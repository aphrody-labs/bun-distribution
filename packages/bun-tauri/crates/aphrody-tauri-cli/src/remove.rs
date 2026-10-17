// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use clap::Parser;
use std::{path::Path, process::Command};
use toml_edit::{DocumentMut, Item, TableLike, Value, value};

use crate::{
    Result, acl,
    error::{Context, ErrorExt},
    helpers::{app_paths::resolve_frontend_dir, cargo, npm::PackageManager},
};

#[derive(Debug, Parser)]
#[clap(about = "Remove a tauri plugin from the project")]
pub struct Options {
    /// The plugin to remove.
    pub plugin: String,
}

pub fn command(options: Options) -> Result<()> {
    let dirs = crate::helpers::app_paths::resolve_dirs();
    let plugin = options.plugin;

    let crate_name = format!("tauri-plugin-{plugin}");

    let mut plugins = crate::helpers::plugins::known_plugins();
    let (metadata, is_known) = plugins
        .remove(plugin.as_str())
        .map(|metadata| (metadata, true))
        .unwrap_or_default();

    let frontend_dir = resolve_frontend_dir();

    let target_str = metadata
        .desktop_only
        .then_some(r#"cfg(not(any(target_os = "android", target_os = "ios")))"#)
        .or_else(|| {
            metadata
                .mobile_only
                .then_some(r#"cfg(any(target_os = "android", target_os = "ios"))"#)
        });

    if is_known {
        remove_consolidated_plugin(dirs.tauri, &plugin)?;
    } else {
        cargo::uninstall_one(cargo::CargoUninstallOptions {
            name: &crate_name,
            cwd: Some(dirs.tauri),
            target: target_str,
        })?;
    }

    if !metadata.rust_only {
        // `tauri add` only installs the JS bindings of known plugins; for community plugins, only
        // remove the package older CLI versions installed, and only if the project actually uses it
        let npm_name = format!("tauri-plugin-{plugin}-api");
        if let Some(frontend_dir) = frontend_dir.filter(|_| !is_known) {
            let package_json = std::fs::read(dirs.frontend.join("package.json"))
                .ok()
                .and_then(|content| serde_json::from_slice::<serde_json::Value>(&content).ok());
            if package_json
                .as_ref()
                .is_some_and(|package_json| lists_dependency(package_json, &npm_name))
            {
                let manager = PackageManager::from_project(frontend_dir);
                // not fatal: the ACL cleanup below must still run
                if let Err(e) = manager.remove(std::slice::from_ref(&npm_name), dirs.frontend) {
                    log::warn!("Failed to remove `{npm_name}`, remove it manually: {e}");
                }
            }
        }

        acl::permission::rm::command(acl::permission::rm::Options {
            identifier: format!("{plugin}:*"),
        })?;
    }

    log::info!("Now, you must manually remove the plugin from your Rust code.",);

    Ok(())
}

fn remove_consolidated_plugin(directory: &Path, plugin: &str) -> Result<()> {
    let manifest_path = directory.join("Cargo.toml");
    let contents = std::fs::read_to_string(&manifest_path)
        .fs_context("failed to read Cargo manifest", manifest_path.clone())?;
    let mut manifest: DocumentMut = contents.parse().context("failed to parse Cargo manifest")?;
    let output = Command::new("cargo")
        .args(["metadata", "--format-version", "1", "--locked"])
        .current_dir(directory)
        .output()
        .context("failed to inspect the consolidated plugin")?;
    if !output.status.success() {
        crate::error::bail!(
            "Failed to inspect the consolidated plugin: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let metadata: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("failed to parse Cargo metadata")?;
    let package = metadata["packages"]
        .as_array()
        .and_then(|packages| {
            packages
                .iter()
                .find(|package| package["name"] == "tauri-plugin-aphrody")
        })
        .context("Cargo metadata does not contain tauri-plugin-aphrody")?;
    let defaults: Vec<&str> = package["features"]["default"]
        .as_array()
        .map(|features| {
            features
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect()
        })
        .unwrap_or_default();
    let workspace_root = metadata["workspace_root"]
        .as_str()
        .context("Cargo metadata lacks workspace root")?;
    let workspace_path = Path::new(workspace_root).join("Cargo.toml");
    let workspace: DocumentMut = std::fs::read_to_string(&workspace_path)
        .fs_context("failed to read workspace manifest", workspace_path.clone())?
        .parse()
        .context("failed to parse workspace manifest")?;
    remove_plugin_features(
        &mut manifest,
        &workspace,
        Path::new(workspace_root),
        plugin,
        &defaults,
    )?;
    std::fs::write(&manifest_path, manifest.to_string())
        .fs_context("failed to write Cargo manifest", manifest_path)?;
    Ok(())
}

fn remove_plugin_features(
    manifest: &mut DocumentMut,
    workspace: &DocumentMut,
    workspace_root: &Path,
    plugin: &str,
    defaults: &[&str],
) -> Result<()> {
    let mut aliases = Vec::new();
    remove_dependency_features(
        manifest.as_table_mut(),
        workspace,
        workspace_root,
        plugin,
        defaults,
        &mut aliases,
    )?;
    if let Some(targets) = manifest.get_mut("target").and_then(Item::as_table_like_mut) {
        for (_, target) in targets.iter_mut() {
            if let Some(target) = target.as_table_like_mut() {
                remove_dependency_features(
                    target,
                    workspace,
                    workspace_root,
                    plugin,
                    defaults,
                    &mut aliases,
                )?;
            }
        }
    }
    if let Some(features) = manifest
        .get_mut("features")
        .and_then(Item::as_table_like_mut)
    {
        for (_, enabled) in features.iter_mut() {
            if let Some(enabled) = enabled.as_array_mut() {
                enabled.retain(|feature| {
                    feature.as_str().is_none_or(|feature| {
                        !aliases.iter().any(|alias| {
                            feature
                                .split_once('/')
                                .is_some_and(|(dependency, feature)| {
                                    dependency.trim_end_matches('?') == alias
                                        && is_plugin_feature(feature, plugin)
                                })
                        })
                    })
                });
            }
        }
    }
    Ok(())
}

fn remove_dependency_features(
    parent: &mut dyn TableLike,
    workspace: &DocumentMut,
    workspace_root: &Path,
    plugin: &str,
    defaults: &[&str],
    aliases: &mut Vec<String>,
) -> Result<()> {
    let Some(dependencies) = parent
        .get_mut("dependencies")
        .and_then(Item::as_table_like_mut)
    else {
        return Ok(());
    };
    for (name, dependency) in dependencies.iter_mut() {
        let inherited = dependency.get("workspace").and_then(Item::as_bool) == Some(true);
        let workspace_dependency = workspace
            .get("workspace")
            .and_then(|workspace| workspace.get("dependencies"))
            .and_then(|dependencies| dependencies.get(name.get()));
        let source = if inherited {
            workspace_dependency.unwrap_or(&*dependency)
        } else {
            &*dependency
        };
        if name.get() != "tauri-plugin-aphrody"
            && source.get("package").and_then(Item::as_str) != Some("tauri-plugin-aphrody")
        {
            continue;
        }
        aliases.push(name.get().to_string());
        if inherited {
            let inherited =
                workspace_dependency.context("Missing inherited consolidated plugin dependency")?;
            let mut merged = dependency_table(inherited)?;
            if let Some(path) = merged.get("path").and_then(Item::as_str) {
                merged.insert(
                    "path",
                    value(workspace_root.join(path).to_string_lossy().as_ref()),
                );
            }
            if let Some(overlay) = dependency.as_table_like() {
                for (key, item) in overlay
                    .iter()
                    .filter(|(key, _)| *key != "workspace" && *key != "default-features")
                {
                    if key == "features" {
                        let mut features = merged
                            .get("features")
                            .and_then(Item::as_array)
                            .cloned()
                            .unwrap_or_default();
                        if let Some(extra) = item.as_array() {
                            for feature in extra.iter() {
                                if !features
                                    .iter()
                                    .any(|existing| existing.as_str() == feature.as_str())
                                {
                                    features.push(feature.clone());
                                }
                            }
                        }
                        merged.insert(key, Item::Value(Value::Array(features)));
                    } else {
                        merged.insert(key, item.clone());
                    }
                }
            }
            *dependency = merged.into();
        }
        let mut table = dependency_table(dependency)?;
        let mut features = table
            .get("features")
            .and_then(Item::as_array)
            .cloned()
            .unwrap_or_default();
        if table.get("default-features").and_then(Item::as_bool) != Some(false)
            || features
                .iter()
                .any(|feature| feature.as_str() == Some("default"))
        {
            for feature in defaults {
                if !features
                    .iter()
                    .any(|existing| existing.as_str() == Some(feature))
                {
                    features.push(*feature);
                }
            }
        }
        features.retain(|feature| feature.as_str() != Some("default"));
        features.retain(|feature| {
            feature
                .as_str()
                .is_none_or(|feature| !is_plugin_feature(feature, plugin))
        });
        table.insert("default-features", value(false));
        table.insert("features", Item::Value(Value::Array(features)));
        *dependency = table.into();
    }
    Ok(())
}

fn is_plugin_feature(feature: &str, plugin: &str) -> bool {
    feature == plugin
        || feature
            .strip_prefix(plugin)
            .is_some_and(|suffix| suffix.starts_with('-'))
}

fn dependency_table(dependency: &Item) -> Result<toml_edit::Table> {
    let mut table = toml_edit::Table::new();
    if let Some(version) = dependency.as_str() {
        table.insert("version", value(version));
    } else if let Some(dependency) = dependency.as_table_like() {
        for (key, item) in dependency.iter() {
            table.insert(key, item.clone());
        }
    } else {
        crate::error::bail!("Invalid consolidated plugin dependency");
    }
    Ok(table)
}

/// Whether the given `package.json` lists `name` as any kind of dependency.
fn lists_dependency(package_json: &serde_json::Value, name: &str) -> bool {
    [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ]
    .iter()
    .any(|key| {
        package_json
            .get(key)
            .and_then(|deps| deps.get(name))
            .is_some()
    })
}

#[cfg(test)]
mod tests {
    use super::{lists_dependency, remove_plugin_features};
    use serde_json::json;

    #[test]
    fn finds_dependency_in_any_section() {
        let package_json = json!({
          "dependencies": { "@aphrody/plugin-fs": "~2" },
          "devDependencies": { "tauri-plugin-foo-api": "^1" },
        });
        assert!(lists_dependency(&package_json, "@aphrody/plugin-fs"));
        assert!(lists_dependency(&package_json, "tauri-plugin-foo-api"));
        assert!(!lists_dependency(&package_json, "@aphrody/plugin-os"));
        assert!(!lists_dependency(&json!({}), "@aphrody/plugin-fs"));
    }

    #[test]
    fn removes_only_the_selected_module_and_keeps_shared_dependencies() {
        let mut manifest: toml_edit::DocumentMut = r#"
[dependencies]
tauri-plugin-aphrody = { version = "=1.4.4", default-features = false, features = ["fs", "fs-watch", "store"] }
[features]
default = ["tauri-plugin-aphrody/fs", "tauri-plugin-aphrody/store"]
"#.parse().unwrap();
        let workspace = toml_edit::DocumentMut::new();
        remove_plugin_features(
            &mut manifest,
            &workspace,
            std::path::Path::new("."),
            "fs",
            &[],
        )
        .unwrap();
        let dependency = &manifest["dependencies"]["tauri-plugin-aphrody"];
        assert_eq!(dependency["version"].as_str(), Some("=1.4.4"));
        assert_eq!(
            dependency["features"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect::<Vec<_>>(),
            ["store"]
        );
        assert_eq!(
            manifest["features"]["default"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect::<Vec<_>>(),
            ["tauri-plugin-aphrody/store"]
        );
    }

    #[test]
    fn expands_provider_defaults_before_removing_one_module() {
        let mut manifest: toml_edit::DocumentMut =
            "[dependencies]\ntauri-plugin-aphrody = \"=1.4.4\"\n"
                .parse()
                .unwrap();
        remove_plugin_features(
            &mut manifest,
            &toml_edit::DocumentMut::new(),
            std::path::Path::new("."),
            "updater",
            &["fs", "updater", "updater-rustls-tls", "store"],
        )
        .unwrap();
        let dependency = &manifest["dependencies"]["tauri-plugin-aphrody"];
        assert_eq!(dependency["default-features"].as_bool(), Some(false));
        assert_eq!(
            dependency["features"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect::<Vec<_>>(),
            ["fs", "store"]
        );
    }

    #[test]
    fn materializes_inherited_target_features_without_changing_the_workspace() {
        let mut manifest: toml_edit::DocumentMut = r#"
[target.'cfg(windows)'.dependencies]
desktop = { workspace = true, features = ["fs-watch"] }
"#
        .parse()
        .unwrap();
        let workspace: toml_edit::DocumentMut = r#"
[workspace.dependencies]
desktop = { package = "tauri-plugin-aphrody", version = "=1.4.4", default-features = false, features = ["fs", "store"] }
"#.parse().unwrap();
        let original = workspace.to_string();
        remove_plugin_features(
            &mut manifest,
            &workspace,
            std::path::Path::new("."),
            "fs",
            &[],
        )
        .unwrap();
        let dependency = &manifest["target"]["cfg(windows)"]["dependencies"]["desktop"];
        assert!(dependency.get("workspace").is_none());
        assert_eq!(dependency["package"].as_str(), Some("tauri-plugin-aphrody"));
        assert_eq!(
            dependency["features"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|feature| feature.as_str())
                .collect::<Vec<_>>(),
            ["store"]
        );
        assert_eq!(workspace.to_string(), original);
    }
}
