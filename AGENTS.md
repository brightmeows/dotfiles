# MiyakoMeow 的 Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

## 目录结构

- `dot_*` — chezmoi 管理的文件，映射至 `~/.`（如 `dot_config/*` → `~/.config/*`，`dot_agents_meow/` → `~/.agents_meow/`）
- `dot_bashrc` — 映射至 `~/.bashrc`
- `dot_agents_meow/` — **agent 共享配置**：pi/opencode 公共服务规则，通过 symlink_AGENTS.md 链接至此
- `dot_pi/agent/` — **Pi 配置**：映射至 `~/.pi/agent/`（Pi 实际读取的目录），含 settings.json
- `dot_agents_meow/AGENTS_MAIN.md` — **agent 主指令**：opencode default.md 与 pi APPEND_SYSTEM.md 的共享主体，通过 symlink 链接至此（opencode 版通过 `.tmpl` 模板含 frontmatter，pi 纯 symlink 无 frontmatter）
- `dot_agents_meow/skills/` — **共享 skills**：opencode 通过 symlink_skills 链接至该目录，pi 的 settings.json 直接指向 `~/.agents_meow/skills/`
- `.chezmoiexternal.toml` — Windows 跨平台配置映射
- `.chezmoiignore` — 仅仓库不部署的文件清单

## 修改流程

1. 编辑源文件（本仓库）
2. `chezmoi -S . diff` 确认变更
3. `chezmoi -S . apply` 应用至本地
4. 验证功能正常
5. commit + push

## chezmoi 工作流

所有命令需以 `-S .` 指定源目录（本仓库根目录）：

- `chezmoi -S . status` — 检视变更
- `chezmoi -S . diff` — 预览差异
- `chezmoi -S . apply` — 应用至 `$HOME`
- `chezmoi -S . add ~/.some/file` — 纳新文件入管理

## AGENTS.md 分工

本仓库含多份 AGENTS.md，职责不同：

- `AGENTS.md`（本文件）——**此仓库**：项目级上下文——此仓库是什么、如何管理、仓库特有约定。
- `dot_agents_meow/AGENTS.md`——**Agent 通用规则**：行为准则——代码风格、提交规范等，适用于一切通过 agent 编辑的项目。pi/opencode 的 AGENTS.md 均为指向此文件的 symlink。

## TypeScript 检查

- `pnpm check`
