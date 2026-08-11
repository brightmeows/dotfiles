/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录 AGENTS.md：LLM 访问某路径时，按需发现并将"管辖"该路径
 * 的子目录 AGENTS.md 内容直接注入上下文（Pi 默认只向上加载，不向下递归）。
 *
 * 设计要点：
 * - 懒加载、零启动成本：不预扫描、不 fork git；工具调用时计算被访问路径
 *   的锚点目录（文件所在目录 + 去扩展名的 co-located 目录，如 src/memory.rs
 *   → src 与 src/memory），向上查找 AGENTS.md（含锚点，止于 cwd、不含根）。
 * - 注入（custom_message + steer）：context 事件对未注入的 AGENTS.md 用
 *   pi.sendMessage 投递 custom_message（display:true），完整内容下一轮进
 *   LLM context；registerMessageRenderer 让 TUI 只渲染“已注入”标记而非
 *   完整内容（display 只控 TUI 渲染，content 总进 LLM）。
 * - 去重靠查找（buildContextEntries）：用 compact-aware 的 buildContextEntries
 *   查找已注入的 customType（同文件去重）与 details.hash（同内容多子包去重）；
 *   命中则跳过，compact 压缩后查不到则重新注入。哈希存 custom_message 的
 *   details（不进 LLM）。代理用 read 显式读取过的 AGENTS.md（explicitlyRead
 *   集合）亦跳过——内容已作为 tool_result 进 LLM；compact 后清空允许重注入。
 *
 * 规则：仅注入 cwd 严格子目录（根 AGENTS.md 由 Pi 原生加载）；不截断、
 * 不过滤 git-ignore。
 */

import type { CustomMessageEntry, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Text } from "@earendil-works/pi-tui";

/** custom_message 的 customType 前缀，后接 AGENTS.md 相对路径（进 LLM + TUI 渲染查找键） */
const CUSTOM_TYPE_PREFIX = "subdir-agents-md:";

// ── 注入提示文案 ──

/** 注入内容段的标记头 */
const injectNotice = (rel: string): string => `[自动注入] ./${rel}`;

// ── 内容哈希（品牌类型，同内容多子包去重） ──

/** SHA256 十六进制摘要的品牌类型；仅由 hashOf 构造，禁止任意字符串冒充 */
type Hash = string & { readonly __brand: "Hash" };

/** 计算内容的 sha256 摘要（唯一构造 Hash 的入口） */
function hashOf(content: string): Hash {
  return createHash("sha256").update(content).digest("hex") as Hash;
}

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

// ── 内容读取 ──

/** 读取文件内容（读取失败返回 null，调用方据此跳过并允许下次重试） */
function readContent(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

// ── Extension ──

export default function subdirAgentsMdExtension(pi: ExtensionAPI) {
  /** 待处理的相对路径（tool_call 收集，context 消费；Set 自动去重） */
  const pending = new Set<string>();
  /** 代理用 read 显式读取过的 AGENTS.md 相对路径（compact 后清空，允许重注入） */
  const explicitlyRead = new Set<string>();

  // 工具调用时按访问路径发现待注入的 AGENTS.md（仅收集相对路径，不读内容）
  pi.on("tool_call", async (event, ctx) => {
    const accessed = extractAccessedPath(event.toolName, event.input, ctx.cwd);
    if (!accessed) {
      return;
    }

    // 代理用 read 显式读取了 AGENTS.md 本身 → 标记，context 阶段跳过注入：
    // 内容已作为 tool_result 进 LLM，重复注入纯浪费 token。仅限 read 工具——
    // bash cat 等场景少，且 parseBashPath 难以区分“读全文”与“ls 列目录”
    if (event.toolName === "read" && path.basename(accessed) === "AGENTS.md") {
      explicitlyRead.add(accessed);
    }

    const root = path.resolve(ctx.cwd);
    const accessedAbs = path.resolve(ctx.cwd, accessed);
    for (const anchor of anchorDirs(accessedAbs)) {
      for (const rel of findAncestorAgentsMd(anchor, root)) {
        pending.add(rel);
      }
    }
  });

  // 下一轮 LLM 调用前：查找去重，未注入的用 custom_message 投递（steer）
  pi.on("context", async (_event, ctx) => {
    if (pending.size === 0) {
      return;
    }

    const { cwd } = ctx;
    const toProcess = [...pending];
    pending.clear();

    // 查找当前上下文里已注入的子目录 AGENTS.md（compact-aware：原内容被
    // 压缩后不再返回，自然允许重新注入）
    const existing = ctx.sessionManager
      .buildContextEntries()
      .filter(
        (e): e is CustomMessageEntry =>
          e.type === "custom_message" && e.customType.startsWith(CUSTOM_TYPE_PREFIX),
      );
    const inContextRels = new Set(
      existing.map((e) => e.customType.slice(CUSTOM_TYPE_PREFIX.length)),
    );
    const inContextHashes = new Set(
      existing
        .map((e) => (e.details as { hash?: string } | undefined)?.hash)
        .filter((h): h is string => typeof h === "string"),
    );

    // 同 turn 内已注入的哈希（steer 延迟到下 turn drain，本 turn 多个 pending 靠它去重）
    const seenHashes = new Set<string>();

    for (const rel of toProcess) {
      if (inContextRels.has(rel)) {
        continue; // 同文件已在上下文
      }
      if (explicitlyRead.has(rel)) {
        continue; // 代理已显式读取，内容已作为 tool_result 进 LLM
      }
      const content = readContent(path.resolve(cwd, rel));
      if (content === null) {
        continue; // 文件读取失败，允许下次重试
      }
      const hash = hashOf(content);
      if (inContextHashes.has(hash) || seenHashes.has(hash)) {
        continue; // 同内容已在上下文（别的子包）或本 turn 已注入，跳过
      }
      seenHashes.add(hash);
      // display:true 让 TUI 渲染本条 message；registerMessageRenderer 只显示
      // “已注入”标记，完整内容由 content 进 LLM（display 不影响 content 进
      // LLM，只控 TUI 渲染）。per-rel 注册：getMessageRenderer 按 customType
      // 精确匹配，动态 customType 需逐一注册
      pi.registerMessageRenderer(
        CUSTOM_TYPE_PREFIX + rel,
        (_msg, _opts, t) => new Text(t.fg("dim", injectNotice(rel))),
      );
      pi.sendMessage(
        {
          customType: CUSTOM_TYPE_PREFIX + rel,
          content: `${injectNotice(rel)}\n${content}`,
          details: { hash },
          display: true,
        },
        { deliverAs: "steer" },
      );
    }
  });

  // compact 后 tool_result 被压缩、代理不再记得内容，允许重新注入
  pi.on("session_compact", async () => {
    explicitlyRead.clear();
  });
}
