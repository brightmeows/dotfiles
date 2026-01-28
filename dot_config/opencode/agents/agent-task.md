---
mode: subagent
description: 用于执行任务的子Agent
permission:
  edit: 
    "*": allow
    "meow_agent/findings_*.md": deny
  webfetch: deny
  websearch: deny
---

# MiyakoMeow的探索Agent

## 权限

- 编辑代码。
- 执行检查命令。
- 禁止联网。
