/**
 * Main-worktree-guard extension for pi
 *
 * 若在 main/master 且工作树目录已入 .gitignore，LLM 首次调用工具后
 * 注入提示——引向用 git worktree 而非直改主干。
 *
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

export default function (pi: ExtensionAPI) {
	let warned = false;

	function getBranch(cwd: string): string {
		try {
			return execSync("git rev-parse --abbrev-ref HEAD", {
				encoding: "utf8",
				cwd,
			}).trim();
		} catch {
			return "";
		}
	}

	function findIgnoredWorktreeDir(cwd: string): string | null {
		for (const dir of WORKTREE_DIRS) {
			try {
				execSync(`git check-ignore ${dir}`, {
					encoding: "utf8",
					cwd,
					stdio: ["ignore", "pipe", "ignore"],
				});
				return dir;
			} catch {
				continue;
			}
		}
		return null;
	}

	pi.on("tool_execution_end", async (_event, ctx) => {
		if (warned) return;
		warned = true;

		const branch = getBranch(ctx.cwd);
		if (!branch) return;
		if (branch !== "main" && branch !== "master") return;

		const ignoredDir = findIgnoredWorktreeDir(ctx.cwd);
		if (!ignoredDir) return;

		const text = `工作树目录 ${ignoredDir} 已被 Git 忽略。`;

		pi.sendMessage(
			{
				customType: "main-worktree-guard",
				content: text,
				display: true,
			},
			{ deliverAs: "steer" },
		);
	});
}
