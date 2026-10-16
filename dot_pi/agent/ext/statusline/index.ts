/**
 * 状态栏扩展（statusline）
 *
 * 两行 footer，布局复刻 pi 内置 FooterComponent（1.2.0），配色为主题点缀：
 *   行1 pwd 行：目录（~ 化）+ (分支，含 dirty 标记 ✗) + • 会话名
 *   行2 stats 行：左 tokens/缓存/费用/上下文占用（80/95 分档警示色），
 *                右 (提供商) 模型 • thinking 档位（右对齐）
 * 颜色全部取当前主题 token（无背景色块，分隔用主题色文字）。内置无的
 * 增强：分支 dirty 标记（pi.exec 后台 30s 刷新）。
 *
 * 行为：
 * - 默认启用（状态文件缺失视为启用）；/statusline 命令切换回内置
 *   footer，开关状态持久化到 <agent-dir>/pi-meow-statusline.json
 * - tokens/缓存/费用：sessionManager.getEntries() 全类型聚合（usage
 *   entry、assistant/toolResult 消息、branch_summary/compaction），
 *   缓存命中率取最新一条 assistant 的 cacheRead 占比——与内置
 *   FooterComponent.getSessionStats 同逻辑（未复制其按会话签名缓存，
 *   footer 每帧现算）
 * - 上下文占用：getContextUsage 每帧现读；>90 error、>70 warning（内置
 *   同阈值）；percent 未知（compaction 后）显示 ?
 * - git dirty 标记：footerData 只有分支名没有 dirty，用 pi.exec 后台跑
 *   git status --porcelain 缓存结果，30s 定时刷新；exec 失败按未修改
 *   处理，标记缺席为预期降级
 * - reload 幂等：session_start 重触发时 setFooter 覆盖安装；dirty
 *   定时器存模块槽，重装前先清旧
 *
 * 依赖事实（pi 1.2.0 实测）：
 * - ctx.getContextUsage / ctx.thinkingLevel / ctx.model / ctx.ui.setFooter
 *   在 session_start ctx 上可用；exec 在 ExtensionAPI（pi.exec）上；
 *   getContextUsage 的成员名在发布物 d.ts 中被混淆，类型侧走结构化探测
 * - theme.colors 为 token -> RGB 表；theme.fg 仅认 56 语义 token（vars
 *   名直接 throw）且为原型方法（抽离须 bind this）
 *
 * 踩坑点（1.2.0 tmux 实测）：
 * - session_start 同步栈内调用 setFooter 或 pi.exec 均会使 pi 静默退出
 *   （官方示例在命令 handler 内调用故未暴露）：安装经 setTimeout 推迟，
 *   dirty 首刷推迟到 interval 首次触发
 * - footer.render 抛错会击穿 TUI 渲染循环令 pi 静默退出：render 内
 *   try/catch 兜底为空行并落盘诊断
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildFooterLines, formatCwdForFooter, type UsageTotals } from "./internal/footer-lines.ts";

// 开关持久化（<agent-dir>/pi-meow-statusline.json，look-pack 同款模式）

const STATE_FILENAME = "pi-meow-statusline.json";
const DIRTY_REFRESH_MS = 30_000;
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

// 类型面（运行时已探测；d.ts 成员名混淆处用结构化探测接住）

interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface StatuslineContext {
  getContextUsage?: () => ContextUsage | undefined;
  thinkingLevel?: string;
  model?: { id?: string; provider?: string } | undefined;
  sessionManager: {
    getBranch: () => readonly unknown[];
    getEntries: () => readonly unknown[];
    getCwd?: () => string;
    getSessionName?: () => string | undefined;
  };
}

// 数据聚合（内置 FooterComponent.getSessionStats 同逻辑，去掉按会话签名缓存）

interface SessionStats {
  totals: UsageTotals;
  cacheHitRate: number | undefined;
}

interface UsageEntry {
  type?: string;
  usage?: AssistantMessage["usage"];
  message?: { role?: string; usage?: AssistantMessage["usage"] };
}

/** 会话条目 -> 其携带的 usage（内置 getSessionStats 的聚合范围：usage/assistant/toolResult/分支与压缩） */
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

// 说明：dirty 缓存存模块槽（reload 重载代码后旧定时器随旧模块一并丢弃）；dirty 取自 git status

let dirtyCache: boolean | undefined;
let dirtyTimer: NodeJS.Timeout | undefined;

function refreshDirty(pi: ExtensionAPI, onChanged: () => void): void {
  pi.exec("git", ["status", "--porcelain"])
    .then((result) => {
      dirtyCache = result.stdout.trim().length > 0;
      onChanged();
    })
    .catch(() => {
      dirtyCache = false;
    });
}

function ensureDirtyLoop(pi: ExtensionAPI, onChanged: () => void): void {
  if (dirtyTimer) {
    clearInterval(dirtyTimer);
  }
  // 首刷推迟到 interval 触发：会话启动阶段调用 pi.exec 会使 pi 静默退出（1.2.0 实测）
  dirtyTimer = setInterval(() => refreshDirty(pi, onChanged), DIRTY_REFRESH_MS);
  dirtyTimer.unref?.();
}

function clearDirtyLoop(): void {
  if (dirtyTimer) {
    clearInterval(dirtyTimer);
    dirtyTimer = undefined;
  }
}

// 安装

function install(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const sl = ctx as typeof ctx & StatuslineContext;
  ctx.ui.setFooter((tui, theme, footerData) => {
    // 主题 fg 为原型方法，抽离须绑 this（内部走 this.tokenAnsi），类型签名放宽到任意 token 名字符串
    const fg = theme.fg.bind(theme) as (token: string, text: string) => string;
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    ensureDirtyLoop(pi, () => tui.requestRender());

    return {
      dispose() {
        unsub();
        clearDirtyLoop();
      },
      invalidate() {},
      render(width: number): string[] {
        try {
          const cwd = sl.sessionManager.getCwd?.() ?? process.cwd();
          const stats = aggregateSession(sl.sessionManager.getEntries());
          const usage = sl.getContextUsage?.();
          const lines = buildFooterLines({
            fg,
            cwdDisplay: formatCwdForFooter(cwd, process.env["HOME"] ?? process.env["USERPROFILE"]),
            branch: footerData.getGitBranch(),
            branchDirty: dirtyCache === true,
            sessionName: sl.sessionManager.getSessionName?.(),
            usage: stats.totals,
            cacheHitRate: stats.cacheHitRate,
            contextUsage: usage,
            modelId: sl.model?.id,
            provider: sl.model?.provider,
            providerCount: footerData.getAvailableProviderCount(),
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
      setTimeout(() => install(pi, ctx), FOOTER_INSTALL_DELAY_MS);
    }
  });

  pi.registerCommand("statusline", {
    description: "切换主题状态栏（默认开，关闭后恢复内置 footer）",
    handler: async (_args, ctx) => {
      const next = !readEnabled();
      writeEnabled(next);
      if (next) {
        install(pi, ctx);
      } else {
        ctx.ui.setFooter(undefined);
      }
      ctx.ui.notify(next ? "主题状态栏已启用" : "已恢复内置 footer", "info");
    },
  });
}
