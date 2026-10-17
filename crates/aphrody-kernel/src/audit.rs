// SPDX-License-Identifier: Apache-2.0
//! Durable, local audit bridge for kernel bus events.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use crate::events::{Event as AuditEvent, EventLevel, NdjsonSinkSubscriber};
use tokio::task::JoinHandle;

use crate::AgentBus;

/// Runtime state for one audit bridge. The bridge deliberately does not block
/// tool dispatch: a full source bus is counted and reported instead.
pub(crate) struct AuditBridge {
    path: PathBuf,
    lagged: Arc<AtomicU64>,
    write_failures: Arc<AtomicU64>,
    task: JoinHandle<()>,
}

impl AuditBridge {
    pub(crate) fn start(bus: AgentBus, path: PathBuf) -> Self {
        let lagged = Arc::new(AtomicU64::new(0));
        let write_failures = Arc::new(AtomicU64::new(0));
        let task_lagged = Arc::clone(&lagged);
        let task_failures = Arc::clone(&write_failures);
        let sink = NdjsonSinkSubscriber::new("kernel-audit", path.clone(), Vec::new());
        let mut events = bus.subscribe();
        let task = tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        let audit_event = AuditEvent::new(
                            event.kind,
                            EventLevel::Info,
                            event.source,
                            event.payload,
                        );
                        if let Err(error) = sink.append_event(&audit_event).await {
                            task_failures.fetch_add(1, Ordering::Relaxed);
                            tracing::error!(%error, "kernel audit event could not be persisted");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        task_lagged.fetch_add(count, Ordering::Relaxed);
                        tracing::error!(dropped = count, "kernel audit bridge fell behind");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Self {
            path,
            lagged,
            write_failures,
            task,
        }
    }

    pub(crate) fn status(&self) -> serde_json::Value {
        serde_json::json!({
            "enabled": true,
            "path": self.path,
            "lagged_events": self.lagged.load(Ordering::Relaxed),
            "write_failures": self.write_failures.load(Ordering::Relaxed),
            "running": !self.task.is_finished(),
        })
    }
}

impl Drop for AuditBridge {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) fn validate_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err("audit path must not be empty".into());
    }
    if !path.is_absolute() {
        return Err("audit path must be absolute".into());
    }
    Ok(path.to_path_buf())
}
