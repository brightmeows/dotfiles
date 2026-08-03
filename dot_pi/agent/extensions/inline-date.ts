/**
 * Inline Date extension for pi
 *
 * 在每条用户消息（agent 开始前）把当前时间注入 system prompt，
 * 让 LLM 始终知道当前日期/时刻，无需每次跑 `date` 命令。
 *
 * 注入时机选择 systemPrompt 而非 message：
 * - 时间信息天生会过期，需要在每轮刷新
 *   （Claude Code 社区痛点：session 开始时注入一次的时间很快过期，
 *   见 anthropics/claude-code#24182 / #34530）
 * - system prompt 每轮重新构建，追加一行不累积；
 *   message 则会在会话历史中堆积过期的旧时间戳
 *
 * 内容：中文完整日期（含星期）+ 时间 + 时区名 + UTC 偏移。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
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

    return {
      systemPrompt: `${event.systemPrompt}\n\n当前时间：${formatted}（${tz}, UTC${offsetStr}）`,
    };
  });
}
