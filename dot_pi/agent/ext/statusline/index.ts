/**
 * 状态栏扩展（statusline）
 *
 * Powerline 分段 footer，替换 Pi 内置 footer。四段从左到右：
 *   git 分支（含 dirty 标记）/ 上下文占用 / 模型·thinking 档位 / 累计 tokens·花费
 * 颜色全部取当前主题 token：段底色用 toolPendingBg（低饱和背景语义，
 * 跨主题可移植），警示态底色用 toolErrorBg；前景按信息语义取色。
 *
 * 行为：
 * - 默认启用（状态文件缺失视为启用）；/statusline 命令切换回内置
 *   footer，开关状态持久化到 <agent-dir>/pi-meow-statusline.json
 * - git dirty 标记：footerData 只有分支名没有 dirty，用 pi.exec 后台跑
 *   git status --porcelain 缓存结果，30s 定时刷新；exec 失败按未修改
 *   处理，标记缺席为预期降级
 * - 上下文占用：getContextUsage 每帧现读；percent >= 80 警示黄、
 *   >= 95 错误红且底色换 toolErrorBg；percent 未知（compaction 后）显示 --
 * - tokens/花费：sessionManager.getBranch() 聚合 assistant usage，
 *   与官方 custom-footer 示例同款
 * - reload 幂等：session_start 重触发时 setFooter 覆盖安装；dirty
 *   定时器存模块槽，重装前先清旧
 *
 * 依赖事实（pi 1.2.0 实测）：
 * - ctx.getContextUsage / ctx.thinkingLevel / ctx.model / ctx.ui.setFooter
 *   在 session_start ctx 上可用；exec 在 ExtensionAPI（pi.exec）上；
 *   getContextUsage 的成员名在发布物 d.ts 中被混淆，类型侧走结构化探测
 * - theme.colors 为 token -> RGB 表；theme.bg 不接语义别名 token，故
 *   背景自拼 ANSI（见 internal/powerline.ts）
 *
 * 踩坑点（1.2.0 tmux 实测）：
 * - theme.fg 对 56 语义 token 之外的键直接 throw（vars 名如 pink、
 *   overlay2 不可用），footer.render 抛错会击穿 TUI 渲染循环令 pi
 *   静默退出——前景 token 必须取自 56 token 清单
 * - session_start 同步栈内调用 setFooter 同样令 pi 静默退出（官方
 *   示例均在命令 handler 内调用），安装经 setTimeout 推迟，render 内
 *   try/catch 兜底防渲染循环崩
 * - session_start 阶段 pi.exec会使 pi 静默退出，dirty 首刷推迟到
 *   interval 首次触发
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderPowerline, type StatusSegment, type ThemeColorTable } from "./internal/powerline.ts";

// 开关持久化（<agent-dir>/pi-meow-statusline.json，look-pack 同款模式）

const STATE_FILENAME = "pi-meow-statusline.json";
const DIRTY_REFRESH_MS = 30_000;
/** 会话启动的 TUI 尚未就绪，推迟安装（实测同步调用会令 pi 静默退出） */
const FOOTER_INSTALL_DELAY_MS = 1000;
/** 上下文占用警示阈值（percent） */
const WARN_AT = 80;
const ALERT_AT = 95;

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
  model?: { id?: string } | undefined;
  sessionManager: { getBranch: () => readonly unknown[] };
}

// 数据聚合

interface UsageSummary {
  input: number;
  output: number;
  cost: number;
}

function aggregateUsage(entries: readonly unknown[]): UsageSummary {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const entry of entries) {
    const candidate = entry as {
      type?: string;
      message?: { role?: string; usage?: AssistantMessage["usage"] };
    };
    if (candidate.type === "message" && candidate.message?.role === "assistant") {
      const { usage } = candidate.message;
      if (usage) {
        input += usage.input ?? 0;
        output += usage.output ?? 0;
        cost += usage.cost?.total ?? 0;
      }
    }
  }
  return { input, output, cost };
}

function formatCount(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

/** 上下文占用文案：未知显示 --，达阈值分档警示色 */
function contextLabel(
  pct: number | null | undefined,
  fg: (token: string, text: string) => string,
): string {
  if (pct === null || pct === undefined) {
    return fg("dim", "--");
  }
  const text = `${Math.round(pct)}%`;
  if (pct >= ALERT_AT) {
    return fg("error", text);
  }
  if (pct >= WARN_AT) {
    return fg("warning", text);
  }
  return fg("dim", text);
}

// 脏状态缓存存模块槽（reload 重载代码后旧定时器随旧模块一并丢弃）；dirty 取自 git status

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

// 段装配

interface SegmentContext {
  fg: (token: string, text: string) => string;
  branch: string | null;
  usage: ContextUsage | undefined;
  modelId: string | undefined;
  thinkingLevel: string | undefined;
  usageSummary: UsageSummary;
}

function buildSegments(sc: SegmentContext): StatusSegment[] {
  const { fg, branch, usage, modelId, thinkingLevel, usageSummary } = sc;
  const segments: StatusSegment[] = [];
  const BG = "toolPendingBg";

  if (branch) {
    const dirty = dirtyCache === true ? ` ${fg("warning", "✗")}` : "";
    segments.push({ bgToken: BG, content: ` ${fg("accent", branch)}${dirty} ` });
  }

  if (usage) {
    const alerting =
      usage.percent !== null && usage.percent !== undefined && usage.percent >= ALERT_AT;
    segments.push({
      bgToken: alerting ? "toolErrorBg" : BG,
      content: ` ${fg("dim", "ctx")} ${contextLabel(usage.percent, fg)} `,
    });
  }

  if (modelId) {
    const level =
      thinkingLevel && thinkingLevel !== "off"
        ? ` ${fg("thinkingXhigh", `· ${thinkingLevel}`)}`
        : "";
    segments.push({ bgToken: BG, content: ` ${fg("text", modelId)}${level} ` });
  }

  const { input, output, cost } = usageSummary;
  segments.push({
    bgToken: BG,
    content: ` ${fg("toolDiffContext", `↑${formatCount(input)} ↓${formatCount(output)}`)} ${fg("success", `$${cost.toFixed(3)}`)} `,
  });

  return segments;
}

// 安装

function install(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const sl = ctx as typeof ctx & StatuslineContext;
  ctx.ui.setFooter((tui, theme, footerData) => {
    const colors = theme.colors as unknown as ThemeColorTable;
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
          const segments = buildSegments({
            fg,
            branch: footerData.getGitBranch(),
            usage: sl.getContextUsage?.(),
            modelId: sl.model?.id,
            thinkingLevel: sl.thinkingLevel,
            usageSummary: aggregateUsage(sl.sessionManager.getBranch()),
          });
          const line = renderPowerline(segments, width, colors);
          return visibleWidth(line) > 0 ? [truncateToWidth(line, width)] : [""];
        } catch (error) {
          // 渲染抛错会击穿 TUI 渲染循环（见头注释踩坑点），兜底为空行并落盘诊断
          debugLog(`render error: ${(error as Error).stack ?? error}`);
          return [""];
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
    description: "切换 Powerline 状态栏（默认开，关闭后恢复内置 footer）",
    handler: async (_args, ctx) => {
      const next = !readEnabled();
      writeEnabled(next);
      if (next) {
        install(pi, ctx);
      } else {
        ctx.ui.setFooter(undefined);
      }
      ctx.ui.notify(next ? "Powerline 状态栏已启用" : "已恢复内置 footer", "info");
    },
  });
}
