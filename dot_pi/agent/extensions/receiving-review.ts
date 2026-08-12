/**
 * Receiving-review extension for pi
 *
 * 探测用户消息中特定句式，自动读取 receiving-code-review skill 内容并注入上下文。
 * 句式示例：
 *   - "Check if these issues are valid"
 *   - "Verify each finding against current code"
 *
 * 注入方式：before_agent_start 中检测句式并预加载 skill，
 * context 事件中将内容直接添加至消息列表（LLM 首轮即见）；
 * 另投递一条 custom_message 通知（display:true），TUI 渲染统一走
 * lib/inject-notice.ts 的 renderInjectNotice（默认外观，只显示提示）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderInjectNotice } from "./lib/inject-notice.ts";

const TRIGGER_PATTERNS = [
  "Check if these issues are valid",
  "Verify each finding against current code",
];

const SKILL_PATH = join(homedir(), ".agents_meow/skills/receiving-code-review/SKILL.md");

/** 统一格式注入提示文案（collapsed 显示） */
const NOTICE = "[自动注入] receiving-code-review skill：内容已注入 LLM 上下文";

export default function (pi: ExtensionAPI) {
  // 统一渲染（默认外观，collapsed 只显示提示）
  pi.registerMessageRenderer("receiving-review", renderInjectNotice);

  let loaded = false;
  let skillContent: string | null = null;
  let pendingInject = false;

  function stripFrontmatter(text: string): string {
    const match = text.match(/^---\n[\s\S]*?\n---\n?/);
    return match ? text.slice(match[0].length) : text;
  }

  function getSkillContent(): string {
    if (skillContent !== null) {
      return skillContent;
    }
    try {
      const raw = readFileSync(SKILL_PATH, "utf8");
      skillContent = stripFrontmatter(raw);
    } catch {
      skillContent = "（无法读取 receiving-code-review skill 文件）";
    }
    return skillContent;
  }

  function formatMessage(): string {
    return `检测到代码审查验证请求。以下为 \`receiving-code-review\` skill 内容，严格遵循：

${getSkillContent()}`;
  }

  pi.on("before_agent_start", async (event) => {
    if (loaded) {
      return;
    }

    const userText = event.prompt;
    if (!userText) {
      return;
    }

    const triggered = TRIGGER_PATTERNS.some((pat) =>
      userText.toLowerCase().includes(pat.toLowerCase()),
    );

    if (!triggered) {
      return;
    }
    loaded = true;
    pendingInject = true;
    getSkillContent(); // 预加载缓存，供各注入路径使用

    // 用户可见：简要通知，不重复全文
    pi.sendMessage(
      {
        content: NOTICE,
        customType: "receiving-review",
        details: { notice: NOTICE },
        display: true,
      },
      { deliverAs: "steer" },
    );
  });

  // Compact 后重置状态，允许重新触发注入
  pi.on("session_compact", async () => {
    loaded = false;
    pendingInject = false;
  });

  pi.on("context", async (event) => {
    if (!pendingInject) {
      return;
    }
    pendingInject = false;

    // LLM 首轮即见：直接加入消息列表
    event.messages.push({
      content: [{ text: formatMessage(), type: "text" }],
      role: "user",
      timestamp: Date.now(),
    });

    return { messages: event.messages };
  });
}
