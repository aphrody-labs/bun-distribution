// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! This plugin provides APIs to access the current process. To spawn child processes, see the [`shell`](https://github.com/tauri-apps/tauri-plugin-shell) plugin.


use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

mod commands;

/// Initializes the plugin, exposing commands to exit or restart the current process.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("process")
        .invoke_handler(tauri::generate_handler![#![plugin(process)] commands::exit, commands::restart])
        .build()
}
