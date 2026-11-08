# 模型配置域（面向代理）

本目录是模型配置的单一编辑域：`models.toml` 是唯一手改入口，Pi 的模型配置由它派生。models.dev 的目录数据是外部事实，由 Pi 扩展运行时获取（24 小时缓存），不落仓库。dsh 侧消费（models-dev 插件与 `.mts` 工具家族）已于 2026-11-08 退役，记录见 [docs/ai/model-config-pipeline.md](../../docs/ai/model-config-pipeline.md)。

## 文件与流向

| 文件 | 角色 |
|---|---|
| `models.toml` | 唯一编辑入口；chezmoi 部署到 `~/.agents_meow/models/models.toml` |
| `gen-models.py` | 校验 TOML 并生成 Pi 两份 JSON；`--check` 供 pre-commit 校验 |

产物：

| 产物 | 归属 | 说明 |
|---|---|---|
| `dot_pi/agent/models-dev.json` | 仓库（提交） | Pi models-dev 扩展的编辑配置（禁用与覆盖类条目） |
| `dot_pi/agent/models.json` | 仓库（提交） | Pi 原生自定义模型（定义类条目） |

常用命令：

```bash
python3 dot_agents_meow/models/gen-models.py          # 生成两份 Pi JSON
python3 dot_agents_meow/models/gen-models.py --check  # 校验 TOML 并比对已存在的目标
```

## TOML 规则

每个 `[providers.<id>]` 段：`id` 与 models.dev 同名表示覆盖外部数据，未收录表示完整定义。

- 判定方式：条目里出现下表任一定义类字段即按完整定义处理（写进 `models.json`）；否则按覆盖处理（写进 `models-dev.json`）。
- provider 级禁用只写顶层 `disabled_providers` 数组；条目里写 `disabled` 会被校验拒绝。
- 完整定义必填 provider 级 `api`、`base_url`，每个模型必填 `context_window`、`max_tokens`、`cost`。
- 未知键、未知 compat 键、未知档位一律报错拒绝（不做静默忽略）。

| 层级 | 字段 | 说明 |
|---|---|---|
| provider | `name`、`api`、`base_url`、`api_key`、`compat` | `api_key` 写环境变量名（字母或下划线开头，生成时加 `$` 前缀） |
| model | `name`、`disabled`、`api`、`base_url` | 覆盖类字段 |
| model | `reasoning`、`input`、`context_window`、`max_tokens`、`cost`、`thinking_levels`、`thinking_wire`、`compat` | 定义类字段 |

档位：`thinking_levels` 是受支持档位列表（`minimal`、`low`、`medium`、`high`、`xhigh`、`max`），生成器展开为 Pi 的 `thinkingLevelMap`（未列档位记 null）；非恒等拼写用 `thinking_wire` 覆盖。省略该字段表示不做档位外推。

字段能力差异：对 models.dev 已收录的 provider，只有覆盖类字段与 `api_key` 参与生成（模型级 `context_window` 等定义类字段会把条目变成完整定义）；`cost` 仅对完整定义生效（Pi 扩展的编辑 schema 没有价格字段）。

## 变更流程

1. 编辑 `models.toml`；
2. `python3 dot_agents_meow/models/gen-models.py` 生成两份 JSON；
3. `chezmoi apply` 部署 TOML 与产物，并在 apply 之后把同一结果同步到 `~/.pi/agent`；
4. 验证：`--check` 与 `pnpm check` 通过；Pi 侧 `/reload` 后确认模型列表；
5. 提交（TOML 与两份 JSON 同提交，pre-commit 会拦截漂移）。
