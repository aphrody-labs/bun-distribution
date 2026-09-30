// SPDX-License-Identifier: Apache-2.0
//! CLI implementation for `aphrody config {show, path, import-codex}`.

use std::{collections::BTreeMap, path::PathBuf};

use aphrody_config::{
    CliOverrides, ConfigLayer, LayerSource, builtin_providers_layer_value, load_codex_compat_layer,
    load_project_layer, load_user_layer, merge_toml_values, resolve, restrict_codex_layer,
};
use clap::Subcommand;
use miette::{IntoDiagnostic, Result};

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum ConfigAction {
    /// Show the active or effective resolved configuration.
    Show {
        /// Emit resolved configuration as JSON instead of TOML
        #[arg(long)]
        json: bool,
    },
    /// Print the path to the user's config.toml file (~/.aphrody/config.toml).
    Path,
    /// Import and layer configuration from ~/.codex/config.toml.
    ImportCodex {
        /// Dry run: inspect what would be imported without modifying ~/.aphrody/config.toml
        #[arg(long)]
        dry_run: bool,
    },
}

/// Returns the path to Aphrody home's `config.toml` (~/.aphrody/config.toml).
fn aphrody_config_path() -> Result<PathBuf> {
    let state = aphrody_models::paths::state_dir().map_err(|e| miette::miette!("{e}"))?;
    Ok(state.join("config.toml"))
}

/// Returns the path to Codex home's `config.toml` (~/.codex/config.toml).
fn codex_config_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        let p = PathBuf::from(dir).join("config.toml");
        if p.exists() {
            return Some(p);
        }
    }
    let home = dirs_home()?;
    let p = home.join(".codex").join("config.toml");
    if p.exists() { Some(p) } else { None }
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// Whether an Antigravity token is readable on this host: the Windows
/// Credential Manager entry, or the `agy` / `aphrody antigravity login`
/// token files on Unix. Decides the default provider on every platform.
fn is_antigravity_available() -> bool {
    aphrody_antigravity::client::AntigravityClient::from_credential_manager().is_ok()
}

pub(crate) async fn run(
    action: ConfigAction,
    profile: Option<String>,
    cli_overrides_raw: &[String],
    force_oss: bool,
    local_provider: Option<String>,
) -> Result<()> {
    match action {
        ConfigAction::Path => {
            let path = aphrody_config_path()?;
            println!("{}", path.display());
            Ok(())
        },
        ConfigAction::Show { json } => {
            let env = |k: &str| std::env::var(k).ok();
            let builtins =
                ConfigLayer::new(LayerSource::Builtin, builtin_providers_layer_value(&env));
            let mut layers = vec![builtins];

            let config_path = aphrody_config_path()?;
            if let Ok(Some(user_layer)) = load_user_layer(&config_path) {
                layers.push(user_layer);
            }

            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            if let Ok(Some(proj_layer)) = load_project_layer(&cwd) {
                layers.push(proj_layer);
            }

            let overrides = CliOverrides {
                profile,
                oss: force_oss,
                local_provider,
                config_overrides: cli_overrides_raw.to_vec(),
                ..CliOverrides::default()
            };

            let default_provider = if is_antigravity_available() { "antigravity" } else { "llama" };

            let (config, warnings) =
                resolve(layers, &overrides, default_provider, &BTreeMap::new())
                    .map_err(|e| miette::miette!("Failed to resolve configuration: {e}"))?;

            for w in warnings {
                eprintln!("warning: {w}");
            }

            if json {
                println!("{}", serde_json::to_string_pretty(&config.to_json()).into_diagnostic()?);
            } else {
                println!("model_provider = \"{}\"", config.provider.id);
                if let Some(m) = &config.model {
                    println!("model = \"{m}\"");
                }
                println!("approval_policy = \"{}\"", config.approval_policy);
                println!("sandbox_mode = \"{}\"", config.sandbox_mode);
                println!("project_doc_max_bytes = {}", config.project_doc_max_bytes);
                println!("\n# Active Provider:");
                println!("name = \"{}\"", config.provider.info.name);
                println!("wire_api = \"{}\"", config.provider.info.wire_api);
                if let Some(u) = &config.provider.info.base_url {
                    println!("base_url = \"{u}\"");
                }
            }
            Ok(())
        },
        ConfigAction::ImportCodex { dry_run } => {
            let codex_path = codex_config_path()
                .ok_or_else(|| miette::miette!("No ~/.codex/config.toml found to import."))?;

            println!("Reading Codex configuration from {}", codex_path.display());
            let codex_layer = load_codex_compat_layer(&codex_path)
                .map_err(|e| miette::miette!("{e}"))?
                .ok_or_else(|| miette::miette!("Codex config layer empty"))?;

            let restricted_layer = restrict_codex_layer(codex_layer.value);

            let target_path = aphrody_config_path()?;
            let target_val = if target_path.exists() {
                let existing = std::fs::read_to_string(&target_path).into_diagnostic()?;
                toml::from_str(&existing).into_diagnostic()?
            } else {
                toml::Value::Table(Default::default())
            };

            let mut merged = restricted_layer;
            merge_toml_values(&mut merged, &target_val);

            let serialized = toml::to_string_pretty(&merged).into_diagnostic()?;

            if dry_run {
                println!("--- Dry Run: Proposed {} ---\n{}", target_path.display(), serialized);
            } else {
                if let Some(parent) = target_path.parent() {
                    std::fs::create_dir_all(parent).into_diagnostic()?;
                }
                std::fs::write(&target_path, serialized).into_diagnostic()?;
                println!(
                    "Successfully imported Codex configuration into {}",
                    target_path.display()
                );
            }
            Ok(())
        },
    }
}
