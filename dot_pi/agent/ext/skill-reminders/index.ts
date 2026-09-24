/**
 * Skill Reminders（技能专项提醒注入，2026-09-19 自 better-skill 拆出）
 *
 * 加载带专项提醒的技能文件时，在工具结果末尾追加提醒段（进 LLM 上下文）。
 * 提醒内容为数据驱动注册表（internal/reminders.ts）：新增提醒 = 在注册表
 * 追加一条，不改本文件。
 *
 * 触发面：read 工具 event.input.path 命中提醒 matches（路径组件匹配，不锁
 * 绝对路径，技能目录受 npx skills 管理重装迁移后仍生效）。
 * （历史：skill 工具通道 2026-09-24 随 better-skill 移除而删除，
 * event.details.path 契约不复存在。）
 *
 * 加载顺序：无包间依赖（2026-09-24 起 better-skill 移除，tool_result 链上
 * 不再有增强段拼接）；本包只做段尾追加。
 */

import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { collectReminders, renderReminderSection } from "./internal/reminders.ts";

/** 取技能文件路径：read 通道用 input.path 原样值 */
function skillFilePath(event: ToolResultEvent): string | null {
  if (event.toolName === "read") {
    const { path } = event.input;
    return typeof path === "string" && path.length > 0 ? path : null;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.isError) {
      return;
    }
    const filePath = skillFilePath(event);
    if (!filePath) {
      return;
    }
    const reminders = collectReminders(filePath);
    if (reminders.length === 0) {
      return;
    }
    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    const sections = reminders.map((reminder) => renderReminderSection(reminder));
    return {
      content: [
        {
          type: "text" as const,
          text: `${first.text}\n\n---\n${sections.join("\n\n---\n")}`,
        },
        ...event.content.slice(1),
      ],
    };
  });
}
