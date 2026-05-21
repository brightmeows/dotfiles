/**
 * Main-worktree-guard plugin for OpenCode
 *
 * 若在 main/master 且工作树目录已入 .gitignore，LLM 首次调用工具后
 * 注入提示——引向用 git worktree 而非直改主干。
 *
 * 机制：tool.execute.after 中检测条件，条件满足后递延至下一次
 * messages.transform 注入简短消息。注入通过 NOTIFY_TAG 标记，
 * 重复防护完全依赖消息历史中的 tag 检测，不维护闭包状态。
 * session.compacting 时清理待发缓存。
 */

import { execFileSync, execSync } from "child_process";
import type { Plugin } from "@opencode-ai/plugin";

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];
const NOTIFY_TAG = "NOTIFY_MAIN_WORKTREE_GUARD";

export const MainWorktreeGuardPlugin: Plugin = async (input) => {
	let pendingDir: string | null = null;

	function getBranch(): string {
		try {
			return execSync("git rev-parse --abbrev-ref HEAD", {
				encoding: "utf8",
				cwd: input.directory,
			}).trim();
		} catch {
			return "";
		}
	}

	function findIgnoredWorktreeDir(): string | null {
		for (const dir of WORKTREE_DIRS) {
			try {
				execFileSync("git", ["check-ignore", dir], {
					encoding: "utf8",
					cwd: input.directory,
					stdio: ["ignore", "pipe", "ignore"],
				});
				return dir;
			} catch {
				continue;
			}
		}
		return null;
	}

	return {
		"tool.execute.after": async () => {
			const branch = getBranch();
			if (!branch) return;
			if (branch !== "main" && branch !== "master") return;

			const ignoredDir = findIgnoredWorktreeDir();
			if (!ignoredDir) return;

			pendingDir = ignoredDir;
		},

		"experimental.chat.messages.transform": async (_input, output) => {
			if (!output.messages.length) return;

			// 完全依靠消息历史中的 tag 判断是否已注入
			const alreadyInjected = output.messages.some((m) =>
				m.parts.some(
					(p) => p.type === "text" && p.text.includes(NOTIFY_TAG),
				),
			);
			if (alreadyInjected) {
				pendingDir = null;
				return;
			}

			if (!pendingDir) return;

			const firstUser = output.messages.find(
				(m) => m.info.role === "user",
			);
			if (!firstUser?.parts.length) return;

			const dir = pendingDir;
			pendingDir = null;

			firstUser.parts.unshift({
				type: "text",
				text: `<${NOTIFY_TAG}>\n工作树目录 ${dir} 已被 Git 忽略。\n</${NOTIFY_TAG}>`,
				id: "",
				sessionID: "",
				messageID: "",
			});
		},

		"experimental.session.compacting": async () => {
			pendingDir = null;
		},
	};
};
