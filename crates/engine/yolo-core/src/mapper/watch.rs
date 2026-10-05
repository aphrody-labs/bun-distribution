// SPDX-License-Identifier: Apache-2.0
//! Debounced repository watcher with one pending rescan and an explicit shutdown owner.

use std::{future::Future, path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};

const WATCH_DIRS: &[&str] = &["apps", "packages", "crates", "scripts", "drive"];
const WATCH_FILES: &[&str] = &[
  ".gitmodules",
  "turbo.json",
  "package.json",
  "bun.lock",
  "Cargo.toml",
  "pnpm-workspace.yaml",
];
const IGNORE_SEGMENTS: &[&str] = &[
  "node_modules",
  ".next",
  ".turbo",
  ".bun-cache",
  "target",
  "dist",
  "build",
  ".git",
  ".cache",
];

/// Synchronous compatibility entry point. Async hosts should await run_async.
pub fn run(root: &Path, audit_out: &Path, map_out: &Path, debounce_ms: u64) -> Result<()> {
  if tokio::runtime::Handle::try_current().is_ok() {
    bail!("repository watcher is inside a Tokio runtime; await mapper::watch::run_async instead");
  }
  tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .max_blocking_threads(1)
    .thread_name("yolo-repository-watch")
    .build()?
    .block_on(run_async(root, audit_out, map_out, debounce_ms))
}

/// Reuse the caller's Tokio runtime and stop on its host's termination signal.
pub async fn run_async(
  root: &Path,
  audit_out: &Path,
  map_out: &Path,
  debounce_ms: u64,
) -> Result<()> {
  run_async_with_shutdown(root, audit_out, map_out, debounce_ms, shutdown_signal()).await
}

async fn shutdown_signal() {
  #[cfg(unix)]
  {
    use tokio::signal::unix::{SignalKind, signal};
    let Ok(mut term) = signal(SignalKind::terminate()) else {
      return;
    };
    let Ok(mut interrupt) = signal(SignalKind::interrupt()) else {
      return;
    };
    tokio::select! { _ = term.recv() => {}, _ = interrupt.recv() => {} }
  }
  #[cfg(not(unix))]
  {
    let _ = tokio::signal::ctrl_c().await;
  }
}

/// Watch within an existing runtime. Shutdown waits for any active native audit
/// to finish; no spawned audit outlives this call. A caller cancelling by dropping
/// the future should instead resolve shutdown and await completion.
pub async fn run_async_with_shutdown(
  root: &Path,
  audit_out: &Path,
  map_out: &Path,
  debounce_ms: u64,
  shutdown: impl Future<Output = ()>,
) -> Result<()> {
  let root = dunce::canonicalize(root).context("resolve repository watcher root")?;
  if !root.is_dir() {
    bail!("repository watcher root must be a directory");
  }
  if debounce_ms == 0 {
    bail!("repository watcher debounce must be positive");
  }
  let audit_out = audit_out.to_path_buf();
  let map_out = map_out.to_path_buf();
  let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);
  // One initial pass. Further events coalesce into a single pending rescan;
  // the receiver is not drained while an audit is active, so changes are kept.
  tx.try_send(()).expect("fresh watcher queue has capacity");
  let mut debouncer = new_debouncer(
    Duration::from_millis(debounce_ms),
    None,
    move |result: DebounceEventResult| match result {
      Ok(events) => {
        if events.iter().any(|event| {
          !event.event.kind.is_access() && event.event.paths.iter().any(|path| !is_noisy(path))
        }) {
          let _ = tx.try_send(());
        }
      }
      Err(errors) => {
        for error in errors {
          tracing::warn!("watch error: {error}");
        }
      }
    },
  )?;
  for (path, mode) in WATCH_DIRS
    .iter()
    .map(|name| (root.join(name), RecursiveMode::Recursive))
    .chain(
      WATCH_FILES
        .iter()
        .map(|name| (root.join(name), RecursiveMode::NonRecursive)),
    )
  {
    if path.exists() {
      debouncer.watch(&path, mode)?;
    }
  }
  tokio::pin!(shutdown);
  loop {
    tokio::select! {
        biased;
        _ = &mut shutdown => break,
        event = rx.recv() => if event.is_none() { break; },
    }
    let (root, audit, map) = (root.clone(), audit_out.clone(), map_out.clone());
    let mut task =
      tokio::task::spawn_blocking(move || crate::mapper::audit::run(&root, &audit, &map));
    tokio::select! {
        result = &mut task => { result.context("repository audit task")??; },
        _ = &mut shutdown => {
            task.await.context("repository audit shutdown")??;
            break;
        }
    }
  }
  drop(debouncer);
  Ok(())
}

fn is_noisy(path: &Path) -> bool {
  for component in path.components() {
    let segment = component.as_os_str().to_string_lossy();
    if IGNORE_SEGMENTS.iter().any(|ignored| *ignored == segment) {
      return true;
    }
  }
  matches!(
    path.extension().and_then(|e| e.to_str()),
    Some("log" | "tmp" | "swp" | "swx")
  )
}
