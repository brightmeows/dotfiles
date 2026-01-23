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

1. 分析需求：明确所有权流转、借用关系、生命周期和错误处理策略。
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

## 所有权系统

掌握 Rust 独特的通过编译时检查提供内存安全而无需垃圾回收的所有权系统。

### 所有权规则

**三个基本的所有权规则：**

1. Rust 中的每个值都有一个变量作为其所有者
2. 一次只能有一个所有者
3. 当所有者超出作用域时，该值被丢弃

```rust
fn ownership_basics() {
    // s owns the String
    let s = String::from("hello");

    // Ownership moved to s2
    let s2 = s;

    // Error: s no longer owns the value
    // println!("{}", s);

    println!("{}", s2); // OK
} // s2 dropped here, memory freed
```

### 移动语义

**所有权转移（移动）：**

```rust
fn move_semantics() {
    let s1 = String::from("hello");

    // 所有权移动到函数
    takes_ownership(s1);

    // 错误：s1 不再有效
    // println!("{}", s1);
}

fn takes_ownership(s: String) {
    println!("{}", s);
} // s 在此处被丢弃

// 从函数返回所有权
fn gives_ownership() -> String {
    String::from("hello")
}

fn main() {
    let s = gives_ownership();
    println!("{}", s);
}
```

**栈类型的 Copy trait：**

```rust
fn copy_types() {
    // 实现 Copy 的类型被复制，而不是移动
    let x = 5;
    let y = x; // x 复制到 y

    println!("x: {}, y: {}", x, y); // 两者都有效

    // Copy 类型：整数、浮点、bool、char、Copy 类型的元组
    let tuple = (1, 2.5, true);
    let tuple2 = tuple;
    println!("{:?} {:?}", tuple, tuple2); // 两者都有效
}
```

### 借用

**不可变借用（引用）：**

```rust
fn immutable_borrow() {
    let s1 = String::from("hello");

    // 借用 s1（不可变引用）
    let len = calculate_length(&s1);

    println!("Length of '{}' is {}", s1, len); // s1 仍然有效
}

fn calculate_length(s: &String) -> usize {
    s.len()
} // s 超出作用域，但不丢弃值

// 允许多个不可变借用
fn multiple_immutable_borrows() {
    let s = String::from("hello");

    let r1 = &s;
    let r2 = &s;
    let r3 = &s;

    println!("{}, {}, {}", r1, r2, r3); // OK
}
```

**可变借用：**

```rust
fn mutable_borrow() {
    let mut s = String::from("hello");

    // 可变借用
    change(&mut s);

    println!("{}", s); // "hello, world"
}

fn change(s: &mut String) {
    s.push_str(", world");
}

// 一次只允许一个可变借用
fn mutable_borrow_rules() {
    let mut s = String::from("hello");

    let r1 = &mut s;
    // let r2 = &mut s; // 错误：不能两次可变借用

    println!("{}", r1);
}

// 不能混合可变和不可变借用
fn no_mix_borrows() {
    let mut s = String::from("hello");

    let r1 = &s;     // 不可变借用
    let r2 = &s;     // 另一个不可变借用
    // let r3 = &mut s; // 错误：在不可变借用时不能可变借用

    println!("{} {}", r1, r2);
}
```

**非词法生命周期（NLL）：**

```rust
fn non_lexical_lifetimes() {
    let mut s = String::from("hello");

    let r1 = &s;
    let r2 = &s;
    println!("{} {}", r1, r2);
    // r1 和 r2 在此点之后不再使用

    // OK：不可变借用结束
    let r3 = &mut s;
    println!("{}", r3);
}
```

### 生命周期

**生命周期注解：**

```rust
// 生命周期 'a 确保返回的引用与两个输入一样长寿
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() {
        x
    } else {
        y
    }
}

fn main() {
    let string1 = String::from("long string");
    let string2 = String::from("short");

    let result = longest(&string1, &string2);
    println!("Longest: {}", result);
}
```

**结构体中的生命周期：**

```rust
// 结构体持有引用，需要生命周期注解
struct ImportantExcerpt<'a> {
    part: &'a str,
}

impl<'a> ImportantExcerpt<'a> {
    fn level(&self) -> i32 {
        3
    }

    fn announce_and_return_part(&self, announcement: &str) -> &str {
        println!("Attention: {}", announcement);
        self.part
    }
}

fn main() {
    let novel = String::from("Call me Ishmael. Some years ago...");
    let first_sentence = novel.split('.').next().unwrap();

    let excerpt = ImportantExcerpt {
        part: first_sentence,
    };

    println!("{}", excerpt.part);
}
```

**Lifetime elision rules:**

```rust
// Compiler infers lifetimes in these cases:

// Rule 1: Each reference parameter gets its own lifetime
fn first_word(s: &str) -> &str {
    // Expanded: fn first_word<'a>(s: &'a str) -> &'a str
    s.split_whitespace().next().unwrap_or("")
}

// Rule 2: If one input lifetime, assign to all outputs
fn foo(s: &str) -> &str {
    s
}

// Rule 3: If &self or &mut self, its lifetime assigned to outputs
impl<'a> ImportantExcerpt<'a> {
    fn get_part(&self) -> &str {
        // Expanded: fn get_part<'a>(&'a self) -> &'a str
        self.part
    }
}
```

**Static lifetime:**

```rust
// 'static means reference lives for entire program duration
fn static_lifetime() -> &'static str {
    "This string is stored in binary"
}

// String literals have 'static lifetime
let s: &'static str = "hello world";
```

### Smart Pointers

**Box for heap allocation:**

```rust
fn box_pointer() {
    // Allocate value on heap
    let b = Box::new(5);
    println!("b = {}", b);
} // b deallocated when out of scope

// Recursive types require Box
enum List {
    Cons(i32, Box<List>),
    Nil,
}

use List::{Cons, Nil};

fn recursive_type() {
    let list = Cons(1, Box::new(Cons(2, Box::new(Cons(3, Box::new(Nil))))));
}
```

**Rc for reference counting:**

```rust
use std::rc::Rc;

fn rc_example() {
    let a = Rc::new(5);

    // Clone Rc pointer, increment count
    let b = Rc::clone(&a);
    let c = Rc::clone(&a);

    println!("Reference count: {}", Rc::strong_count(&a)); // 3

    // All owners must go out of scope before value is dropped
}

// Sharing data in graph structures
enum RcList {
    Cons(i32, Rc<RcList>),
    Nil,
}

use RcList::{Cons as RcCons, Nil as RcNil};

fn shared_ownership() {
    let a = Rc::new(RcCons(5, Rc::new(RcCons(10, Rc::new(RcNil)))));

    // b and c both reference a
    let b = RcCons(3, Rc::clone(&a));
    let c = RcCons(4, Rc::clone(&a));
}
```

**RefCell for interior mutability:**

```rust
use std::cell::RefCell;

fn refcell_example() {
    let value = RefCell::new(5);

    // Borrow mutably
    *value.borrow_mut() += 1;

    // Borrow immutably
    println!("Value: {}", value.borrow());
}

// Combine Rc and RefCell for shared mutable data
use std::rc::Rc;
use std::cell::RefCell;

fn rc_refcell() {
    let value = Rc::new(RefCell::new(5));

    let a = Rc::clone(&value);
    let b = Rc::clone(&value);

    *a.borrow_mut() += 10;
    *b.borrow_mut() += 20;

    println!("Value: {}", value.borrow()); // 35
}
```

### 所有权最佳实践

- 尽可能优先借用而不是所有权转移
- 默认使用不可变借用，只在需要时使用可变借用
- 保持借用作用域尽可能小
- 当编译器可以推断生命周期时使用生命周期省略
- 为用例选择合适的智能指针
- 在性能关键代码中避免 RefCell
- 在函数签名中使用切片而不是拥有类型
- 只在必要时克隆（它是显式的和可见的）
- 为自定义清理逻辑实现 Drop
- 让编译器通过借用检查器错误引导你

## 错误处理

掌握使用 Result、Option、自定义错误类型和流行错误处理库的 Rust 错误处理机制，以构建健壮的应用程序。

### Result 和 Option

**用于可恢复错误的 Result 类型：**

```rust
// Result<T, E> 用于可能失败的操作
fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 {
        Err(String::from("Division by zero"))
    } else {
        Ok(a / b)
    }
}

fn main() {
    match divide(10.0, 2.0) {
        Ok(result) => println!("Result: {}", result),
        Err(e) => println!("Error: {}", e),
    }
}
```

**用于可选值的 Option 类型：**

```rust
fn find_user(id: u32) -> Option<String> {
    if id == 1 {
        Some(String::from("Alice"))
    } else {
        None
    }
}

fn main() {
    match find_user(1) {
        Some(name) => println!("Found: {}", name),
        None => println!("User not found"),
    }
}
```

### 使用 ? 操作符的错误传播

**使用 ? 操作符：**

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_file(path: &str) -> Result<String, io::Error> {
    let mut file = File::open(path)?;  // 传播错误
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;  // 传播错误
    Ok(contents)
}

// 不使用 ? 操作符的等价写法
fn read_file_explicit(path: &str) -> Result<String, io::Error> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => return Err(e),
    };

    let mut contents = String::new();
    match file.read_to_string(&mut contents) {
        Ok(_) => Ok(contents),
        Err(e) => Err(e),
    }
}
```

**? 与 Option：**

```rust
fn get_first_char(text: &str) -> Option<char> {
    text.chars().next()
}

fn process_text(text: Option<&str>) -> Option<char> {
    let t = text?;  // 如果 text 为 None 则返回 None
    get_first_char(t)
}
```

### 自定义错误类型

**简单的自定义错误：**

```rust
use std::fmt;

#[derive(Debug)]
struct ParseError {
    message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Parse error: {}", self.message)
    }
}

impl std::error::Error for ParseError {}

fn parse_number(s: &str) -> Result<i32, ParseError> {
    s.parse().map_err(|_| ParseError {
        message: format!("Failed to parse '{}'", s),
    })
}
```

**基于枚举的错误类型：**

```rust
use std::fmt;
use std::io;

#[derive(Debug)]
enum AppError {
    Io(io::Error),
    Parse(String),
    NotFound(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "IO error: {}", e),
            AppError::Parse(msg) => write!(f, "Parse error: {}", msg),
            AppError::NotFound(item) => write!(f, "Not found: {}", item),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        AppError::Io(error)
    }
}

fn process_file(path: &str) -> Result<String, AppError> {
    let content = std::fs::read_to_string(path)?;  // io::Error 自动转换

    if content.is_empty() {
        Err(AppError::NotFound(path.to_string()))
    } else {
        Ok(content)
    }
}
```

### thiserror 库

**安装 thiserror：**

```bash
cargo add thiserror
```

**使用 thiserror 处理自定义错误：**

```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum DataError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Validation failed: {field} is invalid")]
    Validation { field: String },

    #[error("Not found: {0}")]
    NotFound(String),
}

fn validate_user(name: &str) -> Result<(), DataError> {
    if name.is_empty() {
        return Err(DataError::Validation {
            field: "name".to_string(),
        });
    }
    Ok(())
}

fn load_data(path: &str) -> Result<String, DataError> {
    let data = std::fs::read_to_string(path)?;  // 自动转换 io::Error

    if data.is_empty() {
        return Err(DataError::NotFound(path.to_string()));
    }

    Ok(data)
}
```

### anyhow 库

**安装 anyhow：**

```bash
cargo add anyhow
```

**使用 anyhow 处理应用程序错误：**

```rust
use anyhow::{Result, Context, anyhow, bail};

fn read_config(path: &str) -> Result<String> {
    let content = std::fs::read_to_string(path)
        .context("Failed to read config file")?;

    if content.is_empty() {
        bail!("Config file is empty");
    }

    Ok(content)
}

fn process_data(value: i32) -> Result<i32> {
    if value < 0 {
        return Err(anyhow!("Value must be positive, got {}", value));
    }
    Ok(value * 2)
}

fn main() -> Result<()> {
    let config = read_config("config.toml")
        .context("Failed to load configuration")?;

    let value = process_data(42)?;

    println!("Value: {}", value);
    Ok(())
}
```

**anyhow with context chaining:**

```rust
use anyhow::{Result, Context};

fn load_user(id: u32) -> Result<String> {
    fetch_from_database(id)
        .context("Database query failed")?
        .parse()
        .context(format!("Failed to parse user {}", id))
}

fn fetch_from_database(id: u32) -> Result<String> {
    // Implementation
    Ok(format!("user_{}", id))
}
```

### 错误处理最佳实践

- 对可恢复错误使用 Result，对不可恢复错误使用 panic
- 在应用程序中使用 anyhow::Context 提供上下文
- 对库错误类型使用 thiserror
- 为自定义错误实现 Display 和 Error trait
- 使用 ? 操作符进行错误传播
- 在生产代码中避免 unwrap/expect
- 返回错误而不是记录日志并继续
- 使错误消息可操作且描述性
- 使用类型系统在编译时防止错误
- 在函数文档中记录预期错误
