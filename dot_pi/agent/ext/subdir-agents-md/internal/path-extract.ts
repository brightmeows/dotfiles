/**
 * 纯路径/命令解析库（包内模块，仅被本包入口 import；不依赖 pi 运行时，
 * 可用 node 独立单测）
 *
 * bash 提取策略（2026-09-08 重构，替代旧“命令白名单 + 首操作数”正则）：
 * 旧正则对 rg/grep 等模式优先的命令会把模式当路径、对 fd 等未白名单命令
 * 完全失配、对带独立值的 flag 会把值当路径——扩展触发不稳定的主因。现改
 * 为全 token 扫描 + 存在性过滤：简易 shell 词法切分整条命令，丢弃 flag 与
 * 纯数字，保留“含 / 的 token（覆盖 glob、重定向目标、深层新建文件）”与
 * “磁盘真实存在的 token”。已知取舍：不做变量展开（$DIR/x 提取不到）；
 * 误报（如 --exclude node_modules）锚点向上通常只达已被排除的根，代价仅
 * 几次 stat 调用，注入另有 hash 去重兜底。
 *
 * 本库只用 node 内建模块（fs/os/path），不 spawn 外部命令、零 npm 运行时
 * 依赖：本地包经 chezmoi copy 分发，部署区无 node_modules，npm 依赖在
 * 运行时无法解析，故 fd 类外部命令与 npm glob 库均不可用。
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
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** realpath 归一（symlink 解析到真实树）；目标不存在时回落原路径（write 目标场景） */
export function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** token 分隔符：空白与 shell 结构符（管道、链、后台、子 shell、重定向、命令替换反引号） */
const SEPARATORS = new Set([" ", "\t", "\n", "\r", "|", "&", ";", "(", ")", "<", ">", "`"]);

/** 简易 shell 词法切分：引号内保留空格与分隔符；不做变量/命令替换展开 */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (SEPARATORS.has(ch)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** rel 是否落在 root 内（非空、非向上、非绝对；".." 前缀检查防 "..weird" 误伤） */
function withinRootRel(rel: string): boolean {
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !path.isAbsolute(rel);
}

/**
 * bash 命令 → 路径候选（相对 root）。flag（-x / --xx）与纯数字丢弃；
 * 含 / 的 token 直接保留，无 / 的 token 仅磁盘真实存在才保留。
 * root 外（含 symlink 逃逸）丢弃。
 */
export function bashPathCandidates(cmd: string, root: string): string[] {
  const results = new Set<string>();
  for (const token of tokenizeCommand(cmd)) {
    if (token.startsWith("-") && token.length > 1) continue;
    if (/^\d+$/.test(token)) continue;
    const resolved = realpathOr(path.resolve(root, expandHome(token)));
    const rel = path.relative(root, resolved);
    if (!withinRootRel(rel)) continue;
    if (token.includes("/") || fs.existsSync(resolved)) results.add(rel);
  }
  return [...results];
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
    if (fs.statSync(trimmed).isDirectory()) return [trimmed];
  } catch {
    // 不存在 → 按文件处理
  }
  const ext = path.extname(trimmed);
  const dir = path.dirname(trimmed);
  if (!ext) return [dir];
  const coLocated = trimmed.slice(0, -ext.length);
  return coLocated && coLocated !== dir ? [dir, coLocated] : [dir];
}

/** 目录内按优先级选定规则文件（override > AGENTS.md > CLAUDE.md），无则 null */
export function pickContextFile(dir: string): string | null {
  for (const name of CONTEXT_FILENAMES) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 下一候选
    }
  }
  return null;
}

/**
 * 受限 BFS 扫描 root 下的规则文件候选（含根目录自身层级，是否算“子目录”
 * 由调用方过滤）：限深 maxDepth（按路径段计）、限量 maxFiles（软上限），
 * 目录内按名字排序保证确定性；跳过 node_modules/.git 与 symlink 目录
 * （防环/防逃逸，与 realpath 归一策略一致），不跳隐藏目录（dotfiles 仓库
 * 规则常在 dot_* 下）。
 */
export function scanContextFiles(root: string, maxDepth: number, maxFiles: number): string[] {
  const skip = new Set(["node_modules", ".git"]);
  const results: string[] = [];
  let frontier = [root];
  let visited = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of frontier) {
      if (visited++ > 500) {
        return results;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // 无权限/已消失，跳过
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (isContextFilename(entry.name)) {
          if (entry.isFile()) results.push(path.relative(root, abs));
        } else if (entry.isDirectory() && !skip.has(entry.name) && !entry.isSymbolicLink()) {
          next.push(abs);
        }
      }
      if (results.length >= maxFiles) {
        return results;
      }
    }
    frontier = next;
  }
  return results;
}

/**
 * 从 absDir 向上查找各目录选定的规则文件，止于 absRoot（不含：根规则文件
 * 已由 Pi 原生加载）。返回相对 absRoot 的路径，近 → 远。
 */
export function findAncestorContextFiles(absDir: string, absRoot: string): string[] {
  const results: string[] = [];
  if (!withinRoot(absDir, absRoot)) return results;
  let current = absDir;
  let guard = 0;
  while (withinRoot(current, absRoot) && guard++ < 64) {
    if (current !== absRoot) {
      const picked = pickContextFile(current);
      if (picked) results.push(path.relative(absRoot, picked));
    }
    const parent = path.dirname(current);
    if (parent === current) break; // 文件系统根
    current = parent;
  }
  return results;
}
