---
description: Update AGENTS.md in Parallel
---

# 并行更新 AGENTS.md

对于当前项目内的每个 `AGENTS.md` 文件，分别启动检查子Agent：
- 检查内容是否正确无误。
如果有问题，派遣对应的修复子Agent进行修复。

派遣检查子Agent时，禁止携带上一轮修复信息，禁止复用已有会话。

如此循环，直至所有 `AGENTS.md` 内容完全对齐。

