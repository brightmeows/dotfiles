# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

## AGENTS.md 分层

本仓库含多份 AGENTS.md，按层级分工：

| 层级 | 位置 | 职责 |
|---|---|---|
| 通用规则 | `dot_agents_meow/AGENTS.main.md` | 跨项目行为准则、编码规范、工程原则（opencode/pi 均 symlink 至此） |
| 仓库级 | `AGENTS.md`（本文件） | 项目上下文、管理方式、仓库特有约定 |
| 子目录 | 各子包 `AGENTS.md` | 局部约定、领域逻辑 |

规则：
- 各层内容不重叠。代理优先取子目录 `AGENTS.md`，次退至根。
- 根 `AGENTS.md` 不重复通用规则（通过 symlink 引用）。

## Tech Stack

| 工具 | 版本 | 用途 |
|---|---|---|
| chezmoi | latest (system) | 点文件管理，`mode = "symlink"` |
| pnpm | 10.33.2 | TypeScript 扩展依赖管理 |
| TypeScript | 6.0+ | 扩展/插件类型检查 |
| Node | 20+ | JS 运行时 |

## 目录结构

### Agent 共享配置 — `dot_agents_meow/`

pi 与 opencode 共用。

- `AGENTS.main.md` — Agent 通用行为准则（pi/opencode 通过 symlink 引用）
- `subagents/` — 5 子代理指令（code-reviewer.md + 4 蓝图执行子代理）
- `skills/` — 6 共享 skills（agents-md / blueprint / exec-direct / exec-subagent / receiving-code-review / using-git-worktrees）

### Pi 配置 — `dot_pi/agent/`

映射至 `~/.pi/agent/`。settings.json 通过 `run_onchange_` 脚本合并，非直接托管。

- `symlink_AGENTS.md` — pi 入口，指向 `.agents_meow/AGENTS.main.md`
- `settings.meow.json` — managed 键源（theme / quietStartup / retry / skills / enableSkillCommands / packages）
- `mcp.json` — MCP 服务器（exa / paper-search / cnki）
- `run_onchange_merge-pi-settings.sh` / `.ps1` — settings 合并脚本
- `extensions/` — 5 个 `.ts` 扩展（command-aliases / main-worktree-guard / models-dev-import / receiving-review / subdir-agents-md）

### OpenCode 配置 — `dot_config/opencode/`

映射至 `~/.config/opencode/`。

- `opencode.jsonc` — 主配置（MCP / 权限规则 / agent build/plan 禁用）
- `agents/` — 6 子代理模板（default + 5 蓝图执行子代理的 `.tmpl`）
- `commands/` — 5 斜杠命令（rebase-main / review-cycle / thesis-check-\* / update-agents-md）
- `plugins/` — 2 TS 插件（main-worktree-guard / receiving-review）
- `symlink_AGENTS.md` — opencode 通用准则入口
- `symlink_skills` — skills symlink

### chezmoi 基础设施

- `dot_*` 命名约定：`dot_` 前缀文件映射至 `~/.`（如 `dot_config/*` → `~/.config/*`）
- `dot_config/chezmoi/chezmoi.toml` — `mode = "symlink"`
- `.chezmoiexternal.toml` — Windows 跨平台映射
- `.chezmoiignore` — 仓库不部署的文件清单

## Symlink 策略

| 源（chezmoi 路径） | 目标 | 用途 |
|---|---|---|
| `dot_pi/agent/symlink_AGENTS.md` | `~/.agents_meow/AGENTS.main.md` | Pi 通用准则 |
| `dot_config/opencode/symlink_AGENTS.md` | `~/.agents_meow/AGENTS.main.md` | OpenCode 通用准则 |

两文件为各自工具的行为准则入口，实际内容位于 `dot_agents_meow/`。

## Commands

| 命令 | 用途 |
|---|---|
| `chezmoi -S . status` | 检视变更 |
| `chezmoi -S . diff` | 预览差异 |
| `chezmoi -S . apply` | 应用至 `$HOME` |
| `chezmoi -S . add <path>` | 纳新文件入 chezmoi 管理 |
| `pnpm check` | `tsc --noEmit` 类型检查 |

## Testing

当前无正式测试框架。`pnpm check`（`tsc --noEmit`）为最小验证 gate。

## 边界规则

### Always Do
- 编辑后运行 `pnpm check` 确保类型通过
- 用 `chezmoi -S . diff` 预览变更后再 apply
- 添加新配置后同步更新 AGENTS.md 的目录描述

### Ask First
- 纳新文件入 chezmoi 管理
- 修改 `run_onchange_` 合并脚本逻辑
- 新增 MCP 配置 / 扩展 / 插件
- 重构目录结构

### Never Do
- 直接修改 `~/.` 下的已托管文件（始终编辑仓库源文件）
- 提交 `.env` / 密钥 / token
- 修改 `node_modules` 内容
- 删除 `.chezmoiignore` 中标记的非部署文件

## Git Workflow

- **分支策略**：日常修改直推 main（单人仓库）。大幅重构用 `git worktree` 隔离。
- **提交格式**：Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`）
- **提交粒度**：按逻辑变更拆分提交。
