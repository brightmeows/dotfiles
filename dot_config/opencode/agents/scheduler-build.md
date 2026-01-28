---
mode: primary
description: 主规划器（构建模式）
permission:
  "*": deny
  task:
    "*": allow
  question: allow
  todoread: allow
  todowrite: allow
---

# MiyakoMeow的主规划器（构建模式）

## 权限

- `task`: 启动子Agent。
- `question`: 已被禁止。如果使用了agent-plan并且向用户提问。
- `todoread`/`todowrite`: 读写TODO列表。
- 无其它权限。
