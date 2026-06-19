---
name: agents-md
description: 在创建、修改或重构 AGENTS.md 文件时使用。代理行为不符合预期时亦适用。
license: Apache-2.0
---

# AGENTS.md 技能

本技能为 AGENTS.md 的创建与维护提供结构化指导。

---

## 前置 Skill

**必须先激活 [`writing-agent-docs`](../writing-agent-docs/SKILL.md)。**

该技能定义代理文档写作的通用规则。本技能仅承载 AGENTS.md 专属内容，不重复通用规则——遇通用写作决策时回退到前置 Skill。

---

## 定位

**AGENTS.md** 是面向编码代理的项目说明文件。与 README 职责分离：

- **AGENTS.md**：构建命令、测试指令、代码约定、边界规则——面向代理
- **README**：项目概述、快速开始、贡献指南——面向人

README 不杂代理指令，AGENTS.md 不重复项目介绍。

AGENTS.md 是跨工具开放标准，被 60,000+ 开源仓库采用、25+ 工具原生支持。

---

## 层级与作用域

AGENTS.md 按文件系统层级组织，遵循 4 核心作用域概念：

| 概念 | 含义 |
|---|---|
| **管辖范围** | 每个 AGENTS.md 只影响所在目录及子目录，不影响兄弟目录 |
| **累积** | 子目录继承祖先文件的全部指导，无需重复声明 |
| **优先级** | 就近优先，子目录覆盖祖先的冲突规则 |
| **隐式继承** | 子文件免重复祖先规则——代理视指导为累积的 |

| 层级 | 内容范围 |
|---|---|
| **根 AGENTS.md** | 项目描述、共享工具链、全局边界、代码风格基础 |
| **子目录 AGENTS.md** | 该包领域逻辑、局部技术栈、包内特有命令和约定 |
| **深层 AGENTS.md** | 极端特化规则，覆盖祖先的不适用约束 |

根文件应精简，内容冗余则下沉到子目录。子文件只声明该目录特有内容，祖先已声明的无需重复。

---

## 创建与维护流程

### 增量迭代法

1. **起步**：20-30 行，仅覆盖最常出错的命令和边界
2. **观察**：用真实任务记录代理反复出错的地方
3. **补充**：将反复出现的问题写入
4. **精简**：代理已能遵循的规则可移除
5. **重复**

**大小参考**：推荐 100-150 行；超过 200 行遵循率显著下降（ETH Zurich 2026：冗余内容推理成本 +23%，成功率 -2%）。

### 重构

- **审计**：遍历现有指令，标记可由工具链强制或已过时的内容
- **拆分**：按层级将臃肿根文件内容分配到子目录
- **迁移**：将确定性规则移出 AGENTS.md，指向工具配置
- **验证**：改动前后对比，确认代理推理开销未增加

### 写作原则

以下为 AGENTS.md 专属：

- **Toolchain First**——确定性约束（代码风格、类型、构建、测试）归属工具链配置，AGENTS.md 只承载建议性指令（架构判断、工作流偏好）。
  ```
  # 好——指向工具，不重复规则
  Lint: `pnpm lint`（Biome——见 biome.json）
  # 坏——代替工具写规则
  不要用 var，始终用 const/let，import 顺序按标准库/三方/内部排列...
  ```
- **三层边界 Always / Ask / Never**——比简单禁令清单更有效：
  - **Always Do**：每次自动执行（如提交前运行 `pnpm test`）
  - **Ask First**：重大变更先确认（如改数据库 schema）
  - **Never Do**：绝对禁止（如提交密钥、push main）——配肯定替代（见前置 Skill“肯定指令优先”）
- **反自动化生成**——LLM 自动生成的 AGENTS.md 一致降低成功率且推理成本 +20%+（见 reference/auto-gen-warning.md）。`/init` 等结果只当“内容清单”，手工重写。
- **关键文件路径显式标注**——入口点、基类、配置文件应显式标注路径。
- **@import 引用**——部分工具（如 Claude Code）支持 `@路径/文件名.md` 内联引用外部文件，根文件保持精简，知识按需加载。非 v1.1 标准特性，使用前确认工具兼容性。
- **重点标注非常规**——主流实践、常见配置等显而易见的内容一笔带过；非常规、反直觉、项目特有的内容重点提及。

### 维护规则

以下为 AGENTS.md 专属：

- **写前检查**：遍历锁文件、CI 和现有代码模式再落笔。
- **定期审计**：周期性审查后将可被工具链强制的规则迁移出去（指向工具配置）。

### 常见错误

| 错误 | 详见 |
|---|---|
| 含 README 内容 | 定位 |
| 重复工具链已强制内容 | 写作原则 Toolchain First |
| 自动生成不审校 | 写作原则 反自动化生成 / reference/auto-gen-warning.md |
| 不同工具各维护一份 | 维护唯一 AGENTS.md，symlink 到各工具入口文件（CLAUDE.md / GEMINI.md 等）|
| 否定指令 | 前置 Skill（肯定指令优先） |

---

## 内容决策指南

什么内容该放入 AGENTS.md、什么不该放，按 5 维度评分，越高越该放入：

| 维度 | 含义 |
|------|------|
| **重要性** | 对代理理解项目的重要程度 |
| **推断难度** | 从项目自身获取的困难程度 |
| **稳定性** | 内容变更频率，越稳定越该放 |
| **特异性** | 项目特有程度，越特有越该放 |
| **可工具化程度** | 一票否决——可被工具链强制的内容不放 |

**判定**：重要性高 + 推断难 + 特异 → 放入；可工具化（linter / 类型 / CI 能强制）→ 不放，指向工具配置；介于之间 → 视项目复杂度 / 团队 / 安全要求酌情放入。

各内容类型的分类（推荐 / 可选 / 不放）、详细维度评分与根 / 子目录拆分见 [reference/content-decisions.md](reference/content-decisions.md)（附录：详细目录）。

---

## 参考文件

| 文件 | 内容 |
|---|---|
| [reference/content-decisions.md](reference/content-decisions.md) | 附录：内容决策详细目录（维度评分 / 放入条件 / 根子目录拆分） |
| [reference/comparison-tools.md](reference/comparison-tools.md) | AGENTS.md vs Skill vs MCP 对比（含 token 开销） |
| [reference/empirical-evidence.md](reference/empirical-evidence.md) | Princeton/ETH Zurich/上下文效率等实证数据 |
| [reference/agent-persona.md](reference/agent-persona.md) | Agent Persona 完整定义（specialist / Registry / 单角色） |
| [reference/auto-gen-warning.md](reference/auto-gen-warning.md) | LLM 自动生成危害与实证数据 |
| [reference/v1.1-features.md](reference/v1.1-features.md) | AGENTS.md v1.1 YAML Frontmatter |
