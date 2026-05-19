/**
 * Main-worktree-guard extension for pi
 *
 * 检当前分支及工作树目录 .gitignore 状态。
 * 若在 main/master 且 LLM 首次调用工具后，注入提示——
 * 引向用 git worktree 而非直改主干。
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
		const tip = ignoredDir
			? `工作树目录 ${ignoredDir} 已在 .gitignore 中。创建 git worktree 后在其上工作。`
			: `${WORKTREE_DIRS.join("、")} 未在 .gitignore 中。先加入其一，再创建 git worktree。`;

		const text = `当前在 ${branch} 分支。如需修改，${tip}
注：非修改任务、已指定工作目录或代码库不适合工作树时可忽略。`;

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
