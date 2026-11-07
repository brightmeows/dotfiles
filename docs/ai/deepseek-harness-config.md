# DeepSeek Harness 配置记录

记录 dsh（DeepSeek Harness）在本仓库的托管方式、模型配置流水线（细节见 [model-config-pipeline.md](model-config-pipeline.md)）、与 Pi/opencode 习惯的差异及验证方法。

## 概览

- 安装：日常 `dsh` 由 Omarchy 的 mise 声明提供 0.2.2-rc.1；npm 全局 0.2.1-rc.5 已删除（2026-11-05），PATH 唯一指向 mise shim。
  dsh 是 Omarchy 4.5 官方 agent 花名册成员：`omarchy default agent dsh` 可设为默认 agent，快捷键启动走 `DSH_PERMISSION_MODE=danger-full-access dsh web`（免审批，注意安全面）。
  2026-11-05 从 0.1.5-rc.1 升到 0.2.1-rc.5 时 dump-config 与冷启动复验通过；同日 Omarchy 4.5 把 mise 版本推到 0.2.2-rc.1。
  npm 新版默认拦截安装脚本，升级时带 `--allow-scripts=@deepseek-ai/dsh-subprocess-local,koff,node-pty`，缺脚本会在启动时报原生模块错误。
- 入口：`dsh web`（等价 `--profile web`）启动本地浏览器界面；首次启动自动初始化 `~/.dsh/profiles/web`。
- 配置根：`~/.dsh`（`DSH_HOME` 未设置时的默认值）。
- 主要使用面：浏览器界面；TUI 无官方 profile，不在本项目范围。

## 配置面

| 配置面 | 位置 | 说明 |
|---|---|---|
| 用户级指令 | `~/.dsh/AGENTS.md` | 首请求注入；项目链 `AGENTS.md`/`CLAUDE.md` 由 dsh 自动从 `.git` 根叠到 cwd |
| 插件与 provider 配置 | `~/.dsh/cordis.patch.yml`（home 级）与 `~/.dsh/profiles/<name>/cordis.patch.yml`（profile 级） | home 级对本仓库静态托管（MCP 行与插件挂载行）；profile 级由 models-dev 插件写入模型配置生成块（运行时数据） |
| 模型与界面设置 | `~/.dsh/settings.yaml` | dsh 运行时与 GUI 写入、热重载；不入仓库 |
| 凭据 | `~/.dsh/.credentials.yaml` | GUI 写入、权限 600；本仓库不改动，凭据以启动环境为主 |
| 技能 | `~/.dsh/skills`、`~/.agents/skills`、项目内 `.dsh/skills` 与 `.agents/skills` | dsh 默认扫描这些根；`~/.agents/skills` 由 npx skills 维护 |
| 运行时状态 | `~/.dsh/sessions`、`~/.dsh/storages` 等 | 不入仓库 |

## 仓库托管结构

| 源文件 | 目标 | 说明 |
|---|---|---|
| `dot_dsh/AGENTS.md.tmpl` | `~/.dsh/AGENTS.md` | 渲染 `dot_agents_meow/AGENTS.md`（工程准则），与 Pi/opencode 同源；只收工程准则，不含人设 |
| `dot_dsh/cordis.patch.yml.tmpl` | `~/.dsh/cordis.patch.yml` | home 级 patch：5 个 MCP server 行与 models-dev 插件挂载行 |
| `dot_agents_meow/models/plugin.mts` 等 | `~/.agents_meow/models/` | 模型域插件：抓取 models.dev、叠加用户配置、写各 profile 的模型配置生成块 |

`settings.yaml` 与 `.credentials.yaml` 由 dsh 持有，不入仓库；GUI 内的偏好（主题、默认模型等）因而不随仓库分发。

## 模型配置

模型目录来自外部 models.dev（运行时抓取，24 小时缓存），用户编辑在 `dot_agents_meow/models/models.toml`；`models-dev` 插件在启动、周期与配置变化时合成并写入各 profile 的 patch 生成块，并注册 `/models-refresh` 手动刷新命令。完整规则、产物与验证见 [model-config-pipeline.md](model-config-pipeline.md)。

## 技能与 MCP

- 技能：dsh 默认扫描根已覆盖 `~/.agents/skills`（npx 安装区），这是唯一技能通道；原 `~/.dsh/skills` → `~/.agents_meow/skills` 符号链接已于 2026-10-06 随仓库技能分发退役删除。Pi 的 better-skill 消歧别名扩展已于 2026-09-24 移除，两家重名处理现为同款策略：按层与扫描序保留首个并告警。
- MCP：2026-11-07 起五条 home patch 插入（exa、anysearch、context7、cratesio、zai）全部移除
  （`dot_dsh/cordis.patch.yml.tmpl` 留有裁决注释）。替代：文档检索走 `dsh-context7` 插件
  （原生 `context7_search` / `context7_get_docs` 工具）；搜索与抓取走 dsh 内置
  `web_search` / `web_fetch`；crates.io 与视觉按需用 bash 调 API 或后补社区插件。
  Pi 侧 `mcp.json` 的对应条目同步停用；`ANYSEARCH_API_KEY`、`EXA_API_KEY`、`ZHIPU_API_KEY`
  的环境注入暂成冗余（见凭据节），删除环境文件前先确认 Pi 侧是否仍用。

## 插件（2026-11-05 起，对齐 pi 能力）

插件以 `dsh plugin --profile <name> add <pkg>` 标准安装，包体与 lockfile 属 profile 运行时数据，不入 chezmoi；清单与状态以本节为权威记录。安装 GUI 市场：`dsh plugin --profile web add dshmarket`。

| 插件 | 版本 | 用途（对齐 pi） | 验证状态 |
|---|---|---|---|
| `dsh-patch-edit-plus` | 0.4.6 | Codex 语法 `apply_patch`（pi 编辑形态；需在其设置开 `allowCodexPatch`） | 已从 web profile 移除：0.4.6 的 engines 只到 0.2.1-rc.5，dsh 0.2.2-rc.1 下会被跳过；2026-11-07 复议决定不走版本豁免，维持移除，等上游兼容 |
| `dsh-block-secret-leaks` | 0.1.0 | pi secret-safe 等价：拦读/打印/上传/提交密钥，工具输出脱敏 | 冒烟通过：`.env` 读取被拦 |
| `dsh-plugin-codemode` | 0.1.1 | pi codemode 同构：JS 沙箱 `tools.<name>()` 代理全部工具 | 2026-11-07 卸载：默认预设切官方 PTC（`agent-preset-registry` default `ptc`，`run_code` 工具面），卸载连带 quickjs 依赖链；新会话生效 |
| `dshmarket` | 1.73.10 | GUI 插件市场底座 | 2026-11-07 卸载：个性化功能（收藏/分组/主题）零使用，浏览安装由官方 `plugin_market` 接管；boot 修复场景手改 profile patch 同效 |
| `dsh-context7` | 0.2.0 | context7 文档原生工具（替代已移除的 mcp-context7） | web 已装，重启后 `context7_search` / `context7_get_docs` 已挂载 |
| `dsh-meow-context-hooks` | 0.1.0 | 自写插件：Pi 两扩展复刻（git 快照、子目录 AGENTS.md 注入），源码在 `dot_dsh/plugins/`（chezmoi 不部署，install_bundle 从仓库路径装） | web 已装并挂载；git hooks 检测钩子随 2026-11-07 精简裁决移除 |
| `@deepseek-ai/dsh-experimental-plugin-market-bundle` | 0.2.2-rc.1 | 官方 Discover 标签 + `plugin_market` agent 工具；索引源已在 profile patch 配置（awesome-dsh-plugin 目录的 jsdelivr format-1 副本） | web 已装，重启后 `plugin_market` 已挂载 |

2026-11-07 精简裁决：headless profile 整体退役（从不跑一次性 CLI 任务），插件只维护 web 一份；
如需重建用 `dsh plugin --profile headless add <pkg>`。配套：官方 Code mode（PTC 预设）已设为默认，
`apply_patch` 为主的编辑优先级以工程准则指令落地（三家同源，见 `dot_agents_meow/AGENTS.md`
的“编辑以补丁为主”）。dsh 0.2.2-rc.1 下 `dsh-patch-edit-plus` 暂不可用，编辑回到原生 `edit`；
这不改变 pi/opencode 的补丁优先级。dsh 可选插件加载失败是静默的，状态以浏览器插件面板与功能冒烟为准。

`dsh-block-secret-leaks` 的默认拦截名单仅 `.env` 系文件，`.credentials.yaml` 不在名单内，配置可扩。

上游 `dsh-patch-edit-plus` 的工具描述自带路由指南（单文件小改引导回原生 `edit`），与准则指令叠加后以准则为准。
社区 `@anionex/dsh-apply-patch`（自带原生 DiffBlock 渲染，最贴近 pi 观感）peer 上限全在 0.1.x，0.2.x 下真实断裂不可用，已调研放弃；diff 卡预览需求待上游跟进或自写 client 插件。

## 凭据与沙箱

- 凭据优先级：启动环境快照 > `~/.dsh/.credentials.yaml` > 启动目录 `.env` > `~/.dsh/.env`。`~/.env_self` 只被 shell 加载，因此从终端启动 `dsh web` 时才有 `ANYSEARCH_API_KEY`、`ZHIPU_API_KEY` 等变量；图形启动器启动时不可见。
- 图形会话密钥注入：`~/.config/environment.d/51-meow-local.conf`（本机补充文件，权限 600，不入 chezmoi）从本机密钥文件提取 `ANYSEARCH_API_KEY`、`ZHIPU_API_KEY` 与 `EXA_API_KEY`（exa MCP 的 x-api-key 头），由 systemd user manager 注入，图形启动器启动的进程同样可见。
  密钥轮换后需手工重新提取；加载路径总览见 [env-loading.md](../dev/env-loading.md)。
- 沙箱：读取不受限；`workspace-write` 模式可写会话工作区、`/tmp` 与 `os.tmpdir()`；越界写会被拒并触发审批升级。`~/.agents_tmp` 不在可写范围。
- 默认模型保持 dsh 出厂的 DeepSeek 官方模型（`deepseek-flash`）。

## 验证方法

```bash
chezmoi diff                                        # 预览部署差异
python3 dot_agents_meow/models/gen-models.py --check     # 模型域产物与 TOML 一致
node dot_agents_meow/models/cli.mts check                # dsh 映射统计（读本机缓存）
dsh --profile web --dump-config                          # 组合校验：patch 可加载、MCP 行与模型路由存在
dsh web --no-open --port 3081                            # 冷启动校验（验证后关闭）
```

浏览器内确认：技能目录含 grilling 与 lark 系技能；MCP 工具可调用。

## 非目标与已知差异

- 桌面版（2026-11-05 调研后不装）：官方桌面端仅发行 Windows 与 macOS；npm 无官方桌面通道（仅社区纯壳）。界面继续浏览器 `dsh web`，官方发行 Linux 桌面包或 npm 通道时再评估。
  - 上游 `apps/desktop/README.md` 明确 Linux 不是受支持的桌面发布目标；AUR 的移植包（`dsh-desktop-linux-bin`、`deepseek-harness-desktop` 等）为社区补丁构建，不在官方支持面内。
- Windows：未覆盖（技能符号链接需开发者模式，dsh home 路径为 `%USERPROFILE%\.dsh`）。
- 不迁移：Pi 的 TUI 交互扩展（esc-hold、editor-input-tweaks、斜杠别名）、注入提示渲染约定、models-dev 导入器、`enabledModels` 会话范围；opencode 的 rebase-main 与 review-cycle 命令留在 opencode。
- dsh 的模型选择器没有收藏或筛除机制，`models.toml` 的 `disabled_providers` 与模型级 `disabled` 是唯一的收敛手段（默认禁用 openrouter 与 opencode）。

## 回退

相关提交 revert 后运行 `chezmoi apply`；如 chezmoi 未清理目标，手工删除 `~/.dsh/AGENTS.md` 与 `~/.dsh/cordis.patch.yml`，
并清掉各 `~/.dsh/profiles/*/cordis.patch.yml` 里的 models-dev 生成块。dsh 运行时目录（sessions、storages、profiles）不受影响。

## 参考

- 包内文档：`~/.node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<包名>/README.md`（dsh 升级后以包内文档为准）。
- 验证记录：临时 `DSH_HOME` 下的 `--dump-config` 与冷启动实测；不保留产物。
