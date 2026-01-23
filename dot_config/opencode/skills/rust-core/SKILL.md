---
name: rust-core
version: "0.0.1"
description: Comprehensive Rust development guide covering ownership system, error handling, and modern best practices. Should be triggered when meets project with rust code or cargo config.
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

生成安全、高效、符合 Rust 社区惯例的生产级代码，严格遵循所有权、借用、错误处理和 Clippy。涵盖完整的 Rust 开发指南，包括所有权系统、错误处理和现代最佳实践。

## 触发条件

任务包含 "Rust" "ownership" "borrow" "error" "memory" "async" "trait" 等关键词。

## 工作流程

1. **分析需求**：明确所有权流转、借用关系、生命周期和错误处理策略。
   - 识别数据流向和所有权转移点
   - 确定错误处理边界和传播策略

2. **优先所有权转移**：避免不必要 clone。
   - 正例：`fn process(s: String) -> String { s }`（直接转移所有权）
   - 反例：`fn process(s: &String) -> String { s.clone() }`（不必要的克隆）

3. **trait 界定使用 where 子句**：提升可读性。
   - 正例：
     ```rust
     fn process<T, U>(t: T, u: U) -> impl Trait
     where
         T: Bound1 + Bound2,
         U: Bound3,
     ```
   - 反例：
     ```rust
     fn process<T: Bound1 + Bound2, U: Bound3>(t: T, u: U) -> impl Trait
     ```

4. **错误处理使用 thiserror 定义，`?` 操作符传播**。
   - 正例：`fn read_file(path: &str) -> Result<String, io::Error> { File::open(path)?.read_to_string() }`
   - 反例：`fn read_file(path: &str) -> Result<String, io::Error> { match File::open(path) { Ok(f) => f.read_to_string(), Err(e) => return Err(e) } }`

5. **异步函数正确 .await，pin 投影谨慎**。
   - 正例：`async fn fetch() -> Result<Data> { reqwest::get(url).await?.json().await }`
   - 反例：`async fn fetch() -> Data { reqwest::get(url).await.unwrap().json().await.unwrap() }`

6. **公共 API 完整文档注释，私有实现隐藏**。
   - 正例：
     ```rust
     /// Processes the input data and returns the result.
     /// # Errors
     /// Returns an error if processing fails.
     pub fn process(input: Input) -> Result<Output> { /* implementation */ }
     ```
   - 反例：`pub fn process(input: Input) -> Result<Output> { /* no docs */ }`

7. **输出完整代码 + Cargo.toml + tests + benches + doc tests**。
   - 包含所有必要的文件和测试
   - 确保代码可编译和测试通过

## 最佳实践

### 项目配置

- **使用 `cargo add` 管理依赖**
  - 正例：`cargo add serde --features json`（显式添加依赖和特性）
  - 反例：手动编辑 Cargo.toml（容易出错）

- **Clippy pedantic 全开**
  - 正例：Cargo.toml 中设置 `[lints.clippy] pedantic = "warn"`（启用所有 clippy 检查）
  - 反例：忽略 clippy 警告（可能隐藏代码质量问题）

- **`src` 目录下禁止使用 `mod.rs`**
  - 正例：`src/lib.rs` 和 `src/main.rs`（现代 Rust 项目结构）
  - 反例：`src/mod.rs`（旧式模块声明，已弃用）

### 代码编辑

- **避免 unsafe，如必须则模块隔离**
  - 正例：
    ```rust
    #[cfg(feature = "unsafe")]
    mod unsafe_module {
        unsafe fn dangerous() { /* FFI 调用 */ }
    }
    ```
  - 反例：散布 unsafe 块在代码中（难以审查）

- **测试使用 #[should_panic] 和 doc test**
  - 正例：
    ```rust
    #[test]
    #[should_panic(expected = "divide by zero")]
    fn test_divide_by_zero() { divide(1.0, 0.0); }

    /// ```rust
    /// assert_eq!(add(2, 3), 5);
    /// ```
    fn add(a: i32, b: i32) -> i32 { a + b }
    ```
  - 反例：只用 assert! 而不测试错误情况

- **将文件开头的 use 语句拆分成三个部分**
  - 正例：
    ```rust
    use std::collections::HashMap;
    use std::io;

    use serde::{Deserialize, Serialize};

    use crate::models::User;
    ```
  - 反例：
    ```rust
    use std::collections::HashMap;
    use serde::{Deserialize, Serialize};
    use crate::models::User;
    use std::io;
    ```（混合顺序）

- **使用迭代器、`Option::or`、`Result::map` 等链式语法**
  - 正例：`let result = vec.iter().filter(|&x| x > &5).map(|x| x * 2).collect();`
  - 反例：
    ```rust
    let mut result = Vec::new();
    for x in &vec {
        if x > &5 {
            result.push(x * 2);
        }
    }
    ```（命令式风格）

- **使用 `let-else` 或 `match-return` 等语法，提前返回负面条件**
  - 正例：
    ```rust
    fn process(option: Option<i32>) -> i32 {
        let Some(value) = option else { return 0; };
        value * 2
    }
    ```
  - 反例：
    ```rust
    fn process(option: Option<i32>) -> i32 {
        if let Some(value) = option {
            value * 2
        } else {
            0
        }
    }
    ```（嵌套 if-let）

### 代码文档

- **所有公共项必须有 /// 文档**
  - 正例：
    ```rust
    /// Calculates the sum of two numbers.
    /// # Arguments
    /// * `a` - First number
    /// * `b` - Second number
    /// # Returns
    /// The sum of `a` and `b`
    pub fn add(a: i32, b: i32) -> i32 { a + b }
    ```
  - 反例：`pub fn add(a: i32, b: i32) -> i32 { a + b }`（无文档）

- **所有模块必须使用 //! 文档**
  - 正例：
    ```rust
    //! This module provides mathematical utilities.
    mod math {
        // ...
    }
    ```
  - 反例：`mod math { /* no docs */ }`（无模块文档）

### 完成后测试验证

- **运行完整验证命令**
  - 正例：
    ```bash
    cargo clippy --fix --allow-dirty --all-targets --all-features --message-format=short -- -D warnings && cargo test --quiet --all-targets --all-features --message-format=short && cargo test --quiet --doc --all-features --message-format=short && cargo fmt
    ```
  - 反例：只运行 `cargo build`（不检查代码质量和测试）

- **补全文档注释缺失警告**
  - 正例：看到 clippy 警告后立即添加文档
  - 反例：忽略文档警告，提交无文档代码

- **尽可能避免使用 `#[allow(xxx)]` 等 linter**
  - 正例：修复 linter 警告而不是忽略
  - 反例：`#[allow(clippy::pedantic)]`（掩盖代码质量问题）

## 所有权最佳实践

### 正例/反例

- **优先借用而不是所有权转移**
  - 正例：`fn process(data: &str) -> &str { data }`（借用输入，避免所有权转移）
  - 反例：`fn process(data: String) -> String { data }`（所有权转移，可能导致不必要克隆）

- **默认使用不可变借用，只在需要时使用可变借用**
  - 正例：`fn calculate_length(s: &String) -> usize { s.len() }`
  - 反例：`fn calculate_length(s: &mut String) -> usize { s.len() }`（不必要地要求可变借用）

- **保持借用作用域尽可能小**
  - 正例：
    ```rust
    {
        let r = &s; // 借用开始
        println!("{}", r);
    } // 借用结束，可再次借用
    let w = &mut s; // 现在可以可变借用
    ```
  - 反例：
    ```rust
    let r = &s; // 借用开始
    // ... 很多代码 ...
    let w = &mut s; // 错误：不可变借用仍在作用域内
    ```

- **当编译器可以推断生命周期时使用生命周期省略**
  - 正例：`fn first_word(s: &str) -> &str { s.split_whitespace().next().unwrap_or("") }`
  - 反例：`fn first_word<'a>(s: &'a str) -> &'a str { s.split_whitespace().next().unwrap_or("") }`（不必要的显式生命周期）

- **为用例选择合适的智能指针**
  - 正例：使用 `Box<T>` 用于递归类型或大型数据
  - 反例：对简单数据使用 `Box<T>` 而不是直接栈分配

- **在性能关键代码中避免 RefCell**
  - 正例：使用 `Rc<RefCell<T>>` 仅在必要时
  - 反例：在热点路径中大量使用 RefCell，导致运行时借用检查开销

- **在函数签名中使用切片而不是拥有类型**
  - 正例：`fn process_data(data: &[i32]) -> i32`
  - 反例：`fn process_data(data: Vec<i32>) -> i32`（强制调用者转移所有权）

- **只在必要时克隆（它是显式的和可见的）**
  - 正例：`let cloned = expensive_data.clone(); // 明确表示克隆成本`
  - 反例：隐式克隆通过所有权转移而非显式 `.clone()`

- **为自定义清理逻辑实现 Drop**
  - 正例：
    ```rust
    impl Drop for CustomResource {
        fn drop(&mut self) {
            // 清理逻辑
        }
    }
    ```
  - 反例：手动调用清理函数，忘记清理导致资源泄漏

- **让编译器通过借用检查器错误引导你**
  - 正例：遵循编译器建议重构代码以修复所有权问题
  - 反例：使用 `unsafe` 绕过所有权检查而不了解风险

### 常见陷阱

- **移动值后尝试使用它**
  - 陷阱：`let s1 = String::from("hello"); let s2 = s1; println!("{}", s1);`
  - 避免：理解所有权转移后不再使用原值

- **同时创建多个可变借用**
  - 陷阱：`let mut s = String::from("hello"); let r1 = &mut s; let r2 = &mut s;`
  - 避免：一次只允许一个可变借用

- **混合可变和不可变借用**
  - 陷阱：`let mut s = String::from("hello"); let r1 = &s; let r2 = &mut s;`
  - 避免：不可变借用期间不能可变借用

- **返回局部变量的引用**
  - 陷阱：`fn bad() -> &str { let s = String::from("hello"); &s }`
  - 避免：返回拥有的值或静态引用

- **与借用检查器斗争而不是理解它**
  - 陷阱：反复尝试不同方式绕过编译错误
  - 避免：学习所有权规则，让编译器引导正确设计

- **过度使用 clone() 避免所有权问题**
  - 陷阱：`data.clone()` 在循环中导致性能问题
  - 避免：重构为借用或重新设计数据流

- **不理解生命周期关系**
  - 陷阱：错误生命周期注解导致过度限制或编译错误
  - 避免：从小示例学习生命周期推理规则

- **使用 Rc 的循环引用**
  - 陷阱：`Rc` 相互引用导致内存泄漏
  - 避免：使用 `Weak` 指针打破循环

- **在运行时因 RefCell 借用违规而 panic**
  - 陷阱：`RefCell` 运行时借用检查失败
  - 避免：仔细管理借用作用域

- **错误使用 'static 生命周期**
  - 陷阱：将临时数据标记为 `'static`
  - 避免：只对真正静态数据使用 `'static`

## 错误处理最佳实践

### 正例/反例

- **对可恢复错误使用 Result，对不可恢复错误使用 panic**
  - 正例：`fn divide(a: f64, b: f64) -> Result<f64, String> { if b == 0.0 { Err("Division by zero".to_string()) } else { Ok(a / b) } }`
  - 反例：`fn divide(a: f64, b: f64) -> f64 { if b == 0.0 { panic!("Division by zero") } else { a / b } }`（使用 panic 处理可恢复错误）

- **在应用程序中使用 anyhow::Context 提供上下文**
  - 正例：`file.read_to_string(&mut contents).context("Failed to read config file")?;`
  - 反例：`file.read_to_string(&mut contents)?;`（丢失上下文信息）

- **对库错误类型使用 thiserror**
  - 正例：
    ```rust
    use thiserror::Error;
    #[derive(Error, Debug)]
    pub enum MyError {
        #[error("IO error: {0}")]
        Io(#[from] std::io::Error),
    }
    ```
  - 反例：手动实现 Display 和 Error trait，容易出错

- **为自定义错误实现 Display 和 Error trait**
  - 正例：
    ```rust
    impl std::fmt::Display for MyError {
        fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(f, "Error: {}", self.message)
        }
    }
    impl std::error::Error for MyError {}
    ```
  - 反例：没有实现这些 trait，导致错误信息不清晰

- **使用 ? 操作符进行错误传播**
  - 正例：`fn read_file(path: &str) -> Result<String, io::Error> { let mut file = File::open(path)?; Ok(file.read_to_string()?) }`
  - 反例：`fn read_file(path: &str) -> Result<String, io::Error> { match File::open(path) { Ok(f) => match f.read_to_string() { Ok(s) => Ok(s), Err(e) => Err(e) }, Err(e) => Err(e) } }`（冗长）

- **在生产代码中避免 unwrap/expect**
  - 正例：`let value = optional.unwrap_or_default();`
  - 反例：`let value = optional.expect("This should never be None");`（可能导致生产环境 panic）

- **返回错误而不是记录日志并继续**
  - 正例：`fn process() -> Result<(), Error> { file_operation().map_err(|e| Error::from(e)) }`
  - 反例：`fn process() { if let Err(e) = file_operation() { log::error!("Error: {}", e); } }`（吞掉错误）

- **使错误消息可操作且描述性**
  - 正例：`Err("File not found: check if 'config.toml' exists and is readable")`
  - 反例：`Err("Error")`（无用信息）

- **使用类型系统在编译时防止错误**
  - 正例：`struct NonEmptyString(String);`（防止空字符串）
  - 反例：`fn process(s: String) { assert!(!s.is_empty()); }`（运行时检查）

- **在函数文档中记录预期错误**
  - 正例：
    ```rust
    /// Returns the parsed number.
    /// # Errors
    /// Returns `ParseError` if the string is not a valid number.
    fn parse_number(s: &str) -> Result<i32, ParseError>
    ```
  - 反例：无文档说明可能返回哪些错误

### 常见陷阱

- **在生产中过度使用 unwrap() 导致 panic**
  - 陷阱：`let value = result.unwrap();`
  - 避免：使用 `?` 或适当的错误处理

- **错误消息中没有提供足够上下文**
  - 陷阱：`Err("Failed")`
  - 避免：使用 `anyhow::Context` 或详细错误类型

- **不一致地混合使用 panic 和 Result**
  - 陷阱：有些地方用 `panic!`，有些地方返回 `Result`
  - 避免：为每个错误决定是可恢复还是不可恢复

- **创建过于通用的错误类型（String）**
  - 陷阱：`Result<T, String>`
  - 避免：创建特定的错误枚举

- **未实现 From 用于错误转换**
  - 陷阱：手动转换错误类型
  - 避免：实现 `From` trait 进行自动转换

- **使用 let _ = result 忽略错误**
  - 陷阱：`let _ = file_operation();`
  - 避免：总是处理错误或显式忽略

- **当 Option 更合适时使用 Result**
  - 陷阱：`Result<T, ()>` 用于可选值
  - 避免：使用 `Option<T>` 表示不存在

- **在 match 中未处理所有错误变体**
  - 陷阱：`match result { Ok(v) => ..., Err(_) => panic!() }`
  - 避免：处理或传播所有错误情况

- **创建难以使用的错误类型**
  - 陷阱：深层嵌套的错误类型
  - 避免：保持错误类型简单且组合性好

- **忘记将错误传播到调用栈上方**
  - 陷阱：捕获错误但不返回
  - 避免：使用 `?` 或明确返回错误
