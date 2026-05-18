---
description: 对齐 `AGENTS.md` / `CLAUDE.md` 与代码注释
---

# 对齐项目文档与代码

先读 `agents-doc` skill（`dot_config/opencode/skills/agents-doc.md`）。子Agent须加载之，遵从其三节必含、行数约束、路径验证等规则。

## 一曰检

以项目内每 `AGENTS.md` 为单位，启检子Agent（加载 `agents-doc` skill）。
- 检目标：`AGENTS.md` 内容、`CLAUDE.md` 内容、代码注释是否对齐代码实际实现。
- 按 skill 中三层职责（根 `AGENTS.md` / 子目录 `AGENTS.md` / 模块注释）逐层检。
- 检是否满足：三节必含、行数约束、路径验证。

### 注

审Agent唯析问题，禁改内容。
勿带前轮修改，禁复用旧会话。

## 二曰修

若首步发现问题，遣修子Agent修之（加载 `agents-doc` skill）。
禁改代码实际实现，可改注释与文档。

## 三曰复

循环，至皆对齐为止。

## 循环毕

报所修诸内容。
