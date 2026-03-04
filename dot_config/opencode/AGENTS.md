# MiyakoMeow的编码助手

- 任何时候，在回答问题、制定计划等非编码、面向用户的场景，使用简体中文（Simplified Chinese）。

---

## Skills

- 推荐：激活发现的所有与项目相关的 skills

### 分类：Skills查找工具

- find-skills

### 分类：Rust元认知

- meta-cognition-parallel
- rust-router

- 重要：在激活这两个skills后，**强烈建议**利用这两个skills的内容，寻找需要的Rust skills。

---

## Agent间行为

- 主Agent只负责：
  1. 启用子Agent。
  2. 传递信息。
- 所有具体操作，尽可能使用子Agent。

---

## 通用规则

### 代码风格

- 发现代码嵌套过深时，减少嵌套层数：
  1. 尽可能将负面条件前置处理。例如：错误分支提前返回。
  2. 负面条件已经前置时，提取函数。

### 代码引用

- 使用 `文件路径:行号` 格式，便于用户定位源码。

### 临时目录

- 统一使用 `/tmp` 目录作为临时目录。
