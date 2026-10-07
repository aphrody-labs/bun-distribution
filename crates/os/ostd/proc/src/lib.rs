// SPDX-License-Identifier: Apache-2.0
//! `aphrody-proc` — process supervision primitives.
//!
//! Three long-lived things in aphrody own child processes whose lifetime must
//! never outlast them by accident: the llama-server supervisor, the command
//! sandbox and the training runner. They share the same needs, met here once:
//!
//! - [`spawn_group`] — start a child as the leader of its own process group, owned by a
//!   [`GroupChild`] that kills the *whole tree* on [`GroupChild::kill_tree`] and on drop. Linux
//!   uses a new session and `killpg`; Windows uses a Job Object with `KILL_ON_JOB_CLOSE`, so the
//!   tree dies even when the owner is killed without running destructors.
//! - [`spawn_detached`] — start a daemon that deliberately survives its parent.
//! - [`process_alive`] — liveness probe by pid, used to tell a live daemon from a stale state file.
//! - [`free_port`] — an ephemeral loopback TCP port.
//! - [`FileLock`] — advisory whole-file locks (shared / exclusive).
//! - [`GpuLease`] — the single-GPU arbitration: inference holds the lease shared, training holds it
//!   exclusively, so the two never co-reside in VRAM.
//!
//! `unsafe` is confined to the two platform modules (`pre_exec` on Unix, Win32
//! handles on Windows); everything above them is safe code.

#[cfg(not(target_arch = "wasm32"))]
mod group;
#[cfg(not(target_arch = "wasm32"))]
mod lease;
#[cfg(not(target_arch = "wasm32"))]
mod lock;
#[cfg(not(target_arch = "wasm32"))]
mod port;

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(not(target_arch = "wasm32"))]
pub use group::{
    GroupChild, SpawnOptions, process_alive, spawn_detached, spawn_group, terminate_process,
};
#[cfg(not(target_arch = "wasm32"))]
pub use lease::{GpuHolder, GpuLease, LeaseError, LeaseKind};
#[cfg(not(target_arch = "wasm32"))]
pub use lock::{FileLock, LockKind};
#[cfg(not(target_arch = "wasm32"))]
pub use port::free_port;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod lib_tests;
