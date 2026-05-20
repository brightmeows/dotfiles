/**
 * Main-worktree-guard plugin for OpenCode
 *
 * 若在 main/master 且工作树目录已入 .gitignore，LLM 首次调用工具后
 * 注入提示——引向用 git worktree 而非直改主干。
 *
 * 机制与 pi 版一致：tool.execute.after 中检测条件，
 * 条件满足后递延至下一次 messages.transform 注入简短消息。
 * session.compacting 时重置状态。
 */

import { execFileSync, execSync } from "child_process";
import type { Plugin } from "@opencode-ai/plugin";

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

export const MainWorktreeGuardPlugin: Plugin = async (input) => {
	let warned = false;
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
			if (warned) return;
			warned = true;

			const branch = getBranch();
			if (!branch) return;
			if (branch !== "main" && branch !== "master") return;

			const ignoredDir = findIgnoredWorktreeDir();
			if (!ignoredDir) return;

			pendingDir = ignoredDir;
		},

		"experimental.chat.messages.transform": async (_input, output) => {
			if (!pendingDir) return;
			if (!output.messages.length) return;

			const firstUser = output.messages.find((m) => m.info.role === "user");
			if (!firstUser?.parts.length) return;

			const dir = pendingDir;
			pendingDir = null;

			firstUser.parts.unshift({
				type: "text",
				text: `工作树目录 ${dir} 已被 Git 忽略。`,
				id: "",
				sessionID: "",
				messageID: "",
			});
		},

		"experimental.session.compacting": async () => {
			warned = false;
		},
	};
};
