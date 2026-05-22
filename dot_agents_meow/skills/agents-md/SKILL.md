---
name: agents-md
description: 在创建或更改 `AGENTS.md` 或创建模块、维护模块注释时激活。
license: Apache-2.0
---

# AGENTS.md 最佳实践指南

## 概述

`AGENTS.md` 是面向编码代理的项目说明文件。职责分离：

- **README**：项目概述、快速开始、贡献指南——面向人
- **AGENTS.md**：构建步骤、测试命令、代码约定、边界规则——面向代理

README 不杂代理指令，AGENTS.md 不重复项目介绍。

AGENTS.md 是跨工具开放标准（OpenAI 发起，Linux Foundation 下属 Agentic AI Foundation 治理），被 Codex、Copilot、Cursor、Windsurf、Gemini CLI 等 25+ 工具原生支持。

## AGENTS.md 的 6 大核心内容区

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

另可选**按任务组织**结构：将指令按 coding / review / release 等任务领域分组，而非按类别（style / testing）排列。匹配代理的任务推理方式，减少无关指令干扰。

**原则**：包含代理无法从代码/package.json/README 自行推导的信息，不重复已有内容。

## 三层边界系统

最有效的边界系统（GitHub 2,500+ 仓库实证）：

| 层级 | 含义 | 示例 |
|---|---|---|
| **Always Do** | 每次提交前自动执行 | 运行 `pnpm test`、格式化代码 |
| **Ask First** | 涉及重大变更时先确认 | 修改数据库 schema、重构核心模块 |
| **Never Do** | 绝对禁止的操作 | 提交密钥、删除测试、推送 main、改 vendor/ 目录 |

> “Never commit secrets” 是 2,500+ 仓库中最常见的约束。

## 层级结构

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

## 大小与渐进式披露

- **推荐大小**：100-150 行。超过 200 行后代理遵循率显著下降
- **OpenAI Codex 默认截断**：32 KiB，超出部分静默丢弃
- ETH Zurich 研究：冗余 AGENTS.md 内容使推理成本增加 23%，任务成功率下降 2%
- **渐进式披露**：AGENTS.md 作指南针（~100 行指针），知识放 `docs/` 目录，从 AGENTS.md 中链接引用

```
# 正确做法——连接不内联
架构说明见 docs/ARCHITECTURE.md
部署流程见 docs/DEPLOY.md

# 错误做法——全文内联
<长篇架构说明直接粘贴>
```

## `@import` 引用模式（增强渐进式披露）

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

## 代码示例优先于文字描述

GitHub 分析中最反直觉的发现：**一个正反代码示例胜过三段文字描述**。

```
# 好示范：正反例对比

// ✅ 正确：命名导出，const 优先
export const formatDate = (date: Date): string => { ... }

// ❌ 错误：默认导出，var 声明
export default function formatDate(date){ var result; ... }
```

代理从示例推断规则比解析抽象描述更可靠。

## Symlink 策略（多工具团队）

维护一个 AGENTS.md 作为唯一真相源，通过 symlink 映射到各工具原生文件：

```bash
ln -s AGENTS.md CLAUDE.md        # Claude Code
ln -s AGENTS.md GEMINI.md        # Gemini CLI
# Cursor / Windsurf 等原生支持 AGENTS.md，无需映射
```

优势：一次更新，所有工具同步。

## 增量迭代法

AGENTS.md 通过使用进化，非一次性写完：

```
1. 起步：20-30 行，仅覆盖最常出错的命令和边界
2. 观察：用真实任务工作 1-2 天，记录代理反复出错的地方
3. 补充：将反复出现的问题写入 AGENTS.md
4. 精简：代理已能正确遵循的规则可移除
5. 重复：持续迭代
```

**不写推测性规则**——只有当代理反复犯同一错误才添加。

## Agent Persona（角色定义）

定义 specialist 角色，非通用助手：

```
# 正确——定义角色
你是一个 Rust 后端开发者。对安全性有最高优先级。需要 unsafe 代码时先提方案。

# 错误——模糊描述
你是一个帮助编码的助手。
```

角色帮助代理在权衡时做正确决定（安全 > 性能？可读性 > 巧妙？）。

## AGENTS.md vs Skill vs MCP

| 用途 | 工具 | 示例 |
|---|---|---|
| 项目约定、命令、边界 | AGENTS.md | “用 pnpm，命名导出” |
| 多步骤工作流 | Skill | “部署上 staging → smoke test → 通知 Slack” |
| 数据库查询、外部工具 | MCP Server | “@postgres 查询用户表” |

AGENTS.md 管**项目上下文**，Skill 管**任务知识**，MCP 管**外部工具**——三者互补。

## 确定性强制

AGENTS.md 是建议性指令，存在被忽略的可能。应由确定性工具负责的规则不应写在 AGENTS.md 中：

| 层级 | 性质 | 示例 |
|---|---|---|
| AGENTS.md（建议性） | 编码约定、工作流偏好 | "命名导出优先" |
| Linter/Formatter（确定性） | 代码风格强制 | ESLint、Prettier、Biome——自动修复 |
| CI/CD（确定性） | 构建/测试/类型检查 | CI 中执行 `pnpm typecheck && pnpm test` |

关系：AGENTS.md 告知代理*应该*怎么写，Linter/CI 保证*必须*通过。不要让 AGENTS.md 承担本该由 linter 或 CI 强制执行的规则——LLM 不是 linter 的廉价替代品。

## 维护规则

- **像代码一样维护**：架构/工具链变更时同步更新 AGENTS.md。过时指令比没有更糟。
- **写前检查**：遍历锁文件、CI 配置、README、现有代码模式与测试布局，再落笔
- **行号引用禁用**：用类型名、函数名、模块名代替行号
- **增删同步**：增删类、函数、配置、异常时同步更新 AGENTS.md
- **路径验证**：AGENTS.md 中所有路径与命令须真实存在
- **结构图用 Mermaid**，禁用 ASCII art
- **大幅重构后运行对齐检查**：确认 AGENTS.md 与实际代码一致
- **路径和命令在每个目录级别验证**：嵌套 AGENTS.md 中引用的路径相对该文件所在目录

## 反模式自查

| 错误做法 | 正确做法 |
|---|---|
| 全文粘贴架构文档 | 链接到 `docs/` |
| 写 500 行大而全 | 100-150 行，迭代补充 |
| 用抽象描述代码风格 | 贴正反代码示例 |
| 通用助手 persona | 定义 specialist 角色 |
| 命令不写 flag | `pnpm test --run src/foo.test.ts` |
| 无边界规则 | 三层 Always/Ask/Never |
| 仅否定指令：“不要用 npm” | 否定+替代：“不要用 npm → 用 pnpm” |
| 不同工具各维护一份 | 一份 AGENTS.md + symlink |
| AGENTS.md 含 README 内容 | 仅含代理所需、代码不可推导的信息 |
