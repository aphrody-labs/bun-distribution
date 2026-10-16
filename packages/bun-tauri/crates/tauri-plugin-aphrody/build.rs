// SPDX-License-Identifier: Apache-2.0 OR MIT
//! One build script for every plugin of the crate: each enabled module is a bundle member with its
//! own permissions (`permissions/<name>/`), scope schema and global API script.

#[path = "build/autostart.rs"]
mod autostart;
#[path = "build/clipboard_manager.rs"]
mod clipboard_manager;
#[path = "build/deep_link.rs"]
mod deep_link;
#[path = "build/dialog.rs"]
mod dialog;
#[path = "build/fs.rs"]
mod fs;
#[path = "build/global_shortcut.rs"]
mod global_shortcut;
#[path = "build/log.rs"]
mod log;
#[path = "build/mcp_bridge.rs"]
mod mcp_bridge;
#[path = "build/notification.rs"]
mod notification;
#[path = "build/opener.rs"]
mod opener;
#[path = "build/os.rs"]
mod os;
#[path = "build/process.rs"]
mod process;
#[path = "build/store.rs"]
mod store;
#[path = "build/updater.rs"]
mod updater;
#[path = "build/window_state.rs"]
mod window_state;

/// Commands of the `aphrody` plugin itself (Bun runtime, see `src/bun`).
const APHRODY_COMMANDS: &[&str] = &["bun_info", "bun_request", "bun_restart"];

fn enabled(feature: &str) -> bool {
    std::env::var_os(format!("CARGO_FEATURE_{}", feature.to_uppercase().replace('-', "_"))).is_some()
}

fn main() {
    if enabled("fs") {
        fs::prepare();
    }
    let members: [(&'static str, fn() -> tauri_plugin::Builder<'static>); 15] = [
        ("autostart", autostart::builder),
        ("clipboard-manager", clipboard_manager::builder),
        ("deep-link", deep_link::builder),
        ("dialog", dialog::builder),
        ("fs", fs::builder),
        ("global-shortcut", global_shortcut::builder),
        ("log", log::builder),
        ("mcp-bridge", mcp_bridge::builder),
        ("notification", notification::builder),
        ("opener", opener::builder),
        ("os", os::builder),
        ("process", process::builder),
        ("store", store::builder),
        ("updater", updater::builder),
        ("window-state", window_state::builder),
    ];
    let mut bundle = tauri_plugin::Bundle::new().member(
        "aphrody",
        tauri_plugin::Builder::new(APHRODY_COMMANDS).global_api_script_path("iife/aphrody.js"),
    );
    for (name, builder) in members {
        if enabled(name) {
            bundle = bundle.member(name, builder());
        }
    }
    bundle.build();
    if enabled("deep-link") {
        deep_link::configure();
    }
}
