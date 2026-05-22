/**
 * Receiving-review plugin for OpenCode
 *
 * 探测用户消息中特定句式，自动读取 receiving-code-review skill 内容并注入上下文。
 * 句式示例：
 *   - "Check if these issues are valid"
 *   - "Verify each finding against current code"
 *
 * 注入方式：experimental.chat.messages.transform 中将内容添加至首条用户消息，
 * 以 NOTIFY_TAG 标记。
 *
 * 重复防护双层设计：
 * 1. 闭包变量 injected（主防护）—— 与 transform 调用同生命周期，不依赖持久化
 * 2. 消息历史 NOTIFY_TAG 扫描（次防护）—— 用于热重载后闭包重置等边界场景
 *
 * session.compacting 时重置 injected，允许新会话重新触发。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Plugin } from "@opencode-ai/plugin";

const TRIGGER_PATTERNS = [
	"Check if these issues are valid",
	"Verify each finding against current code",
];

const SKILL_PATH = join(
	homedir(),
	".agents_meow/skills/receiving-code-review/SKILL.md",
);

const NOTIFY_TAG = "NOTIFY_RECEIVING_CODE_REVIEW";

function stripFrontmatter(text: string): string {
	const match = text.match(/^---\n[\s\S]*?\n---\n?/);
	return match ? text.slice(match[0].length) : text;
}

function loadSkillContent(): string {
	try {
		const raw = readFileSync(SKILL_PATH, "utf8");
		return stripFrontmatter(raw);
	} catch {
		return "（无法读取 receiving-code-review skill 文件）";
	}
}

function buildInjectionText(skillContent: string): string {
	return `<${NOTIFY_TAG}>
检测到审查验证请求。以下为 \`receiving-code-review\` skill 内容，严格遵循：

${skillContent}
</${NOTIFY_TAG}>`;
}

export const ReceivingReviewPlugin: Plugin = async (input) => {
	const { client } = input;
	let cachedSkill: string | null = null;
	let injected = false;

	return {
		"experimental.chat.messages.transform": async (_input, output) => {
			// 主防护：闭包变量（可靠，不依赖持久化）
			if (injected) return;
			if (!output.messages.length) return;

			// 次防护：消息历史 tag 扫描（处理热重载等闭包重置的边界场景）
			const alreadyInjected = output.messages.some((m) =>
				m.parts.some(
					(p) => p.type === "text" && p.text.includes(NOTIFY_TAG),
				),
			);
			if (alreadyInjected) {
				injected = true; // 同步闭包状态
				return;
			}

			const firstUser = output.messages.find(
				(m) => m.info.role === "user",
			);
			if (!firstUser?.parts.length) return;

			// 合并首条用户消息文本进行句式匹配
			const userText = firstUser.parts
				.filter((p) => p.type === "text")
				.map((p) => p.text)
				.join(" ");

			const triggered = TRIGGER_PATTERNS.some((pat) =>
				userText.toLowerCase().includes(pat.toLowerCase()),
			);

			if (!triggered) return;

			// 惰性加载 skill 内容
			if (cachedSkill === null) {
				cachedSkill = loadSkillContent();
			}

			injected = true;

			firstUser.parts.unshift({
				type: "text",
				text: buildInjectionText(cachedSkill),
				id: "",
				sessionID: "",
				messageID: "",
			});

			// TUI 通知（fire-and-forget，失败不阻塞注入）
			try {
				await client.tui.showToast({
					body: {
						message:
							"已加载 `receiving-code-review` skill，内容已注入 LLM 上下文。",
						variant: "info",
						duration: 3000,
					},
				});
			} catch {
				// 环境无 TUI 时静默忽略（如无头模式）
			}
		},

		"experimental.session.compacting": async () => {
			injected = false; // compact 后允许新会话重新触发
		},
	};
};
