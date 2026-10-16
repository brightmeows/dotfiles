/**
 * 状态栏两行布局渲染纯库（包内自包含）。
 *
 * 布局复刻 pi 内置 FooterComponent（1.2.0 components/footer.js）：
 *   行1 pwd 行：目录（~ 化）+ (分支) + • 会话名
 *   行2 stats 行：左侧 tokens/费用/上下文占用，右侧 (提供商) 模型·档位（右对齐）
 * 与内置的差异（主题点缀）：整行不再统一 dim，各元素按语义取主题色；
 * 分支后带 dirty 标记 ✗（内置无，pi.exec 后台刷新）。
 *
 * 宽度降级与内置逐条同款：
 *   左段超宽 → 截断（... 兜底）；provider 括号最先丢（多提供商且空间
 *   不足时）；仍超宽 → 右段按剩余空间截断；剩余不足 → 只显示左段。
 *
 * formatTokens / formatCwdForFooter 为内置同逻辑副本（未从包入口导出，
 * 家规"自备副本"）。
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 主题 colors 表（token -> 解析后 RGB） */
export type ThemeColorTable = Record<string, RGB | undefined>;

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface FooterDeps {
  fg: (token: string, text: string) => string;
  cwdDisplay: string;
  branch: string | null;
  branchDirty: boolean;
  sessionName: string | undefined;
  usage: UsageTotals;
  cacheHitRate: number | undefined;
  contextUsage: ContextUsageInfo | undefined;
  modelId: string | undefined;
  /** 提供商名；仅 providerCount > 1 时进入右侧 */
  provider: string | undefined;
  providerCount: number;
  thinkingLevel: string | undefined;
  width: number;
}

/** 千/k/M 紧凑格式化（内置 formatTokens 同逻辑） */
export function formatTokens(count: number): string {
  if (count < 1000) {
    return count.toString();
  }
  if (count < 10_000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count < 10_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(count / 1_000_000)}M`;
}

/** 目录 ~ 化（内置 formatCwdForFooter 同逻辑） */
export function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) {
    return cwd;
  }
  const resolved =
    cwd.startsWith(home) && (cwd.length === home.length || cwd[home.length] === "/")
      ? `~${cwd.slice(home.length)}`
      : cwd;
  return resolved === "" ? "~" : resolved;
}

/** 上下文占用百分比文案：未知显示 ?，其余一位小数 */
function contextPercentText(contextUsage: ContextUsageInfo | undefined): string {
  if (!contextUsage || contextUsage.percent === null) {
    return "?";
  }
  return contextUsage.percent.toFixed(1);
}

/** 上下文分档色：>90 error、>70 warning、其余 dim（内置同阈值） */
function contextColorToken(percentValue: number): string {
  if (percentValue > 90) {
    return "error";
  }
  if (percentValue > 70) {
    return "warning";
  }
  return "dim";
}

/** 行1 pwd：目录 + (分支，含 dirty ✗) + • 会话名 */
function buildPwdLine(deps: FooterDeps, width: number): string {
  const { fg, cwdDisplay, branch, branchDirty, sessionName } = deps;
  let pwd = cwdDisplay;
  if (branch) {
    const dirtyMark = branchDirty ? fg("warning", " ✗") : "";
    pwd += ` ${fg("accent", `(${branch})`)}${dirtyMark}`;
  }
  if (sessionName) {
    pwd += ` ${fg("muted", `• ${sessionName}`)}`;
  }
  return truncateToWidth(pwd, width, fg("dim", "..."));
}

/** 行2 左段：↑↓ [R W CH%] $费用 上下文%/窗口 */
function buildStatsLeft(deps: FooterDeps, width: number): string {
  const { fg, usage, cacheHitRate, contextUsage } = deps;
  const parts: string[] = [];
  if (usage.input) {
    parts.push(`↑${formatTokens(usage.input)}`);
  }
  if (usage.output) {
    parts.push(`↓${formatTokens(usage.output)}`);
  }
  if (usage.cacheRead) {
    parts.push(`R${formatTokens(usage.cacheRead)}`);
  }
  if (usage.cacheWrite) {
    parts.push(`W${formatTokens(usage.cacheWrite)}`);
  }
  if ((usage.cacheRead > 0 || usage.cacheWrite > 0) && cacheHitRate !== undefined) {
    parts.push(`CH${cacheHitRate.toFixed(1)}%`);
  }
  if (usage.cost) {
    parts.push(fg("success", `$${usage.cost.toFixed(3)}`));
  }
  const percentValue = contextUsage?.percent ?? 0;
  const windowText = formatTokens(contextUsage?.contextWindow ?? 0);
  parts.push(
    fg(contextColorToken(percentValue), `${contextPercentText(contextUsage)}%`),
    fg("dim", `/${windowText}`),
  );
  const statsLeft = parts.join(" ");
  if (visibleWidth(statsLeft) > width) {
    return truncateToWidth(statsLeft, width, "...");
  }
  return statsLeft;
}

/** 行2 右段文本：(提供商) 模型 • 档位；空间不足时 provider 括号最先丢（内置同款） */
function rightSideText(deps: FooterDeps, statsLeftWidth: number, width: number): string {
  const { modelId, provider, providerCount, thinkingLevel } = deps;
  let rightSide = modelId ?? "no-model";
  if (thinkingLevel && thinkingLevel !== "off") {
    rightSide = `${rightSide} • ${thinkingLevel}`;
  }
  if (provider && providerCount > 1) {
    const withProvider = `(${provider}) ${rightSide}`;
    if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
      return withProvider;
    }
  }
  return rightSide;
}

/** 右段点缀色：provider 括号 dim、model 用 text、档位用 thinkingXhigh；截断后 prefix 不完整时自然降级 */
function colorizeRightSide(deps: FooterDeps, rightFinal: string): string {
  const { fg, provider } = deps;
  const providerPrefix =
    provider && rightFinal.startsWith(`(${provider}) `) ? `(${provider}) ` : "";
  const body = rightFinal.slice(providerPrefix.length);
  const bulletAt = body.indexOf(" • ");
  const modelPart = bulletAt !== -1 ? body.slice(0, bulletAt) : body;
  const levelPart = bulletAt !== -1 ? body.slice(bulletAt + 3) : "";
  return (
    (providerPrefix ? fg("dim", providerPrefix) : "") +
    fg("text", modelPart) +
    (levelPart ? fg("dim", " • ") + fg("thinkingXhigh", levelPart) : "")
  );
}

/** 行2 stats 整行：左段 + 补齐 + 右对齐右段（降级链见文件头） */
function buildStatsLine(deps: FooterDeps, width: number): string {
  const { width: _w } = deps;
  const statsLeft = buildStatsLeft(deps, width);
  const statsLeftWidth = visibleWidth(statsLeft);
  const rightSide = rightSideText(deps, statsLeftWidth, width);
  const rightSideWidth = visibleWidth(rightSide);
  const minPadding = 2;

  if (statsLeftWidth + minPadding + rightSideWidth <= width) {
    const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
    return statsLeft + padding + colorizeRightSide(deps, rightSide);
  }
  const availableForRight = width - statsLeftWidth - minPadding;
  if (availableForRight <= 0) {
    return statsLeft;
  }
  const rightFinal = truncateToWidth(rightSide, availableForRight, "");
  const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(rightFinal)));
  return statsLeft + padding + colorizeRightSide(deps, rightFinal);
}

/** 两行 footer：pwd 行 + stats 行 */
export function buildFooterLines(deps: FooterDeps): string[] {
  return [buildPwdLine(deps, deps.width), buildStatsLine(deps, deps.width)];
}
