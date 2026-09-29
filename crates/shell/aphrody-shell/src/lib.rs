// SPDX-License-Identifier: Apache-2.0
//! Canonical shell and terminal surface for Aphrody OS.
//!
//! This crate is the only integration dependency required by OS clients. It
//! exposes the embedded Nushell subsystem, the native PTY/WebSocket backend,
//! and the Ratatui agent surface under one stable namespace. Consumers should
//! depend on `aphrody-shell` instead of coupling themselves to one of the
//! implementation crates.

pub use aphrody_nu::{DEFAULT_TIMEOUT, NuOutput, NuShell, ShellSubsystem, json_to_nu, nu_to_json};
pub use aphrody_terminal_backend as backend;
pub use aphrody_terminal_backend::{
    CoordError, CoordHttpResponse, CoordProxy, CoordResponseKind, NDJSON_CONTENT_TYPE, PtyConfig,
    SSE_CONTENT_TYPE, default_shell, sd_notify, serve, start_watchdog_loop,
};
pub use aphrody_tui as tui;
pub use aphrody_tui::{Action, AppState, KeyPress, PendingApproval, TranscriptCell, draw, run};
