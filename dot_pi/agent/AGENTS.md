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
| `models.json`、`models-dev.json` | 模型生成物 | 见上文，勿手改 |
| `ext/` | Pi 扩展包 | 见 [ext/AGENTS.md](./ext/AGENTS.md) |

## web-search.json（已迁出本目录）

pi-web-access 的搜索路由（`searchRouting` 顺序回退链）源文件现为 [`dot_pi/web-search.json`](../web-search.json)，部署到 `~/.pi/web-search.json`；手改后 apply。

**迁出原因**（2026-09-26）：pi-web-access 的配置路径解析 `getWebSearchConfigDir()`（`~/.pi/agent/npm/node_modules/pi-web-access/dist/index.js`）按序分支——
`PI_CODING_AGENT_DIR` → `XDG_CONFIG_HOME` 已设时查 `$XDG_CONFIG_HOME/pi/` 再查 `~/.pi/` → 未设时查 `~/.pi/agent/` 再查 `~/.pi/`。
`~/.pi/web-search.json` 是唯一两个分支都检查的位置：本机 GUI 会话 `XDG_CONFIG_HOME` 已设（TTY/SSH 登录未设），
文件放 `~/.pi/agent/` 时 GUI 上下文会解析到不存在的 `~/.config/pi/`，路由从未生效；
放 `~/.pi/` 则同机 GUI 与 TTY、非 XDG 平台（Windows Git Bash）全部命中。该函数每进程首查一次即缓存，改文件后需重启 pi。

**维护要点**：

- curator UI 运行时回写的 `provider` 字段会被下次 apply 覆盖（顶层 `provider` 存在时会顶掉 `searchRouting`，如需临时换源记得回来删）；回写落在解析出的同一文件，不会产生副本。
- API key 不入仓库，用 `$ENV_VAR` 引用或依赖环境变量优先级。
- 若 `~/.config/pi/web-search.json` 被人为创建，会优先于 `~/.pi/web-search.json` 被读到（XDG 分支先查它）——排查路由失效时先看这里。

## 踩坑点：enabledModels 不是可用性过滤

`~/.pi/agent/settings.json` 的 `enabledModels`（Pi 运行时管理，不入 `settings.meow.json`）配置的是会话模型范围（Ctrl+P 循环与 `/scoped-models`）。不在其中的模型照常注册，可用 `/model` 与 `--model` 选用（`pi --list-models` 也照常列出）。新增模型后若循环里没有，先看这里，别怀疑模型源。
