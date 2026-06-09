---
name: agents-md
description: 在创建、修改或重构 `AGENTS.md` 文件时使用。项目配置不清晰、代理行为不符合预期、或需要管理多工具 symlink 映射时亦适用。
license: Apache-2.0
---

# AGENTS.md 技能

创建、修改、重构 `AGENTS.md` 时使用。

## 定位

**AGENTS.md** 是面向编码代理的项目说明文件。与 README 职责分离：

- **AGENTS.md**：构建命令、测试指令、代码约定、边界规则——面向代理
- **README**：项目概述、快速开始、贡献指南——面向人

README 不杂代理指令，AGENTS.md 不重复项目介绍。

## 内容放置指南

### 层级与作用域

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

### 根 AGENTS.md 推荐放

| 类别 | 适合放 |
|---|---|
| **Commands** | 全仓库通用的构建/测试/lint/部署命令，带精确 flag |
| **Testing** | 全局测试框架、统一 mock 策略、根级测试命令 |
| **Project Structure** | 顶层目录布局说明、关键入口文件位置 |
| **Code Style** | 全仓库代码规范、语言级约定（命名导出/const 优先等） |
| **Git Workflow** | 分支策略、提交格式、PR 流程 |
| **Boundaries** | 全仓库 Always/Ask/Never 边界规则 |
| **Tech Stack** | 所有子包共享的框架/语言/运行时及版本 |

### 子目录 AGENTS.md 推荐放

| 类别 | 适合放 |
|---|---|
| **Commands** | 包内特有命令（如仅该子包的测试/lint 脚本） |
| **Testing** | 该包特有的测试策略、mock 配置 |
| **Project Structure** | 该包特有目录布局（入口、基类、配置文件路径） |
| **Code Style** | 该包特有约定（如该模块用同步而非异步） |
| **Git Workflow** | 不声明，继承根文件 |
| **Boundaries** | 该包特有约束（如永不直接访问某外部服务） |
| **Tech Stack** | 该包独占的库/工具及版本 |

子目录只声明该目录特有内容，根文件已有则无需重复。

### 通用规则（所有层级适用）

#### 可以放

- **Agent Persona**——角色帮助代理在权衡时做正确决定，完整定义放 skill 文件。详见 [reference/agent-persona.md](reference/agent-persona.md)。
- **Symlink 策略**——多工具团队通过 symlink 将唯一 AGENTS.md 映射到各工具原生文件。

#### 不建议放（Toolchain First）

工具链（linter / formatter / type checker / CI）已强制的内容**不放入 AGENTS.md**。

| 类型 | 归属 |
|---|---|
| 代码风格、类型约束（确定性） | biome.json / eslintrc / tsconfig |
| 构建、测试、类型检查（确定性） | CI pipeline |
| 架构判断、工作流偏好（建议性） | **AGENTS.md —— 这里** |

Pink Elephant 问题：告诉 LLM“不要做 X”反而让其在 attention 中更活跃，应修复代码库摩擦本身，再删除对应指令。

**定期审计**：将已可被工具链强制的规则迁移出去。

#### 三层边界系统

| 层级 | 含义 | 示例 |
|---|---|---|
| **Always Do** | 每次提交前自动执行 | 运行 `pnpm test`、格式化代码 |
| **Ask First** | 涉及重大变更时先确认 | 修改数据库 schema、重构核心模块 |
| **Never Do** | 绝对禁止的操作 | 提交密钥、删除测试、push main |

## 创建与维护流程

### 增量迭代法

1. **起步**：仅覆盖最常出错的命令和边界
2. **观察**：用真实任务记录代理反复出错的地方
3. **补充**：将反复出现的问题写入
4. **精简**：代理已能遵循的规则可移除
5. **重复**

**不写推测性规则**——只有当代理反复犯同一错误才添加。

### 写作原则

- **代码示例优先**——一个正反代码示例胜过三段文字描述。
- **Toolchain First**——指向工具配置，不重复规则（见上方“不建议放”）。
- **关键文件路径显式标注**——入口点、基类、配置文件应显式标注路径。
- **禁用否定指令**——改肯定指令或修复代码库摩擦。
- **内容风格**——尽可能简洁。能用一句话说明清楚的绝不用一段话。只写要点，不写推测性信息。

### 维护规则

- **像代码一样维护**：架构变更时同步更新，过时指令比没有更糟。
- **写前检查**：遍历锁文件、CI 和现有代码模式再落笔。
- **行号引用禁用**：用类型名/函数名/模块名代替。
- **路径验证**：所有路径与命令须真实存在，结构图用 Mermaid。

### 常见错误

| 错误 | 后果 | 修复 |
|---|---|---|
| 含 README 内容 | 代理遵循率下降 | 仅含代码不可推导的信息 |
| 重复工具链已强制内容 / 自动生成不审校 | 浪费 token，推理成本 +20% | 指向工具配置，生成结果手工重写 |
| 不同工具各维护一份 | 更新不同步，多份腐烂 | 一份 AGENTS.md + symlink |
| 否定指令如“不要做 X” | Pink Elephant 效应 | 改肯定指令或修复代码库摩擦 |

## 参考文件

| 文件 | 内容 |
|---|---|
| [reference/comparison-tools.md](reference/comparison-tools.md) | AGENTS.md vs Skill vs MCP 对比 |
| [reference/empirical-evidence.md](reference/empirical-evidence.md) | Princeton/ETH Zurich/上下文效率等实证数据 |
| [reference/agent-persona.md](reference/agent-persona.md) | Agent Persona 完整定义（specialist / Registry / 单角色） |
| [reference/auto-gen-warning.md](reference/auto-gen-warning.md) | LLM 自动生成危害与实证数据 |
| [reference/v1.1-features.md](reference/v1.1-features.md) | AGENTS.md v1.1 YAML Frontmatter |
