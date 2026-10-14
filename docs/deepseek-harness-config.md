# DeepSeek Harness 配置记录

记录 dsh（DeepSeek Harness）在本仓库的托管方式、模型配置流水线（细节见 [model-config-pipeline.md](model-config-pipeline.md)）、与 Pi/opencode 习惯的差异及验证方法。

## 概览

- 安装：npm 全局包 `@deepseek-ai/dsh`，命令 `dsh`；本机为 0.1.5-rc.1（rc 阶段配置面可能变动，升级后按包内 README 复核）。
- 入口：`dsh web`（等价 `--profile web`）启动本地浏览器界面；首次启动自动初始化 `~/.dsh/profiles/web`。
- 配置根：`~/.dsh`（`DSH_HOME` 未设置时的默认值）。
- 主要使用面：浏览器界面；TUI 无官方 profile，不在本项目范围。

## 配置面

| 配置面 | 位置 | 说明 |
|---|---|---|
| 用户级指令 | `~/.dsh/AGENTS.md` | 首请求注入；项目链 `AGENTS.md`/`CLAUDE.md` 由 dsh 自动从 `.git` 根叠到 cwd |
| 人设预设 | `~/.dsh/.agent-presets/dafeiyu/` | 生成物：从 dsh 自带 standard 预设派生，只把 persona 行换成大肥鱼人设；默认预设由 home 级 patch 指向它 |
| 插件与 provider 配置 | `~/.dsh/cordis.patch.yml`（home 级）与 `~/.dsh/profiles/<name>/cordis.patch.yml`（profile 级） | home 级对本仓库静态托管（MCP 行与插件挂载行）；profile 级由 models-dev 插件写入模型配置生成块（运行时数据） |
| 模型与界面设置 | `~/.dsh/settings.yaml` | dsh 运行时与 GUI 写入、热重载；不入仓库 |
| 凭据 | `~/.dsh/.credentials.yaml` | GUI 写入、权限 600；本仓库不改动，凭据以启动环境为主 |
| 技能 | `~/.dsh/skills`、`~/.agents/skills`、项目内 `.dsh/skills` 与 `.agents/skills` | dsh 默认扫描这些根；`~/.agents/skills` 由 npx skills 维护 |
| 运行时状态 | `~/.dsh/sessions`、`~/.dsh/storages` 等 | 不入仓库 |

## 仓库托管结构

| 源文件 | 目标 | 说明 |
|---|---|---|
| `dot_dsh/AGENTS.md.tmpl` | `~/.dsh/AGENTS.md` | 渲染 `dot_agents_meow/AGENTS.main.md`（工程准则），与 Pi/opencode 同源；人设不在其中 |
| `dot_dsh/cordis.patch.yml.tmpl` | `~/.dsh/cordis.patch.yml` | home 级 patch：5 个 MCP server 行、models-dev 插件挂载行，以及 `agent-presets` 行（默认预设换成鲸鱼娘模式） |
| `.chezmoiscripts/run_after_dsh-persona-preset.sh.tmpl` + `dot_agents_meow/scripts/gen-dsh-preset.py` | `~/.dsh/.agent-presets/dafeiyu/` | 每次 apply 幂等生成：读 dsh 自带 standard composition，只换 persona 行，persona 文本取自 `dot_agents_meow/AGENTS.persona.md` |
| `dot_agents_meow/models/plugin.mts` 等 | `~/.agents_meow/models/` | 模型域插件：抓取 models.dev、叠加用户配置、写各 profile 的模型配置生成块 |

`settings.yaml` 与 `.credentials.yaml` 由 dsh 持有，不入仓库；GUI 内的偏好（主题、默认模型等）因而不随仓库分发。

## 人设（persona 平面）

dsh 的系统提示词有专用 persona 段位：`DEPLOYMENT_PERSONA_PREFIX` 序号 0（整条提示词最前），`dsh-base` 里默认空着；而 Web 会话用的 preset 自带的 `persona` 行会**遮蔽**部署级 persona。所以人设只写在 home 级 persona 配置里不生效，必须落在预设里；而预设之间没有继承机制（composition 就是一份平铺的插件行列表），取的是派生路线：

- `dot_agents_meow/AGENTS.persona.md` 是唯一人设源（与 Pi/opencode 同源）。
- `gen-dsh-preset.py` 读 dsh 自带 `standard` composition，只换 `persona` 行，其余字节原样保留，写到 `~/.dsh/.agent-presets/dafeiyu/`；写盘前校验“persona 行以外逐字节相同”与行 id 序列不变。
- home 级 patch 的 `agent-presets` 行把默认预设指到 `dafeiyu`（patch 按 id 命中、整份覆盖 config，所以该行要写全）。
- 预设不入仓库（内容随 dsh 版本变）；生成脚本每次 apply 幂等重跑，dsh 升级换掉自带预设后由下一次 apply 拉齐。

失败模式：生成跳过时 dsh 用自带预设（人设平面为空，指令文件不受影响）；预设目录损坏时新建会话报 `agent-preset/invalid`，界面上列出原因而不是隐藏。

## 模型配置

模型目录来自外部 models.dev（运行时抓取，24 小时缓存），用户编辑在 `dot_agents_meow/models/models.toml`；`models-dev` 插件在启动、周期与配置变化时合成并写入各 profile 的 patch 生成块，并注册 `/models-refresh` 手动刷新命令。完整规则、产物与验证见 [model-config-pipeline.md](model-config-pipeline.md)。

## 技能与 MCP

- 技能：dsh 默认扫描根已覆盖 `~/.agents/skills`（npx 安装区），这是唯一技能通道；原 `~/.dsh/skills` → `~/.agents_meow/skills` 符号链接已于 2026-10-06 随仓库技能分发退役删除。Pi 的 better-skill 消歧别名扩展已于 2026-09-24 移除，两家重名处理现为同款策略：按层与扫描序保留首个并告警。
- MCP：迁入 5 个 server（exa、anysearch、context7、cratesio、zai），工具名形如 `mcp__<server>__<tool>`。dsh 无 lazy 概念，启动时全部连接；anysearch 与 zai 的密钥从启动环境（`ANYSEARCH_API_KEY`、`ZHIPU_API_KEY`）读取。

## 凭据与沙箱

- 凭据优先级：启动环境快照 > `~/.dsh/.credentials.yaml` > 启动目录 `.env` > `~/.dsh/.env`。`~/.env_self` 只被 shell 加载，因此从终端启动 `dsh web` 时才有 `COMMAND_CODE_API_KEY` 等变量；图形启动器启动时不可见。
- 沙箱：读取不受限；`workspace-write` 模式可写会话工作区、`/tmp` 与 `os.tmpdir()`；越界写会被拒并触发审批升级。`~/.agents_tmp` 不在可写范围。
- 默认模型保持 dsh 出厂的 DeepSeek 官方模型（`deepseek-flash`）；command-code 模型在会话内选择。

## 验证方法

```bash
chezmoi diff                                        # 预览部署差异
python3 dot_agents_meow/models/gen-models.py --check     # 模型域产物与 TOML 一致
node dot_agents_meow/models/cli.mts check                # dsh 映射统计（读本机缓存）
dsh --profile web --dump-config                          # 组合校验：patch 可加载、MCP 行与模型路由存在
python3 dot_agents_meow/scripts/gen-dsh-preset.py        # 人设预设生成（幂等：第二次无输出）
dsh --profile web --dump-config | rg -A3 'id: agent-presets'   # 默认预设应为 dafeiyu
dsh web --no-open --port 3081                            # 冷启动校验（验证后关闭）
```

浏览器内确认：技能目录含 grilling 与 lark 系技能；模型选择器出现 command-code 组；MCP 工具可调用。

## 非目标与已知差异

- Windows：未覆盖（技能符号链接需开发者模式，dsh home 路径为 `%USERPROFILE%\.dsh`）。
- 不迁移：Pi 的 TUI 交互扩展（esc-hold、editor-input-tweaks、斜杠别名）、注入提示渲染约定、models-dev 导入器、`enabledModels` 会话范围；opencode 的 rebase-main 与 review-cycle 命令留在 opencode。
- dsh 的模型选择器没有收藏或筛除机制，`models.toml` 的 `disabled_providers` 与模型级 `disabled` 是唯一的收敛手段（默认禁用 openrouter 与 opencode）。

## 回退

相关提交 revert 后运行 `chezmoi apply`；如 chezmoi 未清理目标，手工删除 `~/.dsh/AGENTS.md`、`~/.dsh/cordis.patch.yml` 与 `~/.dsh/.agent-presets/dafeiyu/`，并清掉各 `~/.dsh/profiles/*/cordis.patch.yml` 里的 models-dev 生成块。dsh 运行时目录（sessions、storages、profiles）不受影响。

## 参考

- 包内文档：`~/.node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<包名>/README.md`（dsh 升级后以包内文档为准）。
- 验证记录：临时 `DSH_HOME` 下的 `--dump-config` 与冷启动实测；不保留产物。
