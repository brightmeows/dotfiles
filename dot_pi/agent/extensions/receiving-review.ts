/**
 * Receiving-review extension for pi
 *
 * 探测用户消息中特定句式，自动读取 receiving-code-review skill 内容并注入上下文。
 * 句式示例：
 *   - "Check if these issues are valid"
 *   - "Verify each finding against current code"
 *
 * 消息格式沿用 main-worktree-guard 风格（customType、display、INJECTED_TAG）。
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
	let warned = false;
	let skillContent: string | null = null;

	function getSkillContent(): string {
		if (skillContent !== null) return skillContent;
		try {
			skillContent = readFileSync(SKILL_PATH, "utf8");
		} catch {
			skillContent = "（无法读取 receiving-code-review skill 文件）";
		}
		return skillContent;
	}

	pi.on("before_agent_start", async (event, _ctx) => {
		if (warned) return;

		const userText = event.prompt;
		if (!userText) return;

		const triggered = TRIGGER_PATTERNS.some((pat) =>
			userText.toLowerCase().includes(pat.toLowerCase()),
		);

		if (!triggered) return;
		warned = true;

		const content = `检测到审查验证请求。以下为 \`receiving-code-review\` skill 内容，严格遵循：

${getSkillContent()}`;

		return {
			message: {
				customType: "receiving-review",
				content,
				display: true,
			},
		};
	});
}
