---
name: rust-async-patterns
description: "Rust async with Tokio: tasks, JoinSet, select!, channels, streams, async traits, cancellation, shutdown, timeouts, errors, and debugging hangs or Send errors. Use when writing or reviewing any async Rust."
version: "1.1.0"
---

# Rust Async Patterns

Production patterns for async Rust programming with Tokio runtime, including tasks, channels, streams, and error handling.

## When to Use This Skill

- Building async Rust applications
- Implementing concurrent network services
- Using Tokio for async I/O
- Handling async errors properly
- Debugging async code issues
- Optimizing async performance

## Core Concepts

### 1. Async Execution Model

```
Future (lazy) → poll() → Ready(value) | Pending
                ↑           ↓
              Waker ← Runtime schedules
```

### 2. Key Abstractions

| Concept    | Purpose                                  |
| ---------- | ---------------------------------------- |
| `Future`   | Lazy computation that may complete later |
| `async fn` | Function returning impl Future           |
| `await`    | Suspend until future completes           |
| `Task`     | Spawned future running concurrently      |
| `Runtime`  | Executor that polls futures              |

## Quick Start

```toml
# Cargo.toml (or [workspace.dependencies]); check crates.io / `cargo add` for current versions
[dependencies]
tokio = { version = "1", features = ["full"] }   # trim features for libraries
tokio-util = "0.7"                                # CancellationToken, codecs
futures = "0.3"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

```rust
use tokio::time::{sleep, Duration};
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Async operations
    let result = fetch_data("https://api.example.com").await?;
    println!("Got: {}", result);

    Ok(())
}

async fn fetch_data(url: &str) -> Result<String> {
    // Simulated async operation
    sleep(Duration::from_millis(100)).await;
    Ok(format!("Data from {}", url))
}
```

## Detailed patterns and worked examples

Detailed pattern documentation lives in `references/details.md`. Read that file when the navigation tier above is insufficient.

## Best Practices

### Do's

- **Use `tokio::select!`** - For racing futures
- **Prefer channels** - Over shared state when possible
- **Use `JoinSet`** - For managing multiple tasks
- **Instrument with tracing** - For debugging async code
- **Handle cancellation** - Check `CancellationToken`
- **Prefer native `async fn` in traits** - Reach for `async-trait` only for `dyn` dispatch

### Don'ts

- **Don't block** - Never use `std::thread::sleep` in async
- **Don't hold locks across awaits** - Causes deadlocks
- **Don't spawn unboundedly** - Use semaphores for limits
- **Don't ignore errors** - Propagate with `?` or log
- **Don't forget Send bounds** - For spawned futures


## Project conventions

- If the project has a Cargo workspace, add dependencies to `[workspace.dependencies]` and
  reference them with `{ workspace = true }`; honour `[lints] workspace = true` and run the
  project's clippy gate (commonly `cargo clippy --all-targets -- -D warnings`).
- Tokio does not run on `wasm32-unknown-unknown`; if the crate targets wasm, keep runtime
  code behind `cfg(not(target_arch = "wasm32"))` and verify with the `rust-target-check` skill.
- Pair with `rust-best-practices-2026` for general Rust style.
