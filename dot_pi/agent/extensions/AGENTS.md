---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI），各文件头部注释即设计文档，修改前完整读取。仓库根 [AGENTS.md](../../../AGENTS.md) 的通用约定（`chezmoi -S .`、`pnpm check`、提交规范）此处不重复；Pi 扩展 API 细节读官方文档 `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`。

## 目录结构

- 顶层 `*.ts`：单文件扩展，Pi 自动发现（`extensions/*.ts`）
- `skill-ext/`：技能域扩展合并目录。Pi 的扩展发现只支持一层子目录且每目录单一入口（`extensions/*/index.ts`），本目录将技能相关扩展合并为 `index.ts` 一个扩展实例顺序注册（2026-08-11 由顶层 skill-index-rewrite.ts / skill-ref-hint.ts 归组，index-rewrite 拆出
  source-labels / path-canon / render 三个纯函数模块；同日新增 subskill-hint：探测技能包的 skills/ 子技能结构并追加 XML 列表，ref-hint 相应忽略 skills/ 目录路径）
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
