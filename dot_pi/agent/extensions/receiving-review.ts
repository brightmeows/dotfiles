/**
 * Receiving-review extension for pi
 *
 * 探测用户消息中特定句式，自动读取 receiving-code-review skill 内容并注入上下文。
 * 句式示例：
 *   - "Check if these issues are valid"
 *   - "Verify each finding against current code"
 *
 * 注入方式：before_agent_start 中检测句式并预加载 skill，
 * context 事件中将内容直接添加至消息列表（LLM 首轮即见）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TRIGGER_PATTERNS = [
	"Check if these issues are valid",
	"Verify each finding against current code",
];

const SKILL_PATH = join(
	homedir(),
	".agents_meow/skills/receiving-code-review/SKILL.md",
);

export default function (pi: ExtensionAPI) {
	let loaded = false;
	let skillContent: string | null = null;
	let pendingInject = false;

	function stripFrontmatter(text: string): string {
		const match = text.match(/^---\n[\s\S]*?\n---\n?/);
		return match ? text.slice(match[0].length) : text;
	}

	function getSkillContent(): string {
		if (skillContent !== null) return skillContent;
		try {
			const raw = readFileSync(SKILL_PATH, "utf8");
			skillContent = stripFrontmatter(raw);
		} catch {
			skillContent = "（无法读取 receiving-code-review skill 文件）";
		}
		return skillContent;
	}

	function formatMessage(): string {
		return `检测到审查验证请求。以下为 \`receiving-code-review\` skill 内容，严格遵循：

${getSkillContent()}`;
	}

	pi.on("before_agent_start", async (event) => {
		if (loaded) return;

		const userText = event.prompt;
		if (!userText) return;

		const triggered = TRIGGER_PATTERNS.some((pat) =>
			userText.toLowerCase().includes(pat.toLowerCase()),
		);

		if (!triggered) return;
		loaded = true;
		pendingInject = true;
		getSkillContent(); // 预加载缓存，供各注入路径使用

		// 用户可见：简要通知，不重复全文
		pi.sendMessage(
			{
				customType: "receiving-review",
				content: "✅ 已加载 `receiving-code-review` skill，内容已注入 LLM 上下文。",
				display: true,
			},
			{ deliverAs: "steer" },
		);
	});

	pi.on("context", async (event) => {
		if (!pendingInject) return;
		pendingInject = false;

		// LLM 首轮即见：直接加入消息列表
		event.messages.push({
			role: "user",
			content: [{ type: "text", text: formatMessage() }],
			timestamp: Date.now(),
		});

		return { messages: event.messages };
	});
}
