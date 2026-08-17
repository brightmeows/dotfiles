/**
 * 统一"LLM 注入且用户需知情"提示渲染（lib 共享模块）
 *
 * 本目录为扩展共享代码区：Pi 自动发现只匹配顶层 `*.ts` 与一层子目录的
 * `index.ts`；`lib` 下的模块不会被当作扩展加载，仅被各扩展 import 复用。
 *
 * 两个通道（2026-08-17 补 entry 通道，均复刻 Pi 默认 custom message 外观：
 * customMessageBg 紫背景 Box + [customType] 标签 + 内容）：
 * - renderInjectNotice（MessageRenderer）：custom_message 渲染，消息进
 *   LLM 上下文；消费方约定见各扩展。collapsed（默认）只显示
 *   details.notice 提示文案，expanded（ctrl+o）显示 content 注入全文。
 * - renderInjectEntry（EntryRenderer）：appendEntry 渲染，条目不进 LLM
 *   上下文（TUI 转录专属），适合“告知用户已向 LLM 注入什么”的简短提示；
 *   data 为 { notice, lines? }：collapsed 只显示 notice，expanded 显示
 *   lines 全文（缺省回落 notice）。
 *
 * 消费方约定（两通道共用）：
 * - notice 统一格式 `[自动注入] <来源>：<说明>`，collapsed 显示
 * - 展开态全文：message 通道为 content，entry 通道为 data.lines
 * - 扩展注册 renderer：pi.registerMessageRenderer / registerEntryRenderer
 *   （均按 customType 精确匹配，不支持前缀/通配）
 */

import {
  type EntryRenderer,
  type MessageRenderer,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

/** 复刻默认渲染的标签样式（customMessageLabel 色 + bold） */
function renderLabel(customType: string, theme: Parameters<MessageRenderer>[2]): Text {
  return new Text(theme.fg("customMessageLabel", `\x1b[1m[${customType}]\x1b[22m`), 0, 0);
}

/** 提取 content 的纯文本（默认渲染同款逻辑：string 原样，数组取 text 段） */
function contentText(content: string | readonly { type: string; text?: unknown }[]): string {
  if (typeof content === "string") {
    return content;
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("\n");
}

/** entry 版渲染数据：notice 必填，lines 为展开态全文（缺省回落 notice） */
export interface InjectEntryData {
  notice: string;
  lines?: string[];
}

/**
 * entry 版渲染（appendEntry 配套，不进 LLM 上下文）：
 * 外观与 renderInjectNotice 一致，collapsed 只显示 notice，expanded 显示
 * lines 全文
 */
export const renderInjectEntry: EntryRenderer<InjectEntryData> = (entry, options, theme) => {
  const box = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
  box.addChild(renderLabel(entry.customType, theme));
  box.addChild(new Spacer(1));

  const data = entry.data ?? { notice: "" };
  const text =
    options.expanded && data.lines && data.lines.length > 0 ? data.lines.join("\n") : data.notice;
  box.addChild(
    new Markdown(text, 0, 0, getMarkdownTheme(), {
      color: (s: string) => theme.fg("customMessageText", s),
    }),
  );
  return box;
};

export const renderInjectNotice: MessageRenderer = (message, options, theme) => {
  const box = new Box(1, 1, (s: string) => theme.bg("customMessageBg", s));
  box.addChild(renderLabel(message.customType, theme));
  box.addChild(new Spacer(1));

  const notice = (message.details as { notice?: string } | undefined)?.notice;
  const text = options.expanded || notice === undefined ? contentText(message.content) : notice;
  box.addChild(
    new Markdown(text, 0, 0, getMarkdownTheme(), {
      color: (s: string) => theme.fg("customMessageText", s),
    }),
  );
  return box;
};
