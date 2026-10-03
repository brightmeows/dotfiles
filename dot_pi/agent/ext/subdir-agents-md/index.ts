/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录规则文件：代理访问某路径时，同步发现“管辖”该路径的子目录
 * 规则文件，把内容直接拼进本次 tool_result（Pi 默认只向上加载，不向下递归；
 * 上游 #4834 已确认不进核心，扩展是官方认可的实现位置）。
 *
 * 设计（2026-10-03 重构：投递改为 turn_end 边界条目，触发仍走 tool_result）：
 * - 触发：tool_result 时提取被访问路径——结构化工具的 input.path
 *   （read/write/edit/grep/find/ls 六个内置工具中带 path 的全部，2026-09-26
 *   dump schema 实测确认）+ bash/powershell 的 input.command 白名单启发式
 *   （见下）。只收集进本回合待投集合，不在此处投递。
 * - 投递：turn_end 回合一并处理待投 rel，返回两条 custom_message 条目
 *   （0.87+ 可操作边界）：短通知（display: true，逐文件 [自动注入] 单行）+
 *   全文（display: false，规则全文，details.subdirAgents 载标记持久去重）。
 *   2026-10-03 实测（`-p` + before_provider_request dump）：直读场景与旧
 *   tool_result 拼接同一次请求可见；codemode only 下嵌套读取（脚本不回传
 *   内容）时拼接会丢、边界条目仍送达——脚本输出不可控，条目通道是唯一
 *   保证送达的通道。不用 continue: true：实测会在回合本会停止时强制多
 *   一轮模型请求，本场景不需要。
 * - 去重（两态）：实例集 injectedRels/injectedHashes ∪ 扫库。扫库读
 *   toolResult 消息 details.subdirAgents（read 自读标记）与 custom_message
 *   条目同键标记（2026-10-03 起注入条目；2026-09-26 前旧版 details.rel/hash
 *   直挂形态的兼容路径保留），compact 后随条目消失自然回到可注入态。
 *   同内容跨 rel 去重靠 hash 标记。
 * - read 语义：代理 read 规则文件本身 → 内容已作为本次 tool_result 返回，
 *   标记 details 不再注入（防同文件两份进上下文）；此前已注入过的再 read
 *   → 结果尾部追加“已注入勿重复读”提示（内容仍真实返回）。
 * - 锚点与查找：文件路径算锚点目录（所在目录 + 去扩展名 co-located 目录，
 *   如 src/memory.rs → src 与 src/memory），向上逐目录选定规则文件
 *   （AGENTS.override.md > AGENTS.md > CLAUDE.md，override 语义同 Pi 核心
 *   启动加载），止于 cwd（不含：根规则文件由 Pi 原生加载）。路径统一展开
 *   ~ 前缀并 realpath 归一（symlink 指向 cwd 外时放弃注入）。
 * - bash 启发式（2026-09-26 补回，受控白名单版）：2026-09-14 曾因全 token
 *   扫描把 rg/grep 的模式误当路径而整体砍掉 bash 通道（漏触发主因）。现
 *   仅识别白名单文件操作命令（cp mv rm rmdir mkdir touch ln install rsync
 *   tar sed chmod chown + cd 跟随），按 && || ; | 换行分段、跳过 sudo 等
 *   包装命令，解析后要求 within cwd；存在性过滤（创建类命令回落到最深已
 *   存在祖先目录）。rg/grep/cat 等搜索读取命令不在白名单（模式误报教训），
 *   其覆盖由结构化 grep/find/ls 工具兜底。已知限制：glob（rm dir/*）与
 *   $VAR 路径不展开，按漏报处理。
 * - 规则文件会话内被修改：injectedRels 按 rel 挡重注入，新内容要等
 *   compact/重启后生效，或由代理自行 read（与旧版行为一致）。
 *
 * 规则：仅注入 cwd 严格子目录（根规则文件由 Pi 原生加载）；不截断、
 * 不做 git-ignore 过滤。
 *
 * 目录组织：一包一扩展（2026-08-30 拆包），index.ts 为包入口；纯路径
 * 解析归 internal/path-extract.ts（可用 node 独立测试）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  anchorDirs,
  expandHome,
  extractBashPaths,
  findAncestorContextFiles,
  isContextFilename,
  realpathOr,
} from "./internal/path-extract.ts";

/** 注入标记写入 toolResult.details 的键（持久化去重；details 不进 LLM） */
const MARK_KEY = "subdirAgents";

/** 注入条目的 customType（扫库识别；兼容 2026-09-26 前旧版条目） */
const CUSTOM_TYPE = "subdir-agents-md";

/** 注入通知单行（条目知情面，统一 [自动注入] 格式） */
const injectNotice = (rel: string): string => `[自动注入] ./${rel}：子目录规则`;

/** 已注入规则文件被 read 时的 tool_result 追加提示（统一 [自动注入] 格式） */
const readHint = (rel: string): string => `[自动注入] ./${rel}：内容已自动注入上下文，无需重复读取`;

// ── 内容哈希（品牌类型，同内容多子包去重） ──

/** SHA256 十六进制摘要的品牌类型；仅由 hashOf 构造，禁止任意字符串冒充 */
type Hash = string & { readonly __brand: "Hash" };

/** 计算内容的 sha256 摘要（唯一构造 Hash 的入口） */
function hashOf(content: string): Hash {
  return createHash("sha256").update(content).digest("hex") as Hash;
}

// ── 注入标记（details.subdirAgents） ──

/** 单条注入标记：rel 必有；hash 仅注入全文时携带（read 自读标记无 hash） */
interface Mark {
  rel: string;
  hash?: string;
}

function isMark(v: unknown): v is Mark {
  return typeof v === "object" && v !== null && typeof (v as { rel?: unknown }).rel === "string";
}

/** 合并标记进 toolResult.details（保留工具自有 details 字段，按 rel 去重） */
function withMarks(details: unknown, marks: Mark[]): unknown {
  const base: Record<string, unknown> =
    typeof details === "object" && details !== null
      ? { ...(details as Record<string, unknown>) }
      : {};
  const prev: Mark[] = Array.isArray(base[MARK_KEY])
    ? (base[MARK_KEY] as unknown[]).filter(isMark)
    : [];
  const seen = new Set(prev.map((m) => m.rel));
  for (const m of marks) {
    if (!seen.has(m.rel)) {
      seen.add(m.rel);
      prev.push(m);
    }
  }
  base[MARK_KEY] = prev;
  return base;
}

// ── 扫库：已注入标记的权威来源（compact-aware） ──

/**
 * 从会话已落库条目收集已注入 rel/hash：
 * - toolResult 消息的 details.subdirAgents（read 自读标记，随结果持久化）
 * - custom_message 条目的 details.subdirAgents（2026-10-03 起注入条目；
 *   更早版本 details.rel/hash 直挂的形态一并兼容）
 */
function scanSessionMarks(ctx: { sessionManager: { buildContextEntries: () => unknown[] } }): {
  rels: Set<string>;
  hashes: Set<Hash>;
} {
  const rels = new Set<string>();
  const hashes = new Set<Hash>();
  for (const entry of ctx.sessionManager.buildContextEntries()) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const e = entry as {
      type?: string;
      customType?: string;
      details?: unknown;
      message?: { role?: string; details?: unknown };
    };
    let details: unknown;
    if (e.type === "message" && e.message?.role === "toolResult") {
      ({ details } = e.message);
    } else if (
      e.type === "custom_message" &&
      typeof e.customType === "string" &&
      (e.customType === CUSTOM_TYPE || e.customType.startsWith(`${CUSTOM_TYPE}:`))
    ) {
      ({ details } = e);
    } else {
      continue;
    }
    if (typeof details !== "object" || details === null) {
      continue;
    }
    const marks =
      (details as Record<string, unknown>)[MARK_KEY] ??
      // 旧版条目把 rel/hash 直接放在 details（无 MARK_KEY 包装）
      (e.type === "custom_message" ? details : undefined);
    if (!Array.isArray(marks)) {
      // 旧版：details 自身带 rel 字段
      const d = details as { rel?: unknown; hash?: unknown };
      if (typeof d.rel === "string") {
        rels.add(d.rel);
        if (typeof d.hash === "string") {
          hashes.add(d.hash as Hash);
        }
      }
      continue;
    }
    for (const raw of marks) {
      if (!isMark(raw)) {
        continue;
      }
      rels.add(raw.rel);
      if (typeof raw.hash === "string") {
        hashes.add(raw.hash as Hash);
      }
    }
  }
  return { rels, hashes };
}

// ── 路径提取 ──

/** 相对 root 的路径（~ 展开与 realpath 归一后）；root 外（含 symlink 逃逸）返回 undefined */
function relOfPath(p: string, root: string): string | undefined {
  const resolved = realpathOr(path.resolve(root, expandHome(p)));
  const rel = path.relative(root, resolved);
  if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel;
}

/**
 * 从工具调用参数提取被访问路径（相对 root）。结构化工具取 input.path；
 * bash/powershell 取 input.command 走白名单启发式。返回去重后的相对路径。
 */
function collectAccessed(
  input: Record<string, unknown> | undefined | null,
  toolName: string,
  root: string,
): string[] {
  if (!input) {
    return [];
  }
  const out: string[] = [];
  const p = input["path"];
  if (typeof p === "string" && p.length > 0) {
    const rel = relOfPath(p, root);
    if (rel !== undefined) {
      out.push(rel);
    }
  }
  if (toolName === "bash" || toolName === "powershell") {
    const cmd = input["command"];
    if (typeof cmd === "string" && cmd.length > 0) {
      out.push(...extractBashPaths(cmd, root));
    }
  }
  return [...new Set(out)];
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
  /** 本实例已注入（或代理已自读）的规则文件 rel（compact 后清空，允许重注入） */
  const injectedRels = new Set<string>();
  /** 本实例已注入过的内容哈希（同内容跨 rel 去重；品牌类型防任意串冒充） */
  const injectedHashes = new Set<Hash>();
  /** 本回合 tool_result 收集到的待投 rel（turn_end 处理并清空） */
  const pendingRels = new Set<string>();

  // 触发：tool_result 只收集被访问路径，投递统一到 turn_end（见文件头设计）
  pi.on("tool_result", async (event, ctx) => {
    const root = realpathOr(ctx.cwd);

    // 代理 read 规则文件本身：内容已作为本次 tool_result 返回，标记后不再注入；
    // 此前已注入过的再 read → 追加勿读提示（注入消息与读取结果重复进上下文）
    if (event.toolName === "read" && !event.isError) {
      const raw = event.input["path"];
      if (typeof raw === "string" && raw.length > 0) {
        const rel = relOfPath(raw, root);
        if (rel !== undefined && isContextFilename(path.basename(rel))) {
          const scanned = scanSessionMarks(ctx);
          if (injectedRels.has(rel) || scanned.rels.has(rel)) {
            const first = event.content.at(0);
            if (first && first.type === "text") {
              return {
                content: [
                  { type: "text" as const, text: `${first.text}\n\n---\n${readHint(rel)}` },
                  ...event.content.slice(1),
                ],
              };
            }
            return undefined;
          }
          injectedRels.add(rel);
          return { details: withMarks(event.details, [{ rel }]) };
        }
      }
    }

    for (const rel of collectAccessed(event.input, event.toolName, root)) {
      pendingRels.add(rel);
    }
    return undefined;
  });

  // 投递：本回合有访问则查找并注入规则条目（短通知 + 全文两条一起出）
  pi.on("turn_end", async (event, ctx) => {
    if (pendingRels.size === 0) {
      return undefined;
    }
    const rels = [...pendingRels];
    pendingRels.clear();

    const root = realpathOr(ctx.cwd);
    const scanned = scanSessionMarks(ctx);
    const newMarks: Mark[] = [];
    const notices: string[] = [];
    const blocks: string[] = [];
    for (const relPath of rels) {
      for (const anchor of anchorDirs(path.resolve(root, relPath))) {
        for (const found of findAncestorContextFiles(anchor, root)) {
          if (injectedRels.has(found) || scanned.rels.has(found)) {
            continue; // 本实例已注入/扫库命中，不重复注入
          }
          const content = readContent(path.resolve(root, found));
          if (content === null) {
            continue; // 文件读取失败，不标记，允许下次重试
          }
          const hash = hashOf(content);
          if (injectedHashes.has(hash) || scanned.hashes.has(hash)) {
            continue; // 同内容已注入（别的 rel），跳过；不标记 rel，内容变化后仍可注入
          }
          injectedRels.add(found);
          injectedHashes.add(hash);
          newMarks.push({ rel: found, hash });
          notices.push(injectNotice(found));
          blocks.push(`${injectNotice(found)}\n\n${content}`);
        }
      }
    }

    if (newMarks.length === 0) {
      return undefined;
    }
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message" as const,
          customType: CUSTOM_TYPE,
          content: notices.join("\n"),
          display: true,
        },
        {
          type: "custom_message" as const,
          customType: CUSTOM_TYPE,
          content: blocks.join("\n\n---\n\n"),
          display: false,
          details: withMarks(undefined, newMarks),
        },
      ],
    };
  });

  // Compact 后注入条目被压缩、代理不再记得内容，允许重新注入
  // （扫库标记随条目一并消失，实例集主动清空回到可注入态）
  pi.on("session_compact", async () => {
    injectedRels.clear();
    injectedHashes.clear();
  });
}
