# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

## 全局代理文件说明

`dot_agents_meow/AGENTS.core.md` 和 `AGENTS.dev.md` 是 opencode/Pi 工具使用的**全局代理指令文件**，本仓库仅负责托管它们（通过 chezmoi 分发至 `AGENTS.md.tmpl` / `agents/default.md.tmpl` 等入口）。

| 文件 | 内容 | 加载到 opencode 的方式 | 加载到 Pi 的方式 |
|------|------|----------------------|-----------------|
| `AGENTS.core.md` | “确定性优先”“中文引号”等通用行为 | `AGENTS.md.tmpl` → `{{ include }}` | `AGENTS.md.tmpl` → `{{ include }}` |
| `AGENTS.dev.md` | 对话流程、提交规范等主代理工作流 | `agents/default.md.tmpl` → `{{ include }}` | `AGENTS.md.tmpl` → `{{ include }}` |

## Tech Stack

| 工具 | 版本 | 用途 |
|---|---|---|
| chezmoi | latest (system) | 点文件管理，`mode = "symlink"` |
| pnpm | latest (system) | TypeScript 扩展依赖管理 |
| TypeScript | latest (system) | 扩展/插件类型检查 |
| Node | latest (system) | JS 运行时 |


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
