# Pi ask_user_question 上限配置化

## 背景

Pi 的 `ask_user_question` 组件是第三方包 `@juicesharp/rpiv-ask-user-question`（经 settings.json packages 安装，非 Pi 内置）。

其单次调用 4 题上限硬编码于 `tool/types.ts`（`MAX_QUESTIONS = 4`），配置文件原本只支持 `collapseKey` 与 `guidance.*`，无法通过配置解除。

grilling 工作流单轮前沿经常超过 4 问，被迫拆分多次调用、每拆一次多一轮模型往返。

## 决策（2026-10-03）

走上游 PR 路线（不 fork 自用、不抄源码进仓库），全套参数化四个上限常量：

| 键 | 范围 | 默认 |
| --- | --- | --- |
| `maxQuestions` | 1–64 | 4 |
| `maxOptions` | 2–64 | 4 |
| `maxHeaderLength` | 1–256 | 16 |
| `maxLabelLength` | 1–1024 | 60 |

PR 默认值保持现值（向后兼容，上游接受率优先）；本机 config 设 `maxQuestions: 8`。上游响应很快（参考：外部 PR #282 从提出到合并 32 分钟）。

## 跟踪状态

- PR: <https://github.com/juicesharp/rpiv-mono/pull/289>（brightmeows:feat/configurable-limits，2026-10-03 提交）
- 状态：等待上游审阅

## 合并后动作

1. 上游发版后 `pi` 升级包（或经 `~/.pi/agent` 包管理机制更新 `@juicesharp/rpiv-ask-user-question`）
2. 重启 Pi，确认单次可问 8 题
3. 若拒绝/长期无响应：重开 fork 路线讨论（fork + git 引用，多机可用）

## 本机配置

`dot_config/rpiv-ask-user-question/config.json`（chezmoi 托管）→ `~/.config/rpiv-ask-user-question/config.json`。旧版包静默忽略未知键，发版后自动生效。仅含 `maxQuestions: 8`——其余限制无痛点证据，按最小变更不动。
