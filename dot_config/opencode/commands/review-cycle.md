---
description: Start Review Cycle (Default)
---

# Code Review 循环

启动code reviewer子agent。
检查当前分支与main分支的diff。
同时检查实现问题和可优化点。
报告发现的所有问题，并修复所有可修复的问题。
运行项目检查并修复，然后提交。
并使用相同提示词（不要携带之前的修复内容提示），再次启用code reviewer。
如此循环直至没有问题。
