---
description: Rebase 至主分支
---

# Rebase 至 main

## 第一步：拉取并 rebase

拉取 `main` 的最新提交，将当前分支 rebase 到 `main` 上。

## 第二步：检查影响

审查 `main` 的最新变更，分析对当前分支的影响：
- 存在冲突的文件
- 被修改的公共接口、类型定义、配置项

## 第三步：验证

运行项目检查（`pnpm check`、测试、lint），确保 rebase 后一切正常。

## 第四步：审视

重新审视当前分支的实现，确认逻辑完整自洽。