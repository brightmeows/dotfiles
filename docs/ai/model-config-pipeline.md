# pi 模型配置现状与流水线退役记录

记录 pi 侧模型配置的现状（手编 JSON）与旧流水线的退役经过。dsh 侧消费已于 2026-11-08 先行退役，记录见文末。

## 现状

pi 的模型配置是两份手编 JSON，chezmoi 直接部署到 `~/.pi/agent`：

| 文件 | 作用 | 格式 |
|---|---|---|
| `dot_pi/agent/models.json` | Pi 原生自定义模型与保护名单 | 支持 `//` 行注释与尾逗号（不支持 `/* */`） |
| `dot_pi/agent/models-dev.json` | models-dev 扩展用户配置：禁用、协议与端点覆盖、自定义模型 | 严格 JSON，typebox 严格校验 |

当前内容：`models.json` 为空 providers；`models-dev.json` 禁用 openrouter 与 opencode 两个 models.dev 目录 provider。models.dev 目录数据由扩展运行时获取（24 小时缓存），不落仓库。

编辑入口与 schema 见 [`dot_pi/agent/AGENTS.md`](../../dot_pi/agent/AGENTS.md) 与 [`dot_pi/agent/ext/AGENTS.md`](../../dot_pi/agent/ext/AGENTS.md)。

## 验证方法

```bash
pnpm check   # Pi 运行时漂移检查与 tsc（模型域校验已随流水线退役）
```

浏览器内确认（Pi 侧）：`/reload` 后模型列表符合两份 JSON。

## pi 侧流水线退役记录（2026-11-08）

旧流水线：`dot_agents_meow/models/models.toml`（唯一编辑入口）经 `gen-models.py`（436 行，stdlib tomllib）
生成两份入库 JSON，pre-commit 用 `--check` 校验产物，apply 后脚本同步到 `~/.pi/agent`。
经盘问裁决整体退役：6 行 TOML 养 436 行生成器，违反不做多余预留；dsh 消费面退役后仅剩 pi 一个消费者。
退役时两份 JSON 内容定格为生成物现值，pi 行为零变化。

需要复杂模型配置（多 provider 覆盖、自定义模型批量管理）时，从 git 历史恢复 `dot_agents_meow/models/`
与 `.chezmoiscripts/run_onchange_after_gen-pi-models.sh.tmpl`。保留至今的关键语义：models.dev 同名
provider 条目表示覆盖、未收录者表示完整定义——现在由 `models-dev.json` 直接承载，语义不变。

## dsh 侧退役记录（2026-11-08）

models-dev 插件体系（`~/.agents_meow/models/` 的 `.mts` 工具家族、home patch 挂载行、
各 profile patch 的生成块、`~/.dsh/cache/models-dev.json`、`resolved.json` 产物）
经盘问裁决整体退役：dsh 回内建模型通道（原生 deepseek，`DEEPSEEK_API_KEY`），
zhipu 等目录 provider 不再可用，`/models-refresh` 命令消失。
裁决细节与 dsh 侧现状见 [deepseek-harness-config.md](deepseek-harness-config.md)。

## 回退

pi 侧：回退相关提交后运行 `chezmoi apply`。
dsh 侧恢复：从 git 历史找回退役提交中的 `.mts` 家族与 `dot_dsh/cordis.patch.yml.tmpl`，恢复生成器对 `resolved.json` 的输出与 home patch 挂载行。
