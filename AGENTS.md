# MiyakoMeow 的 Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

## 目录结构

- `dot_*` — chezmoi 管理的配置文件，映射至 `~/.config/*`
- `dot_bashrc` — 映射至 `~/.bashrc`
- `.chezmoiexternal.toml` — Windows 跨平台配置映射
- `.chezmoiignore` — 仅仓库不部署的文件清单

## 修改流程

1. 编辑源文件（本仓库）
2. `chezmoi diff` 确认变更
3. `chezmoi apply` 应用至本地
4. 验证功能正常
5. commit + push

## chezmoi 工作流

- `chezmoi status` — 检视变更
- `chezmoi diff` — 预览差异
- `chezmoi apply` — 应用至 `$HOME`
- `chezmoi add ~/.some/file` — 纳新文件入管理

## AGENTS.md 分工

本仓库含多份 AGENTS.md，职责不同：

- `AGENTS.md`（本文件）——**此仓库**：项目级上下文——此仓库是什么、如何管理、仓库特有约定。
- `dot_config/opencode/AGENTS.md`——**OpenCode 全局**：编码助手行为规则——代码风格、提交规范等，适用于一切通过 OpenCode 编辑的项目。

## TypeScript 检查

- `pnpm check`
