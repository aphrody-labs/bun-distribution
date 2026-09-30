// SPDX-License-Identifier: Apache-2.0
//! Tauri plugin build hook: one `allow-*` / `deny-*` permission per command.

/// Every command the plugin registers; keep in sync with `generate_handler!` in `src/lib.rs`.
const COMMANDS: &[&str] = &["css", "scheme", "system_accent", "sync_window"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
