# dsh-meow-context-hooks

Pi 扩展复刻的上下文注入双钩子，落在 dsh 原生通道上。源码由 dotfiles 仓库
托管（`dot_dsh/plugins/`），经 `plugin_manager install_bundle` 从仓库路径安装。

## 两个钩子

1. **Git 快照**（对齐 pi-meow-inline-context）：每个会话首次组装时后台采集
   remote（剥凭据）、dirty 数、ahead-behind、stash、进行中操作、最近提交，
   经 `ctx.systemPrompt.context()` 注入为动态运行时上下文。TTL 过期由下一
   次组装触发后台重采，不阻塞请求。
2. **子目录 AGENTS.md 懒加载**（对齐 pi-meow-subdir-agents-md）：
   `tools/post-execute` 瀑布监听 read/edit/write/grep/glob 的路径参数，收集
   cwd 与目标目录之间各级的 AGENTS.md（cwd 根除外），经
   `PostToolDecision.additionalContexts` 注入，同一会话同一目录只注入一次。

原 git hooks 约定检测钩子已于 2026-11-07 移除：dsh 无自动补配通道，提示
文本对已自管理 hooks 的仓库是噪音。

## v1 已知边界（相对 Pi 版）

- bash/pwsh 命令内的路径启发式触发未实现，只覆盖结构化工具的路径参数。
- 去重是进程内存态（per-session per-directory），跨 resume 不扫库，重启后
  同目录可再次注入一次。
- 采集在 agent/created 触发，subagent 也会各采集一份（轻量，几条 git 命令）。

## 配置

`enableGitSnapshot` / `enableSubdirAgents`（默认开）、`snapshotTtlMs`（默认
30000）、`gitTimeoutMs`（默认 5000）、`subdirMaxChars`（默认 6000）。覆盖
方式：home patch 或 profile patch 的本行 `config:`。
