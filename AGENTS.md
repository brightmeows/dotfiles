# MiyakoMeow 的 Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

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

## 目录结构

### Agent 共享配置 — `dot_agents_meow/`

pi 与 opencode 共用。

- `AGENTS.main.md` — Agent 通用行为准则（pi/opencode 通过 symlink 引用）
- `agents/default.md` — agent 主指令（opencode 通过模板含 frontmatter，pi 通过 symlink）
- `subagents/` — subagent 专用配置
  - `code-reviewer.md` — code review agent 指令
- `skills/` — 共享 skills 目录

### Pi 配置 — `dot_pi/agent/`

映射至 `~/.pi/agent/`，Pi 实际读取的目录。settings.json 通过 `run_onchange_` 脚本按需合并，非直接托管。

- `symlink_AGENTS.md` — pi 入口（目标见 [Symlink 策略](#symlink-策略)）
- `symlink_APPEND_SYSTEM.md` — pi 入口（目标见 [Symlink 策略](#symlink-策略)）
- `run_onchange_merge-pi-settings.sh` — Linux 合并脚本
- `run_onchange_merge-pi-settings.ps1` — Windows 合并脚本
- `settings.meow.json` — managed settings 源文件（theme/retry/skills）
- `extensions/` — 扩展文件，当前含 `command-aliases.ts`

### chezmoi 基础设施

- `dot_*` 命名约定：`dot_` 前缀文件映射至 `~/.`（如 `dot_config/*` → `~/.config/*`，`dot_agents_meow/` → `~/.agents_meow/`）
- `dot_bashrc` — 映射至 `~/.bashrc`
- `.chezmoiexternal.toml` — Windows 跨平台配置映射
- `.chezmoiignore` — 仅仓库不部署的文件清单

### Symlink 策略

| 源（chezmoi 路径） | 目标 | 用途 |
|---|---|---|
| `dot_pi/agent/symlink_AGENTS.md` | `~/.agents_meow/AGENTS.main.md` | agent 通用行为准则 |
| `dot_pi/agent/symlink_APPEND_SYSTEM.md` | `~/.agents_meow/agents/default.md` | agent 主指令 |

两文件为 pi 读取入口，实际内容位于 `dot_agents_meow/`。

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

## 包管理

| 工具 | 用途 | 管理对象 |
|---|---|---|
| `pnpm` | TypeScript 扩展的依赖与 lint | `dot_pi/agent/extensions/*.ts` |
| `chezmoi` | 点文件管理（系统级工具，Go） | 仓库根 |

## 单文件命令

| 命令 | 用途 |
|---|---|
| `pnpm check` | TypeScript 编译检查（扩展及 pi/opencode 配置） |

## 提交规范

遵循 Conventional Commits 格式：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`。按逻辑变更拆分提交。

## Pi 配置指南

### settings.json 合并机制

`settings.json` 非直接托管，通过 `run_onchange_` 脚本按策略合并：

```
输入: settings.json (现有, 含 pi install 写入的 packages) +
     settings.meow.json (managed, 托管于 chezmoi)
输出: settings.meow.json 键覆盖同名字段,
      packages 等非 managed 键保留
```

要点：

- `settings.meow.json` 为 managed 键源（theme / quietStartup / retry / skills / enableSkillCommands）
- `pi install` / `pi remove` / `pi update` 写入的 `packages` 键不受覆盖
- merge 脚本自动移除 `settings.json` 的 symlink（防误写入 repo）
- 新增 managed 键时：加至 `settings.meow.json` + 更新 `run_onchange_` 脚本（若需新合并逻辑）

### 扩展管理

- `dot_pi/agent/extensions/` 下文件由 chezmoi 管理
- `pi install` 安装的包扩展存于 `~/.pi/agent/npm/` / `git/`，无文件重叠
- 新增扩展：以 `.ts` 文件放 `dot_pi/agent/extensions/`，`pi -e` 快速测试后可纳入 chezmoi

### 快捷键管理

- `keybindings.json` 由 `dot_pi/agent/keybindings.json` 直接托管（chezmai 常规文件）
- 新增快捷键绑定：编辑 `dot_pi/agent/keybindings.json`，`/reload` 即可生效
- 绑定的 action id 见 [keybindings.md](keybindings.md)


## Pi 文档速查

Pi 文档位于 `/opt/pi-coding-agent/docs/`，`index.md` 为入口。常见速查：

| 需求 | 入口 |
|---|---|
| 扩展开发 | `extensions.md` |
| 扩展示例 | `examples/extensions/` |
| 技能 | `skills.md` |
| 主题 / 快捷键 | `themes.md` / `keybindings.md` |
| 设置 / 包管理 | `settings.md` / `packages.md` |
| Provider / 自定义模型 | `providers.md` / `models.md` / `custom-provider.md` |
| TUI / SDK / RPC | `tui.md` / `sdk.md` / `rpc.md` |
| 会话管理 / 压缩策略 | `sessions.md` / `compaction.md` |
| Prompt 模板 | `prompt-templates.md` |
| Session 格式 | `session-format.md` |
