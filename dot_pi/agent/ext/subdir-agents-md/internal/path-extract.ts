/**
 * 纯路径解析库（包内模块，仅被本包入口 import；不依赖 pi 运行时，
 * 可用 node 独立单测）
 *
 * bash 命令提取通道已移除（2026-09-14）：此前的全 token 扫描 + 存在性
 * 过滤对 rg/grep 等搜索命令会把模式与参数误当访问路径，触发无关注入；
 * 扩展触发面收敛为仅结构化工具的 input.path（业界同款基线）。
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
