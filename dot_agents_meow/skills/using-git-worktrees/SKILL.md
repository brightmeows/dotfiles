---
name: using-git-worktrees
description: 功能开发需要隔离时，或执行实施计划前——用 git worktree 创建隔离工作区。
---

# 使用 Git Worktrees

**核心原则：** 先检查现有隔离。回退到 git。不要对抗框架。

**开始声明：** “我正在使用 using-git-worktrees skill 设置隔离工作区。”

## 检测隔离

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
SUPER=$(git rev-parse --show-superproject-working-tree 2>/dev/null)
```

- `GIT_DIR != GIT_COMMON` 且没有 `SUPER` → 已在 linked worktree。跳至 setup。
- 否则 → 常规仓库。直接创建 worktree，不需要询问用户。

## 创建 Worktree

使用 `.worktrees/`（项目本地，首选隐藏目录）。

分支名 `$BRANCH` 从待实现 feature 描述自动派生（kebab-case），**不要**询问用户。分支名不得包含 `/`，确保 `.worktrees/$BRANCH` 为扁平结构。例如：

| 任务描述 | 派生分支名 |
|---|---|
| 给登录页加暗色模式 | `add-dark-mode-login` |
| 修复数据库连接池泄漏 | `fix-db-pool-leak` |
| 重构 CI 缓存策略 | `refactor-ci-cache` |

```bash
# 检查 .worktrees 是否已被 .gitignore 忽略
git check-ignore -q .worktrees || {
    echo '/.worktrees' >> .gitignore
    git add .gitignore
    git commit -m "chore: ignore .worktrees/"
}
# 创建 worktree。分支名自动派生，不询问用户。
git worktree add .worktrees/$BRANCH -b $BRANCH
cd .worktrees/$BRANCH
```

**沙箱降级：** 权限失败时通知用户，在原地工作。

## Setup

不做预设。agent 根据项目上下文自行判断（依赖安装、构建脚本等）。

## 基线验证

只做编译/类型检查，不做全量测试。失败就通知用户，询问继续还是排查。通过就报告：

```
Worktree 就绪于 <路径>
基线通过。
可开始实现 <feature-name>
```

## 工作树目录明示规则

创建 worktree 后，后续所有步骤（Setup、基线验证、实现）**必须**在说明中明确提及工作树目录路径（`.worktrees/$BRANCH`）。不可仅称“工作区”“隔离区”——必须写明具体路径，避免混淆主仓库目录与工作树目录。

## 禁止项

- 在已有隔离的情况下重复创建
- 不检查 `.worktrees` 是否已加入 `.gitignore`
- 跳过基线验证
