# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

## AGENTS.md 分层

本仓库含多份 AGENTS.md，按层级分工：

| 层级 | 位置 | 职责 |
|---|---|---|
| 通用规则 | `dot_agents_meow/AGENTS.core.md` | 跨项目通用规则（原内容已废弃，待重写；opencode/pi 均 symlink 至此） |
| 开发者规则 | `dot_agents_meow/AGENTS.dev.md` | 主 Agent 专属规则（提交规范等），主 Agent 通过 template include 加载 |
| 仓库级 | `AGENTS.md`（本文件） | 项目上下文、管理方式、仓库特有约定 |
| 子目录 | 各子包 `AGENTS.md` | 局部约定、领域逻辑 |

规则：
- 各层内容不重叠。代理优先取子目录 `AGENTS.md`，次退至根。
- 根 `AGENTS.md` 不重复 core 内容（通过 symlink 引用）。

## Tech Stack

| 工具 | 版本 | 用途 |
|---|---|---|
| chezmoi | latest (system) | 点文件管理，`mode = "symlink"` |
| pnpm | latest (system) | TypeScript 扩展依赖管理 |
| TypeScript | latest (system) | 扩展/插件类型检查 |
| Node | latest (system) | JS 运行时 |

## 目录结构

### Agent 共享配置 — `dot_agents_meow/`
pi 与 opencode 共用。含通用规则占位 `AGENTS.core.md`（原内容废弃待重写；两工具入口 symlink 至此）、主 Agent 专属规则 `AGENTS.dev.md`（template include 加载）及 3 共享 skills。

### Pi 配置 — `dot_pi/agent/` → `~/.pi/agent/`
settings 通过 `run_onchange_` 脚本合并（非直接托管）。含 MCP 配置、TS 扩展、skills 入口 symlink。

### OpenCode 配置 — `dot_config/opencode/` → `~/.config/opencode/`
含主配置、斜杠命令、TS 插件、AGENTS.md 入口 symlink。

### Rust 工具链 — `dot_cargo/` / `dot_config/sccache/`
Cargo 全局配置（`rustc-wrapper = "sccache"`）、sccache 磁盘缓存。

### chezmoi 基础设施
- `dot_*` 前缀映射至 `~/.`（如 `dot_config/*` → `~/.config/*`）
- `dot_config/chezmoi/chezmoi.toml`：`mode = "symlink"`
- `.chezmoiexternal.toml`：Windows 跨平台映射
- `.chezmoiignore`：仓库不部署的文件清单


## Commands

| 命令 | 用途 |
|---|---|
| `chezmoi -S . status` | 检视变更 |
| `chezmoi -S . diff` | 预览差异 |
| `chezmoi -S . apply` | 应用至 `$HOME` |
| `chezmoi -S . add <path>` | 纳新文件入 chezmoi 管理 |
| `pnpm check` | `tsc --noEmit` 类型检查（最小验证 gate） |

## 边界规则

### Always Do
- 编辑后运行 `pnpm check` 确保类型通过
- 用 `chezmoi -S . diff` 预览变更后再 apply

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
