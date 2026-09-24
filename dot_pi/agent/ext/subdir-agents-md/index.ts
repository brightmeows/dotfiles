/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录规则文件：LLM 访问某路径时，按需发现并将“管辖”该路径的
 * 子目录规则文件内容直接注入上下文（Pi 默认只向上加载，不向下递归；上游
 * #4834 已确认不进核心，扩展是官方认可的实现位置，用户消息通道注入不伤
 * provider 端 prompt cache）。
 *
 * 设计要点（2026-09-14 重构）：
 * - 触发：tool_call 时提取被访问路径，仅信结构化工具（read/write/edit）
 *   的 input.path（三者路径参数名统一为 path，2026-09-14 dump schema 实测
 *   确认）。bash 全 token 扫描通道已移除：rg/grep 等搜索命令的模式与参数
 *   会被存在性过滤放行、误当访问路径触发无关注入（本次重构主因）；业界
 *   同款功能（opencode v2、Claude Code、pi-subdir-context）本就只信结构化
 *   路径。代价：bash 文件操作不再触发注入，兜底只剩模型自发 read 规则
 *   文件。启动索引（session_start BFS 扫描 + 索引消息）一并移除。
 * - 锚点与查找：文件路径算锚点目录（所在目录 + 去扩展名 co-located 目录，
 *   如 src/memory.rs → src 与 src/memory），向上逐目录选定规则文件
 *   （AGENTS.override.md > AGENTS.md > CLAUDE.md，override 语义同 Pi 核心
 *   启动加载），止于 cwd（不含：根规则文件由 Pi 原生加载）。路径统一展开
 *   ~ 前缀并 realpath 归一（symlink 指向 cwd 外时放弃注入）。
 * - 注入（双消息 + steer，2026-09-24 起）：context 事件对未注入的规则文件投
 *   两条 custom_message——提示条（content 为单行“[自动注入]”文案，display:
 *   true，Pi 默认渲染恰好显示这一行）+ 全文条（content 为规则全文，display:
 *   false，进 LLM 上下文、TUI 静默，实测确认）。两条均携 details.rel/hash
 *   供去重状态机查库；用户知情面由提示条承担，无需自定义渲染器。
 *   （2026-09-24 前为单条 display:true 消息 + 包内 inject-notice.ts 渲染器
 *   折叠，随覆写模式移除废止。）
 * - 去重状态机（2026-09-08 补在途登记）：投递生效是最终一致的——steer 消息
 *   入队后要经 runLoop drain 才落库，窗口期内 buildContextEntries 查不到已
 *   投递内容；只查库会把“在途”误判为“未投递”而重复投递（实测：pi 0.85.1
 *   长 run 多轮触达同子树时同 rel 多次 SEND）。故三态建模：未投递 → 已投递
 *   （sentRels/sentHashes 实例级登记，权威）→ 已落库（buildContextEntries
 *   可见）。判定命中“已投递 ∪ 已落库”即跳过；确认落库后从登记摘除（后续
 *   由库查询兜底）；compact 清空登记允许重注入。库查询本身 compact-aware
 *   （压缩后条目消失自然回到可注入态）。哈希存 custom_message 的 details
 *   （不进 LLM）。代理用 read 显式读取过的规则文件（explicitlyRead 集合，含
 *   override/CLAUDE 命名）亦跳过——内容已作为 tool_result 进 LLM；compact
 *   后清空允许重注入。已知限制：pi 0.85.1 存在把单次 steer 投递重复落库的
 *   运行时问题（上游 issue 跟进中），本登记只能消除扩展侧重复投递，无法
 *   消除运行时双写。
 * - read 重复防护（2026-09-14 新增）：注入消息下一轮才进上下文，模型当轮
 *   read 已注入的规则文件时并不知情，可能再读一遍（内容两份进上下文）。
 *   tool_result 拦截：read 命中已注入（在途登记 ∪ 已落库）的规则文件时，
 *   在结果尾部追加“已注入勿重复读”提示——内容仍真实返回，判定出错无损失；
 *   拦截模式与 better-skill read-hint 同款（tool_result 链式中间件，各自
 *   patch 不同内容，互不冲突）。
 *
 * 规则：仅注入 cwd 严格子目录（根规则文件由 Pi 原生加载）；不截断、
 * 不做 git-ignore 过滤。
 *
 * 目录组织：一包一扩展（2026-08-30 拆包），index.ts 为包入口；纯路径
 * 解析归 internal/path-extract.ts（可用 node 独立测试）。
 */

import type { CustomMessageEntry, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  anchorDirs,
  expandHome,
  findAncestorContextFiles,
  isContextFilename,
  realpathOr,
} from "./internal/path-extract.ts";

/** 注入消息的固定 customType（去重键 + 提示条标签，Pi 默认渲染按它显示 [标签]） */
const CUSTOM_TYPE = "subdir-agents-md";

// ── 注入提示文案 ──

/** 懒注入提示（统一格式 [自动注入] <来源>：<说明>；提示条 content 与 details.notice） */
const injectNotice = (rel: string): string => `[自动注入] ./${rel}：子目录规则已注入`;

/** 已注入规则文件被 read 时的 tool_result 追加提示（统一 [自动注入] 格式） */
const readHint = (rel: string): string => `[自动注入] ./${rel}：内容已自动注入上下文，无需重复读取`;

/** 是否本扩展注入的 custom_message 条目（customType 精确或旧格式带 rel 后缀） */
function isInjectEntry(e: CustomMessageEntry): boolean {
  return e.customType === CUSTOM_TYPE || e.customType.startsWith(`${CUSTOM_TYPE}:`);
}

/** 从注入条目提取 rel（details.rel 优先；旧格式回落 customType 后缀） */
function entryRel(e: CustomMessageEntry): string | undefined {
  const rel = (e.details as { rel?: string } | undefined)?.rel;
  if (rel !== undefined) {
    return rel;
  }
  return e.customType.startsWith(`${CUSTOM_TYPE}:`)
    ? e.customType.slice(CUSTOM_TYPE.length + 1)
    : undefined;
}

// ── 内容哈希（品牌类型，同内容多子包去重） ──

/** SHA256 十六进制摘要的品牌类型；仅由 hashOf 构造，禁止任意字符串冒充 */
type Hash = string & { readonly __brand: "Hash" };

/** 计算内容的 sha256 摘要（唯一构造 Hash 的入口） */
function hashOf(content: string): Hash {
  return createHash("sha256").update(content).digest("hex") as Hash;
}

// ── 路径提取 ──

/**
 * 从工具调用参数提取被访问路径（相对 root；~ 展开与 realpath 归一后）。
 * 仅信结构化工具的 input.path（read/write/edit 路径参数名统一为 path）。
 * 返回空数组表示无可提取路径；root 外（含 symlink 逃逸）丢弃。
 */
function extractAccessedPaths(
  input: Record<string, unknown> | undefined | null,
  root: string,
): string[] {
  if (!input) {
    return [];
  }

  const p = input["path"];
  if (typeof p !== "string" || p.length === 0) {
    return [];
  }
  const resolved = realpathOr(path.resolve(root, expandHome(p)));
  const rel = path.relative(root, resolved);
  if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return [];
  }
  return [rel];
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
  /** 代理用 read 显式读取过的规则文件相对路径（compact 后清空，允许重注入） */
  const explicitlyRead = new Set<string>();
  /** 已投递待落库的 rel（在途登记：落库前防重复投递；确认落库后摘除） */
  const sentRels = new Set<string>();
  /** 已投递待落库的内容哈希（同上，同内容多 rel 场景；品牌类型防任意串冒充） */
  const sentHashes = new Set<Hash>();
  // 工具调用时按访问路径发现待注入的规则文件（仅收集相对路径，不读内容）
  pi.on("tool_call", async (event, ctx) => {
    const root = realpathOr(ctx.cwd);
    const accessed = extractAccessedPaths(event.input, root);
    if (accessed.length === 0) {
      return;
    }

    // 代理用 read 显式读取了规则文件本身 → 标记，context 阶段跳过注入：
    // 内容已作为 tool_result 进 LLM，重复注入纯浪费 token。仅限 read 工具
    // ——bash 通道已移除，其余工具不会读到规则文件全文
    if (event.toolName === "read") {
      for (const rel of accessed) {
        if (isContextFilename(path.basename(rel))) {
          explicitlyRead.add(rel);
        }
      }
    }

    for (const rel of accessed) {
      for (const anchor of anchorDirs(path.resolve(root, rel))) {
        for (const found of findAncestorContextFiles(anchor, root)) {
          pending.add(found);
        }
      }
    }
  });

  // 已注入的规则文件被 read 时，结果尾部追加提示，防代理不知情重复读取：注入
  // 消息下一轮才进上下文，模型当轮 read 时并不知道规则已在上下文里
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError) {
      return;
    }
    const raw = event.input?.["path"];
    if (typeof raw !== "string" || raw.length === 0) {
      return;
    }
    const root = realpathOr(ctx.cwd);
    const resolved = realpathOr(path.resolve(root, expandHome(raw)));
    const rel = path.relative(root, resolved);
    if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
      return;
    }
    if (!isContextFilename(path.basename(rel))) {
      return;
    }
    // 已注入判定：在途登记（本轮刚投递）∪ 已落库（查库，compact-aware）
    const injected =
      sentRels.has(rel) ||
      ctx.sessionManager
        .buildContextEntries()
        .some((e) => e.type === "custom_message" && isInjectEntry(e) && entryRel(e) === rel);
    if (!injected) {
      return;
    }
    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }
    return {
      content: [
        { type: "text" as const, text: `${first.text}\n\n---\n${readHint(rel)}` },
        ...event.content.slice(1),
      ],
    };
  });

  // 下一轮 LLM 调用前：查找去重，未注入的用 custom_message 投递（steer）
  pi.on("context", async (_event, ctx) => {
    const toProcess = [...pending];
    pending.clear();
    if (toProcess.length === 0) {
      return;
    }

    const root = realpathOr(ctx.cwd);

    // 查找当前上下文里已注入的规则文件（compact-aware：原内容被压缩后不再
    // 返回，自然允许重新注入）
    const existing = ctx.sessionManager
      .buildContextEntries()
      .filter((e): e is CustomMessageEntry => e.type === "custom_message" && isInjectEntry(e));
    const inContextRels = new Set(
      existing.map(entryRel).filter((r): r is string => r !== undefined),
    );
    const inContextHashes = new Set<Hash>(
      existing
        .map((e) => (e.details as { hash?: string } | undefined)?.hash)
        .filter((h): h is string => typeof h === "string")
        .map((h) => h as Hash),
    );

    // 在途登记 reconciliation：已确认落库（出现在上下文）的 rel/hash 从登记
    // 摘除，此后由 inContext* 集合兜底；compact 后条目从库查询消失、登记也
    // 已清空，自然回到可注入态
    for (const rel of inContextRels) {
      sentRels.delete(rel);
    }
    for (const hash of inContextHashes) {
      sentHashes.delete(hash);
    }

    for (const rel of toProcess) {
      if (sentRels.has(rel) || inContextRels.has(rel)) {
        continue; // 本实例已投递（在途或已落库），不重复投递
      }
      if (explicitlyRead.has(rel)) {
        continue; // 代理已显式读取，内容已作为 tool_result 进 LLM
      }
      const content = readContent(path.resolve(root, rel));
      if (content === null) {
        continue; // 文件读取失败，允许下次重试
      }
      const hash = hashOf(content);
      if (sentHashes.has(hash) || inContextHashes.has(hash)) {
        continue; // 同内容已投递/已在上下文（别的子包），跳过
      }
      // 双消息投递（2026-09-24）：提示条 display:true 承担知情面（Pi 默认渲染
      // 显示单行），全文条 display:false 进 LLM、TUI 静默；两条均携 rel/hash
      // 供去重状态机查库（2026-09-24 前为单条消息 + 渲染器折叠，已废止）
      const notice = injectNotice(rel);
      const details = { notice, rel, hash };
      pi.sendMessage(
        { customType: CUSTOM_TYPE, content: notice, details, display: true },
        { deliverAs: "steer" },
      );
      pi.sendMessage(
        { customType: CUSTOM_TYPE, content, details, display: false },
        { deliverAs: "steer" },
      );
      // 投递后登记（与 sendMessage 同一同步块，无窗口）：即使消息尚未落库，
      // 后续 context 事件也不会重复投递同一 rel/hash；投递失败（罕见）时
      // 挂起到 compact 才可重试，宁缺毋滥
      sentRels.add(rel);
      sentHashes.add(hash);
    }
  });

  // Compact 后 tool_result 被压缩、代理不再记得内容，允许重新注入（在途登记同理）
  pi.on("session_compact", async () => {
    explicitlyRead.clear();
    sentRels.clear();
    sentHashes.clear();
  });
}
