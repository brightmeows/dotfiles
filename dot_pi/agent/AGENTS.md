---
description: Pi agent 配置目录的维护约定（模型配置已迁至模型域）
tags: [pi, mcp, settings]
---

# Pi agent 配置（面向代理）

本目录管理 Pi 的配置源：`settings.meow.json`（合并部署）、`mcp.json`（MCP server 清单）、`models.json` 与 `models-dev.json`（模型配置生成物，随仓库提交）、`ext/`（扩展代码）。
部署与合并机制见仓库根 [AGENTS.md](../../AGENTS.md) 的“自动同步机制”；扩展代码的约定见 [ext/AGENTS.md](./ext/AGENTS.md)。根文件的通用约定（`chezmoi -S .`、提交规范、中文引号）此处不重复。

## 模型配置已迁出

`models.json`（Pi 原生自定义模型）与 `models-dev.json`（models.dev 编辑配置）现在是生成物：

- 唯一编辑入口是 [`dot_agents_meow/models/models.toml`](../../dot_agents_meow/models/models.toml)，字段与规则见 [dot_agents_meow/models/AGENTS.md](../../dot_agents_meow/models/AGENTS.md)。
- 生成命令：`python3 dot_agents_meow/models/gen-models.py`；校验：`--check`（pre-commit 在相关文件变更时自动运行）。
- `apply` 时由 `.chezmoiscripts/run_onchange_after_gen-pi-models.sh.tmpl` 把同一结果同步到 `~/.pi/agent`（Linux 与有 python3 的机器）；Windows 使用仓库中已提交的生成物。
- 不要再手工编辑本目录的 `models.json` 与 `models-dev.json`；models.dev 的目录数据由扩展在运行时获取，不落仓库。

## 其它文件

| 文件 | 用途 | 维护方式 |
|---|---|---|
| `settings.meow.json` | Pi 设置源 | 手改后 `chezmoi -S . apply`，合并脚本写入 `~/.pi/agent/settings.json` |
| `mcp.json` | MCP server 清单 | 手改后 apply |
| `web-search.json` | pi-web-access 搜索路由（`searchRouting` 顺序回退链） | 手改后 apply；curator UI 运行时回写的 `provider` 字段会被下次 apply 覆盖（顶层 `provider` 存在时会顶掉 `searchRouting`，如需临时换源记得回来删）；API key 不入仓库，用 `$ENV_VAR` 引用或依赖环境变量优先级 |
| `models.json`、`models-dev.json` | 模型生成物 | 见上文，勿手改 |
| `ext/` | Pi 扩展包 | 见 [ext/AGENTS.md](./ext/AGENTS.md) |

## 踩坑点：enabledModels 不是可用性过滤

`~/.pi/agent/settings.json` 的 `enabledModels`（Pi 运行时管理，不入 `settings.meow.json`）配置的是会话模型范围（Ctrl+P 循环与 `/scoped-models`）。不在其中的模型照常注册，可用 `/model` 与 `--model` 选用（`pi --list-models` 也照常列出）。新增模型后若循环里没有，先看这里，别怀疑模型源。
