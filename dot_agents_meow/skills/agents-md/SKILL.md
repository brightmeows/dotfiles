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

> **最高信噪比：非显而易见模式**：描述**反直觉的架构决策**是 AGENTS.md 中信噪比最高的内容——这些信息代理无法从训练数据或代码中推导。例如"所有 API 调用永不抛异常，永远返回 ApiResult"、"此模块故意使用同步代码"。代理最常犯错的地方正是这类非标准模式。

> **实证量化**：Princeton 研究（2026 年 1 月）在 10 个仓库、124 个 PR 中测量：有 AGENTS.md 的任务**运行时间减少 28.6%**、**输出 token 减少 16.6%**（中位数）。但 ETH Zurich 后续研究发现 AGENTS.md 也带来约 **20% 推理开销**——正面收益须以精炼内容换取，冗余内容会侵蚀收益。

另可选**按任务组织**结构：将指令按 coding / review / release 等任务领域分组，而非按类别（style / testing）排列。匹配代理的任务推理方式，减少无关指令干扰。

**原则**：包含代理无法从代码/package.json/README 自行推导的信息，不重复已有内容。重复 README 的内容会**降低**代理性能（ETH Zurich 2026）。

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

### 层级结构与作用域规则

AGENTS.md 按文件系统层级组织，遵循 v1.1 规范的四个核心概念：

| 概念 | 含义 |
|---|---|
| **管辖范围 (Jurisdiction)** | 每个 AGENTS.md 只影响所在目录及子目录，不影响兄弟目录 |
| **累积 (Accumulation)** | 子目录继承祖先文件的全部指导，无需重复声明 |
| **优先级 (Precedence)** | 就近优先，子目录覆盖祖先的冲突规则 |
| **隐式继承 (Implicit Inheritance)** | 子文件免重复祖先规则——代理视指导为累积的 |

```
project/
├── AGENTS.md                  # 全仓库公约
├── frontend/
│   ├── AGENTS.md              # React 专属（继承根文件）
│   └── components/            # 受 frontend/AGENTS.md 管辖
└── backend/
    └── AGENTS.md              # API 专属（继承根文件）
```

#### 根 vs 子目录的内容职责

| 层级 | 内容范围 | 更新频率 | 行数参考 |
|---|---|---|---|
| **根 AGENTS.md** | 项目描述、共享工具链、全局边界、代码风格基础 | 低频 | 30-50 行 |
| **子目录 AGENTS.md** | 该包领域逻辑、局部技术栈、包内特有命令和约定 | 中频 | 10-30 行 |
| **深层 AGENTS.md** | 极端特化规则，覆盖祖先的不适用约束 | 极低频 | 5-15 行 |

#### 维护策略差异

- **根文件**被所有目录继承，修改影响面是整个仓库。应精简，只放确实全局适用的规则。若根文件超过 50 行，说明有内容应下沉到子目录或提取到共享参考文件。
- **子文件**只声明该目录**特有**的内容——祖先已声明的无需重复（隐式继承）。重构目录结构时须同步更新对应 AGENTS.md（jurisdiction 随路径变更）。
- **数据流方向**：根 → 子目录（单向继承）。子文件不反向影响根或其他兄弟目录。

### Symlink 策略（多工具团队）

维护一个 AGENTS.md 作为唯一真相源，通过 symlink 映射到各工具原生文件：

```bash
ln -s AGENTS.md CLAUDE.md        # Claude Code
ln -s AGENTS.md GEMINI.md        # Gemini CLI
# Cursor / Windsurf 等原生支持 AGENTS.md，无需映射
```

优势：一次更新，所有工具同步。

---

## Part 3：写作原则与流程

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

核心原则：AGENTS.md 推荐 **100-150 行**（超过 200 行遵循率下降）。**先写 20-30 行**起步，按需迭代补充。完整数据（大小量化、Context Map 边界、`@import` 模式）见 [reference/context-efficiency.md](reference/context-efficiency.md)。

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

详细的角色定义模式（specialist 角色、Registry 模式、单角色示例）见 [reference/agent-persona.md](reference/agent-persona.md)。

**核心原则**：角色帮助代理在权衡时做正确决定（安全 > 性能？可读性 > 巧妙？）。多角色场景只注册名称和调用方式，完整定义放 skill 文件。

### 警告：LLM 自动生成的 AGENTS.md 有害

Gloaguen et al. (2026) 对 138 个真实仓库的实证研究：LLM 自动生成的 AGENTS.md **一致降低代理任务成功率**（推理成本增加 20%+），手写文件也只带来 +4% 边际提升。详见 [reference/auto-gen-warning.md](reference/auto-gen-warning.md)。

### AGENTS.md v1.1 新特性

关键变化：YAML Frontmatter（可选）、层级继承（累积语义）、File Localization 优先。
详见 [reference/v1.1-features.md](reference/v1.1-features.md)。

---

## Part 4：参考

| 文件 | 内容 |
|---|---|
| [reference/maintenance.md](reference/maintenance.md) | 维护规则与反模式自查表 |
| [reference/context-efficiency.md](reference/context-efficiency.md) | 大小限制、Context Map 边界、`@import` 引用模式 |
| [reference/agent-persona.md](reference/agent-persona.md) | Agent Persona 完整模式（specialist / Registry / 单角色） |
| [reference/auto-gen-warning.md](reference/auto-gen-warning.md) | LLM 自动生成危害与实证数据 |
| [reference/v1.1-features.md](reference/v1.1-features.md) | AGENTS.md v1.1 新特性 |
