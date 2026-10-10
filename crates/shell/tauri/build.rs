// SPDX-License-Identifier: Apache-2.0
//! Generates one `allow-*` / `deny-*` permission per command; keep in sync with `src/lib.rs`.
const COMMANDS: &[&str] = &[
    "aphrody_shell_open",
    "aphrody_shell_open_channel",
    "aphrody_shell_write",
    "aphrody_shell_resize",
    "aphrody_shell_close",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
