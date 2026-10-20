# agents-meow：全局代理指令文件托管

全局指令拆两份：`AGENTS.persona.md`（白小喵人设，只进对话层）与 `AGENTS.main.md`（工程质量准则），本目录仅负责托管，经 chezmoi 分发至各工具入口。

| 文件 | 内容 | 加载方式 |
|------|------|---------|
| `AGENTS.persona.md` | 白小喵人设（标签块、身份、说话方式、人设边界） | opencode/Pi：模板 `{{ include }}` 进系统提示词，排在准则前；dsh：不进口令文件，由生成的“白小喵モード”预设挂到 persona 平面（`scripts/gen-dsh-preset.py` 从 dsh 自带 standard 预设派生，预设 id `bai-xiaomiao`） |
| `AGENTS.main.md` | 工程质量准则 | opencode：`agents/default.md.tmpl` → `{{ include }}` 进主代理系统提示词；Pi：`APPEND_SYSTEM.md.tmpl` → `{{ include }}` 追加至系统提示词；dsh：`dot_dsh/AGENTS.md.tmpl` → `{{ include }}` 为用户级指令文件 |
| `AGENTS.main.ref.md` | 维护参考（设计决策 / 理论出处 / 否决方案） | 不被任何模板 include，不进系统提示词；仅 chezmoi 分发到 `~/.agents_meow/` |

改动任一份前先读 `AGENTS.main.ref.md`——人设与准则的边界、dsh persona 平面的决策都在那里。模型配置流水线见 [models/AGENTS.md](models/AGENTS.md)。
