/**
 * 纯路径解析库（包内模块，仅被本包入口 import；不依赖 pi 运行时，
 * 可用 node 独立单测）
 *
 * bash 命令提取（2026-09-26 以受控白名单版补回）：2026-09-14 曾因全
 * token 扫描把 rg/grep 的模式与参数误当访问路径而整体砍掉（漏触发主因，
 * bash 是真实会话最常用的文件访问通道）。现仅识别白名单文件操作命令
 * （BASH_FILE_CMDS），分段 + 包装命令跳过 + 存在性过滤三重约束，
 * rg/grep/cat 等搜索读取命令不在白名单，覆盖由结构化工具兜底。
 *
 * 本库只用 node 内建模块（fs/os/path），不 spawn 外部命令、零 npm 运行时
 * 依赖：本地包经 chezmoi copy 分发，部署区无 node_modules，npm 依赖在
 * 运行时无法解析，故 fd 类外部命令与 npm glob 库均不可用（glob 与 $VAR
 * 路径在启发式里按漏报处理，不展开）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 子目录规则文件候选名，按目录内优先级排列（override 语义同 Pi 核心启动加载） */
export const CONTEXT_FILENAMES = ["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"] as const;

/** 是否规则文件名（override / AGENTS.md / CLAUDE.md 均算） */
export function isContextFilename(basename: string): boolean {
  return (CONTEXT_FILENAMES as readonly string[]).includes(basename);
}

/** 展开 ~ 与 ~/ 前缀（path.resolve 不处理波浪号） */
export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** 用 realpath 归一（symlink 解析到真实树）；目标不存在时回落原路径（write 目标场景） */
export function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Current 是否等于 root 或位于其下（严格前缀匹配，避免 /proj-x 误判 /proj） */
function withinRoot(current: string, root: string): boolean {
  return current === root || current.startsWith(root + path.sep);
}

/**
 * 被访问路径（绝对）的锚点目录：目录取自身；文件取所在目录 + 去扩展名的
 * co-located 目录（如 src/memory.rs → src 与 src/memory，后者可能不存在，
 * 无碍）；不存在的路径按文件处理（write 目标场景）
 */
export function anchorDirs(absPath: string): string[] {
  const trimmed = absPath.replace(/\/+$/, "");
  try {
    if (fs.statSync(trimmed).isDirectory()) {
      return [trimmed];
    }
  } catch {
    // 不存在 → 按文件处理
  }
  const ext = path.extname(trimmed);
  const dir = path.dirname(trimmed);
  if (!ext) {
    return [dir];
  }
  const coLocated = trimmed.slice(0, -ext.length);
  return coLocated && coLocated !== dir ? [dir, coLocated] : [dir];
}

/** 目录内按优先级选定规则文件（override > AGENTS.md > CLAUDE.md），无则 null */
export function pickContextFile(dir: string): string | null {
  for (const name of CONTEXT_FILENAMES) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // 下一候选
    }
  }
  return null;
}

// ── bash 白名单启发式 ──

/** 白名单文件操作命令（basename 匹配）；搜索读取类（rg/grep/cat）刻意不收 */
const BASH_FILE_CMDS = new Set([
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "ln",
  "install",
  "rsync",
  "tar",
  "sed",
  "chmod",
  "chown",
]);

/** 会创建目标的命令：目标不存在时回落到最深已存在祖先目录（mkdir -p / cp 新目标） */
const BASH_CREATORS = new Set(["mkdir", "touch", "ln", "cp", "mv", "install"]);

/** 命令包装器：跳过其自身与选项后再取真实命令（sudo -u root rm …） */
const BASH_WRAPPERS = new Set(["sudo", "command", "nice", "nohup", "time", "env", "exec"]);

/** 去除 token 首尾成对引号（无引号级 shell 解析，尽力而为） */
function stripSurroundQuotes(tok: string): string {
  if (tok.length >= 2) {
    const [a] = tok;
    const b = tok[tok.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return tok.slice(1, -1);
    }
  }
  return tok;
}

/** 路径是否存在（文件或目录） */
function existsAny(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 最深已存在祖先目录（target 自身不存在时回落用）；越出 root 返回 null */
function deepestExistingAncestor(target: string, absRoot: string): string | null {
  let dir = path.dirname(target);
  let guard = 0;
  while (guard++ < 64 && withinRoot(dir, absRoot)) {
    if (existsAny(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

/**
 * 从 bash 命令提取被访问路径（相对 absRoot，已 withinRoot + 存在性过滤）。
 * 按 && || ; | 换行分段顺序处理（cd 跟随更新后续段的解析基目录），每段跳过
 * 包装命令后取命令名，仅白名单命令参与；候选 token 跳过选项与 KEY=VAL，
 * 解析失败（glob / $VAR / 模式串）由存在性过滤按漏报处理。
 */
export function extractBashPaths(command: string, absRoot: string): string[] {
  const found = new Set<string>();
  let base = absRoot;

  const record = (tok: string, creator: boolean): void => {
    let target = realpathOr(path.resolve(base, expandHome(tok)));
    if (!withinRoot(target, absRoot)) {
      return;
    }
    if (!existsAny(target)) {
      if (!creator) {
        return;
      }
      const ancestor = deepestExistingAncestor(target, absRoot);
      if (ancestor === null) {
        return;
      }
      target = ancestor;
    }
    const rel = path.relative(absRoot, target);
    if (rel === "") {
      return; // 根规则文件由 Pi 原生加载
    }
    found.add(rel);
  };

  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean).map(stripSurroundQuotes);
    let i = 0;
    // 跳过包装命令与其选项（sudo -u root …）
    while (i < tokens.length) {
      const first = tokens[i];
      if (first === undefined) {
        break;
      }
      const name = path.basename(first);
      if (!BASH_WRAPPERS.has(name)) {
        break;
      }
      i++;
      while (i < tokens.length && tokens[i]?.startsWith("-")) {
        const flag = tokens[i] ?? "";
        i++;
        if (
          (flag === "-u" || flag === "-g" || flag === "--user" || flag === "--group") &&
          i < tokens.length
        ) {
          i++;
        }
      }
    }
    if (i >= tokens.length) {
      continue;
    }
    const cmdToken = tokens[i];
    if (cmdToken === undefined) {
      continue;
    }
    const cmd = path.basename(cmdToken);
    const args = tokens.slice(i + 1);

    if (cmd === "cd") {
      // 目标必须真实存在才更新基目录（失败的 cd 后续路径仍相对原目录）
      const [cdTarget] = args;
      if (cdTarget !== undefined) {
        const target = realpathOr(path.resolve(base, expandHome(cdTarget)));
        if (withinRoot(target, absRoot) && existsAny(target)) {
          base = target;
        }
      }
      continue;
    }
    if (!BASH_FILE_CMDS.has(cmd)) {
      continue;
    }
    const creator = BASH_CREATORS.has(cmd);
    for (const tok of args) {
      if (tok.startsWith("-") || tok.includes("=")) {
        continue; // 选项与 KEY=VAL（env 包装残留）
      }
      record(tok, creator);
    }
  }
  return [...found];
}

/**
 * 从 absDir 向上查找各目录选定的规则文件，止于 absRoot（不含：根规则文件
 * 已由 Pi 原生加载）。返回相对 absRoot 的路径，近 → 远。
 */
export function findAncestorContextFiles(absDir: string, absRoot: string): string[] {
  const results: string[] = [];
  if (!withinRoot(absDir, absRoot)) {
    return results;
  }
  let current = absDir;
  let guard = 0;
  while (withinRoot(current, absRoot) && guard++ < 64) {
    if (current !== absRoot) {
      const picked = pickContextFile(current);
      if (picked) {
        results.push(path.relative(absRoot, picked));
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    } // 文件系统根
    current = parent;
  }
  return results;
}
