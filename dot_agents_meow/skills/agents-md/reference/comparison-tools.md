# AGENTS.md vs Skill vs MCP

| 用途 | 工具 | 示例 |
|---|---|---|
| 项目约定、命令、边界 | AGENTS.md | "用 pnpm，命名导出" |
| 多步骤工作流 | Skill | "部署上 staging → smoke test → 通知 Slack" |
| 数据库查询、外部工具 | MCP Server | "@postgres 查询用户表" |

AGENTS.md 管**项目上下文**，Skill 管**任务知识**，MCP 管**外部工具**——三者互补。
