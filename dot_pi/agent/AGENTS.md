---
description: Pi agent 配置目录（模型源为主）的维护约定与踩坑点
tags: [pi, models, command-code]
---

# Pi agent 配置（面向代理）

本目录管理 Pi 的配置源：`models.json`（自定义模型源）、`settings.meow.json`（合并部署）、`mcp.json`、`models-dev.json` 等。
部署与合并机制见仓库根 [AGENTS.md](../../AGENTS.md) 的“自动同步机制”；扩展代码的约定见 [ext/AGENTS.md](./ext/AGENTS.md)。根文件的通用约定（`chezmoi -S .`、提交规范、中文引号）此处不重复。

本文件聚焦 `models.json` 里 command-code 模型源的维护。

## 收录范围

command-code 模型源只收 GOAT 计划**当前可用**的模型，不是 Provider API 的全量目录。

- 可用性判据：官方计划页与模型页内嵌数据里的 `minPlanName`。`Go` 与 `GOAT` 表示 GOAT 计划内可用；`Pro` 与 `Max` 表示需更高档计划，不收录。
- Provider API `GET /provider/v1/models` 返回全量目录（含计划外模型）：**id 存在不等于计划可用**，不能据此增删条目。
- 条目顺序与官方模型页列表一致，便于逐条比对审计。

## 数据核验（以官方页为准）

- 价格、上下文、视觉等元数据以官方模型页为准；**成本会漂移**，维护时全量核对（案例：`deepseek-v4-flash` 从 0.22 / 0.66 / 0.007 调整为 0.15 / 0.60 / 0.003）。DeepSeek 系列分峰谷计价，条目记 off-peak 口径。
- `thinkingLevelMap` 按证据直映（同名字符串），不做档位借用；映射值不得超出 API 全局枚举（`low` / `medium` / `high` / `xhigh` / `max`），超出的值（如 `minimal`）请求直接 400。注意 API 对枚举是全局校验、不逐模型限制：探测通过只说明值合法，不代表该档位在页面清单里；逐模型证据看官方模型页内嵌数据的 `reasoningEfforts`。
- 存量条目的档位与页面标注有少量出入（2026-09-10 审计），未逐条校准；要改某条目前先按页面证据核对并实测。
- `maxTokens` 官方未给字段：沿用同族值或 models.dev 旁证，必要时用 API 实测试探。

## 抓取方法（表格数据不用 extract 工具）

extract 类工具会把官方模型表压平（列粘连、部分列丢失），数据不可直接使用。用 `curl` 抓原始 HTML，再解析内嵌载荷：

- Next.js 页面（如计划页 `/docs/plans/goat`）：`self.__next_f.push` 分片，拼接解码。
- React Router 页面（如模型页 `/models/<slug>`）：`streamController.enqueue` 分片，JSON 解码后为按索引引用的扁平数组。

## 更新流程

1. `curl` 官方页并解析载荷，取全量数据；
2. 与现有条目做集合比对，确定增删（含全量价格核验）；
3. 编辑 `models.json`；证据写进提交信息（JSON 无注释）；
4. 同步 dsh 派生配置：`python3 dot_agents_meow/scripts/gen-dsh-llm-route.py` 并提交生成物（pre-commit 会用 `--check` 拦截漂移，映射规则见 [docs/deepseek-harness-config.md](../../docs/deepseek-harness-config.md)）；
5. `chezmoi -S . apply ~/.pi/agent/models.json`；
6. 校验：JSON 解析与集合一致；`pi --list-models` 确认注册；可疑字段用 API 实测；
7. Pi 内 `/reload` 生效。

探测请求（`max_tokens`、`reasoning_effort` 换成待验证值）：

```bash
curl -sS -X POST https://api.commandcode.ai/provider/v1/chat/completions \
  -H "Authorization: Bearer $COMMAND_CODE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"hi"}],"max_tokens":1,"reasoning_effort":"low"}'
```

## 踩坑点

### 数量不写死

模型数量是派生事实：根 AGENTS.md 只写收录范围，不写死数字，免得每次增删都要同步、忘了就过期。要看数量：

```bash
jq '.providers["command-code"].models | length' dot_pi/agent/models.json
```

### enabledModels 不是可用性过滤

`~/.pi/agent/settings.json` 的 `enabledModels`（Pi 运行时管理，不入 `settings.meow.json`）配置的是会话模型范围（Ctrl+P 循环与 `/scoped-models`）。不在其中的模型照常注册，可用 `/model` 与 `--model` 选用（`pi --list-models` 也照常列出）。新增模型后若循环里没有，先看这里，别怀疑模型源。
