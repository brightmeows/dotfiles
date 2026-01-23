---
name: rust-error-handling
description: Use when Rust error handling with Result, Option, custom errors, thiserror, and anyhow. Use when handling errors in Rust applications.
allowed-tools:
  - Bash
  - Read
---

# Rust 错误处理

掌握使用 Result、Option、自定义错误类型和流行错误处理库的 Rust 错误处理机制，以构建健壮的应用程序。

## Result 和 Option

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

## 使用 ? 操作符的错误传播

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

## 自定义错误类型

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

## thiserror 库

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

**带有源错误的 thiserror：**

```rust
use thiserror::Error;
use std::io;

#[derive(Error, Debug)]
enum ConfigError {
    #[error("Failed to read config file")]
    ReadError {
        #[source]
        source: io::Error,
    },

    #[error("Invalid config format")]
    ParseError {
        #[source]
        source: serde_json::Error,
    },
}
```

## anyhow 库

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

## Error Conversion

**Converting between error types:**

```rust
use std::io;
use std::num::ParseIntError;

enum AppError {
    Io(io::Error),
    Parse(ParseIntError),
}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        AppError::Io(error)
    }
}

impl From<ParseIntError> for AppError {
    fn from(error: ParseIntError) -> Self {
        AppError::Parse(error)
    }
}

fn process() -> Result<i32, AppError> {
    let content = std::fs::read_to_string("file.txt")?;
    let number: i32 = content.trim().parse()?;
    Ok(number)
}
```

## unwrap and expect

**When to use unwrap and expect:**

```rust
fn unwrap_examples() {
    // unwrap: panics with generic message
    let value = Some(42).unwrap();

    // expect: panics with custom message
    let value = Some(42).expect("Value should be present");

    // Only use in:
    // 1. Tests
    // 2. Prototypes
    // 3. When you're certain it won't panic

    // Better: handle the error
    if let Some(value) = get_value() {
        println!("{}", value);
    }
}

fn get_value() -> Option<i32> {
    Some(42)
}
```

## Result Combinators

**Using Result methods:**

```rust
fn combinators() -> Result<i32, String> {
    // map: transform Ok value
    let result = Ok(5).map(|x| x * 2);  // Ok(10)

    // map_err: transform Err value
    let result = Err("error").map_err(|e| format!("Error: {}", e));

    // and_then (flatMap): chain operations
    let result = Ok(5)
        .and_then(|x| Ok(x * 2))
        .and_then(|x| Ok(x + 1));  // Ok(11)

    // or_else: provide alternative on error
    let result = Err("error")
        .or_else(|_| Ok(42));  // Ok(42)

    // unwrap_or: provide default on error
    let value = Err("error").unwrap_or(42);  // 42

    // unwrap_or_else: compute default on error
    let value = Err("error").unwrap_or_else(|_| 42);  // 42

    Ok(value)
}
```

## Option Combinators

**Using Option methods:**

```rust
fn option_combinators() {
    // map: transform Some value
    let result = Some(5).map(|x| x * 2);  // Some(10)

    // and_then (flatMap): chain operations
    let result = Some(5)
        .and_then(|x| Some(x * 2))
        .and_then(|x| Some(x + 1));  // Some(11)

    // or: provide alternative
    let result = None.or(Some(42));  // Some(42)

    // unwrap_or: provide default
    let value = None.unwrap_or(42);  // 42

    // filter: keep only if predicate is true
    let result = Some(5).filter(|x| x > &3);  // Some(5)
    let result = Some(2).filter(|x| x > &3);  // None

    // ok_or: convert Option to Result
    let result: Result<i32, &str> = Some(5).ok_or("error");  // Ok(5)
}
```

## Pattern Matching

**Comprehensive error handling with match:**

```rust
use std::fs::File;
use std::io::ErrorKind;

fn open_file(path: &str) -> File {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => match error.kind() {
            ErrorKind::NotFound => {
                match File::create(path) {
                    Ok(file) => file,
                    Err(e) => panic!("Failed to create file: {:?}", e),
                }
            }
            ErrorKind::PermissionDenied => {
                panic!("Permission denied: {}", path);
            }
            other_error => {
                panic!("Failed to open file: {:?}", other_error);
            }
        },
    };

    file
}
```

**if let for simple cases:**

```rust
fn simple_match(result: Result<i32, String>) {
    // Handle only the success case
    if let Ok(value) = result {
        println!("Got value: {}", value);
    }

    // Handle only the error case
    if let Err(e) = result {
        eprintln!("Error: {}", e);
    }
}
```

## Panic vs Result

**When to panic:**

```rust
// Panic for unrecoverable errors or bugs
fn get_element(index: usize) -> i32 {
    let data = vec![1, 2, 3];

    // Panic if index out of bounds (programmer error)
    data[index]
}

// Use Result for expected errors
fn safe_get_element(index: usize) -> Option<i32> {
    let data = vec![1, 2, 3];
    data.get(index).copied()
}

// Custom panic messages
fn validate_config(value: i32) {
    if value < 0 {
        panic!("Config value must be positive, got {}", value);
    }
}

// Conditional panic
fn debug_only_panic(condition: bool) {
    debug_assert!(condition, "This only panics in debug builds");
}
```

## Error Handling in Tests

**Testing error conditions:**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_success() {
        let result = divide(10.0, 2.0);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5.0);
    }

    #[test]
    fn test_error() {
        let result = divide(10.0, 0.0);
        assert!(result.is_err());
    }

    #[test]
    #[should_panic(expected = "Division by zero")]
    fn test_panic() {
        panic!("Division by zero");
    }

    #[test]
    fn test_with_question_mark() -> Result<(), String> {
        let result = divide(10.0, 2.0)?;
        assert_eq!(result, 5.0);
        Ok(())
    }
}

fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 {
        Err(String::from("Division by zero"))
    } else {
        Ok(a / b)
    }
}
```

## When to Use This Skill

Use rust-error-handling when you need to:

- Handle recoverable errors with Result
- Work with optional values using Option
- Create custom error types for your domain
- Use thiserror for library error types
- Use anyhow for application-level errors
- Propagate errors with the ? operator
- Convert between different error types
- Provide context to errors
- Implement comprehensive error handling
- Write robust error messages for debugging

## 最佳实践

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

## 常见陷阱

- 在生产中过度使用 unwrap() 导致 panic
- 错误消息中没有提供足够上下文
- 不一致地混合使用 panic 和 Result
- 创建过于通用的错误类型（String）
- 未实现 From 用于错误转换
- 使用 let _ = result 忽略错误
- 当 Option 更合适时使用 Result
- 在 match 中未处理所有错误变体
- 创建难以使用的错误类型
- 忘记将错误传播到调用栈上方

## Resources

- [Rust Book - Error Handling](https://doc.rust-lang.org/book/ch09-00-error-handling.html)
- [thiserror Documentation](https://docs.rs/thiserror/)
- [anyhow Documentation](https://docs.rs/anyhow/)
- [Rust By Example - Error Handling](https://doc.rust-lang.org/rust-by-example/error.html)
- [Error Handling Survey](https://blog.burntsushi.net/rust-error-handling/)
