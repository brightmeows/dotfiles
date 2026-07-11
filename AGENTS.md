# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

## 全局代理文件说明

`dot_agents_meow/AGENTS.standards.md` 和 `AGENTS.autonomy.md` 是 opencode/Pi 工具使用的**全局代理指令文件**，本仓库仅负责托管它们（通过 chezmoi 分发至 `AGENTS.md.tmpl` / `agents/default.md.tmpl` 等入口）。

| 文件 | 内容 | 加载到 opencode 的方式 | 加载到 Pi 的方式 |
|------|------|----------------------|-----------------|
| `AGENTS.standards.md` | 工程质量准则（确定性优先、提交规范、中文引号） | `agents/default.md.tmpl` → `{{ include }}`（主代理系统提示词） | `APPEND_SYSTEM.md.tmpl` → `{{ include }}`（追加至系统提示词） |
| `AGENTS.autonomy.md` | 自主决策协议（单一判据、两阶段提交、渐进确认陷阱） | `agents/default.md.tmpl` → `{{ include }}`（主代理系统提示词） | `APPEND_SYSTEM.md.tmpl` → `{{ include }}`（追加至系统提示词） |

## Tech Stack

| 工具 | 版本 | 用途 |
|---|---|---|
| chezmoi | latest (system) | 点文件管理，`mode = "symlink"` |
| pnpm | latest (system) | TypeScript 扩展依赖管理 |
| TypeScript | latest (system) | 扩展/插件类型检查 |
| Node | latest (system) | JS 运行时 |

## 系统配置记录

`docs/` 目录下记录了本系统的关键配置决策和历史变更，方便后续排查和重建。

| 文件 | 内容 |
|------|------|
| [`docs/fedora-kinoite-multimedia-repo-config.md`](docs/fedora-kinoite-multimedia-repo-config.md) | Fedora Kinoite 44 多媒体仓库布局、编解码能力分析、terra-mesa 移除记录 |
| [`docs/audio-acp3x-es83xx-headphone.md`](docs/audio-acp3x-es83xx-headphone.md) | AMD ACP3x 音频耳机问题处理 |

## Commands

> **⚠️ 重要约定**： chezmoi 命令必须使用 `-S .` 指定源目录为当前仓库根目录（`~/Codes/dotfiles`）。这是本仓库的非标准目录结构要求，避免使用默认的 `~/.local/share/chezmoi`。
> **ℹ️ Symlink 模式**：本仓库使用 `mode = "symlink"`，目标文件是源文件的符号链接而非副本。编辑源文件后目标文件已自动同步，`chezmoi -S . apply` 通常无额外操作（除非涉及模板渲染或 `run_` 脚本）。修改后直接 `git commit` 即可，不必每次 apply。

| 命令 | 用途 |
|---|---|
| `chezmoi -S . status` | 检视变更 |
| `chezmoi -S . diff` | 预览差异 |
| `chezmoi -S . apply` | 应用至 `$HOME` |
| `chezmoi -S . add <path>` | 纳新文件入 chezmoi 管理 |
| `pnpm check` | `tsc --noEmit` 类型检查（最小验证 gate） |

## 自动同步机制

本仓库使用 chezmoi 脚本自动同步配置文件，确保本地配置与源文件保持一致。

| 配置文件 | 源文件 | 目标文件 | 合并策略 |
|---------|--------|---------|---------|
| Git config | `dot_gitconfig.meow` | `~/.gitconfig` | .meow 覆盖同名键，保留 local-only 键 |
| Pi settings | `dot_pi/agent/settings.meow.json` | `~/.pi/agent/settings.json` | .meow 覆盖同名键，packages 数组合并，Pi 管理键保留 |
| Environment.d | `dot_env_common` | `~/.config/environment.d/50-meow.conf` | awk 翻译 `+=`（追加）/`<=`（前插）为 environment.d 的 `${KEY:+...}` 守卫语法，多操作合并为一行赋值 |

**使用方式**：修改源文件后运行 `chezmoi -S . apply`，脚本自动执行并同步配置。

**实现机制**：合并脚本位于 `.chezmoiscripts/` 目录，使用 `run_` 前缀和模板 hash 监听源文件变化，自动触发合并。

## 边界规则

### Always Do

- 编辑后运行 `pnpm check` 确保类型通过
- 用 `chezmoi -S . diff` 预览变更后再 apply
- 修改配置文件源文件后运行 `chezmoi -S . apply` 同步

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
- **提交语言**：中文
- **提交粒度**：按逻辑变更拆分提交。
- **pre-commit hook**：`git commit` 触发 `pnpm format:check` / `pnpm lint` / markdownlint（见 `.pre-commit-config.yaml`），只检查不写回。失败时先本地修复（`pnpm format` / `pnpm lint:fix`），再重新 `git add` 提交。
