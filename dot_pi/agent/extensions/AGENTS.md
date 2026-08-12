---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI）。约定优先级：本文件 > 各文件头部注释（即设计文档，修改前完整读取）> 仓库根 [AGENTS.md](../../../AGENTS.md)（chezmoi、`pnpm check`、提交规范）> 官方文档 `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`。

## 目录结构（现状）

| 路径 | 角色 | 要点 |
|------|------|------|
| 顶层 `*.ts` | 单文件扩展 | Pi 自动发现（`extensions/*.ts`）；必须 `export default function (pi)`，仅命名导出会加载报错 |
| `skill-ext/` | 技能域扩展合并目录 | Pi 发现只支持一层子目录单入口（`extensions/*/index.ts`）；技能相关扩展在此合并为 `index.ts` 顺序注册 |
| `questionnaire.ts` | 问卷工具 | 顶层单文件扩展，基于官方示例演化，可自由修改；typebox 为仓库 devDependency（运行时由 Pi 内部解析，仓库声明仅为 `pnpm check` 通过） |
| `lib/` | 共享代码区 | **不被 Pi 自动发现**，仅被各扩展 import 复用；当前含 `inject-notice.ts`（统一注入提示渲染，见下文） |

## 新增与归组

- 文件名含 `skill` 的扩展 → 放 `skill-ext/` 并在 `index.ts` 注册；主题归他域者留顶层
- 模块间 import 用 `./xxx.ts` 写法（tsconfig 已开 `allowImportingTsExtensions`）；跨扩展共享逻辑放 `lib/`，勿放顶层（会被当作扩展加载）
- 顶层扩展须实测加载：`pnpm check` 不查 default factory 契约，须 `pi -p -e <扩展> --no-session` 验证
- 各文件头部注释即设计文档：改动前完整读取，改动后同步更新（含 lib/ 模块）

## 统一提示约定（LLM 注入且用户需知情）

LLM 注入且用户需知情的操作，用户提示显示一律统一（2026-08-12）：

- 投递 custom_message（`display: true`），TUI 渲染注册 `lib/inject-notice.ts` 的 `renderInjectNotice`
- `details.notice`：提示文案，统一格式 `[自动注入] <来源>：<说明>`，collapsed（默认）只显示它
- `content`：注入全文（进 LLM；ctrl+o 展开工具输出后显示全文）
- 消费方：subdir-agents-md（懒加载子目录 AGENTS.md）、inline-context（环境摘要）、skill-ext（首轮索引重写摘要）

实现要点：renderer 按 customType 精确匹配（不支持前缀/通配）；不注册 renderer 时默认渲染直接显示 content 全文（无折叠）。

## 踩坑点：运行时验证

`pnpm check` 只保证类型正确，不验证运行时行为。Pi 无内置“dump 系统提示词”命令，验证 `before_agent_start` 类扩展的改写效果时：

- `-e` 传入的扩展排在扩展链最前（先于 `~/.pi/agent/extensions/` 的全局扩展执行）；只传 dump 扩展会拿到改写前的提示词，误判“扩展未生效”。必须 `-e` 同时传入被测扩展源文件与 dump 扩展（dump 在后）：

```bash
pi -p -e dot_pi/agent/extensions/skill-ext/index.ts -e /tmp/dump-ext.ts --no-session "只回复：收到"
```

- 对比验证（行为回归）：从 git 检出旧版到 /tmp，两边分别 `pi -p -e <被测> -e <dump>` 跑，diff dump 落盘产物。对比前临时移走全局同源目录（`~/.pi/agent/extensions/skill-ext`），否则新旧双重改写，diff 失真
- 验证 `tool_result` 拦截类扩展（ref-hint）：`-p` 控制台不打印 tool_result 原文，须在 dump 扩展里监听 `tool_result` 并把 read SKILL.md 的 content 落盘（链尾拿到的是改写后内容）
- dump 工具定义验证 schema：`pi.on("session_start")` 内调 `pi.getAllTools()`，`-e` dump 扩展 + `--no-session` 跑，`parameters` 即 typebox JSON Schema（含 `maxLength`，确认已传 LLM）
- 断链清理：chezmoi apply 不清理孤儿 symlink——源文件删除后 `~/.pi/agent/extensions/` 残留断链 symlink 且 Pi 加载报错，手动 `rm` 处理
- `/reload`（pi 内键入）热重载扩展/技能/提示词/主题/上下文文件（非仅 keybindings，`interactive-mode.js` 重载文案含 `extensions`）；改源文件后用它加载新代码免重启。副作用：reload 后旧 `pi`/`ctx` 变 stale（`runner.js` 校验），勿跨 reload 复用
- 验证 TUI 渲染（`renderResult`/`renderCall`/`ctx.ui.custom`）：`-p` headless 不走 TUI 渲染，须 `/reload` 后在交互会话触发该工具，人眼校验两态——如 `Ctrl+O`（`app.tools.expand`）由 `tool-execution` 重调 renderer 传 `{ expanded }` 触发展开态
- 块注释内禁含 `*/` 序列（会提前终止注释，tsc 报 TS1443 / oxfmt 语法错；写路径如 `*/index.ts` 时改写避让，2026-08-12 lib/inject-notice.ts 踩坑）
- 本文件列表行宽 ≤200 字符（markdownlint MD013 豁免表格，列表不豁免）
