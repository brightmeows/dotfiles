# MiyakoMeow 的 Dotfiles 配置文件

## Identity

Dotfiles maintainer — 管理 ~300+ 配置文件（Hyprland/niri 混成器、Rime 输入法、AI 工具链等），涉及 10+ 异构格式（TOML/KDL/JSON/YAML/JSONC/Nu/INI）。精确性与一致性优先于花哨。

全局代理指令文件（opencode/Pi/dsh 共用）托管于 [dot_agents_meow/AGENTS.md](dot_agents_meow/AGENTS.md)，本仓库仅负责 chezmoi 分发。

## Commands

> **ℹ️ 源目录**：默认源目录 `~/.local/share/chezmoi` 是指向本仓库的链接（Linux/macOS 为 symlink，Windows 为 junction，指向本机实际 clone 位置），chezmoi 命令在任意目录直接裸跑，无需 `-S`。新机器 clone 后建链一次：
>
> - Linux/macOS：`ln -s ~/Codes/dotfiles ~/.local/share/chezmoi`
> - Windows（PowerShell，无需管理员）：先 `New-Item -ItemType Directory -Force "$env:USERPROFILE\.local\share" | Out-Null`，再 `New-Item -ItemType Junction -Path "$env:USERPROFILE\.local\share\chezmoi" -Target "D:\Codes\dotfiles"`
>
> 验证：`chezmoi source-path` 解析到仓库根；`chezmoi doctor` 显示 source-dir 为 clean 的 git working tree。链接被误删时裸跑 `chezmoi init` 会向默认目录重新 clone，重建链接即可恢复。
> **ℹ️ Copy 模式**：本仓库使用 `mode = "file"`（复制模式），目标文件是源文件的副本，运行时回写（如 fcitx5）不会穿透 symlink 到仓库。编辑源文件后需 `chezmoi apply` 同步至 `$HOME`（模板渲染与 `run_onchange_` 脚本也在此步生效）。
> **⚠️ npx skills**：裸跑时作用于所有已检测 agent（pi、opencode 等），写操作前先确认作用域；`remove` 带部分 `-a` 会报成功但实际不删（剩余 agent 顶住 canonical），不带 `-a` 才会真删 canonical，`remove --all` 会清空 canonical 全部技能。细节与事故记录见 [docs/npx-skills-usage.md](docs/npx-skills-usage.md)。

| 命令 | 用途 |
|---|---|
| `chezmoi status` / `chezmoi diff` | 检视变更 / 预览差异 |
| `chezmoi apply` | 应用至 `$HOME` |
| `chezmoi add <path>` | 纳新文件入 chezmoi 管理 |
| `python3 dot_agents_meow/models/gen-models.py` | 生成 Pi 模型 JSON 与 dsh resolved.json（`--check` 校验） |
| `pnpm check` | `tsc --noEmit` 类型检查（最小验证 gate） |

## 自动同步机制

修改源文件后运行 `chezmoi apply`，`.chezmoiscripts/` 的合并脚本自动执行同步。脚本统一使用 `run_onchange_after_` 前缀（数据文件部署后执行 + 内容变化才运行）；三个 `run_after_` 例外（触发条件不在模板 hash 里）见 [docs/chezmoi-sync-scripts.md](docs/chezmoi-sync-scripts.md)。

| 配置文件 | 源文件 | 目标文件 | 合并策略 |
|---------|--------|---------|---------|
| Git config | `dot_gitconfig.meow` | `~/.gitconfig` | .meow 覆盖同名键，保留 local-only 键 |
| Pi settings | `dot_pi/agent/settings.meow.json` | `~/.pi/agent/settings.json` | .meow 覆盖同名键，packages 数组并集合并（去重排序；meow 源删除不传导，删包后须手动从 settings.json 移除），Pi 管理键保留 |
| 模型配置 | `dot_agents_meow/models/models.toml` | `dot_pi/agent/models*.json`（生成物，随仓库提交）与 `~/.agents_meow/models/resolved.json`（本机） | `gen-models.py` 从 TOML 生成，pre-commit 用 `--check` 校验仓库产物；apply 后脚本同步到 `~/.pi/agent`。规则见 [dot_agents_meow/models/AGENTS.md](dot_agents_meow/models/AGENTS.md) |
| Environment.d | `dot_env_common` | `~/.config/environment.d/50-meow.conf` | awk 翻译 `+=`/`<=` 为 environment.d 守卫语法 |
| Omarchy 工作区组件 | `dot_config/omarchy/plugins/brightmeows.workspaces/manifest.json` | `~/.config/omarchy/shell.json` | 仅替换 `bar.layout` 组件 id（脚本每次 apply 运行）；幂等、尊重手动删除；shell.json 不入 chezmoi 管理（Omarchy CLI 与升级迁移会就地改写） |
| Omarchy 活动窗口组件 | `dot_config/omarchy/plugins/brightmeows.active-window/`（脚本每次 apply 运行） | `~/.config/omarchy/shell.json` | 缺条目则插到中区最左，已存在则原地不动；`omarchy refresh shell` 重置后一次 apply 恢复 |
| dsh 人设预设 | `dot_agents_meow/AGENTS.persona.md`（脚本每次 apply 运行） | `~/.dsh/.agent-presets/bai-xiaomiao/`（生成物，不入仓库） | `gen-dsh-preset.py` 从 dsh 自带 standard 预设派生，只换 persona 行、其余字节原样保留；默认预设由 home 级 patch 指向它。规则见 [docs/deepseek-harness-config.md](docs/deepseek-harness-config.md) |

## DeepSeek Harness 配置

- dsh 用户级配置由本仓库托管（`dot_dsh/` → `~/.dsh`），托管表格与迁移细节见 [docs/deepseek-harness-config.md](docs/deepseek-harness-config.md)。
- 模型配置唯一编辑入口是 `dot_agents_meow/models/models.toml`，流水线见 [docs/model-config-pipeline.md](docs/model-config-pipeline.md)。
- `settings.yaml` 与 `.credentials.yaml` 由 dsh 运行时持有，不入仓库。

## 环境变量配置

数据源：`dot_env_common`（bash 与 nushell 共享，chezmoi 管理）+ 可选 `~/.env_self`（本地补充，不入仓库）。自定义语法（`KEY=` 原样 / `KEY+=` 以 `:` 追加 / `KEY<=` 前插）、shell 与 environment.d 双加载路径及踩坑点见 [docs/env-loading.md](docs/env-loading.md)。

## 跨平台配置原则

- 路径、端口、密钥等机器相关配置（如 Pi `shellPath`、GPG `signingkey`）→ 本机直接写入目标文件，不入源文件；行为、主题、偏好等共享配置 → 写入源文件，chezmoi 分发。
- 各平台配置位置差异由 `.chezmoiexternal.toml` 处理（如 Nu：Linux `~/.config/nushell` vs Windows `%AppData%\nushell`），其映射优先级高于 `dot_` → `.` 默认命名约定；修改配置文件前先查此文件。

## 系统配置记录

`docs/` 目录记录关键配置决策与历史变更，新文档随提交登记于此；该目录仅仓库维护，不再部署到 `~/docs`（各机 `~/docs` 内容不归本仓库管理）：

| 文件 | 内容 |
|------|------|
| [`docs/fedora-kinoite-multimedia-repo-config.md`](docs/fedora-kinoite-multimedia-repo-config.md) | Fedora Kinoite 44 多媒体仓库布局、编解码能力分析、terra-mesa 移除记录 |
| [`docs/audio-acp3x-es83xx-headphone.md`](docs/audio-acp3x-es83xx-headphone.md) | AMD ACP3x 音频耳机问题处理 |
| [`docs/bof-venue-ip-policy.md`](docs/bof-venue-ip-policy.md) | BOF 会场 IP 管控性质、mihomo 实测出口与 BOF 组直连计划 |
| [`docs/fedora-kinoite-obs-vaapi-encode.md`](docs/fedora-kinoite-obs-vaapi-encode.md) | OBS Studio VAAPI 硬件编码配置、VCN 单元监控方法 |
| [`docs/fedora-kinoite-wine-galgame-setup.md`](docs/fedora-kinoite-wine-galgame-setup.md) | Wine 玩日文 Galgame 配置记录 |
| [`docs/fedora-kinoite-wine-selinux-execmod.md`](docs/fedora-kinoite-wine-selinux-execmod.md) | Wine Galgame 的 SELinux execmod 问题排查 |
| [`docs/fedora-nushell-repo-upgrade.md`](docs/fedora-nushell-repo-upgrade.md) | Nushell 升级至官方 Gemfury 仓库记录 |
| [`docs/npx-skills-usage.md`](docs/npx-skills-usage.md) | npx skills 作用域机制、remove 假成功 bug、安全操作姿势与验证方法、WorkBuddy 技能桥接单元 |
| [`docs/deepseek-harness-config.md`](docs/deepseek-harness-config.md) | DeepSeek Harness 配置托管、技能与 MCP 迁移、凭据与沙箱差异 |
| [`docs/model-config-pipeline.md`](docs/model-config-pipeline.md) | 模型配置流水线：TOML 单一源、双消费者生成物、models.dev 刷新与映射规则 |
| [`docs/matebook-battery-optimization.md`](docs/matebook-battery-optimization.md) | MateBook 续航优化：放电数据对比、battery-boost/power-log 改动、mihomo DoT 探测风暴处置 |
| [`docs/pi-lsp-support.md`](docs/pi-lsp-support.md) | Pi 的 LSP 支持：pi-lsp-extension 选型决策与重审触发条件、防漂移四件套写法示范 |
| [`docs/pi-ask-user-question-limits.md`](docs/pi-ask-user-question-limits.md) | Pi ask_user_question 上限配置化 |
| [`docs/env-loading.md`](docs/env-loading.md) | 环境变量单一数据源 + 双加载路径、自定义语法与踩坑点 |
| [`docs/chezmoi-sync-scripts.md`](docs/chezmoi-sync-scripts.md) | 合并脚本命名约定、触发方式与时序约束 |
| [`docs/nvm-shim-nvm4306-script-trust.md`](docs/nvm-shim-nvm4306-script-trust.md) | （历史）NVM shim NVM4306 拦截与脚本信任修复；nvm 已退役，问题随 shim 代理层消失 |
| [`docs/Edge与Firefox书签合并经验.md`](docs/Edge与Firefox书签合并经验.md) | Edge 与 Firefox 书签合并：同步引擎与文件层两套真相、去重映射与两地手术 |
| [`docs/lark-cli技能环境与维护记录.md`](docs/lark-cli技能环境与维护记录.md) | lark-cli 技能环境：安装来源差异、版本对齐与 skills CLI 已知 bug |
| [`docs/terra-mesa-setup.md`](docs/terra-mesa-setup.md) | terra-mesa 硬件解码部署记录（Fedora Kinoite、AMD Ryzen 5 5500U） |
| [`docs/omarchy-monitors-lua-除管记录.md`](docs/omarchy-monitors-lua-除管记录.md) | Omarchy 缩放切档器就地改写 monitors.lua 与 chezmoi 的主权冲突：证据链、除管裁决、政策承接与恢复方法 |
| [`docs/omarchy-shell-refresh-定制恢复清单.md`](docs/omarchy-shell-refresh-定制恢复清单.md) | Omarchy shell.json 手动定制清单（时钟格式、托盘 pinned、右区顺序）、refresh shell 恢复步骤与升级核对提示 |
| [`docs/jujutsu-migration.md`](docs/jujutsu-migration.md) | Jujutsu 试验记录与回退：特性谱系、混用边界与失效模式速查（供将来重用参考） |

## 边界规则

### Always Do

- 编辑后运行 `pnpm check` 确保类型通过
- 用 `chezmoi diff` 预览变更后再 apply
- 修改配置文件源文件后运行 `chezmoi apply` 同步

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

- **分支策略**：日常修改直推 main（单人仓库）；大幅重构用 `git worktree` 隔离。
- **提交**：Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`），中文说明，按逻辑变更拆分提交。
- **验证以 hook 为准**：`git commit` 触发 `.githooks/pre-commit`（`pnpm format:check` / `pnpm lint` 全量 + markdownlint 与中文引号检查仅暂存 md），只检查不写回；失败时先本地修复（`pnpm format` / `pnpm lint:fix`），再重新 `git add` 提交。
- hook 外补验一律原样运行 `.githooks/pre-commit` 或照抄其中的命令行，不自拼检查组合、不用 `--no-verify` 绕过；确需绕过时事后必须原样补跑全部检查并如实报告。
- 格式工具以 package.json scripts 为准（oxfmt，非 prettier）。
- **hook 安装**：package.json 的 `prepare` 脚本在 `pnpm install` 时写入 `core.hooksPath .githooks`（local、相对路径），新机器 clone 后 `pnpm install` 即激活。

> 本仓库曾于 2026-10 短暂试验 jujutsu colocated 后回退，试验记录与 jj 特性速查见 [docs/jujutsu-migration.md](docs/jujutsu-migration.md)。
