/**
 * 提交署名配置读取与校验。
 *
 * 配置来源按优先级从低到高：
 *
 * 1. 代码默认值：白小喵 <noreply@pi.dev>
 * 2. 全局文件：<agent dir>/git-attribution.json
 * 3. 仓库文件：<repo root>/.pi/git-attribution.json
 *
 * 合并是字段级的：仓库只写 email 时，name 继续用全局值。配置在
 * session_start 读取一次，/reload 或重启生效。仓库根从会话 cwd 解析，
 * 因此 `git -C` 其他仓库的提交仍使用会话仓库的配置，作为已知边界。
 *
 * 失效模式：文件不存在静默使用上一层；JSON 语法错、字段类型错、空值、
 * 邮箱缺 @ 时告警并保留上一层值；未知键告警并忽略。配置问题不阻塞提交。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AttributionConfig {
  coAuthor: {
    name: string;
    email: string;
  };
}

export const DEFAULT_CONFIG: AttributionConfig = {
  coAuthor: {
    name: "白小喵",
    email: "noreply@pi.dev",
  },
};

const CONFIG_FILENAME = "git-attribution.json";
const TOP_LEVEL_KEYS = new Set(["coAuthor"]);
const CO_AUTHOR_KEYS = new Set(["name", "email"]);
const UNSAFE_NAME_CHARS = /[\p{Cc}<>]/gu;
const WHITESPACE = /\s+/gu;

/** 读取全局与仓库配置，返回字段级合并后的结果。 */
export function loadConfig(cwd: string, agentDir: string): AttributionConfig {
  const config = cloneDefaults();
  applyFile(config, join(agentDir, CONFIG_FILENAME));
  const repoRoot = findRepoRoot(cwd);
  if (repoRoot !== undefined) {
    applyFile(config, join(repoRoot, ".pi", CONFIG_FILENAME));
  }
  return config;
}

/** 把一份已解析的配置合并进目标；供文件读取与单测共用。 */
export function applyConfig(config: AttributionConfig, raw: unknown, source: string): void {
  if (!isRecord(raw)) {
    warn(`${source}: 配置必须是 JSON 对象`);
    return;
  }
  warnUnknownKeys(raw, TOP_LEVEL_KEYS, source);
  const { coAuthor } = raw;
  if (coAuthor === undefined) {
    return;
  }
  if (!isRecord(coAuthor)) {
    warn(`${source}: coAuthor 必须是对象`);
    return;
  }
  warnUnknownKeys(coAuthor, CO_AUTHOR_KEYS, source);

  const name = readNonEmptyString(coAuthor["name"], `${source}: coAuthor.name`);
  if (name !== undefined) {
    config.coAuthor.name = sanitizeName(name);
  }
  const email = readEmail(coAuthor["email"], `${source}: coAuthor.email`);
  if (email !== undefined) {
    config.coAuthor.email = email;
  }
}

/** 清洗姓名；空值退回默认姓名。 */
export function sanitizeName(value: string): string {
  const cleaned = value.replaceAll(UNSAFE_NAME_CHARS, " ").replaceAll(WHITESPACE, " ").trim();
  return cleaned === "" ? DEFAULT_CONFIG.coAuthor.name : cleaned;
}

/** 清洗邮箱；去掉包裹尖括号，缺 @ 时返回 undefined。 */
export function normalizeEmail(value: string): string | undefined {
  let email = value.trim();
  if (email.startsWith("<") && email.endsWith(">")) {
    email = email.slice(1, -1).trim();
  }
  email = email.replaceAll(UNSAFE_NAME_CHARS, "").replaceAll(WHITESPACE, "");
  return email.includes("@") ? email : undefined;
}

function cloneDefaults(): AttributionConfig {
  return {
    coAuthor: { ...DEFAULT_CONFIG.coAuthor },
  };
}

function applyFile(config: AttributionConfig, path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      warn(`${path}: 读取失败：${message(error)}`);
    }
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    warn(`${path}: JSON 解析失败：${message(error)}`);
    return;
  }
  applyConfig(config, raw, path);
}

function findRepoRoot(cwd: string): string | undefined {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return root === "" ? undefined : root;
  } catch {
    return undefined;
  }
}

function readNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    warn(`${label} 必须是字符串`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    warn(`${label} 不能为空`);
    return undefined;
  }
  return trimmed;
}

function readEmail(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    warn(`${label} 必须是字符串`);
    return undefined;
  }
  const email = normalizeEmail(value);
  if (email === undefined) {
    warn(`${label} 不是有效邮箱`);
  }
  return email;
}

function warnUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  source: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      warn(`${source}: 未知配置键 ${key}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function warn(text: string): void {
  console.error(`[git-attribution] ${text}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
