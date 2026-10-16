// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

const COMMANDS: &[&str] = &["log"];

/// Build description of the `log` plugin.
pub fn builder() -> tauri_plugin::Builder<'static> {
    tauri_plugin::Builder::new(COMMANDS)
        .global_api_script_path("iife/log.js")
}
