# MiyakoMeow 的 Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

## AGENTS.md 分工

本仓库含多份 AGENTS.md，职责不同：

- `AGENTS.md`（本文件）——**此仓库**：项目级上下文——此仓库是什么、如何管理、仓库特有约定。
- `dot_agents_meow/AGENTS.md`——**Agent 通用规则**：行为准则——代码风格、提交规范等，适用于一切通过 agent 编辑的项目。pi/opencode 的 AGENTS.md 均为指向此文件的 symlink。

## 目录结构

### Agent 共享配置 — `dot_agents_meow/`

pi 与 opencode 共用。

- `AGENTS.md` — Agent 通用行为准则（pi/opencode 通过 symlink 引用）
- `agents/default.md` — agent 主指令（opencode 通过模板含 frontmatter，pi 通过 symlink）
- `subagents/` — subagent 专用配置
  - `code-reviewer.md` — code review agent 指令
- `skills/` — 共享 skills 目录

### Pi 配置 — `dot_pi/agent/`

映射至 `~/.pi/agent/`，Pi 实际读取的目录。settings.json 通过 `run_onchange_` 脚本按需合并，非直接托管。

- `symlink_AGENTS.md` — symlink 至 `~/.agents_meow/AGENTS.md`
- `symlink_APPEND_SYSTEM.md` — symlink 至 `~/.agents_meow/agents/default.md`
- `run_onchange_merge-pi-settings.sh` — Linux 合并脚本
- `run_onchange_merge-pi-settings.ps1` — Windows 合并脚本
- `settings.meow.json` — managed settings 源文件（theme/retry/skills）

### chezmoi 基础设施

- `dot_*` 命名约定：`dot_` 前缀文件映射至 `~/.`（如 `dot_config/*` → `~/.config/*`，`dot_agents_meow/` → `~/.agents_meow/`）
- `dot_bashrc` — 映射至 `~/.bashrc`
- `.chezmoiexternal.toml` — Windows 跨平台配置映射
- `.chezmoiignore` — 仅仓库不部署的文件清单

## 工作流

### 日常修改

1. 编辑源文件（本仓库）
2. `chezmoi -S . diff` 确认变更
3. `chezmoi -S . apply` 应用至 `$HOME`
4. 验证功能正常
5. commit + push

### 其他命令

- `chezmoi -S . status` — 检视变更
- `chezmoi -S . diff` — 预览差异
- `chezmoi -S . apply` — 应用至 `$HOME`
- `chezmoi -S . add ~/.some/file` — 纳新文件入管理

## TypeScript 检查

- `pnpm check` — pi 及 opencode 的配置须通过 TypeScript 编译检查
