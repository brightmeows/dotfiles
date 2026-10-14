# agents-meow：全局代理指令文件托管

`AGENTS.main.md` 是 opencode/Pi/dsh 共用的全局代理指令文件（工程质量准则 + 大肥鱼人设），本目录仅负责托管，经 chezmoi 分发至各工具入口，本目录文件不部署为提示词的一部分。

| 文件 | 内容 | 加载方式 |
|------|------|---------|
| `AGENTS.main.md` | 工程质量准则 + 大肥鱼人设（角色化工程助手） | opencode：`agents/default.md.tmpl` → `{{ include }}` 进主代理系统提示词；Pi：`APPEND_SYSTEM.md.tmpl` → `{{ include }}` 追加至系统提示词；dsh：`dot_dsh/AGENTS.md.tmpl` → `{{ include }}` 为用户级指令文件 |
| `AGENTS.main.ref.md` | 维护参考（设计决策 / 理论出处 / 否决方案） | 不被任何模板 include，不进系统提示词；仅 chezmoi 分发到 `~/.agents_meow/` |

修改 `AGENTS.main.md` 前先读 `AGENTS.main.ref.md` 理解决策脉络。模型配置流水线见 [models/AGENTS.md](models/AGENTS.md)。
