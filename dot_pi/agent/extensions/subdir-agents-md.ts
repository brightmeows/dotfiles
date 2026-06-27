/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录 AGENTS.md：当 LLM 访问某路径时，按需发现并注入"管辖"
 * 该路径的子目录 AGENTS.md。
 *
 * 背景：Pi 默认只向上加载 AGENTS.md（cwd → 父目录 → 全局），不向下递归。
 * 本扩展补足这一缺口。
 *
 * 设计（懒加载，零启动成本）：
 * - 不在 session_start 全树扫描，不 fork git 进程。
 * - 工具调用时（read/write/edit/bash cd 等）计算被访问路径的锚点目录
 *   （文件所在目录 + 去扩展名的 co-located 目录，如 src/memory.rs →
 *   src 与 src/memory），从各锚点向上查找 AGENTS.md（含锚点自身，止于
 *   cwd、不含根），收集未加载者。
 *   一条访问路径即覆盖三种命中：访问子目录本身 / 访问子目录内文件 /
 *   访问子目录的同名兄弟文件。
 * - 下一轮 LLM 调用前（context 事件）将内容以 user 消息注入消息列表。
 *
 * 规则：
 * - 每个 AGENTS.md 每 session 最多注入一次；compact 后重置，允许重新注入。
 * - 仅注入 cwd 严格子目录中的 AGENTS.md；根 AGENTS.md 由 Pi 原生加载。
 * - 不做 git-ignore 过滤：懒加载下仅处理实际被访问的路径，风险面小；
 *   即便命中被忽略目录的 AGENTS.md，注入也无副作用。
 *
 * 注入方式参考 receiving-review.ts：context 事件推送至消息列表。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 路径提取 ──

/** 解析 bash 命令中首个操作数路径（跳过 flags），支持可选引号 */
function parseBashPath(cmd: string, cwd: string): string | null {
  const m = cmd
    .trim()
    .match(
      /^(?:cd|pushd|ls|ll|la|cat|head|tail|less|more|rg|grep|find|stat|du|file)\b(?:\s+-\S*)*\s+(["']?)([^"'\s]+)\1/,
    );
  return m?.[2] ? path.relative(cwd, path.resolve(cwd, m[2])) : null;
}

/** 从工具调用参数提取被访问路径（相对 cwd，已规范化，解析 .. 与绝对路径） */
function extractAccessedPath(
  toolName: string,
  input: Record<string, unknown> | undefined | null,
  cwd: string,
): string | null {
  if (!input) {
    return null;
  }

  if (toolName === "bash") {
    const cmd = input["command"];
    return typeof cmd === "string" ? parseBashPath(cmd, cwd) : null;
  }

  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? path.relative(cwd, path.resolve(cwd, p)) : null;
}

// ── 锚点与向上查找 ──

/** Current 是否等于 root 或位于其下（严格前缀匹配，避免 /proj-x 误判 /proj） */
function withinRoot(current: string, root: string): boolean {
  return current === root || current.startsWith(root + path.sep);
}

/**
 * 计算被访问路径（绝对）的锚点目录：
 * - 目录 → [自身]
 * - 文件 → [所在目录, 去扩展名的 co-located 目录]（后者可能不存在，无碍）
 * - 不存在（如 write 目标）→ 按文件处理
 */
function anchorDirs(absPath: string): string[] {
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

/**
 * 从 absDir 向上查找 AGENTS.md，止于 absRoot（不含 absRoot：根 AGENTS.md
 * 已由 Pi 原生加载）。返回相对 absRoot 的路径，近 → 远。
 */
function findAncestorAgentsMd(absDir: string, absRoot: string): string[] {
  const results: string[] = [];
  if (!withinRoot(absDir, absRoot)) {
    return results;
  }

  let current = absDir;
  let guard = 0;
  while (withinRoot(current, absRoot) && guard++ < 64) {
    if (current !== absRoot) {
      const md = path.join(current, "AGENTS.md");
      try {
        if (fs.statSync(md).isFile()) {
          results.push(path.relative(absRoot, md));
        }
      } catch {
        // 无 AGENTS.md
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break; // 文件系统根
    }
    current = parent;
  }
  return results;
}

// ── 格式化 ──

function formatContent(relPaths: string[], cwd: string): string {
  const parts: string[] = ["以下为本项目子目录中的 AGENTS.md，适用于你正在访问的子包："];
  for (const rel of relPaths) {
    let content: string;
    try {
      content = fs.readFileSync(path.resolve(cwd, rel), "utf8").trim();
    } catch {
      continue; // 注入前被删除
    }
    parts.push("", `## ./${rel}`, "", content);
  }
  return parts.join("\n");
}

function depth(rel: string): number {
  return rel.split(path.sep).length;
}

// ── Extension ──

export default function subdirAgentsMdExtension(pi: ExtensionAPI) {
  const loaded = new Set<string>();
  const pending = new Set<string>();
  let displayCwd = "";

  // 新 session / reload / resume / fork：重置状态
  pi.on("session_start", async () => {
    loaded.clear();
    pending.clear();
  });

  // 工具调用时按访问路径发现待注入的 AGENTS.md
  pi.on("tool_call", async (event, ctx) => {
    displayCwd = ctx.cwd;
    const accessed = extractAccessedPath(event.toolName, event.input, ctx.cwd);
    if (!accessed) {
      return;
    }

    const root = path.resolve(ctx.cwd);
    const accessedAbs = path.resolve(ctx.cwd, accessed);
    for (const anchor of anchorDirs(accessedAbs)) {
      for (const rel of findAncestorAgentsMd(anchor, root)) {
        if (!loaded.has(rel)) {
          pending.add(rel);
        }
      }
    }
  });

  // 下一轮 LLM 调用前注入 pending
  pi.on("context", async (event, ctx) => {
    if (pending.size === 0) {
      return;
    }

    const toLoad = [...pending].filter((p) => !loaded.has(p));
    pending.clear();
    if (toLoad.length === 0) {
      return;
    }

    toLoad.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    for (const p of toLoad) {
      loaded.add(p);
    }

    event.messages.push({
      content: [{ text: formatContent(toLoad, displayCwd), type: "text" }],
      role: "user",
      timestamp: Date.now(),
    });

    ctx.ui.notify(`subdir-agents-md: ${toLoad.map((r) => `./${r}`).join(", ")}`, "info");

    return { messages: event.messages };
  });

  // Compact 后重置已加载记录，允许重新注入
  pi.on("session_compact", async () => {
    loaded.clear();
  });
}
