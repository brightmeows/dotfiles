# 技能编写最佳实践

> 学习如何编写能让 Claude 发现并有效使用的技能。

好的技能应该简洁、结构良好、并经过真实使用测试。本指南提供实用的编写决策，帮助你编写能被 Claude 发现并有效使用的技能。

关于技能工作原理的概念背景，请参见[技能概述](/en/docs/agents-and-tools/agent-skills/overview)。

## 核心原则

### 简洁是关键

[上下文窗口](https://platform.claude.com/docs/en/build-with-claude/context-windows) 是一种公共资源。你的技能与 Claude 所需知道的其他一切共享上下文窗口，包括：

* 系统提示词
* 对话历史
* 其他技能的元数据
* 你的实际请求

并非技能中的每个 token 都有即时成本。启动时，仅预加载所有技能的元数据（name 和 description）。Claude 仅在技能变得相关时才读取 SKILL.md，并根据需要读取其他文件。然而，SKILL.md 的简洁仍然重要：一旦 Claude 加载它，每个 token 都与对话历史和其他上下文竞争。

**默认假设**：Claude 已经非常聪明

只添加 Claude 尚未拥有的上下文。质疑每条信息：

* “Claude 真的需要这个解释吗？”
* “我能假设 Claude 已经知道这个吗？”
* “这段文字值得它的 token 成本吗？”

**好示例：简洁**（约 50 tokens）：

````markdown  theme={null}
## 提取 PDF 文本

使用 pdfplumber 提取文本：

```python
import pdfplumber

with pdfplumber.open(“file.pdf”) as pdf:
    text = pdf.pages[0].extract_text()
```
````

**坏示例：过于冗长**（约 150 tokens）：

```markdown  theme={null}
## 提取 PDF 文本

PDF（便携式文档格式）文件是一种常见的文件格式，包含
文本、图像和其他内容。要从 PDF 中提取文本，你需要
使用一个库。有许多库可用于 PDF 处理，但我们
推荐 pdfplumber，因为它易于使用且能很好地处理大多数情况。
首先，你需要使用 pip 安装它。然后你可以使用下面的代码……
```

简洁版本假设 Claude 知道 PDF 是什么以及库如何工作。

### 设定适当的自由度

将详细程度与任务的脆弱性和可变性相匹配。

**高自由度**（基于文本的指令）：

适用于：

* 多种方法都可行
* 决策取决于上下文
* 启发式指导方法

示例：

```markdown  theme={null}
## 代码审查流程

1. 分析代码结构和组织
2. 检查潜在 bug 或边界情况
3. 建议可读性和可维护性改进
4. 验证是否符合项目规范
```

**中自由度**（伪代码或带参数的脚本）：

适用于：

* 存在偏好的模式
* 允许一定变化
* 配置影响行为

示例：

````markdown  theme={null}
## 生成报告

使用此模板并根据需要自定义：

```python
def generate_report(data, format=“markdown”, include_charts=True):
    # 处理数据
    # 按指定格式生成输出
    # 可选包含可视化
```
````

**低自由度**（具体脚本，很少或无需参数）：

适用于：

* 操作脆弱且易出错
* 一致性至关重要
* 必须遵循特定顺序

示例：

````markdown  theme={null}
## 数据库迁移

精确运行此脚本：

```bash
python scripts/migrate.py --verify --backup
```

不要修改命令或添加额外参数。
````

**类比**：把 Claude 想象成探索路径的机器人：

* **两边是悬崖的窄桥**：只有一条安全的前进道路。提供具体的护栏和精确的指令（低自由度）。示例：必须按精确顺序运行的数据库迁移。
* **没有危险的广阔田野**：多条路径通向成功。给大致方向，相信 Claude 会找到最佳路线（高自由度）。示例：由上下文决定最佳方法的代码审查。

### 在所有计划使用的模型上测试

技能作为模型的附加内容发挥作用，因此效果取决于底层模型。在所有你计划使用的模型上测试你的技能。

**按模型的测试考量**：

* **Claude Haiku**（快速、经济）：技能是否提供了足够的指导？
* **Claude Sonnet**（平衡）：技能是否清晰高效？
* **Claude Opus**（强大的推理能力）：技能是否避免了过度解释？

对 Opus 完美适用的内容可能需要对 Haiku 更详细。如果你计划在多个模型上使用技能，应目标是让指令在所有模型上都运行良好。

## 技能结构

<Note>
  **YAML 前置元数据**：SKILL.md 的前置元数据需要两个字段：

  * `name` ——技能的人类可读名称（最多 64 字符）
  * `description` ——技能做什么以及何时使用的一行描述（最多 1024 字符）

  完整的技能结构细节，请参见[技能概述](/en/docs/agents-and-tools/agent-skills/overview#skill-structure)。
</Note>

### 命名约定

使用一致的命名模式使技能更易于引用和讨论。我们建议技能名称使用**动名词形式**（动词 + -ing），因为这能清晰描述技能提供的活动或能力。

**好的命名示例（动名词形式）**：

* “Processing PDFs”
* “Analyzing spreadsheets”
* “Managing databases”
* “Testing code”
* “Writing documentation”

**可接受的替代方案**：

* 名词短语：“PDF Processing”、“Spreadsheet Analysis”
* 面向动作：“Process PDFs”、“Analyze Spreadsheets”

**避免**：

* 模糊名称：“Helper”、“Utils”、“Tools”
* 过于通用：“Documents”、“Data”、“Files”
* 技能集合中的不一致模式

一致的命名便于：

* 在文档和对话中引用技能
* 一眼了解技能的作用
* 组织并搜索多个技能
* 维护专业、内聚的技能库

### 编写有效的描述

`description` 字段支持技能发现，应同时包含技能做什么以及何时使用。

<Warning>
  **始终以第三人称编写**。描述被注入到系统提示词中，不一致的视角可能导致发现问题。

  * **好：** “Processes Excel files and generates reports”
  * **避免：** “I can help you process Excel files”
  * **避免：** “You can use this to process Excel files”
</Warning>

**要具体并包含关键术语**。同时包含技能做什么以及何时使用的具体触发器/上下文。

每个技能只有一个描述字段。描述对技能选择至关重要：Claude 用它从潜在 100+ 可用技能中选择正确的技能。你的描述必须提供足够的细节让 Claude 知道何时选择此技能，而 SKILL.md 的其余部分提供实现细节。

有效示例：

**PDF 处理技能：**

```yaml  theme={null}
description: 从 PDF 文件中提取文本和表格、填写表单、合并文档。在处理 PDF 文件或用户提及 PDF、表单、文档提取时使用
```

**Excel 分析技能：**

```yaml  theme={null}
description: 分析 Excel 电子表格、创建透视表、生成图表。在分析 Excel 文件、电子表格、表格数据或 .xlsx 文件时使用
```

**Git 提交辅助技能：**

```yaml  theme={null}
description: 通过分析 git diff 生成描述性提交消息。在用户请求帮助编写提交消息或审查暂存变更时使用
```

避免像这样的模糊描述：

```yaml  theme={null}
description: 帮助处理文档
```

```yaml  theme={null}
description: 处理数据
```

```yaml  theme={null}
description: 处理文件相关事务
```

### 渐进式披露模式

SKILL.md 充当概述，根据需要将 Claude 指向详细材料，就像入职指南中的目录。关于渐进式披露如何工作的解释，请参见概述中的[技能如何工作](/en/docs/agents-and-tools/agent-skills/overview#how-skills-work)。

**实用指导：**

* 保持 SKILL.md 主体在 500 行以内以获得最佳性能
* 接近此限制时将内容拆分到单独文件
* 使用下面的模式有效组织指令、代码和资源

#### 直观概览：从简单到复杂

基础级技能仅从一个包含元数据和指令的 SKILL.md 文件开始：

<img src=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?fit=max&auto=format&n=4Bny2bjzuGBK7o00&q=85&s=87782ff239b297d9a9e8e1b72ed72db9” alt=“展示 YAML 前置元数据和 markdown 主体的简单 SKILL.md 文件” data-og-width=“2048” width=“2048” data-og-height=“1153” height=“1153” data-path=“images/agent-skills-simple-file.png” data-optimize=“true” data-opv=“3” srcset=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=280&fit=max&auto=format&n=4Bny2bjzuGBK7o00&q=85&s=c61cc33b6f5855809907f7fda94cd80e 280w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=560&fit=max&auto=format&n=4Bny2bjzuGBK7o00&q=85&s=90d2c0c1c76b36e8d485f49e0810dbfd 560w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=840&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=ad17d231ac7b0bea7e5b4d58fb4aeabb 840w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=1100&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=f5d0a7a3c668435bb0aee9a3a8f8c329 1100w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=1650&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=0e927c1af9de5799cfe557d12249f6e6 1650w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-simple-file.png?w=2500&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=46bbb1a51dd4c8202a470ac8c80a893d 2500w” />

随着技能增长，你可以打包仅在需要时才由 Claude 加载的附加内容：

<img src=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?fit=max&auto=format&n=4Bny2bjzuGBK7o00&q=85&s=a5e0aa41e3d53985a7e3e43668a33ea3” alt=“打包额外的参考文件如 reference.md 和 forms.md” data-og-width=“2048” width=“2048” data-og-height=“1327” height=“1327” data-path=“images/agent-skills-bundling-content.png” data-optimize=“true” data-opv=“3” srcset=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=280&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=f8a0e73783e99b4a643d79eac86b70a2 280w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=560&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=dc510a2a9d3f14359416b706f067904a 560w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=840&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=82cd6286c966303f7dd914c28170e385 840w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=1100&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=56f3be36c77e4fe4b523df209a6824c6 1100w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=1650&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=d22b5161b2075656417d56f41a74f3dd 1650w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-bundling-content.png?w=2500&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=3dd4bdd6850ffcc96c6c45fcb0acd6eb 2500w” />

完整的技能目录结构可能如下所示：

```
pdf/
├── SKILL.md              # 主指令（触发时加载）
├── FORMS.md              # 表单填写指南（按需加载）
├── reference.md          # API 参考（按需加载）
├── examples.md           # 使用示例（按需加载）
└── scripts/
    ├── analyze_form.py   # 实用工具脚本（执行而非加载）
    ├── fill_form.py      # 表单填写脚本
    └── validate.py       # 验证脚本
```

#### 模式 1：带参考的高级指南

````markdown  theme={null}
---
name: PDF Processing
description: 从 PDF 文件中提取文本和表格、填写表单、合并文档。在处理 PDF 文件或用户提及 PDF、表单、文档提取时使用
---

# PDF Processing

## 快速开始

用 pdfplumber 提取文本：
```python
import pdfplumber
with pdfplumber.open(“file.pdf”) as pdf:
    text = pdf.pages[0].extract_text()
```

## 高级功能

**表单填写**：完整指南见 [FORMS.md](FORMS.md)
**API 参考**：所有方法见 [REFERENCE.md](REFERENCE.md)
**示例**：常见模式见 [EXAMPLES.md](EXAMPLES.md)
````

Claude 仅在需要时才加载 FORMS.md、REFERENCE.md 或 EXAMPLES.md。

#### 模式 2：按领域组织

对于跨多个领域的技能，按领域组织内容以避免加载不相关的上下文。当用户询问销售指标时，Claude 只需要读取与销售相关的模式，无需财务或市场数据。这保持了较低的 token 使用量和聚焦的上下文。

```
bigquery-skill/
├── SKILL.md（概述和导航）
└── reference/
    ├── finance.md（收入、账单指标）
    ├── sales.md（机会、管道）
    ├── product.md（API 使用、功能）
    └── marketing.md（活动、归因）
```

````markdown SKILL.md theme={null}
# BigQuery 数据分析

## 可用数据集

**财务**：收入、ARR、账单 → 参见 [reference/finance.md](reference/finance.md)
**销售**：机会、管道、账户 → 参见 [reference/sales.md](reference/sales.md)
**产品**：API 使用、功能、采用 → 参见 [reference/product.md](reference/product.md)
**市场**：活动、归因、邮件 → 参见 [reference/marketing.md](reference/marketing.md)

## 快速搜索

使用 grep 查找特定指标：

```bash
grep -i “revenue” reference/finance.md
grep -i “pipeline” reference/sales.md
grep -i “api usage” reference/product.md
```
````

#### 模式 3：条件性详情

展示基础内容，链接到高级内容：

```markdown  theme={null}
# DOCX 处理

## 创建文档

新文档使用 docx-js。参见 [DOCX-JS.md](DOCX-JS.md)。

## 编辑文档

简单修改直接编辑 XML。

**修订追踪**：参见 [REDLINING.md](REDLINING.md)
**OOXML 细节**：参见 [OOXML.md](OOXML.md)
```

Claude 仅在用户需要这些功能时才读取 REDLINING.md 或 OOXML.md。

### 避免深层嵌套引用

当文件从其他被引用的文件中引用时，Claude 可能部分读取文件。遇到嵌套引用时，Claude 可能使用 `head -100` 等命令预览内容，而非读取整个文件，导致信息不完整。

**从 SKILL.md 开始保持引用一层深度**。所有引用文件应直接从 SKILL.md 链接，以确保 Claude 在需要时读取完整文件。

**坏示例：太深**：

```markdown  theme={null}
# SKILL.md
参见 [advanced.md](advanced.md)……

# advanced.md
参见 [details.md](details.md)……

# details.md
这里是实际信息……
```

**好示例：一层深度**：

```markdown  theme={null}
# SKILL.md

**基本用法**：[SKILL.md 中的指令]
**高级功能**：参见 [advanced.md](advanced.md)
**API 参考**：参见 [reference.md](reference.md)
**示例**：参见 [examples.md](examples.md)
```

### 较长的参考文件用目录结构组织

对于超过 100 行的参考文件，在顶部包含目录。这确保了即使通过部分读取预览，Claude 也能看到可用信息的完整范围。

**示例**：

```markdown  theme={null}
# API 参考

## 目录
- 认证与设置
- 核心方法（创建、读取、更新、删除）
- 高级功能（批量操作、webhook）
- 错误处理模式
- 代码示例

## 认证与设置
……

## 核心方法
……
```

Claude 可以根据需要读取完整文件或跳转到特定章节。

关于这种基于文件系统的架构如何实现渐进式披露的详细信息，请参见下方高级章节中的[运行时环境](#runtime-environment)。

## 工作流与反馈循环

### 复杂任务使用工作流

将复杂操作分解为清晰、有序的步骤。对特别复杂的工作流，提供 Claude 可以复制到其响应中并逐步勾选完成的清单。

**示例 1：研究综合工作流**（适用于无代码的技能）：

````markdown  theme={null}
## 研究综合工作流

复制此清单并跟踪进度：

```
研究进度：
- [ ] 第 1 步：阅读所有源文档
- [ ] 第 2 步：识别关键主题
- [ ] 第 3 步：交叉验证声明
- [ ] 第 4 步：创建结构化总结
- [ ] 第 5 步：验证引用
```

**第 1 步：阅读所有源文档**

审查 `sources/` 目录中的每个文档。记录主要论点和支撑证据。

**第 2 步：识别关键主题**

寻找跨来源的模式。哪些主题反复出现？来源之间在哪里一致或分歧？

**第 3 步：交叉验证声明**

对每个主要声明，验证其在源材料中出现。记录哪个来源支持每个观点。

**第 4 步：创建结构化总结**

按主题组织发现。包括：
- 主要声明
- 来源的支撑证据
- 冲突观点（如有）

**第 5 步：验证引用**

检查每个声明是否引用正确的源文档。如果引用不完整，返回第 3 步。
````

此示例展示了工作流如何应用于无需代码的分析任务。清单模式适用于任何复杂、多步骤的流程。

**示例 2：PDF 表单填写工作流**（适用于有代码的技能）：

````markdown  theme={null}
## PDF 表单填写工作流

复制此清单并在完成时勾选：

```
任务进度：
- [ ] 第 1 步：分析表单（运行 analyze_form.py）
- [ ] 第 2 步：创建字段映射（编辑 fields.json）
- [ ] 第 3 步：验证映射（运行 validate_fields.py）
- [ ] 第 4 步：填写表单（运行 fill_form.py）
- [ ] 第 5 步：验证输出（运行 verify_output.py）
```

**第 1 步：分析表单**

运行：`python scripts/analyze_form.py input.pdf`

这将提取表单字段及其位置，保存到 `fields.json`。

**第 2 步：创建字段映射**

编辑 `fields.json` 为每个字段添加值。

**第 3 步：验证映射**

运行：`python scripts/validate_fields.py fields.json`

在继续前修复所有验证错误。

**第 4 步：填写表单**

运行：`python scripts/fill_form.py input.pdf fields.json output.pdf`

**第 5 步：验证输出**

运行：`python scripts/verify_output.py output.pdf`

如果验证失败，返回第 2 步。
````

清晰的步骤防止 Claude 跳过关键验证。清单帮助 Claude 和你都通过多步骤工作流跟踪进度。

### 实现反馈循环

**常见模式**：运行验证器 → 修复错误 → 重复

此模式极大提高输出质量。

**示例 1：风格指南合规**（适用于无代码的技能）：

```markdown  theme={null}
## 内容审查流程

1. 按照 STYLE_GUIDE.md 中的指南起草内容
2. 对照清单审查：
   - 检查术语一致性
   - 验证示例遵循标准格式
   - 确认所有必需章节都已存在
3. 如发现问题：
   - 记录每个问题的具体章节引用
   - 修订内容
   - 再次审查清单
4. 仅在满足所有要求后继续
5. 定稿并保存文档
```

这展示了使用参考文档而非脚本的验证循环模式。“验证器”是 STYLE_GUIDE.md，Claude 通过阅读和比较来执行检查。

**示例 2：文档编辑流程**（适用于有代码的技能）：

```markdown  theme={null}
## 文档编辑流程

1. 在 `word/document.xml` 中进行编辑
2. **立即验证**：`python ooxml/scripts/validate.py unpacked_dir/`
3. 如果验证失败：
   - 仔细审查错误信息
   - 修复 XML 中的问题
   - 再次运行验证
4. **仅在验证通过后继续**
5. 重建：`python ooxml/scripts/pack.py unpacked_dir/ output.docx`
6. 测试输出文档
```

验证循环在早期捕获错误。

## 内容指南

### 避免时间敏感信息

不要包含会过时的信息：

**坏示例：时间敏感**（会变得错误）：

```markdown  theme={null}
如果你在 2025 年 8 月之前做这个，使用旧 API。
2025 年 8 月之后，使用新 API。
```

**好示例**（使用“旧模式”章节）：

```markdown  theme={null}
## 当前方法

使用 v2 API 端点：`api.example.com/v2/messages`

## 旧模式

<details>
<summary>Legacy v1 API（已于 2025-08 弃用）</summary>

v1 API 使用：`api.example.com/v1/messages`

该端点已不再支持。
</details>
```

旧模式章节提供了历史上下文，同时不干扰主要内容。

### 使用一致的术语

选择一个术语并在整个技能中一致使用：

**好——一致**：

* 始终用 “API endpoint”
* 始终用 “field”
* 始终用 “extract”

**坏——不一致**：

* 混用 “API endpoint”、“URL”、“API route”、“path”
* 混用 “field”、“box”、“element”、“control”
* 混用 “extract”、“pull”、“get”、“retrieve”

一致性帮助 Claude 理解和遵循指令。

## 常见模式

### 模板模式

提供输出格式的模板。将严格程度与你的需求匹配。

**严格要求的场景**（如 API 响应或数据格式）：

````markdown  theme={null}
## 报告结构

ALWAYS 使用此精确模板结构：

```markdown
# [分析标题]

## 执行摘要
[关键发现的段落概述]

## 关键发现
- 发现 1 及支撑数据
- 发现 2 及支撑数据
- 发现 3 及支撑数据

## 建议
1. 具体可操作的建议
2. 具体可操作的建议
```
````

**灵活指导的场景**（适配有用时）：

````markdown  theme={null}
## 报告结构

这是一个合理的默认格式，但根据分析情况做出最佳判断：

```markdown
# [分析标题]

## 执行摘要
[概述]

## 关键发现
[根据你的发现调整章节]

## 建议
[根据具体上下文定制]
```

根据具体分析类型调整章节。
````

### 示例模式

对于输出质量依赖示例的技能，像常规提示一样提供输入/输出对：

````markdown  theme={null}
## 提交消息格式

生成遵循以下示例的提交消息：

**示例 1：**
输入：Added user authentication with JWT tokens
输出：
```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
```

**示例 2：**
输入：Fixed bug where dates displayed incorrectly in reports
输出：
```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
```

**示例 3：**
输入：Updated dependencies and refactored error handling
输出：
```
chore: update dependencies and refactor error handling

- Upgrade lodash to 4.17.21
- Standardize error response format across endpoints
```

遵循此风格：type(scope): brief description，然后详细说明。
````

示例比单独的描述更清晰地帮助 Claude 理解期望的风格和详细程度。

### 条件工作流模式

引导 Claude 通过决策点：

```markdown  theme={null}
## 文档修改工作流

1. 确定修改类型：

   **创建新内容？** → 按照下方“创建工作流”
   **编辑现有内容？** → 按照下方“编辑工作流”

2. 创建工作流：
   - 使用 docx-js 库
   - 从头构建文档
   - 导出为 .docx 格式

3. 编辑工作流：
   - 解包现有文档
   - 直接修改 XML
   - 每次更改后验证
   - 完成后重新打包
```

<Tip>
  如果工作流变得庞大或复杂，步骤很多，考虑将其推送到单独的文件中，并告诉 Claude 根据当前任务读取相应的文件。
</Tip>

## 评估与迭代

### 先构建评估

**在编写大量文档之前先创建评估。** 这确保你的技能解决的是真实问题，而非文档化想象出来的需求。

**评估驱动开发：**

1. **识别缺口**：在无技能的情况下对代表性任务运行 Claude。记录具体失败或缺失的上下文
2. **创建评估**：构建三个测试这些缺口的场景
3. **建立基线**：测量 Claude 在无技能时的表现
4. **编写最简指令**：创建刚好足以填补缺口并通过评估的内容
5. **迭代**：执行评估，与基线比较，并优化

此方法确保你解决的是实际问题，而非预测可能永远不会实现的需求。

**评估结构**：

```json  theme={null}
{
  "skills": ["pdf-processing"],
  "query": "Extract all text from this PDF file and save it to output.txt",
  "files": ["test-files/document.pdf"],
  "expected_behavior": [
    "Successfully reads the PDF file using an appropriate PDF processing library or command-line tool",
    "Extracts text content from all pages in the document without missing any pages",
    "Saves the extracted text to a file named output.txt in a clear, readable format"
  ]
}
```

<Note>
  此示例展示了带有简单测试评分标准的数据驱动评估。我们目前不提供运行这些评估的内置方式。用户可以创建自己的评估系统。评估是你衡量技能有效性的真实来源。
</Note>

### 与 Claude 一起迭代开发技能

最有效的技能开发过程涉及 Claude 自身。与一个 Claude 实例（“Claude A”）协作创建技能，供其他实例（“Claude B”）使用。Claude A 帮助你设计和优化指令，而 Claude B 在真实任务中测试它们。这之所以有效，是因为 Claude 模型既理解如何编写有效的 agent 指令，也知道 agent 需要哪些信息。

**创建新技能：**

1. **在无技能的情况下完成任务**：与 Claude A 一起使用常规提示解决问题。在过程中，你会自然地提供上下文、解释偏好并分享过程性知识。注意你反复提供的信息。

2. **识别可复用的模式**：完成任务后，识别你提供的哪些上下文对未来的类似任务有用。

   **示例**：如果你完成了一个 BigQuery 分析，你可能提供了表名、字段定义、过滤规则（如“始终排除测试账户”）和常见查询模式。

3. **让 Claude A 创建技能**：“创建一个捕捉我们刚才使用的 BigQuery 分析模式的技能。包括表结构、命名约定和关于过滤测试账户的规则。”

   <Tip>
     Claude 模型原生理解技能格式和结构。你不需要特殊的系统提示或“编写技能”技能来让 Claude 帮助创建技能。只需要求 Claude 创建一个技能，它就会生成结构正确的 SKILL.md 内容，包括适当的前置元数据和主体内容。
   </Tip>

4. **检查简洁性**：检查 Claude A 是否添加了不必要的解释。问：“删除关于 win rate 含义的解释——Claude 已经知道了。”

5. **改进信息架构**：要求 Claude A 更有效地组织内容。例如：“组织一下，使表结构放在单独的参考文件中。我们以后可能添加更多表。”

6. **在类似任务上测试**：用 Claude B（加载了技能的新实例）在相关用例上使用技能。观察 Claude B 是否能找到正确的信息、正确应用规则并成功处理任务。

7. **基于观察迭代**：如果 Claude B 遇到困难或遗漏了什么，带着具体细节回到 Claude A：“当 Claude 使用此技能时，它忘了按日期过滤 Q4 的数据。我们应该添加一个关于日期过滤模式的章节吗？”

**迭代现有技能：**

同样的层次化模式在改进技能时继续适用。你在以下角色间交替：

* **与 Claude A 协作**（帮助优化技能的专家）
* **用 Claude B 测试**（使用技能执行实际工作的 agent）
* **观察 Claude B 的行为**并将洞察带回给 Claude A

1. **在真实工作流中使用技能**：给 Claude B（已加载技能）实际任务，而非测试场景

2. **观察 Claude B 的行为**：记录它在哪些方面挣扎、成功或做出意外选择

   **观察示例**：“当我要求 Claude B 提供区域销售报告时，它编写了查询但忘了过滤掉测试账户，尽管技能中提到了这条规则。”

3. **回到 Claude A 进行改进**：分享当前的 SKILL.md 并描述你的观察。问：“我注意到当我要求区域报告时，Claude B 忘了过滤测试账户。技能提到了过滤，但可能不够突出？”

4. **审查 Claude A 的建议**：Claude A 可能建议重新组织以使规则更突出，使用更强硬的语言如 “MUST filter” 而非 “always filter”，或重构工作流章节。

5. **应用并测试更改**：用 Claude A 的优化更新技能，然后在类似请求上用 Claude B 再次测试

6. **根据使用情况重复**：在遇到新场景时继续此观察-优化-测试循环。每次迭代都基于真实的 agent 行为改进技能，而非假设。

**收集团队反馈：**

1. 与队友分享技能并观察他们的使用
2. 问：技能是否在预期时激活？指令是否清晰？缺少什么？
3. 整合反馈以解决你自己使用模式中的盲点

**为什么这种方法有效**：Claude A 理解 agent 需求，你提供领域专业知识，Claude B 通过真实使用揭示缺口，迭代优化基于观察到的行为而非假设改进技能。

### 观察 Claude 如何导航技能

当你迭代技能时，注意 Claude 在实践中如何使用它们。注意：

* **意外的探索路径**：Claude 是否以你未预料到的顺序读取文件？这可能表明你的结构不如你想象的那样直观
* **错过的连接**：Claude 是否未能跟踪到重要文件的引用？你的链接可能需要更明确或更突出
* **过度依赖某些章节**：如果 Claude 反复读取同一个文件，考虑该内容是否应放在主 SKILL.md 中替代
* **被忽略的内容**：如果 Claude 从未访问打包的文件，它可能不必要或在主指令中信号不够充分

基于这些观察而非假设进行迭代。技能元数据中的 ‘name’ 和 ‘description’ 尤为关键。Claude 在决定是否针对当前任务触发技能时使用它们。确保它们清晰描述技能做什么以及何时使用。

## 要避免的反模式

### 避免 Windows 风格路径

始终在文件路径中使用正斜杠，即使在 Windows 上：

* ✓ **好**：`scripts/helper.py`、`reference/guide.md`
* ✗ **避免**：`scripts\helper.py`、`reference\guide.md`

Unix 风格路径在所有平台上都能工作，而 Windows 风格路径在 Unix 系统上会导致错误。

### 避免提供过多选项

除非必要，不要呈现多种方法：

````markdown  theme={null}
**坏示例：过多选择**（令人困惑）：
"You can use pypdf, or pdfplumber, or PyMuPDF, or pdf2image, or……"

**好示例：提供默认方案**（含备选出口）：
"Use pdfplumber for text extraction:
```python
import pdfplumber
```

For scanned PDFs requiring OCR, use pdf2image with pytesseract instead."
````

## 进阶：带可执行代码的技能

以下章节聚焦于包含可执行脚本的技能。如果你的技能仅使用 markdown 指令，跳到[有效技能清单](#checklist-for-effective-skills)。

### 解决问题，而非推给 Claude

编写技能脚本时，处理错误条件而非推给 Claude。

**好示例：明确处理错误**：

```python  theme={null}
def process_file(path):
    “”“处理文件，如不存在则创建。”“”
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        # 创建带默认内容的文件，而非失败
        print(f“文件 {path} 未找到，创建默认文件”)
        with open(path, 'w') as f:
            f.write('')
        return ''
    except PermissionError:
        # 提供替代方案而非失败
        print(f“无法访问 {path}，使用默认值”)
        return ''
```

**坏示例：推给 Claude**：

```python  theme={null}
def process_file(path):
    # 直接失败，让 Claude 自己想办法
    return open(path).read()
```

配置参数也应合理说明并有文档，以避免“巫毒常数”（Ousterhout 法则）。如果你不知道正确的值，Claude 如何确定？

**好示例：自文档化**：

```python  theme={null}
# HTTP 请求通常在 30 秒内完成
# 更长的超时覆盖慢速连接情况
REQUEST_TIMEOUT = 30

# 三次重试在可靠性与速度间取得平衡
# 大多数间歇性失败在第二次重试时解决
MAX_RETRIES = 3
```

**坏示例：魔法数字**：

```python  theme={null}
TIMEOUT = 47  # 为什么是 47？
RETRIES = 5   # 为什么是 5？
```

### 提供实用脚本

即使 Claude 可以编写脚本，预制脚本也有优势：

**实用脚本的好处**：

* 比生成的代码更可靠
* 节省 token（无需在上下文中包含代码）
* 节省时间（无需代码生成）
* 确保跨使用的一致性

<img src=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?fit=max&auto=format&n=4Bny2bjzuGBK7o00&q=85&s=4bbc45f2c2e0bee9f2f0d5da669bad00” alt=“将可执行脚本与指令文件打包” data-og-width=“2048” width=“2048” data-og-height=“1154” height=“1154” data-path=“images/agent-skills-executable-scripts.png” data-optimize=“true” data-opv=“3” srcset=“https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=280&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=9a04e6535a8467bfeea492e517de389f 280w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=560&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=e49333ad90141af17c0d7651cca7216b 560w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=840&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=954265a5df52223d6572b6214168c428 840w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=1100&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=2ff7a2d8f2a83ee8af132b29f10150fd 1100w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=1650&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=48ab96245e04077f4d15e9170e081cfb 1650w, https://mintcdn.com/anthropic-claude-docs/4Bny2bjzuGBK7o00/images/agent-skills-executable-scripts.png?w=2500&fit=max&auto&format&n=4Bny2bjzuGBK7o00&q=85&s=0301a6c8b3ee879497cc5b5483177c90 2500w” />

上图展示了可执行脚本如何与指令文件协同工作。指令文件（forms.md）引用脚本，Claude 可以在不将脚本内容加载到上下文中的情况下执行它。

**重要区分**：在你的指令中明确说明 Claude 应：

* **执行脚本**（最常见）：“运行 `analyze_form.py` 提取字段”
* **作为参考阅读**（用于复杂逻辑）：“参见 `analyze_form.py` 了解字段提取算法”

对大多数实用脚本，执行是首选方式，因为它更可靠且更高效。详见下方[运行时环境](#runtime-environment)章节。

**示例**：

````markdown  theme={null}
## 实用脚本

**analyze_form.py**：从 PDF 中提取所有表单字段

```bash
python scripts/analyze_form.py input.pdf > fields.json
```

输出格式：
```json
{
  “field_name”: {“type”: “text”, “x”: 100, “y”: 200},
  “signature”: {“type”: “sig”, “x”: 150, “y”: 500}
}
```

**validate_boxes.py**：检查重叠的边界框

```bash
python scripts/validate_boxes.py fields.json
# 返回：“OK” 或列出冲突
```

**fill_form.py**：将字段值应用到 PDF

```bash
python scripts/fill_form.py input.pdf fields.json output.pdf
```
````

### 可视化分析

当输入可以渲染为图像时，让 Claude 分析它们：

````markdown  theme={null}
## 表单布局分析

1. 将 PDF 转换为图像：
   ```bash
   python scripts/pdf_to_images.py form.pdf
   ```

2. 分析每页图像以识别表单字段
3. Claude 可以直观看到字段位置和类型
````

<Note>
  在此示例中，你需要编写 `pdf_to_images.py` 脚本。
</Note>

Claude 的视觉能力有助于理解布局和结构。

### 创建可验证的中间输出

当 Claude 执行复杂、开放式的任务时，它可能犯错。“计划-验证-执行”模式通过让 Claude 先用结构化格式创建计划，然后通过脚本验证计划后再执行，从而在早期捕获错误。

**示例**：想象要求 Claude 基于电子表格更新 PDF 中的 50 个表单字段。没有验证的情况下，Claude 可能引用不存在的字段、创建冲突的值、遗漏必填字段或错误应用更新。

**解决方案**：使用上面展示的工作流模式（PDF 表单填写），但在应用变更前增加一个中间 `changes.json` 文件进行验证。工作流变为：分析 → **创建计划文件** → **验证计划** → 执行 → 验证。

**为什么这种模式有效：**

* **早期捕获错误**：验证在变更应用前发现问题
* **机器可验证**：脚本提供客观验证
* **可逆的计划**：Claude 可以在不触及原始数据的情况下迭代计划
* **清晰的调试**：错误信息指向具体问题

**使用时机**：批量操作、破坏性变更、复杂验证规则、高风险操作。

**实现技巧**：使验证脚本的输出详细，包含具体的错误信息，如“字段 ‘signature_date’ 未找到。可用字段：customer_name、order_total、signature_date_signed”以帮助 Claude 修复问题。

### 打包依赖项

技能在代码执行环境中运行，存在平台特定的限制：

* **claude.ai**：可从 npm 和 PyPI 安装包，并从 GitHub 仓库拉取
* **Anthropic API**：无网络访问，无运行时包安装

在 SKILL.md 中列出所需包，并在[代码执行工具文档](/en/docs/agents-and-tools/tool-use/code-execution-tool)中验证它们是否可用。

### 运行时环境

技能在具有文件系统访问、bash 命令和代码执行能力的代码执行环境中运行。关于此架构的概念性解释，请参见概述中的[技能架构](/en/docs/agents-and-tools/agent-skills/overview#the-skills-architecture)。

**这如何影响你的编写：**

**Claude 如何访问技能：**

1. **元数据预加载**：启动时，所有技能 YAML 前置元数据中的 name 和 description 被加载到系统提示中
2. **按需读取文件**：Claude 在需要时使用 bash 的读取工具访问 SKILL.md 和其他文件
3. **高效执行脚本**：实用脚本可以通过 bash 执行，无需将其完整内容加载到上下文中。仅脚本的输出消耗 token
4. **大文件无上下文惩罚**：参考文件、数据或文档在实际读取前不消耗上下文 token

* **文件路径很重要**：Claude 像文件系统一样导航你的技能目录。使用正斜杠（`reference/guide.md`），而非反斜杠
* **描述性命名文件**：使用指示内容的名称：`form_validation_rules.md`，而非 `doc2.md`
* **为发现而组织**：按领域或功能组织目录
  * 好：`reference/finance.md`、`reference/sales.md`
  * 坏：`docs/file1.md`、`docs/file2.md`
* **打包全面的资源**：包含完整的 API 文档、大量示例、大数据集；访问前无上下文惩罚
* **确定性操作首选脚本**：编写 `validate_form.py` 而非要求 Claude 生成验证代码
* **明确执行意图**：
  * “运行 `analyze_form.py` 提取字段”（执行）
  * “参见 `analyze_form.py` 了解提取算法”（作为参考阅读）
* **测试文件访问模式**：通过真实请求验证 Claude 能否导航你的目录结构

**示例：**

```
bigquery-skill/
├── SKILL.md（概述，指向参考文件）
└── reference/
    ├── finance.md（收入指标）
    ├── sales.md（管道数据）
    └── product.md（使用分析）
```

当用户询问收入时，Claude 读取 SKILL.md，看到对 `reference/finance.md` 的引用，并调用 bash 读取该文件。sales.md 和 product.md 文件保留在文件系统中，在需要前消耗零个上下文 token。这种基于文件系统的模型正是实现渐进式披露的方式。Claude 可以导航并有选择地加载每个任务所需的精确内容。

关于技术架构的完整细节，请参见技能概述中的[技能如何工作](/en/docs/agents-and-tools/agent-skills/overview#how-skills-work)。

### MCP 工具引用

如果你的技能使用 MCP（模型上下文协议）工具，始终使用完全限定的工具名称以避免“工具未找到”错误。

**格式**：`ServerName:tool_name`

**示例**：

```markdown  theme={null}
Use the BigQuery:bigquery_schema tool to retrieve table schemas.
Use the GitHub:create_issue tool to create issues.
```

其中：

* `BigQuery` 和 `GitHub` 是 MCP 服务器名称
* `bigquery_schema` 和 `create_issue` 是这些服务器内的工具名称

没有服务器前缀，Claude 可能无法定位工具，尤其是在多个 MCP 服务器可用时。

### 避免假设工具已安装

不要假设包可用：

````markdown  theme={null}
**坏示例：假设已安装**：
"Use the pdf library to process the file."

**好示例：明确依赖关系**：
"Install required package: `pip install pypdf`

Then use it:
```python
from pypdf import PdfReader
reader = PdfReader(“file.pdf”)
```"
````

## 技术说明

### YAML 前置元数据要求

SKILL.md 前置元数据需要 `name`（最多 64 字符）和 `description`（最多 1024 字符）字段。完整结构细节见[技能概述](/en/docs/agents-and-tools/agent-skills/overview#skill-structure)。

### Token 预算

保持 SKILL.md 主体在 500 行以内以获得最佳性能。如果你的内容超出此限制，使用之前描述的渐进式披露模式将其拆分到单独文件。关于架构细节，参见[技能概述](/en/docs/agents-and-tools/agent-skills/overview#how-skills-work)。

## 有效技能清单

分享技能前，验证：

### 核心质量

* [ ] description 具体且包含关键术语
* [ ] description 同时包含技能做什么和何时使用
* [ ] SKILL.md 主体在 500 行以内
* [ ] 附加详情在单独文件中（如需要）
* [ ] 无时间敏感信息（或在“旧模式”章节）
* [ ] 全文术语一致
* [ ] 示例具体而非抽象
* [ ] 文件引用保持一层深度
* [ ] 恰当使用渐进式披露
* [ ] 工作流有清晰的步骤

### 代码与脚本

* [ ] 脚本解决问题而非推给 Claude
* [ ] 错误处理明确且有用
* [ ] 无“巫毒常数”（所有值有合理说明）
* [ ] 所需包已在指令中列出并验证可用
* [ ] 脚本有清晰的文档
* [ ] 无 Windows 风格路径（全部使用正斜杠）
* [ ] 关键操作有验证/确认步骤
* [ ] 质量关键任务包含反馈循环

### 测试

* [ ] 至少创建了三个评估
* [ ] 已在 Haiku、Sonnet 和 Opus 上测试
* [ ] 已使用真实使用场景测试
* [ ] 已纳入团队反馈（如适用）

## 后续步骤

<CardGroup cols={2}>
  <Card title=“Agent Skills 入门” icon=“rocket” href=“/en/docs/agents-and-tools/agent-skills/quickstart”>
    创建你的第一个技能
  </Card>

  <Card title=“在 Claude Code 中使用技能” icon=“terminal” href=“/en/docs/claude-code/skills”>
    在 Claude Code 中创建和管理技能
  </Card>

  <Card title=“通过 API 使用技能” icon=“code” href=“/en/api/skills-guide”>
    以编程方式上传和使用技能
  </Card>
</CardGroup>
