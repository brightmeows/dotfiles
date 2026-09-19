/**
 * 统一“LLM 注入且用户需知情”提示渲染（skill-reminders 包内副本，2026-09-19
 * 自 better-skill/internal/inject-notice.ts 迁入；只保留本包所需的 entry
 * 通道，message 通道未迁入）
 *
 * 各包完全自包含：本文件为包内副本，与其他包的同名副本互不依赖、无同步
 * 义务（2026-08-30 lib/ 撤销，消费方各自自包含）。
 *
 * renderInjectEntry（EntryRenderer）：appendEntry 渲染，条目不进 LLM 上下文
 * （TUI 转录专属），适合“告知用户已向 LLM 注入什么”的简短提示；data 为
 * { notice, lines? }：collapsed 单行截断显示 notice，expanded（ctrl+o）显示
 * lines 全文（缺省回落 notice）。外观复刻 Pi 默认 custom message（customMessageBg
 * 紫背景 Box + [customType] 标签 + 内容）。
 *
 * 消费方约定：notice 统一格式 `[自动注入] <来源>：<说明>`（本包由 reminders.ts
 * 的 renderReminderNotice 产出）；registerEntryRenderer 按 customType 精确
 * 匹配（不支持前缀/通配）。
 */

import { type EntryRenderer, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

/** Entry 版渲染数据：notice 必填，lines 为展开态全文（缺省回落 notice） */
export interface InjectEntryData {
  notice: string;
  lines?: string[];
}

/** 复刻默认渲染的标签样式（customMessageLabel 色 + bold） */
function renderLabel(
  customType: string,
  theme: Parameters<EntryRenderer<InjectEntryData>>[2],
): Text {
  return new Text(theme.fg("customMessageLabel", `\x1b[1m[${customType}]\x1b[22m`), 0, 0);
}

/** 折叠态单行截断：超长 notice 截至 50 字符加省略号，防止 TUI 内 wrap 成多行 */
const COLLAPSED_MAX = 50;
function truncateSingleLine(text: string): string {
  return text.length > COLLAPSED_MAX ? `${text.slice(0, COLLAPSED_MAX)}…` : text;
}

/**
 * Entry 版渲染（appendEntry 配套，不进 LLM 上下文）：collapsed 单行截断显示
 * notice，expanded 显示 lines 全文
 */
export const renderInjectEntry: EntryRenderer<InjectEntryData> = (entry, options, theme) => {
  const box = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
  box.addChild(renderLabel(entry.customType, theme));
  box.addChild(new Spacer(1));

  const data = entry.data ?? { notice: "" };
  const text =
    options.expanded && data.lines && data.lines.length > 0
      ? data.lines.join("\n")
      : truncateSingleLine(data.notice);
  box.addChild(
    new Markdown(text, 0, 0, getMarkdownTheme(), {
      color: (s: string) => theme.fg("customMessageText", s),
    }),
  );
  return box;
};
