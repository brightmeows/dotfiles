# 实证数据参考

## 采用情况

AGENTS.md 已被 **60,000+ 开源仓库**采用、被 25+ 工具原生支持（Codex、Copilot、Cursor、Windsurf、Gemini CLI、Devin、Amp 等）。

GitHub 对 2,500+ 仓库的实证分析显示测试指令在 75% 的高质量 AGENTS.md 中出现——频率最高。

## Princeton 研究（2026 年 1 月）

在 10 个仓库、124 个 PR 中测量：
- 有 AGENTS.md 的任务**运行时间减少 28.6%**
- **输出 token 减少 16.6%**（中位数）

## ETH Zurich 研究（2025-2026）

- AGENTS.md 带来约 **20% 推理开销**——正面收益须以精炼内容换取
- 移除 Architecture 章节后代理表现不变但 token 下降——架构概述对实现任务是**净开销**
- 冗余 AGENTS.md 内容使推理成本增加 23%、成功率下降 2%
- 不必要指令导致推理 token 增加 14-22%

## Context Map 的价值边界

Gloaguen et al. (2026) 发现目录映射（directory map）对**实现任务**中的文件发现加速效果不显著——代理已能有效自主导航文件系统。

Context Map 的真实价值在于：**新会话的架构定向**（spec 编写、错误分类、ADR 撰写），而非作为实现代理的导航捷径。

## OpenAI Codex 默认截断

32 KiB，超出部分静默丢弃。
