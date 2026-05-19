---
name: using-git-worktrees
description: feature 工作需隔离时，或执行计划前——借 git worktree 保隔离工作区
---

# 使用 Git Worktrees

## 概览

保工作在隔离工作区进行。借 git worktree 建隔离工作区。

**核心原则：** 先检现有隔离。后退至 git。勿抗框架。

**开始声明：** “我正使 using-git-worktrees skill 设隔离工作区。”

## 第 0 步：检测现有隔离

**创物前，先检是否已在隔离工作区。**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**子模块守卫：** `GIT_DIR != GIT_COMMON` 在子模块内亦真。断 “已在 worktree” 前，先验非子模块：

```bash
# 若返回路径，则处子模块内，非 worktree——作常规仓库处理
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**若 `GIT_DIR != GIT_COMMON`（且非子模块）：** 已在 linked worktree。跳至第 2 步（项目设置）。**勿**另建 worktree。

按分支状态报告：
- 在分支上：“已在隔离工作区 `<path>`，分支 `<name>`。”
- Detached HEAD：“已在隔离工作区 `<path>`（detached HEAD，外部管理）。完成时需创建分支。”

**若 `GIT_DIR == GIT_COMMON`（或在子模块中）：** 处常规仓库 checkout。

指令中用户是否已声明 worktree 偏好？若未，建 worktree 前求同意：

> “需设隔离 worktree 否？可保护当前分支不受变更影响。”

已有声明偏好者遵之，不询。用户拒则原地工作，跳至第 2 步。

## 第 1 步：创建隔离工作区

借 git worktree 建隔离工作区。

### 目录选择

优先级如下（用户显式偏好压倒一切）：

1. 指令中声明之目录
2. 已有 `.worktrees/`（项目本地，首选隐藏）
3. 已有 `worktrees/`
4. 已有 `~/.config/superpowers/worktrees/<project>/`（向后兼容）
5. 默认项目根 `.worktrees/`

```bash
ls -d .worktrees worktrees ~/.config/superpowers/worktrees/$(basename "$(git rev-parse --show-toplevel)") 2>/dev/null
```

### 安全检查（仅项目本地目录）

**建 worktree 前必须验目录已被 ignore：** 防意外提交 worktree 内容至仓库。

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**若未被 ignore：** 加至 .gitignore，提交变更，再继续。

全局目录（`~/.config/superpowers/worktrees/`）无需验证。

### 创建 Worktree

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
# 项目本地： path=".worktrees/$BRANCH_NAME"
# 全局：     path="~/.config/superpowers/worktrees/$project/$BRANCH_NAME"
git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**沙箱降级：** `git worktree add` 因权限失败时，告用户并原地工作。然后就地运行 setup 与测试。

## 第 2 步：项目设置

自动检测并运行相应 setup：

```bash
# Node.js
if [ -f package.json ]; then npm install; fi
# Rust
if [ -f Cargo.toml ]; then cargo build; fi
# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi
# Go
if [ -f go.mod ]; then go mod download; fi
```

## 第 3 步：验证干净基线

运行测试以保工作区起始干净：

```bash
# 用项目适切命令
npm test / cargo test / pytest / go test ./...
```

**测试失败：** 报告失败，问继续或排查。
**测试通过：** 报告就绪。

报告格式：

```
Worktree 就绪于 <完整路径>
测试通过（<N> 项，0 失败）
可开始实现 <feature-name>
```

## 禁止项

**永不：**
- 第 0 步检得现有隔离，仍创 worktree
- 未验项目本地目录已 ignore 即创 worktree
- 跳过基线测试验证
- 测试失败不询即继续

**始终：**
- 先运行第 0 步检测
- 循目录优先级
- 项目本地目录验其已 ignore
- 自动检测并运行项目 setup
- 验证干净测试基线
