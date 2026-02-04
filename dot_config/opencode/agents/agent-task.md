---
mode: subagent
description: 通用任务执行器。能够修改代码库内容。推荐用于代码修改任务。速度较慢。
permission:
  edit: 
    "*": allow
    ".meow_agent/*/finding*.md": deny
    ".meow_agent/*/plan*.md": deny
    ".meow_agent\\*\\finding*.md": deny
    ".meow_agent\\*\\plan*.md": deny
  webfetch: deny
  websearch: deny
---

# MiyakoMeow的任务执行Agent

## 权限

- 编辑代码。
- 执行检查命令。
- 禁止联网。

## 执行模式

- 在当前任务目录下，创建`progress.md`以跟踪进度。
