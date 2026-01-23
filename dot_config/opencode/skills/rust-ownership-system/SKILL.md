---
name: rust-ownership-system
description: Use when Rust's ownership system including ownership rules, borrowing, lifetimes, and memory safety. Use when working with Rust memory management.
allowed-tools:
  - Bash
  - Read
---

# Rust 所有权系统

掌握 Rust 独特的通过编译时检查提供内存安全而无需垃圾回收的所有权系统。

## 所有权规则

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

## 移动语义

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

## 借用

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

## 生命周期

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

## Smart Pointers

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

## Ownership Patterns

**Taking ownership vs borrowing:**

```rust
// Take ownership when you need to consume the value
fn consume(s: String) {
    println!("{}", s);
}

// Borrow when you only need to read
fn read(s: &String) {
    println!("{}", s);
}

// Borrow mutably when you need to modify
fn modify(s: &mut String) {
    s.push_str(" modified");
}

fn main() {
    let mut s = String::from("hello");

    read(&s);        // Still own s
    modify(&mut s);  // Still own s
    consume(s);      // No longer own s
}
```

**Builder pattern with ownership:**

```rust
struct Config {
    name: String,
    value: i32,
}

struct ConfigBuilder {
    name: Option<String>,
    value: Option<i32>,
}

impl ConfigBuilder {
    fn new() -> Self {
        ConfigBuilder {
            name: None,
            value: None,
        }
    }

    // Take ownership and return ownership
    fn name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }

    fn value(mut self, value: i32) -> Self {
        self.value = Some(value);
        self
    }

    fn build(self) -> Config {
        Config {
            name: self.name.unwrap_or_default(),
            value: self.value.unwrap_or(0),
        }
    }
}

fn main() {
    let config = ConfigBuilder::new()
        .name(String::from("app"))
        .value(42)
        .build();
}
```

## Slice Types

**String slices:**

```rust
fn string_slices() {
    let s = String::from("hello world");

    // Slice references part of string
    let hello = &s[0..5];
    let world = &s[6..11];

    // Shorthand
    let hello = &s[..5];
    let world = &s[6..];
    let whole = &s[..];

    println!("{} {}", hello, world);
}

fn first_word(s: &str) -> &str {
    let bytes = s.as_bytes();

    for (i, &item) in bytes.iter().enumerate() {
        if item == b' ' {
            return &s[..i];
        }
    }

    &s[..]
}
```

**Array slices:**

```rust
fn array_slices() {
    let a = [1, 2, 3, 4, 5];

    let slice = &a[1..3]; // &[i32]

    assert_eq!(slice, &[2, 3]);
}
```

## Clone vs Copy

**Understanding Clone trait:**

```rust
#[derive(Clone)]
struct Point {
    x: f64,
    y: f64,
}

fn clone_example() {
    let p1 = Point { x: 1.0, y: 2.0 };

    // Explicit clone (deep copy)
    let p2 = p1.clone();

    // Both valid
    println!("{} {}", p1.x, p2.x);
}
```

**Copy trait limitations:**

```rust
// Copy requires all fields to implement Copy
#[derive(Copy, Clone)]
struct Coord {
    x: i32,
    y: i32,
}

// Cannot derive Copy with String field
// #[derive(Copy, Clone)]  // Error
struct Person {
    name: String,  // String doesn't implement Copy
}
```

## Drop Trait

**Custom cleanup with Drop:**

```rust
struct CustomSmartPointer {
    data: String,
}

impl Drop for CustomSmartPointer {
    fn drop(&mut self) {
        println!("Dropping CustomSmartPointer with data: {}", self.data);
    }
}

fn main() {
    let c = CustomSmartPointer {
        data: String::from("my stuff"),
    };

    let d = CustomSmartPointer {
        data: String::from("other stuff"),
    };

    println!("CustomSmartPointers created");
} // d dropped, then c dropped
```

**Manual drop:**

```rust
fn manual_drop() {
    let c = CustomSmartPointer {
        data: String::from("some data"),
    };

    println!("Before drop");
    drop(c); // Manually drop early
    println!("After drop");
}
```

## When to Use This Skill

Use rust-ownership-system when you need to:

- Understand Rust's memory management model
- Write memory-safe code without garbage collection
- Handle ownership transfer between functions
- Work with references and borrowing
- Implement structs with lifetime parameters
- Use smart pointers (Box, Rc, RefCell)
- Debug borrow checker errors
- Choose between ownership, borrowing, and cloning
- Implement custom Drop behavior
- Work with slices and references safely

## 最佳实践

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

## 常见陷阱

- 移动值并尝试随后使用它
- 同时创建多个可变借用
- 混合可变和不可变借用
- 返回对局部变量的引用
- 与借用检查器斗争而不是理解它
- 过度使用 clone() 来避免所有权问题
- 不理解生命周期关系
- 使用 Rc 的循环引用（使用 Weak）
- 在运行时因 RefCell 借用违规而 panic
- 错误使用 'static 生命周期

## Resources

- [Rust Book - Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html)
- [Rust Book - Lifetimes](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html)
- [Rust By Example - Scopes](https://doc.rust-lang.org/rust-by-example/scope.html)
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/)
- [Too Many Linked Lists](https://rust-unofficial.github.io/too-many-lists/)
