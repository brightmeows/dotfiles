# DeepSeek Harness 配置记录

记录 dsh（DeepSeek Harness）在本仓库的托管方式、内建模型通道、与 Pi/opencode 习惯的差异及验证方法。

## 概览

- 安装：日常 `dsh` 由 Omarchy 的 mise 声明提供 0.2.2-rc.1；npm 全局 0.2.1-rc.5 已删除（2026-11-05），PATH 唯一指向 mise shim。
  dsh 是 Omarchy 4.5 官方 agent 花名册成员：`omarchy default agent dsh` 可设为默认 agent，快捷键启动走 `DSH_PERMISSION_MODE=danger-full-access dsh web`（免审批，注意安全面）。
  2026-11-05 从 0.1.5-rc.1 升到 0.2.1-rc.5 时 dump-config 与冷启动复验通过；同日 Omarchy 4.5 把 mise 版本推到 0.2.2-rc.1。
  npm 新版默认拦截安装脚本，升级时带 `--allow-scripts=@deepseek-ai/dsh-subprocess-local,koff,node-pty`，缺脚本会在启动时报原生模块错误。
- 入口：`dsh web`（等价 `--profile web`）启动本地浏览器界面；首次启动自动初始化 `~/.dsh/profiles/web`。
- 配置根：`~/.dsh`（`DSH_HOME` 未设置时的默认值）。
- 主要使用面：浏览器界面；2026-11-09 起加开终端使用面——`pi-tui` profile（`@xmoon76/dsh-pi-tui`），与 web 共享会话、凭据与技能，详见插件节。

## 配置面

| 配置面 | 位置 | 说明 |
|---|---|---|
| 用户级指令 | `~/.dsh/AGENTS.md` | 首请求注入；项目链 `AGENTS.md`/`CLAUDE.md` 由 dsh 自动从 `.git` 根叠到 cwd |
| 插件配置 | `~/.dsh/profiles/<name>/cordis.patch.yml`（profile 级） | 插件清单在 profile 的 package.json；patch 里只留 GUI 运行时状态键，GUI 改动直接写回本文件 |
| 凭据 | `~/.dsh/.credentials.yaml` | GUI 写入、权限 600；本仓库不改动；现含 deepseek 账号登录与浏览器会话记录，API key 类仍以启动环境为主 |
| 技能 | `~/.dsh/skills`、`~/.agents/skills`、项目内 `.dsh/skills` 与 `.agents/skills` | dsh 默认扫描这些根；`~/.agents/skills` 由 npx skills 维护 |
| 运行时状态 | `~/.dsh/sessions`、`~/.dsh/storages` 等 | 不入仓库 |

home 级 patch（`~/.dsh/cordis.patch.yml`）已于 2026-11-08 经盘问裁决整体退役：models-dev 插件挂载行与四条偏好 override（默认模型、PTC 预设、市场索引源、block-secret-leaks 密钥名单补齐）一并废除，仓库不再托管 patch（模板 `dot_dsh/cordis.patch.yml.tmpl` 已删除）。
2026-11-08 晚 profile patch 新增 `ui-chat` 状态键（`collapseTiming: next-input`、`transcriptView: standard`）：过程组完成后保持展开、下一轮输入才折叠，过程展示停在标准档；该键本应由 GUI 设置写回，本次随主题降对比盘问以 override 行手写落键。
同法手写 `ui-theme` 字体键：`textFontFamily` 与 `codeFontFamily` 均为
JetBrainsMono Nerd Font 加 Noto Sans Mono CJK SC（正文与代码块等宽化，中文回退 CJK 等宽；
初选 ComicShannsMono 后按用户裁决换 JetBrainsMono），
override 整体替换 config，GUI 写入的 `fontSize: 16` 已原样重述。

## 仓库托管结构

| 源文件 | 目标 | 说明 |
|---|---|---|
| `private_dot_dsh/AGENTS.md.tmpl` | `~/.dsh/AGENTS.md` | 渲染 `dot_agents_meow/AGENTS.md`（工程准则），与 Pi/opencode 同源；只收工程准则，不含人设 |

模型域插件（`~/.agents_meow/models/plugin.mts` 家族）已随 models-dev 退役（2026-11-08）删除；
自写插件 dsh-meow-context-hooks 同日经盘问裁决退役删除（双端复刻的维护认知负担大于增量价值，
dsh 丢 git 快照与子目录 AGENTS.md 注入，pi 侧两扩展保留）；`.credentials.yaml` 由 dsh 持有，不入仓库。

## 模型配置

dsh 使用内建模型通道：llm 层复用 pi-ai 1.5.0 的 provider 注册表
（`@earendil-works/pi-ai/dist/providers/data/`），含 `zai-coding-cn`
（`ZAI_CODING_CN_API_KEY` 认证）与原生 deepseek（支持 GUI 账号登录，
凭据落 `~/.dsh/.credentials.yaml` 的 `deepseek-account-platform` 记录）。
2026-11-08 重启后 GUI 已写回默认模型 `zai-coding-cn/glm-5.3-flash`
（effort max）到 profile patch——该行与 `llm-pi-ai` 的空 provider 覆盖
同属 GUI 运行时状态。
models-dev 插件体系（models.dev 目录抓取、`~/.agents_meow/models`
插件家族、profile patch 生成块）已于同日整体退役：`/models-refresh`
命令消失，目录 provider（models.dev 收录的数千模型）不再出现在选择器。
流水线历史与 pi 侧现状见 [model-config-pipeline.md](model-config-pipeline.md)。

## 技能与 MCP

- 技能：dsh 默认扫描根已覆盖 `~/.agents/skills`（npx 安装区），这是唯一技能通道；原 `~/.dsh/skills` → `~/.agents_meow/skills` 符号链接已于 2026-10-06 随仓库技能分发退役删除。Pi 的 better-skill 消歧别名扩展已于 2026-09-24 移除，两家重名处理现为同款策略：按层与扫描序保留首个并告警。
- MCP：2026-11-07 起五条 home patch 插入（exa、anysearch、context7、cratesio、zai）全部移除，
  裁决与登记记录只保留在本节。替代：文档检索曾走 `dsh-context7` 插件
  （原生 `context7_search` / `context7_get_docs` 工具），2026-11-09 盘问裁决卸载
  （dsh 有检索退路，工具面与提示段一并瘦掉；重装 `dsh plugin --profile web add dsh-context7` 即回；
  pi 侧 context7 MCP 不受影响照旧保留），库文档检索现走 `research` / `web_search` 加 `web_fetch`；
  搜索走 `dsh-free-search`
  多引擎 provider（2026-11-08 起，`web_search` 工具面不变），抓取走 dsh 内置
  `web_fetch`；crates.io 缺口由其 `domain_search` 垂直源补上，视觉仍按需用 bash 调 API。
  官方 `deepseek-official` 搜索 provider 保留不卸：插件运行时接管选路
  （`searchProvider` 配置字段保持未设即接管，硬 pin 反有悬空引用翻车教训），
  插件被禁用时搜索降级回官方 provider，故物理退役官方包等于砍掉兜底。
  Pi 侧按有无替代通道区别对待（2026-11-08 复核）：`context7` 保留（pi 无库文档检索替代通道），
  `cratesio-mcp` 停用（bash 调 API 替代），exa、anysearch 维持停用。
  `ANYSEARCH_API_KEY`、`EXA_API_KEY`、`TAVILY_API_KEY`、`TINYFISH_API_KEY` 同时被
  pi-web-access 搜索回退链与 dsh-free-search 使用，`ZHIPU_API_KEY` 仍被 pi 的
  zhipu 模型通道使用，这批 key 都不可删（见凭据节）。

## 插件（2026-11-05 起，对齐 pi 能力）

插件以 `dsh plugin --profile <name> add <pkg>` 标准安装，包体与 lockfile 属 profile 运行时数据，不入 chezmoi；清单与状态以本节为权威记录。市场浏览与安装走官方 `plugin_market` 工具。

| 插件 | 版本 | 用途（对齐 pi） | 验证状态 |
|---|---|---|---|
| `dsh-patch-edit-plus` | 0.4.6 | Codex 语法 `apply_patch`（pi 编辑形态；需在其设置开 `allowCodexPatch`） | 已从 web profile 移除：0.4.6 的 engines 只到 0.2.1-rc.5，dsh 0.2.2-rc.1 下会被跳过；2026-11-07 复议决定不走版本豁免，维持移除，等上游兼容 |
| `dsh-block-secret-leaks` | 0.1.0 | pi secret-safe 等价：拦读/打印/上传/提交密钥，工具输出脱敏 | 冒烟通过：`.env` 读取被拦；extraPatterns 密钥名单补齐随 home patch 退役作废（2026-11-08 裁决） |
| `dsh-plugin-codemode` | 0.1.1 | pi codemode 同构：JS 沙箱 `tools.<name>()` 代理全部工具 | 2026-11-07 卸载：默认预设切官方 PTC（`run_code` 工具面），卸载连带 quickjs 依赖链；该 override 已随 home patch 退役失效，预设回 dsh 内建默认（2026-11-08） |
| `dshmarket` | 1.73.10 | GUI 插件市场底座 | 2026-11-07 卸载：个性化功能（收藏/分组/主题）零使用，浏览安装由官方 `plugin_market` 接管 |
| `dsh-context7` | 0.2.0 | context7 文档原生工具（替代已移除的 mcp-context7） | 2026-11-09 卸载（盘问裁决：dsh 有检索退路，见 MCP 节；pi 侧 context7 MCP 照旧保留）；重装 `dsh plugin --profile web add dsh-context7` |
| `dsh-meow-context-hooks` | 0.1.0 | 自写插件：Pi 两扩展复刻（git 快照、子目录 AGENTS.md 注入），源码在 `dot_dsh/plugins/`（chezmoi 不部署，install_bundle 从仓库路径装） | 2026-11-08 卸载退役：双端复刻维护负担大于增量价值，pi 侧扩展保留；恢复从 git 历史找回源码重装 |
| `dsh-zen-remote` | 2.3.11 | 手机 PWA 推送与远程访问（lan-gate 推送通道，`push_notify` 工具面） | 2026-11-08 装（web），lan-gate-server 进程常驻；运行时状态在 `~/.dsh/zen-remote-server.json`（serverId）与 `~/.dsh/lan-gate-state.json`（VAPID 密钥与推送订阅） |
| `@deepseek-ai/dsh-experimental-plugin-market-bundle` | 0.2.2-rc.1 | 官方 Discover 标签 + `plugin_market` agent 工具 | web 已装，重启后 `plugin_market` 已挂载；2026-11-09 配置唯一索引源 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（awesome-dsh-plugin 社区目录，format-1，4872 插件），写入 profile `cordis.patch.yml` 的 `plugin-market` 行 `config.indexes`，HMR 热生效无需重启，`list_indexes` 与主题类检索实测可用（theme 关键词 351 条，兼容性自动标注） |
| `dsh-free-search` | 0.9.34 | pi-web-access 等价：注册进 ctx.web 的多引擎搜索 provider（27 引擎回退链、keyless 档、多 key 轮换），附 `advanced_search` / `multi_search` / `platform_search` / `domain_search`（41 垂直源）/ `video_search` / `research` 等工具面 | 2026-11-08 装（web），热应用生效：九件工具挂载，`web_search` 与官方 provider 共存正常；`free_search_test` 定向实测 exa/anysearch/tavily/tinyfish 四把 `~/.env_self` key 全 OK，bing OK，ddg 触发 bot-wall 冷却（声明行为）；registry 按供应链策略解析 0.9.34（npm 当日最新 0.9.38），pnpm peers 有 WARN 不阻加载 |
| `dsh-soft-palette` | 1.0.0 | 自写 client 插件：`ThemeRuntime.overrideTokens` 常驻低对比调色层，深色正文约 18:1 降到约 9:1（正文 `#bcc3cd`、底色 `#1e2126`），浅色只降正文一档；覆盖正文、次要文字、底色、两层面板、两级边框七枚 alias token，品牌色与状态色不动；卸载即恢复内建色板 | 2026-11-08 装（web），源码在 `private_dot_dsh/plugins/dsh-soft-palette/`（chezmoi 不部署，install_bundle 从仓库路径装）；`application: applied` 零告警，组合树含 `soft-palette` 行，视觉验收待用户刷新实况 |
| `dsh-meow-preset` | 1.0.0 | 自写 bundle：喵喵模式精简日常预设（id `meow`，order 0）：standard 减 schedule 四件、delegation 四件、todo、present、plugin-manager 工具，保留 goal、jobs、计划模式、ask-user、web_fetch、技能与压缩，applyPatch 维持 false；plan-mode 提示段照抄 standard，仅 todo_write 引用句适配（本预设不挂 todo） | 2026-11-09 装（web），源码在 `private_dot_dsh/plugins/dsh-meow-preset/`（chezmoi 不部署，install_bundle 从仓库路径装）；`application: applied` 零告警，dump-config 含完整声明且行上无激活诊断；同日复制进 pi-tui profile（link 同源） |
| `dsh-herdr-state` | 0.1.0 | 自写插件：把 dsh 会话状态上报给 herdr 状态栏（协议对齐 herdr 官方 pi 集成：`pane.report_agent_session` / `pane.report_agent`，agent 报 `dsh`）；working/idle 取 Stable `subscribeState`，blocked 用 Advanced editor seam 轮询编辑器座位占用（审批/问卷），仅 `HERDR_ENV=1` 时启用 | 2026-11-09 装（pi-tui profile），源码在 `private_dot_dsh/plugins/dsh-herdr-state/`（chezmoi 不部署，install_bundle 从仓库路径装）；`application: applied`，实跑 `herdr agent list` 已识别 `agent: dsh`、`agent_status: working`；blocked 态实机验证待触发一次审批流程；上游 dsh-pi-tui 发布 blocked 字段后改用订阅（见 2026-11-09 盘问记录） |
| `@xmoon76/dsh-pi-tui` | 0.5.6 | pi-tui 系终端前端：装成 `pi-tui` profile（与 web 共享会话、凭据、技能），engines 精确声明 dsh >= 0.2.2-rc.1（上游有版本配对矩阵与 compat CI），pi 直系键位（Esc Esc rewind、Ctrl+S steer、Ctrl+R 输入历史、`!` 与 `!!` shell 模式）、Session fork/rewind/lineage、Extension API 分层稳定入口 | 2026-11-09 装（pi-tui profile），伴喵喵预设；安装三教训入册（见下方 2026-11-09 段）：@latest 在仓库 cwd 被 pnpm minimumReleaseAge 滤成 0.5.5 配对错位（离库目录显式 pin 修复）、patch 缺 llm-pi-ai 行报 NO_ADAPTER、update 前对上游配对矩阵；三方内存实测冷启 274 MB、十轮 203 MB（协议与全程数字存 grilling 记录）；版本策略 @latest 浮动 |

2026-11-07 精简裁决：headless profile 整体退役（从不跑一次性 CLI 任务），插件只维护 web 一份；
如需重建用 `dsh plugin --profile headless add <pkg>`。2026-11-09 盘问裁决开出 pi-tui profile 例外
（终端前端，见插件表）。
dsh 0.2.2-rc.1 下 `dsh-patch-edit-plus` 暂不可用，编辑回到原生 `edit`；
这不改变 pi/opencode 的补丁优先级。dsh 可选插件加载失败是静默的，状态以浏览器插件面板与功能冒烟为准。

2026-11-09 盘问裁决开终端使用面：`pi-tui` profile 装 `@xmoon76/dsh-pi-tui` 0.5.6 与喵喵预设
（link 同源），patch 镜像 web 运行时状态三行（llm-pi-ai 空 provider 覆盖、默认模型、预设默认），
原“TUI 无官方 profile 不在本项目范围”裁决随之作废。三个教训入册：@latest 安装在本仓库 cwd 下
被 pnpm minimumReleaseAge 滤掉当日发布的 0.5.6、落到与 dsh 0.2.2-rc.1 配对错位的 0.5.5
（离库目录显式 pin 修复）；patch 缺 llm-pi-ai 行时 zai 适配器不挂载，会话报 NO_ADAPTER；
将来 update 前先对上游配对矩阵。三方内存实测（十轮计数器任务，tmux 驱动，统一
zai-coding-cn/glm-5.3-flash）：pi 181/159 MB（冷启/十轮后），pi-tui 274/203 MB，
web 临时实例 266 MB，Edge GUI tab 增量约 48 MB——dsh-tui 不比 pi 轻，比浏览器前端略省；
全程数字与协议存 `~/.cache/grilling/dotfiles/20261109-dsh-tui-终端前端选型.md`。

2026-11-09 盘问裁决两层精简：包层 `set_bundle` 停用官方安装包 agent-team 与 forge
（减团队工具与 Team Lead 提示段、create_worktree 与 Forge 面板；market 与四只 profile 包保留；
状态写 profile patch 属 GUI 运行时状态，插件面板或 set_bundle 一键回）；预设层新增
`dsh-meow-preset`（见插件表），换预设粒度的取舍由它承载。已开会话保留原组合，
验证以新会话选喵喵模式后的工具面为准。

上游 `dsh-patch-edit-plus` 的工具描述自带路由指南（单文件小改引导回原生 `edit`），与准则指令叠加后以准则为准。
社区 `@anionex/dsh-apply-patch`（自带原生 DiffBlock 渲染，最贴近 pi 观感）peer 上限全在 0.1.x，0.2.x 下真实断裂不可用，已调研放弃；diff 卡预览需求待上游跟进或自写 client 插件。
社区分叉 `dsh-union-search` 自述 “renamed from dsh-free-search”，但 npm 维护者不同且原包同日仍由原作者发版，声明不实，不采用。

## 凭据与沙箱

- 凭据优先级：启动环境快照 > `~/.dsh/.credentials.yaml` > 启动目录 `.env` > `~/.dsh/.env`。`~/.env_self` 只被 shell 加载，因此从终端启动 `dsh web` 时才有 `DEEPSEEK_API_KEY` 等变量；图形启动器启动时不可见。
- 图形会话密钥注入：`~/.config/environment.d/51-meow-local.conf` 已于 2026-11-08 删除
  （当时裁决：三把 key 的 dsh 消费者全部消失；同日晚装 `dsh-free-search` 后 dsh 重新
  消费 exa/anysearch/tavily/tinyfish，靠终端启动加载 `~/.env_self` 供应），
  连带 `systemctl --user unset-environment` 清掉已导入残留。本机无图形启动器跑 dsh
  的路径（omarchy/hypr 无 dsh 绑定），当前实例从 kitty 里的 nushell 启动，key 可达；
  将来若新增图形启动器跑 dsh 的路径，需重估 environment.d 注入。
  pi 终端会话的 key 由 `~/.env_self` 供应，不受影响。
  加载路径总览见 [env-loading.md](../dev/env-loading.md)。
- 沙箱：读取不受限；`workspace-write` 模式可写会话工作区、`/tmp` 与 `os.tmpdir()`；越界写会被拒并触发审批升级。`~/.agents_tmp` 不在可写范围。
- 默认模型：当前为 GUI 写回的 `zai-coding-cn/glm-5.3-flash`（effort max）；models-dev 时代的 home patch override 已随 2026-11-08 退役废除，GUI 手改随时覆盖。

## 验证方法

```bash
chezmoi diff                                        # 预览部署差异
dsh --profile web --dump-config                     # 组合校验：patch 可加载、模型路由存在
dsh web --no-open --port 3081                       # 冷启动校验（验证后关闭）
dsh --profile pi-tui                                # 终端前端冷启动校验（横幅应示 dsh-0.2.2-rc.1 · tui-v0.5.6）
```

浏览器内确认：技能目录含 grilling 与 lark 系技能；内建模型（zai-coding-cn、deepseek）可选。

## 非目标与已知差异

- 桌面版（2026-11-05 调研后不装）：官方桌面端仅发行 Windows 与 macOS；npm 无官方桌面通道（仅社区纯壳）。界面继续浏览器 `dsh web`，官方发行 Linux 桌面包或 npm 通道时再评估。
  - 上游 `apps/desktop/README.md` 明确 Linux 不是受支持的桌面发布目标；AUR 的移植包（`dsh-desktop-linux-bin`、`deepseek-harness-desktop` 等）为社区补丁构建，不在官方支持面内。
- Windows：未覆盖（技能符号链接需开发者模式，dsh home 路径为 `%USERPROFILE%\.dsh`）。
- 不迁移：Pi 的 TUI 交互扩展（esc-hold、editor-input-tweaks、斜杠别名）、注入提示渲染约定、models-dev 导入器、`enabledModels` 会话范围；opencode 的 rebase-main 与 review-cycle 命令留在 opencode。

## 回退

相关提交 revert 后运行 `chezmoi apply`；如 chezmoi 未清理目标，手工删除 `~/.dsh/AGENTS.md`。
2026-11-08 退役的 home patch 如需恢复，从 git 历史找回 `dot_dsh/cordis.patch.yml.tmpl`，
并按 model-config-pipeline.md 的退役记录重建模型域插件。dsh 运行时目录（sessions、storages、profiles）不受影响。

## 参考

- 包内文档：`~/.node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<包名>/README.md`（dsh 升级后以包内文档为准）。
- 验证记录：临时 `DSH_HOME` 下的 `--dump-config` 与冷启动实测；不保留产物。
