# Claude 搜索优化（CSO）——详细参考

> writing-skills 技能 `## Claude 搜索优化（CSO）` 章节的完整参考。SKILL.md 仅保留核心原则与最简好坏对照，需要关键词覆盖、命名、Token 效率、交叉引用的完整规则与好坏示例时读本文件。

**对发现性至关重要：** 未来的 Claude 需要找到你的技能。

## 1. 丰富的描述字段

**目的：** Claude 通过读取描述来决定为给定任务加载哪些技能。让它能回答：“我现在应该读这个技能吗？”

**格式：** 以 “Use when...” 开头以聚焦触发条件

**关键：描述 = 何时使用，而非技能做什么**

描述应仅描述触发条件。不要在描述中总结技能的过程或工作流。

**为何重要：** 测试发现，当描述总结了技能的工作流时，Claude 可能只会跟随描述而不读取完整的技能内容。写有“任务间代码审查”的描述导致 Claude 只做了一次审查，尽管技能的流程图清楚显示了两次审查（规范合规→代码质量）。

当描述改为仅写“在执行含独立任务的实施计划时使用”（无工作流总结），Claude 正确读取了流程图并遵循了两阶段的审查流程。

**陷阱：** 总结工作流的描述为 Claude 创建了快捷路径。技能主体成了 Claude 跳过的文档。

```yaml
# 坏：总结了工作流——Claude 可能跟随它而不是阅读技能
description: 在执行计划时使用——按任务分发 subagent，任务间进行代码审查

# 坏：过程细节过多
description: 用于 TDD——先写测试，观察失败，编写最简代码，重构

# 好：仅触发条件，无工作流总结
description: 在当前会话中执行含独立任务的实施计划时使用

# 好：仅触发条件
description: 在实现任何功能或修复 bug 时、编写实现代码前使用
```

**内容：**
- 使用具体的触发器、症状和表明该技能适用的情况
- 描述*问题本身*（竞态条件、不一致行为）而非*语言特定症状*（setTimeout、sleep）
- 除非技能本身是技术特定的，否则保持触发器与技术无关
- 如果技能是技术特定的，在触发器中明确说明
- 以第三人称编写（注入到系统提示词中）
- **绝不总结技能的过程或工作流**

```yaml
# 坏：过于抽象、模糊、不包含何时使用
description: 用于异步测试

# 坏：第一人称
description: 我可以在异步测试不稳定时帮助你

# 坏：提到了技术但技能并非针对该技术
description: 在测试使用 setTimeout/sleep 且不稳定时使用

# 好：以“在……时使用”开头、描述问题、无工作流
description: 在测试存在竞态条件、时间依赖或通过/失败不一致时使用

# 好：技术特定技能，含明确触发器
description: 在使用 React Router 处理认证重定向时使用
```

## 2. 关键词覆盖

使用 Claude 会搜索的词：
- 错误信息：“Hook timed out”、“ENOTEMPTY”、“race condition”
- 症状：“flaky”、“hanging”、“zombie”、“pollution”
- 同义词：“timeout/hang/freeze”、“cleanup/teardown/afterEach”
- 工具：实际命令、库名、文件类型

## 3. 描述性命名

**使用主动语态，动词优先：**
- `creating-skills` 而非 `skill-creation`
- `condition-based-waiting` 而非 `async-test-helpers`

**按你做什么或核心洞察来命名：**
- `condition-based-waiting` > `async-test-helpers`
- `using-skills` 而非 `skill-usage`
- `flatten-with-flags` > `data-structure-refactoring`
- `root-cause-tracing` > `debugging-techniques`

**动名词（-ing）描述过程效果好：**
- `creating-skills`、`testing-skills`、`debugging-with-logs`

## 4. Token 效率（关键）

**问题：** 入门指南和频繁引用的技能会加载到每一次对话中。每个 token 都很重要。

**目标字数：**
- 入门指南工作流：每个 <150 词
- 频繁加载的技能：总计 <200 词
- 其他技能：<500 词（仍需简洁）

**技巧：**

**将细节移至工具帮助：**
```bash
# 坏：在 SKILL.md 中记录所有参数
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# 好：引用 --help
search-conversations supports multiple modes and filters. Run --help for details.
```

**使用交叉引用：**
```markdown
# 坏：重复工作流细节
搜索时，用模板分发 subagent……
[20 行重复指令]

# 好：引用其他技能
始终使用 subagent（节省 50-100 倍上下文）。必须：使用 [其他技能名称] 执行工作流。
```

**压缩示例：**
```markdown
# 坏：臃肿的示例（42 词）
人类伙伴：“我们之前是怎么处理 React Router 中的认证错误的？”
你：我来搜索过往对话中 React Router 的认证模式。
[分发 subagent，搜索查询：“React Router authentication error handling 401”]

# 好：最简示例（20 词）
伙伴：“React Router 的 auth 错误之前怎么处理的？”
你：正在搜索……
[分发 subagent → 综合]
```

**消除冗余：**
- 不要重复交叉引用技能中的内容
- 不要解释命令本身显而易见的内容
- 不要包含同一模式的多个示例

**验证：**
```bash
wc -w skills/path/SKILL.md
# 入门指南工作流：每个目标 <150 词
# 其他频繁加载的：目标 <200 总计
```

## 5. 交叉引用其他技能

**编写引用其他技能的文档时：**

区分本地与外部技能，并加明确要求标记：

- 好：本地同级技能用相对路径链接 + 必须激活标记——`**必须先激活 [test-driven-development](../test-driven-development/SKILL.md)**`
- 好：外部命名空间技能用技能名 + 必须理解标记——`**必需背景：** 你 MUST 理解 superpowers:systematic-debugging`
- 坏：`@skills/testing/test-driven-development/SKILL.md`（强制加载，浪费上下文）

**为什么不用 @ 链接：** `@` 语法会立即强制加载文件，在你需要之前就消耗 200k+ 上下文。相对路径的 Markdown 链接仅作引用，不触发加载。
