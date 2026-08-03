/**
 * Inline Git Status extension for pi
 *
 * 在用户提交消息（agent 开始前）时检测当前 Git 状态并注入上下文：
 * - 是否位于 Git 仓库中（不在则注入提示，不阻塞）
 * - 仓库根目录、当前分支、detached HEAD 判别
 * - 普通 checkout / linked worktree / submodule 判别
 * - 若在 main/master 直改且存在已被 .gitignore 忽略的工作树目录，
 *   注入使用 `git worktree` 隔离开发的建议
 *
 * 检测命令参考 superpowers/using-git-worktrees 技能：
 *   git rev-parse --git-dir / --git-common-dir / --show-toplevel
 *   git branch --show-current
 *   git rev-parse --show-superproject-working-tree
 *
 * 每个 session 只在第一条用户消息时注入一次（compact 后重置，
 * 允许在精简后的上下文中重新注入最新状态）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

export interface GitStatus {
  root: string;
  branch: string | null; // 当前分支（detached HEAD 时为 null）
  isWorktree: boolean;
  isSubmodule: boolean;
}

// 执行 git 命令，失败（非仓库 / 命令不存在）返回 null
// ExecFileSync 参数数组形式：不经 shell、自动处理引号，路径含空格时 Windows 安全
function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// 不在 Git 仓库时返回 null
export function detectGitStatus(cwd: string): GitStatus | null {
  const gitDir = runGit(cwd, ["rev-parse", "--git-dir"]);
  if (!gitDir) {
    return null;
  }
  const commonDir = runGit(cwd, ["rev-parse", "--git-common-dir"]);
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = runGit(cwd, ["branch", "--show-current"]);
  const superproject = runGit(cwd, ["rev-parse", "--show-superproject-working-tree"]);

  // Superproject 路径输出非空 ⇒ 位于 submodule 中
  const isSubmodule = Boolean(superproject);
  // Linked worktree：git-dir 与 git-common-dir 不同（submodule 除外）
  const isWorktree = !isSubmodule && Boolean(commonDir) && gitDir !== commonDir;

  return {
    root: root ?? cwd,
    branch: branch || null,
    isWorktree,
    isSubmodule,
  };
}

// 返回第一个已被 .gitignore 忽略的工作树目录名，否则 null
export function findIgnoredWorktreeDir(cwd: string): string | null {
  for (const dir of WORKTREE_DIRS) {
    if (runGit(cwd, ["check-ignore", "-q", dir]) !== null) {
      return dir;
    }
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let injected = false;

  function buildStatusText(info: GitStatus): string {
    const { root, branch, isWorktree, isSubmodule } = info;
    let text: string;
    if (isSubmodule) {
      text = `[Git 状态] 当前位于 Git submodule（仓库根 ${root}，分支 ${branch ?? "detached HEAD"}），按普通仓库对待。`;
    } else if (isWorktree) {
      text = `[Git 状态] 当前位于 Git linked worktree（仓库根 ${root}，分支 ${branch ?? "detached HEAD"}），工作区已隔离。`;
    } else {
      text = `[Git 状态] 当前位于 Git 仓库（根目录 ${root}，分支 ${branch ?? "detached HEAD"}）。`;
    }
    if (!branch) {
      text += " 处于 detached HEAD，由外部管理，收尾时需创建分支。";
    }
    return text;
  }

  // Compact 后重置，允许重新注入最新 Git 状态
  pi.on("session_compact", async () => {
    injected = false;
  });

  // 用户提交消息、agent loop 开始前注入一次 Git 状态
  pi.on("before_agent_start", async (_event, ctx) => {
    if (injected) {
      return;
    }
    injected = true;

    // /resume 等场景：扩展重载后闭包状态归零，会话历史已含注入消息则跳过
    const hasInjected = ctx.sessionManager
      .getEntries()
      .some((entry) => entry.type === "custom_message" && entry.customType === "inline-git-status");
    if (hasInjected) {
      return;
    }

    const { cwd } = ctx;
    const info = detectGitStatus(cwd);
    let text: string;
    if (!info) {
      text = "[Git 状态] 当前目录不在 Git 仓库中。";
    } else {
      text = buildStatusText(info);
      // 在 main/master 直改且存在被忽略的工作树目录时，给出 worktree 建议
      if (
        (info.branch === "main" || info.branch === "master") &&
        !info.isWorktree &&
        !info.isSubmodule
      ) {
        const ignoredDir = findIgnoredWorktreeDir(cwd);
        if (ignoredDir) {
          text += ` 工作树目录 ${ignoredDir} 已被 Git 忽略，建议在隔离分支上开发：\`git worktree add ${ignoredDir}/<新分支> -b <新分支>\`，避免直改 ${info.branch}。`;
        }
      }
    }

    return {
      message: {
        customType: "inline-git-status",
        content: text,
        display: true,
      },
    };
  });
}
