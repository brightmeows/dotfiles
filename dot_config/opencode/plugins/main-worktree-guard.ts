/**
 * Main-worktree-guard plugin for OpenCode.ai
 *
 * 检查当前 git 分支及工作树目录 .gitignore 状态。
 * 若在 main/master，向用户首条消息注入提示——
 * 引导使用 git worktree 而非直接修改主干。
 *
 * 用 git check-ignore（非手动解析）检测忽略状态，更准确。
 * 以 INJECTED_TAG 标记防重复注入。
 */

import { execFileSync, execSync } from "child_process";
import type { Plugin } from "@opencode-ai/plugin";

const INJECTED_TAG = "INJECTED_BRANCH_MAIN_WARN";

export const MainWorktreeGuardPlugin: Plugin = async (input) => {
  let warned = false;
  let branchChecked = false;
  let cachedBranch = "";

  function getBranch(): string {
    if (branchChecked) return cachedBranch;
    try {
      cachedBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
        cwd: input.directory,
      }).trim();
    } catch {
      cachedBranch = "";
    }
    branchChecked = true;
    return cachedBranch;
  }

  const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

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
    "experimental.chat.messages.transform": async (_input, output) => {
      if (warned) return;
      if (!output.messages.length) return;

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) return;

      if (
        firstUser.parts.some(
          (p) => p.type === "text" && p.text.includes(INJECTED_TAG),
        )
      ) return;

      const branch = getBranch();
      if (!branch) {
        warned = true; // 非 git repo
        return;
      }
      if (branch !== "main" && branch !== "master") {
        warned = true; // 安全分支
        return;
      }

      warned = true;
      const ignoredDir = findIgnoredWorktreeDir();
      const tip = ignoredDir
        ? `工作树目录 ${ignoredDir} 已在 .gitignore 中。创建 git worktree 后在其上工作。`
        : WORKTREE_DIRS.join("、") + " 未在 .gitignore 中。先加入其一，再创建 git worktree。";

      const bootstrap = `<${INJECTED_TAG}>
当前在 ${branch} 分支。如需修改，${tip}
注：非修改任务、已指定工作目录或代码库不适合工作树时可忽略。
</${INJECTED_TAG}>`;

      firstUser.parts.unshift({
        type: "text",
        text: bootstrap,
        id: "",
        sessionID: "",
        messageID: "",
      });
    },
  };
};
