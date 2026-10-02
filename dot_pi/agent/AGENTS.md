---
description: Pi agent 配置目录的维护约定（模型配置已迁至模型域）
tags: [pi, mcp, settings]
---

# Pi agent 配置（面向代理）

本目录管理 Pi 的配置源：`settings.meow.json`（合并部署）、`mcp.json`（Pi 内建 MCP server 清单）、`models.json` 与 `models-dev.json`（模型配置生成物，随仓库提交）、`ext/`（扩展代码）。
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
| `mcp.json` | Pi 内建 MCP server 清单 | 手改后 apply；字段与旧适配器字段的对照见下方注记 |
| `models.json`、`models-dev.json` | 模型生成物 | 见上文，勿手改 |
| `ext/` | Pi 扩展包 | 见 [ext/AGENTS.md](./ext/AGENTS.md) |

> 2026-10-02 起 Pi 回归内建 MCP，`pi-mcp-adapter` 与 `mcp-adapter.json` 已移除
> （2026-09-27 曾因适配器 3.x 从 `mcp.json` 更名为 `mcp-adapter.json`）。现配置源为 `mcp.json`，字段即内建格式：
> stdio 用 `command`/`args`/`env`/`cwd`，HTTP 用 `url`/`headers`，另有 `enabled: false`、`exposure`、`timeout`、`description`。
> `exposure` 默认 `codemode`，可写 `deferred`/`direct`/`hidden`。
> 旧适配器字段对照：`directTools: false` 对应 `exposure: "codemode"`；
> `auth: "bearer"` + `bearerTokenEnv` 对应 `headers.Authorization: "Bearer ${VAR}"`；
> `disabled: true` 对应 `enabled: false`；`lifecycle` 无对应，内建对启用 server 后台连接并保持到会话结束。
> 服务器增删优先用 `pi mcp add/remove`（写同一文件），手改文件后 `/reload` 生效。
> `settings.json` 的 `extensions` 不应再出现 `-builtin:mcp`（适配器安装时写入的禁用项），内建 MCP 默认加载。

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
- `ssrf.allowRanges`（2026-09-27 起，当前值 `["198.18.0.0/16"]`）：mihomo TUN fake-ip 把域名解析成
  198.18.x.x 假地址，pi-web-access 的 SSRF 防护会把它误判为内网地址拦截（报
  `Blocked internal address for <域名>`），故加白名单放行。范围依据：上游 README 要求写“覆盖代理
  fake-ip 池的最窄范围”，本仓库各机 `fake-ip-range` 同源未显式配置、即默认 `198.18.0.1/16`——
  改 `fake-ip-range` 或再撞同一报错时按此复核。安防含义：放行后域名级 SSRF 防护失效
  （提示注入可借 pi 诱导抓取内网服务），残余防护仅剩 URL 字面内网 IP 与 fake-ip-filter 域名
  （`*.lan`/`*.local` 解析真实内网 IP 仍拦）。
- 若 `~/.config/pi/web-search.json` 被人为创建，会优先于 `~/.pi/web-search.json` 被读到（XDG 分支先查它）——排查路由失效时先看这里。

## LSP 扩展（pi-lsp-extension）

`packages` 含 `npm:pi-lsp-extension`（LSP 导航工具）。选型依据、机制事实与重审触发条件见
[docs/pi-lsp-support.md](../../docs/pi-lsp-support.md)——该文按防漂移四件套写法，版本与
状态类事实以探针为准，本文不复述其值。

维护要点：

- 项目根 `.pi-lsp.json` 两键惯例：`autoInjectDiagnostics: false`（关编辑注入）+ `autoStart`（预热）；
  逐键覆盖语义（项目 > 用户 > 内置），逐项目手放（2026-09-26 起，六个仓已配）
- 上游 issue（#15 用户级配置、#16 信任门、#17 clangd 默认、#18 导航前 didOpen）的
  跟进状态用 `gh issue list --repo samfoy/pi-lsp-extension --author brightmeows` 查，不写死状态
- 信任纪律：`.pi-lsp.json` 的 `servers`/`lombokJar` 是代码执行向量，未信任仓库不开会话
  （上游信任门合并前长期有效）

## 踩坑点：enabledModels 不是可用性过滤

`~/.pi/agent/settings.json` 的 `enabledModels`（Pi 运行时管理，不入 `settings.meow.json`）配置的是会话模型范围（Ctrl+P 循环与 `/scoped-models`）。不在其中的模型照常注册，可用 `/model` 与 `--model` 选用（`pi --list-models` 也照常列出）。新增模型后若循环里没有，先看这里，别怀疑模型源。
