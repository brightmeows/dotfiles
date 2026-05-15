---
description: Review Code: Diff with Main
---

# Code Review 循环

## 第一步：Code Review

启动 code reviewer 子 agent，检查当前分支与 main 分支的 diff。
同时检查实现问题和可优化点。

### 注意

检查 agent 仅用于分析问题，禁止修改内容。

## 第二步：修复

报告发现的所有问题，修复所有可修复的问题。
运行项目检查并修复，然后提交，完成一轮循环。

## 第三步：回到第一步

使用相同提示词，再次启用 code reviewer，开启下一轮循环。
不要提示之前的修复内容，不要复用已有的会话。

如此循环直至没有问题。
