---
name: using-git-worktrees
description: feature 工作需隔离时，或执行计划前——借 git worktree 保隔离工作区
---

# 使用 Git Worktrees

**核心原则：** 先检查现有隔离。后退到 git。不要对抗框架。

**开始声明：** “我正使 using-git-worktrees skill 设隔离工作区。”

## 检测隔离

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
SUPER=$(git rev-parse --show-superproject-working-tree 2>/dev/null)
```

- `GIT_DIR != GIT_COMMON` 且无 `SUPER` → 已在 linked worktree。跳至 setup。
- 否则 → 常规仓库。未声偏好者求同意。拒则原地工作，跳至 setup。

## 创建 Worktree

用 `.worktrees/`（项目本地，首选隐藏）。

```bash
# 验已 ignore
git check-ignore -q .worktrees || {
    echo '/.worktrees' >> .gitignore
    git add .gitignore
    git commit -m "chore: ignore .worktrees/"
}
# 创建。新分支名取自待实现 feature。
git worktree add .worktrees/$BRANCH -b $BRANCH
cd .worktrees/$BRANCH
```

**沙箱降级：** 权限失败时告用户，原地工作。

## Setup

不作预设。agent 依项目上下文自行判断（依赖安装、构建脚本等）。

## 基线验证

编译/类型检查，非全测试。失败则告用户，问继续或排查。通过则报告：

```
Worktree 就绪于 <路径>
基线通过。
可开始实现 <feature-name>
```

## 禁止项

- 已有隔离复创
- 未验 `.worktrees` 已 ignore
- 跳过基线验证
