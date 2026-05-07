/**
 * Receiving-review plugin for OpenCode.ai
 *
 * 探测用户消息中特定句式，自动激活 receiving-code-review skill。
 * 句式示例：
 *   - "Check if these issues are valid"
 *   - "Verify each finding against current code"
 *
 * 仅每会话注入一次。
 */

import type { Plugin } from "@opencode-ai/plugin";

const TRIGGER_PATTERNS = [
  "Check if these issues are valid",
  "Verify each finding against current code",
];

const INJECTED_TAG = "INJECTED_RECEIVING_REVIEW";

export const ReceivingReviewPlugin: Plugin = async ({}) => {
  const bootstrap = `<${INJECTED_TAG}>
用户请求验证审查反馈。加载 \`receiving-code-review\` skill，照其指导逐项验证。
</${INJECTED_TAG}>`;

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return;

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) return;

      // 仅注入一次
      if (
        firstUser.parts.some(
          (p) => p.type === "text" && p.text.includes(INJECTED_TAG)
        )
      ) return;

      // 拼合用户文本，检测触发句式
      const userText = firstUser.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");

      const triggered = TRIGGER_PATTERNS.some((pat) =>
        userText.toLowerCase().includes(pat.toLowerCase())
      );

      if (!triggered) return;

      firstUser.parts.unshift({ type: "text", text: bootstrap } as never);
    },
  };
};
