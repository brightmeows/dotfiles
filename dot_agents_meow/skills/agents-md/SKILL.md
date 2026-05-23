---
name: agents-md
description: 在创建、修改或重构 `AGENTS.md` 文件时使用。项目配置不清晰、代理行为不符合预期、或需要管理多工具 symlink 映射时亦适用。
license: Apache-2.0
---

# AGENTS.md 最佳实践指南

## 概述

`AGENTS.md` 是面向编码代理的项目说明文件。职责分离：

- **README**：项目概述、快速开始、贡献指南——面向人
- **AGENTS.md**：构建步骤、测试命令、代码约定、边界规则——面向代理

README 不杂代理指令，AGENTS.md 不重复项目介绍。

AGENTS.md 是跨工具开放标准（OpenAI 发起，2025-12-09 捐赠至 Linux Foundation 下属 Agentic AI Foundation 治理），已被 **60,000+ 开源仓库**采用、被 25+ 工具原生支持（Codex、Copilot、Cursor、Windsurf、Gemini CLI、Devin、Amp 等）。

> **Claude Code**：Claude Code 官方仍以 `CLAUDE.md` 为入口，但社区已通过 symlink 或 `@AGENTS.md` 引用方式稳定桥接。多工具团队建议在 AGENTS.md 中维护唯一真相源，通过 symlink 映射到各工具原生文件（见 Symlink 策略章节）。

---

## Part 1：基础概念

### AGENTS.md vs Skill vs MCP

| 用途 | 工具 | 示例 |
|---|---|---|
| 项目约定、命令、边界 | AGENTS.md | “用 pnpm，命名导出” |
| 多步骤工作流 | Skill | “部署上 staging → smoke test → 通知 Slack” |
| 数据库查询、外部工具 | MCP Server | “@postgres 查询用户表” |

AGENTS.md 管**项目上下文**，Skill 管**任务知识**，MCP 管**外部工具**——三者互补。

### AGENTS.md 的 6 大核心内容区

基于 GitHub 对 2,500+ 仓库的实证分析，效果最好的 AGENTS.md 覆盖以下六类内容：

| 类别 | 内容要点 | 示例 |
|---|---|---|
| **Commands** | 带精确 flag 的构建/测试/lint/部署命令 | `pnpm test --run src/foo.test.ts` |
| **Testing** | 测试框架、单文件执行方式、mock 策略 | `pytest tests/unit/ -v -k "test_name"` |
| **Project Structure** | 目录布局说明、关键文件位置 | `src/api/` 处理路由，`src/lib/` 放业务逻辑 |
| **Code Style** | 命名规范、导入顺序、组件模式（含正反例） | 命名导出优先，`const` 而非 `let` |
| **Git Workflow** | 分支策略、提交格式、PR 流程 | `feat:` / `fix:` / `chore:` |
| **Boundaries** | 硬性边界：什么绝对不能碰（见下文三层系统） | 永不提交 `.env`、永不删除失败测试 |
| **Tech Stack** | 框架/语言/数据库/包管理器及版本 | `Node 20.11`、`pnpm 9.x`、`Next.js 16` |

**补充**：Tech Stack 显式标注版本有助于防止代理用错误版本的 API——代理无法从 `^18.0.0` 的 loose version range 确定你实际使用的版本。

**实证**：测试指令在 75% 的高质量 AGENTS.md 中出现——频率最高。即使其他都不写，测试指令也值得写。

> **Commands 是最高 ROI 类别**：GitHub 2,500+ 仓库分析明确指出 Commands（带精确 flag 的命令）是整份 AGENTS.md 中投入产出比最高的部分。正确标注构建/测试/lint 命令比写任何其他类别都更能减少代理试错。

另可选**按任务组织**结构：将指令按 coding / review / release 等任务领域分组，而非按类别（style / testing）排列。匹配代理的任务推理方式，减少无关指令干扰。

**原则**：包含代理无法从代码/package.json/README 自行推导的信息，不重复已有内容。

### 三层边界系统

最有效的边界系统（GitHub 2,500+ 仓库实证）：

| 层级 | 含义 | 示例 |
|---|---|---|
| **Always Do** | 每次提交前自动执行 | 运行 `pnpm test`、格式化代码 |
| **Ask First** | 涉及重大变更时先确认 | 修改数据库 schema、重构核心模块 |
| **Never Do** | 绝对禁止的操作 | 提交密钥、删除测试、推送 main、改 vendor/ 目录 |

> “Never commit secrets” 是 2,500+ 仓库中最常见的约束。

---

## Part 2：文件架构

### 层级结构

```
仓库根 AGENTS.md        ← 全局约束、技术栈、工作流（低频更新）
  ├── src/AGENTS.md     ← 子包领域逻辑、局部约定（中频更新）
  └── tests/AGENTS.md   ← 测试专用约定、mock 策略（中频更新）
```

规则：
- 代理取最近 AGENTS.md 优先，逐级回退
- 根 AGENTS.md 不重复子模块细节
- 各 AGENTS.md 内容不重叠
- 子目录 AGENTS.md 不含全局性规则

### Symlink 策略（多工具团队）

维护一个 AGENTS.md 作为唯一真相源，通过 symlink 映射到各工具原生文件：

```bash
ln -s AGENTS.md CLAUDE.md        # Claude Code
ln -s AGENTS.md GEMINI.md        # Gemini CLI
# Cursor / Windsurf 等原生支持 AGENTS.md，无需映射
```

优势：一次更新，所有工具同步。

---

## Part 3：内容原则

### Toolchain First 原则（来自 v1.1 共识）

AGENTS.md 只应承载**工具无法强制表达的内容**。如果一个约束可以被 linter、formatter、type checker、git hook 或 CI gate 确定性执行——它**不该**出现在 AGENTS.md 中。

AGENTS.md 的性质是**建议性指令**——告知代理*应该*怎么写，但存在被忽略的可能。Linter/CI 保证*必须*通过。不要让 AGENTS.md 承担本该由工具链强制执行的规则：LLM 不是 linter 的廉价替代品。

| 类型 | 归属 | 示例 |
|---|---|---|
| 代码风格、类型约束（确定性） | `biome.json` / `eslintrc` / `tsconfig` | 禁止 `var`、import 顺序、格式化规则 |
| 构建、测试、类型检查（确定性） | CI pipeline | `pnpm typecheck && pnpm test` |
| 架构判断、工作流偏好（建议性） | AGENTS.md | “组合优先于继承”、“加依赖前先讨论” |
| 会话角色定义（建议性） | skill 文件 | Critic、Builder 等角色定义 |
| 任务特定风格 | Spec / PBI | “此模块的 API 命名约定” |

```
# 正确——指向工具，不重复规则
Lint: `pnpm lint`（Biome——见 biome.json）

# 错误——代替工具写规则
不要用 var，始终用 const/let，import 顺序必须按标准库/三方/内部排列...
```

**副效应——Pink Elephant Problem**：告诉 LLM「不要做 X」反而让 X 在 attention 中更活跃（Context Anchoring）。每条否定指令都是代码库结构摩擦的信号——最优解是修复摩擦本身（删掉遗留代码、加 linter 规则），再删除 AGENTS.md 中对应的指令。

**定期审计**：周期性审查 AGENTS.md，将已可被工具链强制执行的内容迁移出去并删除对应指令。常见迁移目标：lint 规则、tsconfig 限制、CI gate。

### 代码示例优先于文字描述

GitHub 分析中最反直觉的发现：**一个正反代码示例胜过三段文字描述**。

```
# 好示范：正反例对比

// ✅ 正确：命名导出，const 优先
export const formatDate = (date: Date): string => { ... }

// ❌ 错误：默认导出，var 声明
export default function formatDate(date){ var result; ... }
```

代理从示例推断规则比解析抽象描述更可靠。

### 大小与渐进式披露

- **推荐大小**：100-150 行。超过 200 行后代理遵循率显著下降。v1.1 spec 给出更宽松上限（500 行），但实证研究仍支持 150 行以内最优
- **OpenAI Codex 默认截断**：32 KiB，超出部分静默丢弃
- **ETH Zurich 研究（2025）**：冗余 AGENTS.md 内容使推理成本增加 23%、成功率下降 2%；不必要指令导致推理 token 增加 14-22%。每条指令都占用注意力预算——保留它们须有明确理由
- **渐进式披露**：AGENTS.md 作指南针（~100 行指针），知识放 `docs/` 目录，从 AGENTS.md 中链接引用

#### Context Map 的价值边界

Gloaguen et al. (2026) 发现：目录映射（directory map）对**实现任务**中的文件发现加速效果不显著——代理已能有效自主导航文件系统。

Context Map 的真实价值在于：**新会话的架构定向**（spec 编写、错误分类、ADR 撰写），而非作为实现代理的导航捷径。不要用 AGENTS.md 做良好目录结构的替代品。

```
# 正确做法——连接不内联
架构说明见 docs/ARCHITECTURE.md
部署流程见 docs/DEPLOY.md

# 错误做法——全文内联
<长篇架构说明直接粘贴>
```

### `@import` 引用模式（增强渐进式披露）

Claude Code 等工具支持 `@路径/文件名.md` 语法在 AGENTS.md 中内联引用外部文件：

```
# AGENTS.md（根文件，~50 行指针）
通用构建/测试/边界规则。
详细架构约定见 @docs/ARCHITECTURE.md
数据库操作规范见 @docs/DATABASE.md
```

被引用文件在会话启动时展开并合并到上下文中。优点：
- 根文件保持精简（< 100 行）
- 领域知识按需引用，不污染无关任务
- 引用文件可独立维护，不混入根文件

**注意**：`@import` 不节省 token——被引用文件内容仍会加载到上下文，和直接粘贴语义等价。真正的 token 节省应来自路径限定的规则文件（如 `.claude/rules/` 的 `paths:` 声明，仅在匹配 glob 时加载）。

---

## Part 4：创作流程

### 增量迭代法

AGENTS.md 通过使用进化，非一次性写完：

```
1. 起步：20-30 行，仅覆盖最常出错的命令和边界
2. 观察：用真实任务工作 1-2 天，记录代理反复出错的地方
3. 补充：将反复出现的问题写入 AGENTS.md
4. 精简：代理已能正确遵循的规则可移除
5. 重复：持续迭代
```

**不写推测性规则**——只有当代理反复犯同一错误才添加。

### Agent Persona（角色定义）

#### 1. 定义 specialist 角色

```
# 正确——定义角色
你是一个 Rust 后端开发者。对安全性有最高优先级。需要 unsafe 代码时先提方案。

# 错误——模糊描述
你是一个帮助编码的助手。
```

角色帮助代理在权衡时做正确决定（安全 > 性能？可读性 > 巧妙？）。

#### 2. Registry 模式（多角色场景）

若项目使用多个 agent 角色，在 AGENTS.md 中**只注册名称和调用方式**，完整定义放在 skill 文件中——避免每次会话加载所有角色的完整定义：

```
## Personas
Invoke via skill: @Lead, @Dev, @Critic
Definitions: `.claude/skills/`
```

单角色项目保持简单：

```
## Identity
Senior Systems Engineer — Go 1.22, gRPC, high-throughput concurrency.
Favor explicit error handling and composition over inheritance.
```

---

## Part 5：警示与前沿

### 警告：LLM 自动生成的 AGENTS.md 有害

Gloaguen et al. (2026) 对 138 个真实仓库的实证研究：

- LLM 自动生成的 AGENTS.md **一致降低代理任务成功率**，同时推理成本增加 20%+
- 原因：代理**忠实跟随**生成指令，但生成内容含微妙不准确，导致探索范围扩大、推理成本上升
- 开发者手写的文件也仅带来 +4% 的边际提升——且仅限于极简精确的文件

**结论**：不要依赖 `/init` 等自动生成命令。将生成结果作为“内容清单”参考，应用 Toolchain First 原则过滤后手工重写。

### AGENTS.md v1.1 新特性

关键变化：YAML Frontmatter（可选）、层级继承（累积语义）、File Localization 优先。
详见 [reference/v1.1-features.md](reference/v1.1-features.md)。

---

## Part 6：参考

维护规则与反模式自查表见 [reference/maintenance.md](reference/maintenance.md)。
