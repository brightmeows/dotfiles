# 模型配置流水线

记录 Pi 与 dsh 共用的模型配置来源、生成物、刷新机制与验证方法。用户编辑入口是 `dot_agents_meow/models/models.toml`（部署到 `~/.agents_meow/models/models.toml`）。

## 三层结构

| 层 | 内容 | 归属 |
|---|---|---|
| 外部目录 | models.dev 的 provider 与模型数据 | 外部；Pi 扩展与 dsh 插件各自运行时抓取，不落仓库 |
| 用户配置 | `models.toml`：禁用哪些 provider、覆盖协议与端点、不在 models.dev 的自定义模型 | 仓库（chezmoi 托管） |
| 消费者 | Pi 扩展读 `models-dev.json` 与 `models.json`；dsh 插件读 models.dev 缓存与 `resolved.json` | 仓库生成物 + 本机生成物 |

## 数据流

1. `gen-models.py` 读 `models.toml`，写两份 Pi JSON（入库并随 chezmoi 部署）与本机 `resolved.json`。
2. dsh 插件读 models.dev 缓存（本机抓取）与 `resolved.json`，合成路由写入各 profile 的 patch 生成块。
3. `llm-pi-ai` 从生成块拿到 providers 配置；补丁变更触发加载器热重载。

## 关键决策

- **models.dev 是外部事实**：两侧各自获取（Pi 扩展 24 小时缓存；dsh 插件写 `~/.dsh/cache/models-dev.json`），仓库不冻结目录数据。
- **单段 `[providers.<id>]`**：与 models.dev 同名表示覆盖，未收录表示完整定义；条目里出现定义类字段即按定义处理。这样一份文件只有一条规则，且离线生成器（无目录信息）也能确定 Pi 侧落点。
- **provider 级禁用只写顶层 `disabled_providers`**，条目里写 `disabled` 会被拒绝；首份配置预置禁用 openrouter 与 opencode（体量最大）。
- **档位用 `thinking_levels` 短表达**，生成器展开为 Pi 的 `thinkingLevelMap`（未列档位记 null）与 dsh 的 `reasoningEfforts`；非恒等拼写用 `thinking_wire`。省略表示不做档位外推。
- **`cost` 只对完整定义生效**：Pi 扩展的编辑 schema 没有价格字段，models.dev 已收录 provider 的价格由扩展在运行时自行映射。
- **Pi 两份 JSON 提交入库**并加 pre-commit 校验：它们是 TOML 的纯函数且很小，提交后 Windows（无 python3）等机器也能直接获得；apply 脚本仍会把同一结果同步到 `~/.pi/agent`，覆盖未提交的本地改动。
- **dsh 插件写 profile patch**（home 级保持 chezmoi 静态托管）；实测 patch 文件运行时改写会触发热重载，因此插件不需要 settings 写权限（settings 写接口属注册者 owner scope，外部插件不可写）。
- **插件以免构建方式挂载**：本地 `.mts` 文件由 home patch 行以绝对路径直接挂载（实测可行），Node 26 原生类型剥离，仓库 `pnpm check` 覆盖类型；只使用 Node 内置与仓库内相对导入。
- **Python 解析 TOML**（stdlib `tomllib`）产出 `resolved.json`，插件不解析 TOML：Node 没有标准库 TOML 解析器，自写子集解析是长期风险。
- **watcher 在应用就绪后才注册**，因此插件“启动先写 + 就绪后确认重写”，保证首次启动也能生效。

## dsh 侧映射规则

| 项 | 处理 |
|---|---|
| 协议 | npm 显式映射表（anthropic / google / vertex / bedrock / openai）；dsh 配置层只接受 `openai-completions`、`openai-responses`、`anthropic-messages`，google 系与 bedrock 类跳过；openai 兼容白名单需显式端点，未知 npm 跳过并记录 |
| 凭据 | 目录 `env[0]` 或用户 `api_key` 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，否则跳过（models.dev 存在数字开头的名字） |
| 端点 | 覆盖类 `base_url` 优先；数据层 `provider.api` 展开 `${ENV}`，展开失败或缺失时回落；兼容系无端点则跳过 |
| 模型级差异 | 数据层 `provider.shape`（responses/completions）与 `provider.api`、用户覆盖按模型生效；按 (协议, 端点) 分组拆路由（`<id>-2` 等后缀），避免 dsh 无法表达模型级端点 |
| 档位 | `thinking_levels`（覆盖）优先；目录 `reasoning_options.effort` 取值直映（`none` 映射到 `off`）；`reasoning: false` 写 `reasoningEfforts: false`；其余省略 |
| 限额与模态 | `context_window`/`max_tokens`/`input` 覆盖优先，其次目录 `limit` 与 `modalities.input`；非正整数限额丢弃（目录里存在 0 值），由 dsh 回落默认 |
| cost | dsh 无对应字段，不迁移 |

## 产物与命令

| 产物 | 位置 | 入库 |
|---|---|---|
| `models-dev.json` | `dot_pi/agent/` → `~/.pi/agent/` | 是（生成物，提交） |
| `models.json` | `dot_pi/agent/` → `~/.pi/agent/` | 是（生成物，提交） |
| `resolved.json` | `~/.agents_meow/models/` | 否（本机生成） |
| models.dev 缓存 | `~/.dsh/cache/models-dev.json` | 否（运行时） |
| 模型配置生成块 | `~/.dsh/profiles/*/cordis.patch.yml` | 否（运行时） |

```bash
python3 dot_agents_meow/models/gen-models.py          # 生成仓库产物与本机 resolved.json
python3 dot_agents_meow/models/gen-models.py --check  # 校验 TOML 并比对已存在目标（pre-commit 使用）
node dot_agents_meow/models/cli.mts check             # 映射统计与跳过报告（读本机缓存）
node dot_agents_meow/models/cli.mts render            # 干跑打印生成块
```

## 刷新与失败行为

- 触发：启动先写（用缓存）、就绪后确认重写、每 24 小时、`resolved.json` 变化、`/models-refresh` 手动刷新。
- 缓存：`{fetchedAt, data}`，TTL 24 小时；过期先用旧值后台刷新；拉取失败保留旧值与既有生成块并告警。
- 写入：标记块替换、内容不变不写、临时文件加 rename 原子落盘；用户自己在 profile patch 里的其它内容不受影响。
- 解析失败（缓存或 resolved.json）按无缓存/空配置处理并告警，不中断 dsh 启动。

## 验证方法

```bash
python3 dot_agents_meow/models/gen-models.py --check
node dot_agents_meow/models/cli.mts check          # 期望：约 186 条路由、约 5700 个模型条目、本地校验 0 问题
node dot_agents_meow/models/cli.mts write          # 需要时重写生成块（修复用）
node --test dot_agents_meow/models/*.test.mts      # 映射与写入逻辑单测
dsh --profile web --dump-config                    # 组合可加载，llm-pi-ai 行存在
dsh web --no-open --port 3081                      # 冷启动，观察插件日志与生成块写入
```

浏览器内确认：模型选择器出现 command-code 与常用 provider 组；`/models-refresh` 可手动刷新；技能目录与 MCP 工具正常。

## 已知差异与非目标

- dsh 模型选择器没有收藏或筛除机制，收敛只能靠 `disabled_providers` 与模型级 `disabled`。
- dsh 无 `cost` 字段；`budget_tokens`/`toggle` 类推理模型不提供档位选择。
- Windows：不运行生成脚本（用仓库中已提交的 Pi 生成物）；dsh 插件与 skill 符号链接未覆盖。
- opencode 的 rebase-main 与 review-cycle 命令留在 opencode，不迁移。

## 回退

回退相关提交后运行 `chezmoi -S . apply`；本机需手工清理各 `~/.dsh/profiles/*/cordis.patch.yml` 中的 models-dev 生成块与 `~/.dsh/cache/models-dev.json`。`models.toml` 与生成物可保留（对旧链路无副作用）。
