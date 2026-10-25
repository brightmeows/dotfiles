/**
 * 状态栏两行+扩展状态行布局渲染纯库（包内自包含）。
 *
 * 布局（自 2026-10 起与内置 FooterComponent 分道的自定义布局）：
 *   行1 pwd 行：左 目录（~ 化）+ (分支) + • 会话名，
 *              右 (提供商) 模型 • 档位（自行2右段上移）
 *   行2 stats 行：左 ↑↓ R W CH% $费用[(sub)] [• xp]，
 *              右 上下文%/窗口[(auto)]（自行2左段右移，分档色保留）
 *   行3 扩展状态行：ctx.ui.setStatus 的文本（字母序、控制字符清洗、单行截断）
 * 配色点缀（与内置的差异）：各行元素按语义取主题色（内置统一 dim 仅
 * ctx%/xp 分档上色）。
 *
 * 宽度降级（两行同款思路）：
 *   左段超宽 → 截断（... 兜底）；行1右段空间不足 → provider 括号最先丢；
 *   仍超宽 → 右段按剩余空间截断；剩余不足 → 只显示左段。
 *
 * formatTokens / formatCwdForFooter / sanitizeStatusText 为内置同逻辑
 * 副本（未从包入口导出，家规"自备副本"）。
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
  bold: (text: string) => string;
  cwdDisplay: string;
  branch: string | null;
  sessionName: string | undefined;
  usage: UsageTotals;
  cacheHitRate: number | undefined;
  contextUsage: ContextUsageInfo | undefined;
  modelId: string | undefined;
  /** 提供商名；仅 providerCount > 1 时进入右侧 */
  provider: string | undefined;
  providerCount: number;
  /** 走订阅计费的提供商（kimi-coding），费用后缀 (sub)，内置 isUsingSubscription 的可达半边 */
  usingSubscription: boolean;
  autoCompactEnabled: boolean;
  experimentalEnabled: boolean;
  /** 扩展状态文本（setStatus 写入；键值对，渲染前按键字母序拼单行） */
  statuses: ReadonlyMap<string, string>;
  thinkingLevel: string | undefined;
  width: number;
}

/** 千/k/M 紧凑格式化（内置 formatTokens 同逻辑） */
export function formatTokens(count: number): string {
  const table: readonly [number, (n: number) => string][] = [
    [1000, (n) => n.toString()],
    [10_000, (n) => `${(n / 1000).toFixed(1)}k`],
    [1_000_000, (n) => `${Math.round(n / 1000)}k`],
    [10_000_000, (n) => `${(n / 1_000_000).toFixed(1)}M`],
  ];
  for (const [limit, fmt] of table) {
    if (count < limit) {
      return fmt(count);
    }
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

/** 状态文本清洗：控制字符替换为空格并折叠连续空格（内置 sanitizeStatusText 同逻辑） */
export function sanitizeStatusText(text: string): string {
  return text
    .replaceAll(/[\r\n\t]/gu, " ")
    .replaceAll(/ +/gu, " ")
    .trim();
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
  return percentValue > 70 ? "warning" : "dim";
}

/** 左段 + 补齐 + 右对齐右段；右段超宽按剩余空间截断，剩余不足只显示左段 */
function joinTwoSides(left: string, right: string, width: number): string {
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  const minPadding = 2;
  if (leftWidth + minPadding + rightWidth <= width) {
    return left + " ".repeat(width - leftWidth - rightWidth) + right;
  }
  const availableForRight = width - leftWidth - minPadding;
  if (availableForRight <= 0) {
    return left;
  }
  const rightFinal = truncateToWidth(right, availableForRight, "");
  const padding = " ".repeat(Math.max(0, width - leftWidth - visibleWidth(rightFinal)));
  return left + padding + rightFinal;
}

/** 行1 右段文本：(提供商) 模型 • 档位（自行2右段上移） */
function rightSideText(deps: FooterDeps, withProvider: boolean): string {
  const { modelId, provider, providerCount, thinkingLevel } = deps;
  let rightSide = modelId ?? "no-model";
  if (thinkingLevel && thinkingLevel !== "off") {
    rightSide = `${rightSide} • ${thinkingLevel}`;
  }
  if (withProvider && provider && providerCount > 1) {
    return `(${provider}) ${rightSide}`;
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

/** 行1 pwd：左 目录 (分支) • 会话名 + 右 (提供商) 模型 • 档位 */
function buildPwdLine(deps: FooterDeps, width: number): string {
  const { fg, cwdDisplay, branch, sessionName } = deps;
  const branchPart = branch ? ` ${fg("accent", `(${branch})`)}` : "";
  const sessionPart = sessionName ? ` ${fg("muted", `• ${sessionName}`)}` : "";
  const left = truncateToWidth(`${cwdDisplay}${branchPart}${sessionPart}`, width, fg("dim", "..."));
  const leftWidth = visibleWidth(left);
  const minPadding = 2;

  const full = rightSideText(deps, true);
  const bare = rightSideText(deps, false);
  const fitsFull = leftWidth + minPadding + visibleWidth(full) <= width;
  const chosen = fitsFull ? full : bare;

  const availableForRight = width - leftWidth - minPadding;
  if (availableForRight <= 0 || visibleWidth(chosen) === 0) {
    return left;
  }
  const rightFinal =
    visibleWidth(chosen) <= availableForRight
      ? chosen
      : truncateToWidth(chosen, availableForRight, "");
  const padding = " ".repeat(Math.max(0, width - leftWidth - visibleWidth(rightFinal)));
  return left + padding + colorizeRightSide(deps, rightFinal);
}

/** 左段 usage 计数部分：↑↓ R W CH% $费用[(sub)]；零值也显示（新对话不空，经确认） */
function buildUsageParts(deps: FooterDeps): string[] {
  const { fg, usage, cacheHitRate, usingSubscription } = deps;
  const parts: string[] = [
    `↑${formatTokens(usage.input)}`,
    `↓${formatTokens(usage.output)}`,
    `R${formatTokens(usage.cacheRead)}`,
    `W${formatTokens(usage.cacheWrite)}`,
    `CH${(cacheHitRate ?? 0).toFixed(1)}%`,
  ];
  const subSuffix = usingSubscription ? " (sub)" : "";
  parts.push(fg("success", `$${usage.cost.toFixed(3)}${subSuffix}`));
  return parts;
}

/** 行2 左段：usage 计数部分 + [• xp]（上下文段已右移） */
function buildStatsLeft(deps: FooterDeps, width: number): string {
  const { fg, bold, experimentalEnabled } = deps;
  const parts = buildUsageParts(deps);
  if (experimentalEnabled) {
    parts.push(`${fg("dim", "•")} ${bold(fg("warning", "xp"))}`);
  }
  const statsLeft = parts.join(" ");
  if (visibleWidth(statsLeft) > width) {
    return truncateToWidth(statsLeft, width, "...");
  }
  return statsLeft;
}

/** 行2 右段：上下文%/窗口[(auto)]，分档色（自行2左段右移） */
function buildContextSegment(deps: FooterDeps): string {
  const { fg, contextUsage, autoCompactEnabled } = deps;
  const percentValue = contextUsage?.percent ?? 0;
  const windowText = formatTokens(contextUsage?.contextWindow ?? 0);
  const autoIndicator = autoCompactEnabled ? " (auto)" : "";
  return fg(
    contextColorToken(percentValue),
    `${contextPercentText(contextUsage)}%/${windowText}${autoIndicator}`,
  );
}

/** 行2 stats：左 usage 计数 [• xp] + 右 上下文%/窗口[(auto)] */
function buildStatsLine(deps: FooterDeps, width: number): string {
  const left = buildStatsLeft(deps, width);
  return joinTwoSides(left, buildContextSegment(deps), width);
}

/** 行3 扩展状态行：setStatus 文本按键字母序拼单行，截断带 dim 兜底（无状态时不产出行） */
function buildStatusesLine(deps: FooterDeps, width: number): string | undefined {
  const { fg, statuses } = deps;
  if (statuses.size === 0) {
    return undefined;
  }
  const sorted = [...statuses.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeStatusText(text));
  return truncateToWidth(sorted.join(" "), width, fg("dim", "..."));
}

/** 三行 footer：pwd 行 + stats 行 + 扩展状态行（无状态时两行） */
export function buildFooterLines(deps: FooterDeps): string[] {
  const lines = [buildPwdLine(deps, deps.width), buildStatsLine(deps, deps.width)];
  const statusesLine = buildStatusesLine(deps, deps.width);
  if (statusesLine !== undefined) {
    lines.push(statusesLine);
  }
  return lines;
}
