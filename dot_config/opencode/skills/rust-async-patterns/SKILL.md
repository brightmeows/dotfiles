---
name: rust-async-patterns
description: Master Rust async programming with Tokio, async traits, error handling, and concurrent patterns. Use when building async Rust applications, implementing concurrent systems, or debugging async code.
---

# Rust 异步模式

使用 Tokio 运行时生产级异步 Rust 编程模式，包括任务、通道、流和错误处理。

## 何时使用此技能

- 构建异步 Rust 应用程序
- 实现并发网络服务
- 使用 Tokio 进行异步 I/O
- 正确处理异步错误
- 调试异步代码问题
- 优化异步性能

## 核心概念

### 1. 异步执行模型

```
Future (lazy) → poll() → Ready(value) | Pending
                ↑           ↓
              Waker ← Runtime schedules
```

### 2. 关键抽象

| 概念 | 目的 |
|------|------|
| `Future` | 可能稍后完成的延迟计算 |
| `async fn` | 返回 impl Future 的函数 |
| `await` | 暂停直到 future 完成 |
| `Task` | 并发运行的 spawned future |
| `Runtime` | 轮询 futures 的执行器 |

## 快速开始

```toml
# Cargo.toml
[dependencies]
tokio = { version = "1", features = ["full"] }
futures = "0.3"
async-trait = "0.1"
anyhow = "1.0"
tracing = "0.1"
tracing-subscriber = "0.3"
```

```rust
use tokio::time::{sleep, Duration};
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化 tracing
    tracing_subscriber::fmt::init();

    // 异步操作
    let result = fetch_data("https://api.example.com").await?;
    println!("Got: {}", result);

    Ok(())
}

async fn fetch_data(url: &str) -> Result<String> {
    // 模拟异步操作
    sleep(Duration::from_millis(100)).await;
    Ok(format!("Data from {}", url))
}
```

## 模式

### 模式 1: 并发任务执行

```rust
use tokio::task::JoinSet;
use anyhow::Result;

// 并发生成多个任务
async fn fetch_all_concurrent(urls: Vec<String>) -> Result<Vec<String>> {
    let mut set = JoinSet::new();

    for url in urls {
        set.spawn(async move {
            fetch_data(&url).await
        });
    }

    let mut results = Vec::new();
    while let Some(res) = set.join_next().await {
        match res {
            Ok(Ok(data)) => results.push(data),
            Ok(Err(e)) => tracing::error!("Task failed: {}", e),
            Err(e) => tracing::error!("Join error: {}", e),
        }
    }

    Ok(results)
}

// 带并发限制
use futures::stream::{self, StreamExt};

async fn fetch_with_limit(urls: Vec<String>, limit: usize) -> Vec<Result<String>> {
    stream::iter(urls)
        .map(|url| async move { fetch_data(&url).await })
        .buffer_unordered(limit) // 最大并发任务数
        .collect()
        .await
}

// 选择首先完成的
use tokio::select;

async fn race_requests(url1: &str, url2: &str) -> Result<String> {
    select! {
        result = fetch_data(url1) => result,
        result = fetch_data(url2) => result,
    }
}
```

### 模式 2: 用于通信的通道

```rust
use tokio::sync::{mpsc, broadcast, oneshot, watch};

// 多生产者，单消费者
async fn mpsc_example() {
    let (tx, mut rx) = mpsc::channel::<String>(100);

    // 生成生产者
    let tx2 = tx.clone();
    tokio::spawn(async move {
        tx2.send("Hello".to_string()).await.unwrap();
    });

    // 消费
    while let Some(msg) = rx.recv().await {
        println!("Got: {}", msg);
    }
}

// 广播：多生产者，多消费者
async fn broadcast_example() {
    let (tx, _) = broadcast::channel::<String>(100);

    let mut rx1 = tx.subscribe();
    let mut rx2 = tx.subscribe();

    tx.send("Event".to_string()).unwrap();

    // 两个接收者都收到消息
    let _ = rx1.recv().await;
    let _ = rx2.recv().await;
}

// Oneshot：单个值，单次使用
async fn oneshot_example() -> String {
    let (tx, rx) = oneshot::channel::<String>();

    tokio::spawn(async move {
        tx.send("Result".to_string()).unwrap();
    });

    rx.await.unwrap()
}

// Watch：单生产者，多消费者，最新值
async fn watch_example() {
    let (tx, mut rx) = watch::channel("initial".to_string());

    tokio::spawn(async move {
        loop {
            // 等待更改
            rx.changed().await.unwrap();
            println!("New value: {}", *rx.borrow());
        }
    });

    tx.send("updated".to_string()).unwrap();
}
```

### 模式 3: 异步错误处理

```rust
use anyhow::{Context, Result, bail};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ServiceError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Timeout after {0:?}")]
    Timeout(std::time::Duration),
}

// 使用 anyhow 处理应用程序错误
async fn process_request(id: &str) -> Result<Response> {
    let data = fetch_data(id)
        .await
        .context("Failed to fetch data")?;

    let parsed = parse_response(&data)
        .context("Failed to parse response")?;

    Ok(parsed)
}

// 为库代码使用自定义错误
async fn get_user(id: &str) -> Result<User, ServiceError> {
    let result = db.query(id).await?;

    match result {
        Some(user) => Ok(user),
        None => Err(ServiceError::NotFound(id.to_string())),
    }
}

// 超时包装器
use tokio::time::timeout;

async fn with_timeout<T, F>(duration: Duration, future: F) -> Result<T, ServiceError>
where
    F: std::future::Future<Output = Result<T, ServiceError>>,
{
    timeout(duration, future)
        .await
        .map_err(|_| ServiceError::Timeout(duration))?
}
```

### 模式 4: 优雅关闭

```rust
use tokio::signal;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

async fn run_server() -> Result<()> {
    // 方法 1: CancellationToken
    let token = CancellationToken::new();
    let token_clone = token.clone();

    // 生成尊重取消的任务
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = token_clone.cancelled() => {
                    tracing::info!("Task shutting down");
                    break;
                }
                _ = do_work() => {}
            }
        }
    });

    // 等待关闭信号
    signal::ctrl_c().await?;
    tracing::info!("Shutdown signal received");

    // 取消所有任务
    token.cancel();

    // 给任务清理时间
    tokio::time::sleep(Duration::from_secs(5)).await;

    Ok(())
}

// 方法 2: 用于关闭的广播通道
async fn run_with_broadcast() -> Result<()> {
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    let mut rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        tokio::select! {
            _ = rx.recv() => {
                tracing::info!("Received shutdown");
            }
            _ = async { loop { do_work().await } } => {}
        }
    });

    signal::ctrl_c().await?;
    let _ = shutdown_tx.send(());

    Ok(())
}
```

### 模式 5: 异步 Traits

```rust
use async_trait::async_trait;

#[async_trait]
pub trait Repository {
    async fn get(&self, id: &str) -> Result<Entity>;
    async fn save(&self, entity: &Entity) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<()>;
}

pub struct PostgresRepository {
    pool: sqlx::PgPool,
}

#[async_trait]
impl Repository for PostgresRepository {
    async fn get(&self, id: &str) -> Result<Entity> {
        sqlx::query_as!(Entity, "SELECT * FROM entities WHERE id = $1", id)
            .fetch_one(&self.pool)
            .await
            .map_err(Into::into)
    }

    async fn save(&self, entity: &Entity) -> Result<()> {
        sqlx::query!(
            "INSERT INTO entities (id, data) VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET data = $2",
            entity.id,
            entity.data
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<()> {
        sqlx::query!("DELETE FROM entities WHERE id = $1", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// Trait 对象使用
async fn process(repo: &dyn Repository, id: &str) -> Result<()> {
    let entity = repo.get(id).await?;
    // Process...
    repo.save(&entity).await
}
```

### 模式 6: 流和异步迭代

```rust
use futures::stream::{self, Stream, StreamExt};
use async_stream::stream;

// 从异步迭代器创建流
fn numbers_stream() -> impl Stream<Item = i32> {
    stream! {
        for i in 0..10 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            yield i;
        }
    }
}

// 处理流
async fn process_stream() {
    let stream = numbers_stream();

    // 映射和过滤
    let processed: Vec<_> = stream
        .filter(|n| futures::future::ready(*n % 2 == 0))
        .map(|n| n * 2)
        .collect()
        .await;

    println!("{:?}", processed);
}

// 分块处理
async fn process_in_chunks() {
    let stream = numbers_stream();

    let mut chunks = stream.chunks(3);

    while let Some(chunk) = chunks.next().await {
        println!("Processing chunk: {:?}", chunk);
    }
}

// 合并多个流
async fn merge_streams() {
    let stream1 = numbers_stream();
    let stream2 = numbers_stream();

    let merged = stream::select(stream1, stream2);

    merged
        .for_each(|n| async move {
            println!("Got: {}", n);
        })
        .await;
}
```

### 模式 7: 资源管理

```rust
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, Semaphore};

// 使用 RwLock 的共享状态（适合读多写少）
struct Cache {
    data: RwLock<HashMap<String, String>>,
}

impl Cache {
    async fn get(&self, key: &str) -> Option<String> {
        self.data.read().await.get(key).cloned()
    }

    async fn set(&self, key: String, value: String) {
        self.data.write().await.insert(key, value);
    }
}

// 使用信号量的连接池
struct Pool {
    semaphore: Semaphore,
    connections: Mutex<Vec<Connection>>,
}

impl Pool {
    fn new(size: usize) -> Self {
        Self {
            semaphore: Semaphore::new(size),
            connections: Mutex::new((0..size).map(|_| Connection::new()).collect()),
        }
    }

    async fn acquire(&self) -> PooledConnection<'_> {
        let permit = self.semaphore.acquire().await.unwrap();
        let conn = self.connections.lock().await.pop().unwrap();
        PooledConnection { pool: self, conn: Some(conn), _permit: permit }
    }
}

struct PooledConnection<'a> {
    pool: &'a Pool,
    conn: Option<Connection>,
    _permit: tokio::sync::SemaphorePermit<'a>,
}

impl Drop for PooledConnection<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            let pool = self.pool;
            tokio::spawn(async move {
                pool.connections.lock().await.push(conn);
            });
        }
    }
}
```

## 调试提示

```rust
// 启用 tokio-console 进行运行时调试
// Cargo.toml: tokio = { features = ["tracing"] }
// Run: RUSTFLAGS="--cfg tokio_unstable" cargo run
// Then: tokio-console

// 检测异步函数
use tracing::instrument;

#[instrument(skip(pool))]
async fn fetch_user(pool: &PgPool, id: &str) -> Result<User> {
    tracing::debug!("Fetching user");
    // ...
}

// 跟踪任务生成
let span = tracing::info_span!("worker", id = %worker_id);
tokio::spawn(async move {
    // 轮询时进入 span
}.instrument(span));
```

## 最佳实践

### 推荐做法
- **使用 `tokio::select!`** - 用于竞争 futures
- **优先使用通道** - 而不是共享状态（可能时）
- **使用 `JoinSet`** - 用于管理多个任务
- **使用 tracing 检测** - 用于调试异步代码
- **处理取消** - 检查 `CancellationToken`

### 不推荐做法
- **不要阻塞** - 在异步中永远不要使用 `std::thread::sleep`
- **不要跨 await 持有锁** - 会导致死锁
- **不要无限制生成** - 使用信号量限制
- **不要忽略错误** - 使用 `?` 或日志传播
- **不要忘记 Send 界限** - 对于 spawned futures

## Resources

- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)
- [Async Book](https://rust-lang.github.io/async-book/)
- [Tokio Console](https://github.com/tokio-rs/console)
