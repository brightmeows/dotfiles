---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI），各文件头部注释即设计文档，修改前完整读取。仓库根 [AGENTS.md](../../../AGENTS.md) 的通用约定（`chezmoi -S .`、`pnpm check`、提交规范）此处不重复；Pi 扩展 API 细节读官方文档 `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`。

## 目录结构

- 顶层 `*.ts`：单文件扩展，Pi 自动发现（`extensions/*.ts`）
- `skill-ext/`：技能域扩展合并目录。Pi 的扩展发现只支持一层子目录且每目录单一入口（`extensions/*/index.ts`），本目录将技能相关扩展合并为 `index.ts` 一个扩展实例顺序注册（2026-08-11 由顶层 skill-index-rewrite.ts / skill-ref-hint.ts 归组，index-rewrite 拆出
  source-labels / path-canon / render 三个纯函数模块；同日新增 subskill-hint：探测技能包的 skills/ 子技能结构并追加 XML 列表；
  ref-hint 改为目录枚举提示（整树递归、相对路径 + 基准注记、跳过隐藏与 skills/ 区））
- `questionnaire.ts`：问卷工具（顶层单文件扩展）。基于官方示例 `examples/extensions/questionnaire.ts`（pi 0.84.1）演化，2026-08-11 由 official-clone 克隆区提升为顶层文件、可自由修改；typebox 为仓库 devDependency（运行时由 Pi 内部解析，仓库声明仅为 `pnpm check` 通过）
- `lib/`：扩展共享代码区，**不被 Pi 自动发现**（自动发现只匹配顶层 `*.ts` 与 `*/index.ts`），
  仅被各扩展 import 复用。当前含 `inject-notice.ts`：统一“LLM 注入且用户需知情”提示渲染
  （复刻默认 custom_message 外观：collapsed 只显示 `[自动注入] <来源>：<说明>` 提示，
  ctrl+o 展开工具输出后显示注入全文）
- 统一提示约定（2026-08-12）：LLM 注入且用户需知情的操作一律 custom_message
  （display:true）+ details.notice（`[自动注入] <来源>：<说明>`）+
  `registerMessageRenderer(<customType>, renderInjectNotice)`；content 为注入全文
  （进 LLM，expanded 显示）。消费方：subdir-agents-md / receiving-review /
  inline-context / skill-ext（首轮摘要）
- 归组标准：文件名含 `skill` 的扩展入 `skill-ext/`；主题归他域者（如 receiving-review 属评审工作流）留顶层
- 新增技能相关扩展：文件放入 `skill-ext/` 并在 `index.ts` 注册；模块间 import 用 `./xxx.ts` 写法（tsconfig 已开 `allowImportingTsExtensions`）

## 踩坑点：运行时验证

`pnpm check` 只保证类型正确，不验证运行时行为。Pi 无内置“dump 系统提示词”命令；验证 `before_agent_start` 类扩展的改写效果时：

- `-e` 传入的扩展排在扩展链最前（先于 `~/.pi/agent/extensions/` 的全局扩展执行）；只传 dump 扩展会拿到改写前的提示词，误判“扩展未生效”
- 必须 `-e` 同时传入被测扩展源文件与 dump 扩展（dump 在后）：

```bash
pi -p -e dot_pi/agent/extensions/skill-ext/index.ts -e /tmp/dump-ext.ts --no-session "只回复：收到"
```

- 对比验证（行为回归）：从 git 检出旧版到 /tmp，两边分别 `pi -p -e <被测> -e <dump>` 跑，diff dump 落盘产物。对比前临时移走全局同源目录（`~/.pi/agent/extensions/skill-ext`），否则新旧双重改写，diff 失真
- 验证 `tool_result` 拦截类扩展（ref-hint）：`-p` 控制台不打印 tool_result 原文，须在 dump 扩展里监听 `tool_result` 并把 read SKILL.md 的 content 落盘（链尾拿到的是改写后内容）
- 断链清理：chezmoi apply 不清理孤儿 symlink——源文件删除后 `~/.pi/agent/extensions/` 残留断链 symlink 且 Pi 加载报错，手动 `rm` 处理
- 顶层扩展 default factory：`extensions/*.ts` 必须 `export default function (pi)`，
  仅命名导出会导致 Pi 加载报错 "Extension does not export a valid factory function"。
  从子目录合并入口提到顶层时须补 default factory；`pnpm check` 不查此契约，
  须 `pi -p -e` 实测加载（2026-08-11 questionnaire 迁移踩坑）
- dump 工具定义验证 schema：`pi.on("session_start")` 内调 `pi.getAllTools()`，
  `-e` dump 扩展 + `--no-session` 跑，`parameters` 即 typebox JSON Schema
  （含 `maxLength`，确认已传 LLM）
