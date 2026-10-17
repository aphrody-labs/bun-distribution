// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::collections::HashMap;

#[derive(Default)]
pub struct PluginMetadata {
    pub desktop_only: bool,
    pub mobile_only: bool,
    pub rust_only: bool,
    pub builder: bool,
    pub version_req: Option<String>,
}

// known plugins with particular cases
pub fn known_plugins() -> HashMap<&'static str, PluginMetadata> {
    let mut plugins: HashMap<&'static str, PluginMetadata> = HashMap::new();

    // desktop-only
    for p in [
        "autostart",
        "global-shortcut",
        "single-instance",
        "updater",
        "window-state",
    ] {
        plugins.entry(p).or_default().desktop_only = true;
    }

    // uses builder pattern
    for p in [
        "autostart",
        "global-shortcut",
        "log",
        "store",
        "updater",
        "window-state",
    ] {
        plugins.entry(p).or_default().builder = true;
    }

    // rust-only
    for p in ["single-instance", "wrap"] {
        plugins.entry(p).or_default().rust_only = true;
    }

    // known, but no particular config
    for p in [
        "deep-link",
        "dialog",
        "fs",
        "notification",
        "os",
        "process",
        "opener",
        "clipboard-manager",
        "mcp-bridge",
        "aphrody",
    ] {
        plugins.entry(p).or_default();
    }

    let version_req = version_req();
    for plugin in plugins.values_mut() {
        plugin.version_req.replace(version_req.clone());
    }

    plugins
}

pub fn plugin_features(plugin: &str) -> Vec<&str> {
    match plugin {
        "aphrody" => vec![],
        "dialog" => vec!["dialog", "dialog-xdg-portal"],
        "updater" => vec![
            "updater",
            "updater-rustls-tls",
            "updater-system-proxy",
            "updater-zip",
        ],
        _ => vec![plugin],
    }
}

pub fn plugin_init(plugin: &str) -> String {
    if plugin == "aphrody" {
        return ".plugin(tauri_plugin_aphrody::init())".to_string();
    }
    let module = plugin.replace('-', "_");
    let init = match plugin {
        "autostart" | "global-shortcut" | "updater" => "Builder::new().build()",
        "store" | "window-state" => "Builder::default().build()",
        "log" => "Builder::new().level(tauri_plugin_aphrody::log::log::LevelFilter::Info).build()",
        "single-instance" => "init(|_app, _args, _cwd| {})",
        "wrap" => "init(include_str!(\"../wrap.json\"))",
        _ => "init()",
    };
    format!(".plugin(tauri_plugin_aphrody::{module}::{init})")
}

fn version_req() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn owned_plugin_requirements_use_the_complete_product_release() {
        let plugins = super::known_plugins();
        assert_eq!(plugins["fs"].version_req.as_deref(), Some("1.4.4"));
        assert_eq!(plugins["opener"].version_req.as_deref(), Some("1.4.4"));
        assert!(!plugins.contains_key("shell"));
    }

    #[test]
    fn consolidated_modules_keep_their_native_initializers() {
        assert_eq!(
            super::plugin_init("store"),
            ".plugin(tauri_plugin_aphrody::store::Builder::default().build())"
        );
        assert_eq!(
            super::plugin_init("opener"),
            ".plugin(tauri_plugin_aphrody::opener::init())"
        );
        assert_eq!(
            super::plugin_features("dialog"),
            ["dialog", "dialog-xdg-portal"]
        );
        assert_eq!(
            super::plugin_features("updater"),
            [
                "updater",
                "updater-rustls-tls",
                "updater-system-proxy",
                "updater-zip"
            ]
        );
    }
}
