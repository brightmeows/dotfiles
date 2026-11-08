# 模型配置流水线

记录模型配置的来源、生成物与验证方法。用户编辑入口是 `dot_agents_meow/models/models.toml`（部署到 `~/.agents_meow/models/models.toml`）。dsh 侧消费已于 2026-11-08 退役，本文件只描述 pi 侧现状，退役记录见文末。

## 三层结构

| 层 | 内容 | 归属 |
|---|---|---|
| 外部目录 | models.dev 的 provider 与模型数据 | 外部；Pi 扩展运行时抓取（24 小时缓存），不落仓库 |
| 用户配置 | `models.toml`：禁用哪些 provider、覆盖协议与端点、不在 models.dev 的自定义模型 | 仓库（chezmoi 托管） |
| 消费者 | Pi 扩展读 `models-dev.json` 与 `models.json` | 仓库生成物 |

## 数据流

1. `gen-models.py` 读 `models.toml`，写两份 Pi JSON（入库并随 chezmoi 部署）。
2. apply 脚本把同一结果同步到 `~/.pi/agent`（覆盖未提交的本地改动）。
3. Pi 扩展读两份 JSON，叠加 models.dev 目录数据。

## 关键决策

- **models.dev 是外部事实**：Pi 扩展运行时获取（24 小时缓存），仓库不冻结目录数据。
- **单段 `[providers.<id>]`**：与 models.dev 同名表示覆盖，未收录表示完整定义；条目里出现定义类字段即按定义处理。这样一份文件只有一条规则，且离线生成器（无目录信息）也能确定落点。
- **provider 级禁用只写顶层 `disabled_providers`**，条目里写 `disabled` 会被拒绝；首份配置预置禁用 openrouter 与 opencode（体量最大）。
- **档位用 `thinking_levels` 短表达**，生成器展开为 Pi 的 `thinkingLevelMap`（未列档位记 null）；非恒等拼写用 `thinking_wire`。省略表示不做档位外推。
- **`cost` 只对完整定义生效**：Pi 扩展的编辑 schema 没有价格字段，models.dev 已收录 provider 的价格由扩展在运行时自行映射。
- **两份 JSON 提交入库**并加 pre-commit 校验：它们是 TOML 的纯函数且很小，提交后 Windows（无 python3）等机器也能直接获得。
- **Python 解析 TOML**（stdlib `tomllib`）：Node 没有标准库 TOML 解析器，自写子集解析是长期风险。

## 产物与命令

| 产物 | 位置 | 入库 |
|---|---|---|
| `models-dev.json` | `dot_pi/agent/` → `~/.pi/agent/` | 是（生成物，提交） |
| `models.json` | `dot_pi/agent/` → `~/.pi/agent/` | 是（生成物，提交） |

```bash
python3 dot_agents_meow/models/gen-models.py          # 生成两份 Pi JSON
python3 dot_agents_meow/models/gen-models.py --check  # 校验 TOML 并比对已存在目标（pre-commit 使用）
```

## 验证方法

```bash
python3 dot_agents_meow/models/gen-models.py --check
pnpm check   # 含 Pi 运行时漂移检查与 tsc
```

浏览器内确认（Pi 侧）：`/reload` 后模型列表符合 `models.toml`。

## dsh 侧退役记录（2026-11-08）

models-dev 插件体系（`~/.agents_meow/models/` 的 `.mts` 工具家族、home patch 挂载行、
各 profile patch 的生成块、`~/.dsh/cache/models-dev.json`、`resolved.json` 产物）
经盘问裁决整体退役：dsh 回内建模型通道（原生 deepseek，`DEEPSEEK_API_KEY`），
zhipu 等目录 provider 不再可用，`/models-refresh` 命令消失。
裁决细节与 dsh 侧现状见 [deepseek-harness-config.md](deepseek-harness-config.md)。

## 回退

pi 侧：回退相关提交后运行 `chezmoi apply`。
dsh 侧恢复：从 git 历史找回退役提交中的 `.mts` 家族与 `dot_dsh/cordis.patch.yml.tmpl`，恢复生成器对 `resolved.json` 的输出与 home patch 挂载行；`models.toml` 未变动，可直接复用。
