/**
 * Inline Date extension for pi
 *
 * 在用户提交消息（agent 开始前）注入当前时间，双轨设计：
 * - message：session 内首次注入一条可见提示（TUI 显示，customType=inline-date）
 * - systemPrompt：每轮刷新最新时间，让 LLM 始终知道当前日期/时刻
 *
 * 为什么双轨：
 * - 时间信息天生会过期，需每轮刷新（Claude Code 社区痛点：session 开始时
 *   注入一次的时间很快过期，见 anthropics/claude-code#24182 / #34530）；
 *   system prompt 每轮重新构建、不累积
 * - 可见提示复用 message 展示（同 inline-git-status），避免每次刷新时
 *   在会话历史堆积过期的旧时间戳
 *
 * 内容：中文完整日期（含星期）+ 时间 + 时区名 + UTC 偏移。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let injectedMessage = false;

  // Compact 后重置，允许重新展示可见提示
  pi.on("session_compact", async () => {
    injectedMessage = false;
  });

  pi.on("before_agent_start", async (event) => {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "full",
      timeStyle: "medium",
    }).format(now);
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin < 0 ? "-" : "+";
    const absMin = Math.abs(offsetMin);
    const offsetH = Math.floor(absMin / 60);
    const offsetM = absMin % 60;
    const offsetStr = `${sign}${offsetH}${offsetM ? `:${String(offsetM).padStart(2, "0")}` : ""}`;

    const line = `当前时间：${formatted}（${tz}, UTC${offsetStr}）`;
    const result: {
      message?: {
        customType: string;
        content: string;
        display: boolean;
      };
      systemPrompt: string;
    } = {
      systemPrompt: `${event.systemPrompt}\n\n${line}`,
    };
    if (!injectedMessage) {
      injectedMessage = true;
      result.message = {
        customType: "inline-date",
        content: `[日期] ${line}`,
        display: true,
      };
    }
    return result;
  });
}
