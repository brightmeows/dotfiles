/**
 * Inline Date extension for pi
 *
 * 在用户提交消息（agent 开始前）注入当前日期（不含时分秒），双轨设计：
 * - message：session 内首次注入一条可见提示（TUI 显示，customType=inline-date）
 * - systemPrompt：每轮刷新当天日期，让 LLM 始终知道今天几号
 *
 * 只注入日期、不注入时间：
 * - 时分秒变化太快，注入时间戳会让长会话里的时间信息迅速过期且
 *   与可见消息不一致
 * - 日期每天变化一次，system prompt 每轮刷新保持同日内一致、
 *   跨天自动更新
 *
 * 内容：中文完整日期（含星期）+ 时区名 + UTC 偏移。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let injectedMessage = false;

  // Compact 后重置，允许重新展示可见提示
  pi.on("session_compact", async () => {
    injectedMessage = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "full",
    }).format(now);
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin < 0 ? "-" : "+";
    const absMin = Math.abs(offsetMin);
    const offsetH = Math.floor(absMin / 60);
    const offsetM = absMin % 60;
    const offsetStr = `${sign}${offsetH}${offsetM ? `:${String(offsetM).padStart(2, "0")}` : ""}`;

    const line = `今天日期：${formatted}（${tz}, UTC${offsetStr}）`;
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
      // /resume 场景：会话历史已含可见提示则跳过，仅 systemPrompt 刷新日期
      const hasInjected = ctx.sessionManager
        .getEntries()
        .some((entry) => entry.type === "custom_message" && entry.customType === "inline-date");
      if (!hasInjected) {
        result.message = {
          customType: "inline-date",
          content: `[日期] ${line}`,
          display: true,
        };
      }
    }
    return result;
  });
}
