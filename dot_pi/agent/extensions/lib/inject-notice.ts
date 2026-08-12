/**
 * 统一"LLM 注入且用户需知情"提示渲染（lib 共享模块）
 *
 * 本目录为扩展共享代码区：Pi 自动发现只匹配顶层 `*.ts` 与一层子目录的
 * `index.ts`；`lib` 下的模块不会被当作扩展加载，仅被各扩展 import 复用。
 *
 * renderInjectNotice 复刻 Pi 默认 custom_message 外观
 * （CustomMessageComponent 默认渲染：customMessageBg 紫背景 Box +
 * [customType] 标签 + 内容），collapsed（默认）只显示 details.notice
 * 提示文案，expanded（ctrl+o 切换工具输出展开）显示 content 注入全文。
 * 消费方约定：
 * - custom_message 的 details 携带 `notice`（统一格式
 *   `[自动注入] <来源>：<说明>`，collapsed 显示）；content 为注入全文
 *   （进 LLM + expanded 显示）
 * - 扩展注册 renderer：pi.registerMessageRenderer(<customType>, renderInjectNotice)
 */

import { type MessageRenderer, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
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
