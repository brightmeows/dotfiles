/**
 * Branch-main-warn plugin for OpenCode.ai
 *
 * 检查当前 git 分支。若在 main/master，注入警告——提示建新分支或
 * 使用 using-git-worktrees skill。防意外修改主干。
 *
 * 分支检查在 messages.transform 内进行（非 factory 阶段），
 * 确保 workspace 上下文已就绪。以 warned 状态锁防重复。
 */

import { execSync } from "child_process";
import type { Plugin } from "@opencode-ai/plugin";

const INJECTED_TAG = "INJECTED_BRANCH_MAIN_WARN";

export const BranchMainWarnPlugin: Plugin = async () => {
  let warned = false;

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (warned) return;
      if (!output.messages.length) return;

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) return;

      if (
        firstUser.parts.some(
          (p) => p.type === "text" && p.text.includes(INJECTED_TAG)
        )
      ) return;

      let branch = "";
      try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
          encoding: "utf8",
        }).trim();
      } catch {
        warned = true; // 非 git repo——不再检查
        return;
      }

      if (branch !== "main" && branch !== "master") {
        warned = true; // 安全分支——不再检查
        return;
      }

      warned = true;

      const bootstrap = `<${INJECTED_TAG}>
当前在 ${branch} 分支。直接修改有风险。建新分支或激活 \`using-git-worktrees\` skill。
</${INJECTED_TAG}>`;

      firstUser.parts.unshift({ type: "text", text: bootstrap } as never);
    },
  };
};
