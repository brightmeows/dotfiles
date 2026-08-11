# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

## 全局代理文件说明

`dot_agents_meow/AGENTS.main.md` 是 opencode/Pi 工具使用的**全局代理指令文件**，本仓库仅负责托管它（通过 chezmoi 分发至 `agents/default.md.tmpl` / `APPEND_SYSTEM.md.tmpl` 等入口）。

| 文件 | 内容 | 加载到 opencode 的方式 | 加载到 Pi 的方式 |
|------|------|----------------------|-----------------|
| `AGENTS.main.md` | 工程质量准则 + 自主决策协议 | `agents/default.md.tmpl` → `{{ include }}`（主代理系统提示词） | `APPEND_SYSTEM.md.tmpl` → `{{ include }}`（追加至系统提示词） |
| `AGENTS.main.ref.md` | 维护参考（设计决策 / 理论出处 / 否决方案） | 不加载（仅 chezmoi 分发到 `~/.agents_meow/`） | 不加载 |

修改 `AGENTS.main.md` 前先读 `AGENTS.main.ref.md` 理解决策脉络；ref.md 不被任何模板 include，不进系统提示词。

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
> **ℹ️ Symlink 模式**：本仓库使用 `mode = "symlink"`，目标文件是源文件的符号链接而非副本。编辑源文件后目标文件已自动同步，`chezmoi -S . apply` 通常无额外操作（除非涉及模板渲染或 `run_onchange_` 脚本）。修改后直接 `git commit` 即可，不必每次 apply。
> **⚠️ npx skills 作用域**：`npx skills` 不带 `--agent` 时对所有已检测 agent 生效
> （含 pi 的 `~/.pi/agent/skills`、opencode 的 `~/.config/opencode/skills` 等）。
> 2026-08-11 已移除 bash/nushell 的 `skills` wrapper（曾自动注入 `--agent codex`）；现在裸跑 `npx skills` 写命令前必须先确认作用域。
> **remove 需注意**：不带 `-a` 时 targeting 所有 agent（会清理各 agent 专属目录中的同名技能）；指定 `-a` 时仅列出所有已安装的 universal agent（codex+opencode）才会真删 canonical 与 lock，否则报成功但实际不删。
> opencode 技能目录 `~/.config/opencode/skills` 由 `dot_config/opencode/symlink_skills.tmpl` 管理，指向 `~/.agents_meow/skills` 分发目录
> （曾指向仓库源目录，2026-08-10 曾导致 `npx skills remove` 顺着 symlink 删除仓库源文件）。

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

**实现机制**：合并脚本位于 `.chezmoiscripts/` 目录，使用 `run_onchange_` 前缀（内容变化才运行）和模板 hash 监听源文件变化，自动触发合并。

## 跨平台路径映射

部分应用的配置文件在各平台的实际应用位置不同（例如 Nu 在 Linux 上使用 `~/.config/nushell`，在 Windows 上使用 `%AppData%\nushell`）。chezmoi 的 `.chezmoiexternal.toml` 负责处理这些差异：

```toml
{{- if eq .chezmoi.os "windows" }}
# Windows 上将源文件复制到 %AppData% 对应位置
["AppData/Roaming/nushell/env.nu"]
type = "file"
url = "file://{{ .chezmoi.sourceDir }}/dot_config/nushell/env.nu"
{{- end }}
```

修改此类配置文件时，需确认目标位置是否由 `.chezmoiexternal.toml` 定义，而非 `dot_` 命名约定的默认位置。

## 环境变量配置

环境变量采用“单一数据源 + 双加载路径”架构。

**数据源**：`dot_env_common`（bash 与 nushell 共享的静态变量，chezmoi 管理）+ 可选 `~/.env_self`（本地补充，不入仓库）。

**自定义语法**（`KEY=` 原样 / `KEY+=` 以 `:` 追加 / `KEY<=` 前插）由 shell 加载器与 environment.d 生成脚本共用。

**双加载路径**：

| 路径 | 消费者 | 影响范围 | 读取源 |
|---|---|---|---|
| ① Shell | `dot_bashrc`（`_load_env_file`）、`dot_config/nushell/env.nu`（`load-env-file`） | TTY/SSH 登录的交互式 shell | `.env_common` + `.env_self` |
| ② systemd environment.d | `run_onchange_gen-environmentd.sh.tmpl` → `~/.config/environment.d/50-meow.conf` | systemd user manager 及图形会话（Hyprland/niri） | 仅 `.env_common` |

**踩坑点**：

- environment.d **不影响** TTY/SSH 登录的 shell——纯 shell 变量只走路径①
- `~/.env_self` **只被 shell 读取**，不进 environment.d——本地补充的变量在图形会话/服务中不可见
- nushell 加载器不支持 `$VAR` 引用展开，含变量引用的项须保留在各 shell 配置内
- Nu 的 `load-env-file` 的 `PATH+=` 处理器会根据 `$env.PATH` 的类型分支：list→`append`，string→`concat`。Windows 上初始为 list，但部分场景（Nu 版本/交互模式差异）可能丢失系统 PATH。`env.nu` 底部有安全兜底——保存原始 PATH 并在末尾合并缺失条目。

> environment.d 生成产物 `50-meow.conf` 的同步机制见上文“自动同步机制”一节。

## 跨平台注意事项

本仓库管理多台机器的配置文件，部分配置项具有**平台特异性**（OS 路径、shell 位置、包管理器路径等），不应纳入共享的 dotfiles 源文件。

| 配置示例 | 所属场景 | 处理方式 |
|---------|---------|--------|
| Pi `shellPath` | Windows Git Bash 路径，因安装方式而异 | 直接写入 `~/.pi/agent/settings.json`，不入 `settings.meow.json` |
| GPG `signingkey` | 各机器的签名密钥不同 | 直接 `git config --global` 写入 `~/.gitconfig`，不入 `gitconfig.meow` |
| GPG `gpgsign` / `gpg.program` | GPG 路径及签名策略因 OS 而异 | 同上，直接写入 `~/.gitconfig` |
| `~/.env_self` | 本地补充的环境变量 | 见“环境变量配置”，**不入仓库** |

**原则**：路径、端口、密钥等机器相关配置 → 本机直接写入目标文件，不入源文件；行为、主题、偏好等共享配置 → 写入源文件，通过 chezmoi 分发。

> ⚠️ `.chezmoiexternal.toml` 中定义的平台路径映射优先级高于 `dot_` → `.` 默认命名约定。修改配置文件前请先检查此文件。

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
