#!/usr/bin/env node
/**
 * 校验 dot_agents_meow 声明的 workflow-skills 依赖。
 *
 * 模式：
 * - --decl-only：只解析 AGENTS.md 的技能清单并对照 skills.lock.json，不读本机状态，CI 可跑。
 * - --warn：声明校验加本机安装校验，机器问题只告警，pre-commit 使用。
 * - --strict：声明校验加本机安装校验，缺装、换源、hash 不符都失败，手动闸门使用。
 * - --write-lock：从 workflow-skills 检出重新生成 skills.lock.json。
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AGENTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENTS_PATH = join(AGENTS_DIR, "AGENTS.md");
const LOCK_PATH = join(AGENTS_DIR, "skills.lock.json");
const SOURCE = "brightmeows/workflow-skills";
const SKILLS_ROOT = join(homedir(), ".agents", "skills");
const STATE_LOCK_PATH = process.env.XDG_STATE_HOME
  ? join(process.env.XDG_STATE_HOME, "skills", ".skill-lock.json")
  : join(homedir(), ".agents", ".skill-lock.json");

const SKILL_LINE = /^-\s+`([a-z0-9][a-z0-9-]*)`：(.+)$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function parseDeclaredSkills(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^###\s+工作流技能\s*$/u.test(line));
  if (start === -1) {
    throw new Error("找不到“### 工作流技能”节");
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,3}\s/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  const skills = [];
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(SKILL_LINE);
    if (match) {
      skills.push({ name: match[1], description: match[2].trim() });
    }
  }
  if (skills.length === 0) {
    throw new Error("“工作流技能”节没有解析到技能条目");
  }
  const seen = new Set();
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      throw new Error(`技能重复：${skill.name}`);
    }
    seen.add(skill.name);
  }
  return skills;
}

export function readLock(path = LOCK_PATH) {
  const lock = JSON.parse(readFileSync(path, "utf8"));
  if (lock.version !== 1) {
    throw new Error(`skills.lock.json 版本不支持：${lock.version}`);
  }
  if (lock.source !== SOURCE) {
    throw new Error(`skills.lock.json 来源不符：${lock.source}`);
  }
  if (lock.skills === null || typeof lock.skills !== "object") {
    throw new Error("skills.lock.json 缺少 skills");
  }
  for (const [name, digest] of Object.entries(lock.skills)) {
    if (typeof digest !== "string" || !DIGEST.test(digest)) {
      throw new Error(`skills.lock.json 的 ${name} 摘要格式不正确`);
    }
  }
  return lock;
}

export function compareDeclaration(declared, lock) {
  const declaredNames = new Set(declared.map((skill) => skill.name));
  const lockedNames = new Set(Object.keys(lock.skills));
  return {
    missing: [...declaredNames].filter((name) => !lockedNames.has(name)),
    extra: [...lockedNames].filter((name) => !declaredNames.has(name)),
  };
}

export function computeFolderHash(skillDir) {
  const files = [];
  collectFiles(skillDir, skillDir, files);
  const sortedFiles = files.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const hash = createHash("sha256");
  for (const file of sortedFiles) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return `sha256:${hash.digest("hex")}`;
}

function collectFiles(baseDir, currentDir, results) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      collectFiles(baseDir, fullPath, results);
    } else if (entry.isFile()) {
      results.push({
        relativePath: relative(baseDir, fullPath).split("\\").join("/"),
        content: readFileSync(fullPath),
      });
    }
  }
}

function readStateLock() {
  try {
    const lock = JSON.parse(readFileSync(STATE_LOCK_PATH, "utf8"));
    if (lock.version !== 3 || lock.skills === null || typeof lock.skills !== "object") {
      return undefined;
    }
    return lock;
  } catch {
    return undefined;
  }
}

export function checkInstalled(declared, lock, stateLock) {
  const errors = [];
  const warnings = [];
  let skillsRootExists = true;
  try {
    skillsRootExists = statSync(SKILLS_ROOT).isDirectory();
  } catch {
    skillsRootExists = false;
  }
  if (!skillsRootExists) {
    errors.push(`技能目录不存在：${SKILLS_ROOT}`);
    return { errors, warnings };
  }
  if (stateLock === undefined) {
    errors.push(`npx 状态锁不存在或版本不支持：${STATE_LOCK_PATH}`);
  }
  for (const { name } of declared) {
    const skillDir = join(SKILLS_ROOT, name);
    let installed = false;
    try {
      installed = statSync(skillDir).isDirectory();
    } catch {
      installed = false;
    }
    if (!installed) {
      errors.push(`${name}：未安装（${skillDir}）`);
      continue;
    }
    if (stateLock !== undefined) {
      const entry = stateLock.skills[name];
      if (entry === undefined) {
        errors.push(`${name}：npx 状态锁没有记录，无法校验来源`);
      } else {
        if (entry.source !== SOURCE) {
          errors.push(`${name}：来源是 ${entry.source}，期望 ${SOURCE}`);
        }
        if (entry.skillPath !== `skills/${name}/SKILL.md`) {
          errors.push(`${name}：skillPath 是 ${entry.skillPath}，期望 skills/${name}/SKILL.md`);
        }
      }
    }
    const actual = computeFolderHash(skillDir);
    const expected = lock.skills[name];
    if (actual !== expected) {
      warnings.push(`${name}：目录 hash 不符（期望 ${expected}，实际 ${actual}）`);
    }
  }
  return { errors, warnings };
}

function writeLock(sourceDir) {
  const declared = parseDeclaredSkills(readFileSync(AGENTS_PATH, "utf8"));
  const skills = {};
  for (const { name } of declared) {
    const skillDir = join(sourceDir, "skills", name);
    let exists = false;
    try {
      exists = statSync(skillDir).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      throw new Error(`workflow-skills 检出里没有技能目录：${skillDir}`);
    }
    skills[name] = computeFolderHash(skillDir);
  }
  const sorted = Object.entries(skills).toSorted(([left], [right]) => left.localeCompare(right));
  const lock = {
    version: 1,
    source: SOURCE,
    skills: Object.fromEntries(sorted),
  };
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`skills: 写入 ${LOCK_PATH}（${declared.length} 项）`);
}

function printDeclarationProblems(declared, lock) {
  const { missing, extra } = compareDeclaration(declared, lock);
  let failed = false;
  for (const name of missing) {
    console.error(`skills: 错误：AGENTS.md 声明了 ${name}，skills.lock.json 没有对应摘要`);
    failed = true;
  }
  for (const name of extra) {
    console.error(`skills: 错误：skills.lock.json 有 ${name}，AGENTS.md 没有声明`);
    failed = true;
  }
  return failed;
}

function main(argv) {
  const mode = ["decl-only", "warn", "strict", "write-lock"].find((name) =>
    argv.includes(`--${name}`),
  );
  if (mode === undefined) {
    console.error(
      "用法：check-skills.mjs --decl-only | --warn | --strict | --write-lock [--source-dir <path>]",
    );
    process.exit(2);
  }
  if (mode === "write-lock") {
    const sourceIndex = argv.indexOf("--source-dir");
    const sourceDir =
      sourceIndex === -1
        ? join(homedir(), "Codes", "workflow-skills")
        : resolve(argv[sourceIndex + 1]);
    writeLock(sourceDir);
    return;
  }
  const declared = parseDeclaredSkills(readFileSync(AGENTS_PATH, "utf8"));
  const lock = readLock();
  if (printDeclarationProblems(declared, lock)) {
    process.exit(1);
  }
  if (mode === "decl-only") {
    console.log(`skills: 声明与锁一致（${declared.length} 项）`);
    return;
  }
  const stateLock = readStateLock();
  const { errors, warnings } = checkInstalled(declared, lock, stateLock);
  for (const message of warnings) {
    console.warn(`skills: 警告：${message}`);
  }
  for (const message of errors) {
    if (mode === "strict") {
      console.error(`skills: 错误：${message}`);
    } else {
      console.warn(`skills: 警告：${message}`);
    }
  }
  if (mode === "strict" && (errors.length > 0 || warnings.length > 0)) {
    process.exit(1);
  }
  if (mode === "warn") {
    console.log(
      `skills: 声明一致（${declared.length} 项）；本机 ${errors.length + warnings.length} 项告警`,
    );
  } else {
    console.log(
      `skills: 声明一致（${declared.length} 项）；本机 ${errors.length} 错误、${warnings.length} 警告`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`skills: 错误：${error.message}`);
    process.exit(1);
  }
}
