/**
 * Main-worktree-guard extension for pi
 *
 * 若在 main/master 且工作树目录已入 .gitignore，LLM 首次调用工具后
 * 注入提示——引向用 git worktree 而非直改主干。
 *
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

export default function (pi: ExtensionAPI) {
  let warned = false;

  function getBranch(cwd: string): string {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  }

  function findIgnoredWorktreeDir(cwd: string): string | null {
    for (const dir of WORKTREE_DIRS) {
      try {
        execSync(`git check-ignore ${dir}`, {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return dir;
      } catch {
        continue;
      }
    }
    return null;
  }

  // Compact 后重置，允许重新发出工作树提示
  pi.on("session_compact", async () => {
    warned = false;
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    if (warned) {
      return;
    }
    warned = true;

    const branch = getBranch(ctx.cwd);
    if (!branch) {
      return;
    }
    if (branch !== "main" && branch !== "master") {
      return;
    }

    const ignoredDir = findIgnoredWorktreeDir(ctx.cwd);
    if (!ignoredDir) {
      return;
    }

    const text = `工作树目录 ${ignoredDir} 已被 Git 忽略。`;

    pi.sendMessage(
      {
        content: text,
        customType: "main-worktree-guard",
        display: true,
      },
      { deliverAs: "steer" },
    );
  });
}
