---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI），各文件头部注释即设计文档，修改前完整读取。仓库根 [AGENTS.md](../../../AGENTS.md) 的通用约定（`chezmoi -S .`、`pnpm check`、提交规范）此处不重复；Pi 扩展 API 细节读官方文档 `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`。

## 踩坑点：运行时验证

`pnpm check` 只保证类型正确，不验证运行时行为。Pi 无内置“dump 系统提示词”命令；验证 `before_agent_start` 类扩展的改写效果时：

- `-e` 传入的扩展排在扩展链最前（先于 `~/.pi/agent/extensions/` 的全局扩展执行）；只传 dump 扩展会拿到改写前的提示词，误判“扩展未生效”
- 必须 `-e` 同时传入被测扩展源文件与 dump 扩展（dump 在后）：

```bash
pi -p -e ~/.pi/agent/extensions/skill-index-rewrite.ts -e /tmp/dump-ext.ts --no-session "只回复：收到"
```
