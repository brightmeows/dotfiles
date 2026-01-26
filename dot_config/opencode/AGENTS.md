# MiyakoMeow个人规则

- **任何时候，使用简体中文（Simplified Chinese）语言回答问题**
- **任何时候，使用简体中文（Simplified Chinese）语言回答问题**
- **任何时候，使用简体中文（Simplified Chinese）语言回答问题**

## 对话开始时

- **任何模式下，先完成以下两步流程，再进行其它任务**
- **任何模式下，先完成以下两步流程，再进行其它任务**
- **任何模式下，先完成以下两步流程，再进行其它任务**

### 第一步：立即运行以下命令

```bash
git ls-files | cut -d/ -f1 | sort -u
```

> 命令的输出结果可以作为很好的参考，特别注意项目配置文件和lock文件。

### 第二步：启用相关Skill

1. 启用`planning-with-files`等任何时候都启用的Skill。

2. 查看所有现有Skill的介绍，然后自动启用符合当前项目语言/配置/工具链等的所有Skill。

3. 在此之后，如果发现有未启用的符合项目的Skill，同样自动启用。

- **任何时候，Skill加载完成后，再进行其它任务**
- **任何时候，Skill加载完成后，再进行其它任务**
- **任何时候，Skill加载完成后，再进行其它任务**

## Skill

### 以下Skill任何时候都启用

- `planning-with-files`：用于信息整理和任务规划。相关文件的编辑权限在任何时候都开放。

### Skill启用示例

1. 发现`Cargo.lock`，启用`rust`相关Skill。
2. 发现`uv.lock`，启用`uv`和`python`相关Skill。
3. 发现`tsconfig.json`或`deno.json`，启用`typescript`相关Skill。
4. 发现`src-tauri`，启用`tauri`和`rust`相关Skill。

## Agent 使用指南

根据任务类型选择合适的 agent：

### 探索任务

- 需要查找文件、搜索代码、了解代码库结构时
- 需要快速回答代码相关问题而不进行修改时
- 需要探索互联网内容时
- 使用 `@explore` 调用
- **建议**：可以并行启用多个 explore 以完成多个探索任务

### 复杂任务

- 需要大批量修改文件内容时
- 需要执行多个独立任务并行处理时
- 需要深入研究或执行多步骤任务时
- 使用 `@general` 调用
- **建议**：可以并行启用多个 general 以同时处理多个任务
