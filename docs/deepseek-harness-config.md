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
| 插件与 provider 配置 | `~/.dsh/cordis.patch.yml`（home 级）与 `~/.dsh/profiles/<name>/cordis.patch.yml`（profile 级） | home 级对本仓库静态托管（MCP 行与插件挂载行）；profile 级由 models-dev 插件写入模型配置生成块（运行时数据） |
| 模型与界面设置 | `~/.dsh/settings.yaml` | dsh 运行时与 GUI 写入、热重载；不入仓库 |
| 凭据 | `~/.dsh/.credentials.yaml` | GUI 写入、权限 600；本仓库不改动，凭据以启动环境为主 |
| 技能 | `~/.dsh/skills`、`~/.agents/skills`、项目内 `.dsh/skills` 与 `.agents/skills` | dsh 默认扫描这些根；`~/.agents/skills` 由 npx skills 维护 |
| 运行时状态 | `~/.dsh/sessions`、`~/.dsh/storages` 等 | 不入仓库 |

## 仓库托管结构

| 源文件 | 目标 | 说明 |
|---|---|---|
| `dot_dsh/AGENTS.md.tmpl` | `~/.dsh/AGENTS.md` | 渲染 `dot_agents_meow/AGENTS.main.md`，与 Pi/opencode 同源 |
| `dot_dsh/cordis.patch.yml.tmpl` | `~/.dsh/cordis.patch.yml` | home 级 patch：5 个 MCP server 行与 models-dev 插件挂载行 |
| `dot_dsh/symlink_skills.tmpl` | `~/.dsh/skills` | 符号链接到 `~/.agents_meow/skills`，使 meow 技能（grilling 等）对 dsh 可见 |
| `dot_agents_meow/models/plugin.mts` 等 | `~/.agents_meow/models/` | 模型域插件：抓取 models.dev、叠加用户配置、写各 profile 的模型配置生成块 |

`settings.yaml` 与 `.credentials.yaml` 由 dsh 持有，不入仓库；GUI 内的偏好（主题、默认模型等）因而不随仓库分发。

## 模型配置

模型目录来自外部 models.dev（运行时抓取，24 小时缓存），用户编辑在 `dot_agents_meow/models/models.toml`；`models-dev` 插件在启动、周期与配置变化时合成并写入各 profile 的 patch 生成块，并注册 `/models-refresh` 手动刷新命令。完整规则、产物与验证见 [model-config-pipeline.md](model-config-pipeline.md)。

## 技能与 MCP

- 技能：dsh 默认扫描根已覆盖 `~/.agents/skills`（npx 安装区）；`~/.dsh/skills` 由 chezmoi 部署为指向 `~/.agents_meow/skills` 的符号链接，dsh 默认跟随符号链接。dsh 没有 Pi better-skill 的重名消歧别名机制，重名按层与扫描序判定并告警。
- MCP：迁入 5 个 server（exa、anysearch、context7、cratesio、zai），工具名形如 `mcp__<server>__<tool>`。dsh 无 lazy 概念，启动时全部连接；anysearch 与 zai 的密钥从启动环境（`ANYSEARCH_API_KEY`、`ZHIPU_API_KEY`）读取。

## 凭据与沙箱

- 凭据优先级：启动环境快照 > `~/.dsh/.credentials.yaml` > 启动目录 `.env` > `~/.dsh/.env`。`~/.env_self` 只被 shell 加载，因此从终端启动 `dsh web` 时才有 `COMMAND_CODE_API_KEY` 等变量；图形启动器启动时不可见。
- 沙箱：读取不受限；`workspace-write` 模式可写会话工作区、`/tmp` 与 `os.tmpdir()`；越界写会被拒并触发审批升级。`~/.agents_tmp` 不在可写范围。
- 默认模型保持 dsh 出厂的 DeepSeek 官方模型（`deepseek-flash`）；command-code 模型在会话内选择。

## 验证方法

```bash
chezmoi -S . diff                                        # 预览部署差异
python3 dot_agents_meow/models/gen-models.py --check     # 模型域产物与 TOML 一致
node dot_agents_meow/models/cli.mts check                # dsh 映射统计（读本机缓存）
dsh --profile web --dump-config                          # 组合校验：patch 可加载、MCP 行与模型路由存在
dsh web --no-open --port 3081                            # 冷启动校验（验证后关闭）
```

浏览器内确认：技能目录含 grilling 与 lark 系技能；模型选择器出现 command-code 组；MCP 工具可调用。

## 非目标与已知差异

- Windows：未覆盖（技能符号链接需开发者模式，dsh home 路径为 `%USERPROFILE%\.dsh`）。
- 不迁移：Pi 的 TUI 交互扩展（esc-hold、editor-input-tweaks、斜杠别名）、注入提示渲染约定、models-dev 导入器、`enabledModels` 会话范围；opencode 的 rebase-main 与 review-cycle 命令留在 opencode。
- dsh 的模型选择器没有收藏或筛除机制，`models.toml` 的 `disabled_providers` 与模型级 `disabled` 是唯一的收敛手段（默认禁用 openrouter 与 opencode）。

## 回退

相关提交 revert 后运行 `chezmoi -S . apply`；如 chezmoi 未清理目标，手工删除 `~/.dsh/AGENTS.md`、`~/.dsh/cordis.patch.yml` 与 `~/.dsh/skills` 符号链接，并清掉各 `~/.dsh/profiles/*/cordis.patch.yml` 里的 models-dev 生成块。dsh 运行时目录（sessions、storages、profiles）不受影响。

## 参考

- 包内文档：`~/.node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<包名>/README.md`（dsh 升级后以包内文档为准）。
- 验证记录：临时 `DSH_HOME` 下的 `--dump-config` 与冷启动实测；不保留产物。
