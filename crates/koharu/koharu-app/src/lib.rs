//! Koharu's Tauri-managed application state, commands, and lifecycle.

mod app;
mod commands;

#[cfg(feature = "cef")]
pub use app::run;
pub use app::{on_window_event, setup};
pub use commands::{COMMAND_NAMES, bindings};
