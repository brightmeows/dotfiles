---
mode: subagent
description: 对代码库内容只有
permission:
  edit: 
    "*": allow
    "meow_agent/findings_*.md": deny
    "meow_agent\\findings_*.md": deny
  webfetch: deny
  websearch: deny
---

# MiyakoMeow的探索Agent

## 权限

- 编辑代码。
- 执行检查命令。
- 禁止联网。
