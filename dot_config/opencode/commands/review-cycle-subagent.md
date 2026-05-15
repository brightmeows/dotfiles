---
description: Review Spec & Code: Direct Subagents
---

# Spec Review & Code Review 循环

## 第一步：检查

同时进行规格审查和代码审查。

### 注意

检查 agent 仅用于分析问题，禁止修改内容。

## 第二步：修复

修复所有发现的问题。

## 第三步：回到第一步

使用相同提示词，再次启动检查子Agent。
不要提示之前的修复内容，不要复用已有的会话。

如此循环，直至所有问题被处理，且最后一次循环没有新问题。
