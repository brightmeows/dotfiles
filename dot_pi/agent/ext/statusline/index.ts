/**
 * 状态栏扩展（statusline）
 *
 * 三行 footer + 输入框下边框速度显示。三行布局自 2026-10 起为自定义
 * （与内置 FooterComponent 分道，迁移经确认）：
 *   行1 pwd 行：左 目录（~ 化）+ (分支) + • 会话名，右 (提供商) 模型 • 档位
 *   行2 stats 行：左 ↑↓ R W CH% $费用[(sub)] [• xp]，右 上下文%/窗口[(auto)]
 *   行3 扩展状态行：ctx.ui.setStatus 的文本（其他扩展的提示经此行生效，
 *                  setStatus 的全局 requestRender 链路不依赖 footer 实现）
 *
 * 下边框速度（pi 无下边框定制钩子，monkey-patch CustomEditor
 * .prototype.renderBottomBorder，thinking-flow 同手法）：
 *   流式中 "── 平均 12.3 · 1s 45.6 tok/s ────"，空闲时保留平均段；
 *   从未流式时保持纯横线；滚动提示（↓ N）优先于速度。
 *   数据采集与口径见 internal/stream-speed.ts 头注释。
 *
 * 内置有而本版省略（数据源扩展侧不可达，经确认接受）：
 *   虚拟模型路由显示（session.routedModel）、(sub) 的
 *   isUsingSubscription 半边（保留 kimi-coding 静态判断）。
 *
 * 行为：
 * - 默认启用（状态文件缺失视为启用）；/statusline 命令切换回内置
 *   footer，开关状态持久化到 <agent-dir>/pi-meow-statusline.json；
 *   切换同时装卸下边框速度 patch
 * - 性能缓存：usage 全量聚合按 (sessionId, leafId, 条目数, model) 签名
 *   缓存（内置 getSessionStats 同语义；扩展侧 ReadonlySessionManager 无
 *   getEntryCount，用 getEntries().length 等价替代——条目 append-only）
 * - (auto) 标记：ctx.getSettings().compaction.enabled !== false（内置取
 *   session.autoCompactionEnabled，扩展侧经 settings 等价读取）
 * - xp 标记：PI_EXPERIMENTAL === "1"（与内置 experimental.js 同判断）
 * - reload 幂等：session_start 重触发时 setFooter 覆盖安装；原生方法与
 *   秒表引用存 globalThis Symbol 槽；缓存存模块槽
 *
 * 依赖事实（pi 1.2.0 实测）：
 * - ctx.getContextUsage / ctx.thinkingLevel / ctx.model / ctx.ui.setFooter
 *   在 session_start ctx 上可用；getContextUsage 的成员名在发布物 d.ts
 *   中被混淆，类型侧走结构化探测
 * - theme.colors 为 token -> RGB 表；theme.fg 仅认 56 语义 token（vars
 *   名直接 throw）且为原型方法（抽离须 bind this）
 * - ctx.ui.setStatus 的重绘走全局 requestRender，与 footer 实现无关，
 *   自定义 footer 内读 footerData.getExtensionStatuses() 即可承接
 * - CustomEditor 从包入口导出；renderBottomBorder 为基类方法（未被
 *   coding-agent 覆写），速度文本色取 globalThis 主题单例（thinking-flow
 *   同款访问路径），不可用时降级裸文本
 *
 * 踩坑点（1.2.0 tmux 实测）：
 * - session_start 同步栈内调用 setFooter 会使 pi 静默退出（官方示例在
 *   命令 handler 内调用故未暴露）：安装经 setTimeout 推迟
 * - footer.render 抛错会击穿 TUI 渲染循环令 pi 静默退出：render 内
 *   try/catch 兜底为空行并落盘诊断；下边框 patch 同款兜底回 original
 * - pi.exec 在会话启动阶段调用同样会使 pi 静默退出（曾用于 dirty 轮询，
 *   dirty 标记已随纯内置化移除，记录留作未来使用 pi.exec 时的警示）
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildFooterLines, formatCwdForFooter, type UsageTotals } from "./internal/footer-lines.ts";
import { createStreamSpeed, formatSpeedText } from "./internal/stream-speed.ts";

// 开关持久化（<agent-dir>/pi-meow-statusline.json，look-pack 同款模式）

const STATE_FILENAME = "pi-meow-statusline.json";
/** 会话启动的 TUI 尚未就绪，推迟安装（实测同步调用会令 pi 静默退出） */
const FOOTER_INSTALL_DELAY_MS = 1000;

const DEBUG_LOG = "/tmp/sl-debug.log";

function debugLog(message: string): void {
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString().slice(11, 23)}] ${message}\n`);
  } catch {
    // 诊断日志失败不影响功能
  }
}

function statePath(): string {
  const dir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  return join(dir, STATE_FILENAME);
}

function readEnabled(): boolean {
  try {
    const raw = readFileSync(statePath(), "utf8");
    return JSON.parse(raw).enabled !== false;
  } catch {
    return true;
  }
}

function writeEnabled(value: boolean): void {
  try {
    writeFileSync(statePath(), JSON.stringify({ enabled: value }), "utf8");
  } catch {
    // 持久化失败不影响本次会话的切换
  }
}

// 流式速度（采集见 internal/stream-speed.ts）

const speed = createStreamSpeed();

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

function speedBorderText(): string | undefined {
  const raw = formatSpeedText(speed.snapshot());
  if (raw === undefined) {
    return undefined;
  }
  const theme = (globalThis as unknown as Record<symbol, unknown>)[THEME_KEY] as
    | { fg?: (token: string, text: string) => string }
    | undefined;
  return typeof theme?.fg === "function" ? theme.fg("dim", raw) : raw;
}

// 下边框 patch（pi 无下边框定制钩子；装卸管理与 reload 幂等同 thinking-flow）

type RenderBottomBorderFn = (this: unknown, width: number, hiddenLineCount: number) => string;

interface BorderEditorLike {
  borderColor?: (str: string) => string;
}

const ORIGINAL_BORDER_KEY = Symbol.for("pi-meow-statusline:original-bottom-border");

/** 速度嵌入下边框左侧；无速度文本/滚动中/宽度不足时回退原生渲染 */
function patchedBottomBorder(this: unknown, width: number, hiddenLineCount: number): string {
  const editor = this as BorderEditorLike;
  const original = (globalThis as unknown as Record<symbol, unknown>)[
    ORIGINAL_BORDER_KEY
  ] as RenderBottomBorderFn;
  try {
    const text = speedBorderText();
    if (hiddenLineCount > 0 || text === undefined || typeof editor.borderColor !== "function") {
      return original.call(this, width, hiddenLineCount);
    }
    const prefix = editor.borderColor("── ") + text + editor.borderColor(" ");
    const prefixWidth = visibleWidth(prefix);
    if (prefixWidth + 1 >= width) {
      return original.call(this, width, hiddenLineCount);
    }
    return prefix + editor.borderColor("─".repeat(width - prefixWidth));
  } catch (error) {
    debugLog(`bottom border error: ${(error as Error).stack ?? error}`);
    return original.call(this, width, hiddenLineCount);
  }
}

function installSpeedBorder(): void {
  const proto = CustomEditor.prototype as unknown as Record<string, unknown>;
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const original =
    (globals[ORIGINAL_BORDER_KEY] as RenderBottomBorderFn | undefined) ??
    (proto["renderBottomBorder"] as RenderBottomBorderFn | undefined);
  if (original === undefined) {
    return;
  }
  globals[ORIGINAL_BORDER_KEY] = original;
  proto["renderBottomBorder"] = patchedBottomBorder;
}

function uninstallSpeedBorder(): void {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const original = globals[ORIGINAL_BORDER_KEY] as RenderBottomBorderFn | undefined;
  if (original === undefined) {
    return;
  }
  const proto = CustomEditor.prototype as unknown as Record<string, unknown>;
  proto["renderBottomBorder"] = original;
}

// 类型面（运行时已探测；d.ts 成员名混淆处用结构化探测接住）

interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface StatuslineContext {
  getContextUsage?: () => ContextUsage | undefined;
  getSettings?: () => { compaction?: { enabled?: boolean } } | undefined;
  thinkingLevel?: string;
  model?: { id?: string; provider?: string } | undefined;
  sessionManager: {
    getBranch: () => readonly unknown[];
    getEntries: () => readonly unknown[];
    getCwd?: () => string;
    getSessionId?: () => string;
    getLeafId?: () => string | null;
    getSessionName?: () => string | undefined;
  };
}

// 数据聚合（内置 FooterComponent.getSessionStats 同逻辑）

interface SessionStats {
  totals: UsageTotals;
  cacheHitRate: number | undefined;
}

interface UsageEntry {
  type?: string;
  usage?: AssistantMessage["usage"];
  message?: { role?: string; usage?: AssistantMessage["usage"] };
}

/** 会话条目 -> 其携带的 usage（内置聚合范围：usage/assistant/toolResult/分支与压缩） */
function entryUsage(entry: unknown): AssistantMessage["usage"] | undefined {
  const e = entry as UsageEntry;
  if (e.type === "usage") {
    return e.usage;
  }
  if (
    e.type === "message" &&
    (e.message?.role === "assistant" || e.message?.role === "toolResult")
  ) {
    return e.message.usage;
  }
  if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) {
    return e.usage;
  }
  return undefined;
}

function isAssistantEntry(entry: unknown): boolean {
  return (entry as UsageEntry).message?.role === "assistant";
}

function addUsage(totals: UsageTotals, usage: AssistantMessage["usage"] | undefined): void {
  if (!usage) {
    return;
  }
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  totals.cost += usage.cost?.total ?? 0;
}

function aggregateSession(entries: readonly unknown[]): SessionStats {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let cacheHitRate: number | undefined;
  for (const entry of entries) {
    addUsage(totals, entryUsage(entry));
    if (isAssistantEntry(entry)) {
      const { message } = entry as UsageEntry;
      if (!message) {
        continue;
      }
      const { usage } = message;
      if (usage) {
        const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
        cacheHitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
      }
    }
  }
  return { totals, cacheHitRate };
}

// 聚合缓存（内置 getSessionStats 的按会话签名缓存同语义；扩展侧无
// 说明：getEntryCount，条目 append-only，用 getEntries().length 等价替代）

let statsCache:
  | {
      sessionId: string;
      leafId: string | null;
      entryCount: number;
      modelId: string | undefined;
      stats: SessionStats;
    }
  | undefined;

function getSessionStats(sl: StatuslineContext): SessionStats {
  const sessionId = sl.sessionManager.getSessionId?.() ?? "";
  const leafId = sl.sessionManager.getLeafId?.() ?? null;
  const entries = sl.sessionManager.getEntries();
  const entryCount = entries.length;
  const modelId = sl.model?.id;
  const cached = statsCache;
  if (
    cached &&
    cached.sessionId === sessionId &&
    cached.leafId === leafId &&
    cached.entryCount === entryCount &&
    cached.modelId === modelId
  ) {
    return cached.stats;
  }
  const stats = aggregateSession(entries);
  statsCache = { sessionId, leafId, entryCount, modelId, stats };
  return stats;
}

// 安装

function install(ctx: ExtensionContext): void {
  const sl = ctx as typeof ctx & StatuslineContext;
  installSpeedBorder();
  ctx.ui.setFooter((tui, theme, footerData) => {
    // 主题 fg 为原型方法，抽离须绑 this（内部走 this.tokenAnsi），类型签名放宽到任意 token 名字符串
    const fg = theme.fg.bind(theme) as (token: string, text: string) => string;
    const bold = theme.bold.bind(theme);
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose() {
        unsub();
      },
      invalidate() {},
      render(width: number): string[] {
        try {
          const cwd = sl.sessionManager.getCwd?.() ?? process.cwd();
          const settings = sl.getSettings?.();
          const lines = buildFooterLines({
            fg,
            bold,
            cwdDisplay: formatCwdForFooter(cwd, process.env["HOME"] ?? process.env["USERPROFILE"]),
            branch: footerData.getGitBranch(),
            sessionName: sl.sessionManager.getSessionName?.(),
            usage: getSessionStats(sl).totals,
            cacheHitRate: getSessionStats(sl).cacheHitRate,
            contextUsage: sl.getContextUsage?.(),
            modelId: sl.model?.id,
            provider: sl.model?.provider,
            providerCount: footerData.getAvailableProviderCount(),
            usingSubscription: sl.model?.provider === "kimi-coding",
            autoCompactEnabled: settings?.compaction?.enabled !== false,
            experimentalEnabled: process.env["PI_EXPERIMENTAL"] === "1",
            statuses: footerData.getExtensionStatuses(),
            thinkingLevel: sl.thinkingLevel,
            width,
          });
          return lines;
        } catch (error) {
          // 渲染抛错会击穿 TUI 渲染循环（见头注释踩坑点），兜底为空行并落盘诊断
          debugLog(`render error: ${(error as Error).stack ?? error}`);
          return ["", ""];
        }
      },
    };
  });
}

export default function statusline(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (readEnabled()) {
      setTimeout(() => install(ctx), FOOTER_INSTALL_DELAY_MS);
    }
  });

  // 流式速度采集（text/thinking 增量；回合精确校准见 stream-speed.ts）
  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") {
      speed.onAssistantStart();
    }
  });
  pi.on("message_update", (event) => {
    const e = event.assistantMessageEvent;
    if (e.type === "text_delta" || e.type === "thinking_delta") {
      speed.onDelta(e.delta);
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      speed.onAssistantDone(event.message.usage?.output);
    }
  });

  pi.registerCommand("statusline", {
    description: "切换主题状态栏（默认开，关闭后恢复内置 footer）",
    handler: async (_args, ctx) => {
      const next = !readEnabled();
      writeEnabled(next);
      if (next) {
        install(ctx);
      } else {
        ctx.ui.setFooter(undefined);
        uninstallSpeedBorder();
      }
      ctx.ui.notify(next ? "主题状态栏已启用" : "已恢复内置 footer", "info");
    },
  });
}
