---
description: 模型配置域（TOML 单一源，Pi 与 dsh 双消费者）的维护约定
tags: [models, models-dev, pi, dsh]
---

# 模型配置域（面向代理）

本目录是模型配置的单一编辑域：`models.toml` 是唯一手改入口，Pi 与 dsh 两侧的模型配置都由它派生。models.dev 的目录数据是外部事实，由两侧各自在运行时获取（Pi 扩展 24 小时缓存；dsh 插件写本机缓存），不落仓库。

## 文件与流向

| 文件 | 角色 |
|---|---|
| `models.toml` | 唯一编辑入口；chezmoi 部署到 `~/.agents_meow/models/models.toml` |
| `gen-models.py` | 校验 TOML 并生成产物；`--check` 供 pre-commit 校验 |
| `mapping.mts`、`plugin.mts`、`patch-writer.mts`、`config.mts`、`types.mts` | dsh 插件：抓取 models.dev、叠加本文件、写各 profile 的 patch 生成块 |
| `cli.mts` | 干跑 CLI：`check` 统计、`render` 打印生成块 |
| `import-pi-models.py` | 一次性导入器（历史 `models.json` 转 TOML 初稿），保留备查 |

产物：

| 产物 | 归属 | 说明 |
|---|---|---|
| `dot_pi/agent/models-dev.json` | 仓库（提交） | Pi models-dev 扩展的编辑配置（禁用与覆盖类条目） |
| `dot_pi/agent/models.json` | 仓库（提交） | Pi 原生自定义模型（定义类条目） |
| `~/.agents_meow/models/resolved.json` | 本机（不入库） | dsh 插件消费的中立配置，apply 时由脚本生成 |

常用命令：

```bash
python3 dot_agents_meow/models/gen-models.py          # 生成仓库产物与本机 resolved.json
python3 dot_agents_meow/models/gen-models.py --check  # 校验 TOML 并比对已存在的目标
node dot_agents_meow/models/cli.mts check             # dsh 映射统计（读本机缓存与 resolved.json）
node dot_agents_meow/models/cli.mts render            # 打印 patch 生成块（干跑）
node dot_agents_meow/models/cli.mts write             # 重写各 profile 的生成块（修复用）
node --test dot_agents_meow/models/*.test.mts         # 映射与写入逻辑单测
```

## TOML 规则

单段 `[providers.<id>]`：`id` 与 models.dev 同名表示覆盖外部数据，未收录表示完整定义。

- 判定方式：条目里出现任一“定义类字段”即按完整定义处理（Pi 写进 `models.json`，dsh 直接构造路由）；否则按覆盖处理（Pi 写进 `models-dev.json`，dsh 叠加到外部数据上）。
- 定义类字段：模型级 `reasoning`、`input`、`context_window`、`max_tokens`、`cost`、`thinking_levels`、`thinking_wire`、`compat`。
- provider 级禁用只写顶层 `disabled_providers` 数组；条目里写 `disabled` 会被校验拒绝。
- 完整定义必填 provider 级 `api`、`base_url`，每个模型必填 `context_window`、`max_tokens`、`cost`。
- 未知键、未知 compat 键、未知档位一律报错拒绝（不做静默忽略）。

| 层级 | 字段 | 说明 |
|---|---|---|
| provider | `name`、`api`、`base_url`、`api_key`、`compat` | `api_key` 写环境变量名（字母或下划线开头，Pi 生成时加 `$` 前缀） |
| model | `name`、`disabled`、`api`、`base_url` | 覆盖类字段 |
| model | `reasoning`、`input`、`context_window`、`max_tokens`、`cost`、`thinking_levels`、`thinking_wire`、`compat` | 定义类字段 |

档位：`thinking_levels` 是受支持档位列表（`minimal`、`low`、`medium`、`high`、`xhigh`、`max`），生成器展开为 Pi 的 `thinkingLevelMap`（未列档位记 null）与 dsh 的 `reasoningEfforts`；非恒等拼写用 `thinking_wire` 覆盖。省略该字段表示不做档位外推（Pi 不加映射，dsh 不发档位参数）。

字段能力差异：对 models.dev 已收录的 provider，只有覆盖类字段与 `api_key` 参与两侧生成（模型级 `context_window` 等定义类字段会把条目变成完整定义）；`cost` 仅对完整定义生效（Pi 扩展的编辑 schema 没有价格字段）。

## 变更流程

1. 编辑 `models.toml`；
2. `python3 dot_agents_meow/models/gen-models.py` 生成仓库产物与本机 `resolved.json`；
3. `chezmoi -S . apply` 部署 TOML 与产物，并在 apply 之后把同一结果同步到 `~/.pi/agent`；
4. 验证：`--check` 通过；dsh 侧看插件日志与 `/models-refresh`；Pi 侧 `/reload` 后确认模型列表；
5. 提交（TOML 与两份 JSON 同提交，pre-commit 会拦截漂移）。

## 与 dsh 的关系

`models-dev` 插件在启动、就绪确认、每 24 小时、`resolved.json` 变化与 `/models-refresh` 时：抓取 models.dev（缓存 `~/.dsh/cache/models-dev.json`）、叠加本文件、写各 `~/.dsh/profiles/*/cordis.patch.yml` 的标记块，触发热重载。失败保留旧块并打日志；生成块是运行时数据，不入仓库。

映射到 dsh 时的硬限制（写出前由 `validateRoutes` 拦截，不合法就跳过并计数）：

- 协议只支持 `openai-completions`、`openai-responses`、`anthropic-messages`；google 系与 bedrock 类 provider 跳过。
- 凭据名必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`；models.dev 里存在数字开头的环境变量名（如 `302AI_API_KEY`），这类 provider 跳过。
- `contextWindow` 与 `maxTokens` 必须为正整数；目录里的 0 值限额丢弃，由 dsh 回落默认值。
- 按 (协议, 端点) 分组拆路由，弥补 dsh 无法表达模型级端点的限制。

插件只使用 Node 内置与仓库内相对导入（部署后从 `~/.agents_meow/models/` 加载），不依赖裸模块解析；诊断走 console（dsh 默认组合没有日志 exporter）。
