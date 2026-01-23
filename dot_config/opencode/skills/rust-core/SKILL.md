---
name: rust-core
version: "0.0.1"
description: Best practices for Rust projects. Should be triggered when meets project with rust code or cargo config.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - WebSearch
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      hooks:
        - type: command
          command: "echo '[modern-rust-best-practices] Current project state:' && cargo tree --depth 1 2>/dev/null || true && cat Cargo.toml 2>/dev/null | head -10 || true"
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "echo '[modern-rust-best-practices] Code file updated. Remember to run cargo clippy --fix and tests before finalizing.'"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "echo '[modern-rust-best-practices] Cargo command executed. Verify all checks pass with the complete validation command.'"
  Stop:
    - hooks:
        - type: command
          command: |
            echo '[modern-rust-best-practices] Performing final validation...'
            if [ -f Cargo.toml ]; then
              echo "Running full Rust validation suite:"
              cargo clippy --all-targets --all-features -D warnings 2>/dev/null | head -10 || true
              cargo test --all-targets --all-features --quiet 2>/dev/null | head -5 || true
              echo "Validation complete. Review any warnings/errors above."
            fi
---

# 技能名称：现代 Rust 最佳实践（2024 Edition）

## 描述

生成安全、高效、符合 Rust 社区惯例的生产级代码，严格遵循所有权、借用和 Clippy。

## 触发条件

任务包含 "Rust" "ownership" "borrow" "async" "trait" "error" 等关键词。

## 工作流程

1. 分析需求：明确所有权流转、借用关系、生命周期。
2. 优先所有权转移，避免不必要 clone。
3. trait 界定使用 where 子句提升可读性。
4. 错误处理使用 thiserror 定义，`?` 操作符传播。
5. 异步函数正确 .await，pin 投影谨慎。
6. 公共 API 完整文档注释，私有实现隐藏。
7. 输出完整代码 + Cargo.toml + tests + benches + doc tests。

## 最佳实践

### 项目配置

- 使用`cargo add`管理依赖。
- Clippy pedantic 全开。
- `src`目录下禁止使用`mod.rs`。

### 代码编辑

- 避免 unsafe，如必须则模块隔离。
- 测试使用 #[should_panic] 和 doc test。
- 将文件开头的use语句拆分成三个部分：标准库 -> 三方crate -> 本地引用，每部分用空行隔开。
- 使用迭代器、`Option::or`、`Result::map`等链式语法。
- 使用`let-else`或`match-return`等语法，提前返回负面条件，避免代码嵌套过深。

### 代码文档

- 所有公共项必须有 /// 文档。
- 所有模块必须使用 //! 文档。

### 完成后测试验证

- 将以下命令合为一行，并运行：

```bash
cargo clippy --fix --allow-dirty --all-targets --all-features --message-format=short -- -D warnings 
cargo test --quiet --all-targets --all-features --message-format=short 
cargo test --quiet --doc --all-features --message-format=short
cargo fmt
```

- `--all-targets`和`--all-features`参数，可在需要测试特定feature/target时移除。`--message-format=short`参数，可在需要详细警告/错误信息时移除。

- 对于文档注释缺失警告，必须补全文档注释。
- 尽可能避免使用`#[allow(xxx)]`等linter。
