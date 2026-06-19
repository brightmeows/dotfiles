---
description: 对齐 `AGENTS.md` 与代码注释
---

# 对齐项目文档与代码

先加载 `writing-agent-docs` 获取通用代理文档编写原则，再加载 `structuring-agents-md` skill 获取 AGENTS.md 领域规则，并读取该 skill 的所有参考内容。

## 第一步：检查

以项目内每个 `AGENTS.md` 为单位：

一次同时启动多个检查子 agent。
- 提示词中应提示检查子 agent 加载 `writing-agent-docs` + `structuring-agents-md` 技能，且寻找尽可能的多的可优化点。
- 检查目标：`AGENTS.md` 内容、代码注释等文档内容，是否对齐代码实际实现。
- 按 skill 中三层职责（根 `AGENTS.md` / 子目录 `AGENTS.md` / 模块注释）逐层检查。
- 只分析问题，禁止修改内容。

## 第二步：修改

如果第一步发现问题，派修复子 agent 修复（加载 `writing-agent-docs` + `structuring-agents-md` 技能）。
禁止修改代码实际实现，可以改注释与文档。

## 第三步：复查

回到第一步，开始下一轮循环。
再次派遣子 agent 时，不要携带上一轮修复内容，不要复用上一轮的会话。

如此循环，直到全部对齐为止。

## 循环结束

报告所修改的全部内容。
