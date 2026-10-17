// SPDX-License-Identifier: Apache-2.0
//! Configuration resolution (`aphrody config show`) and profile helpers.

use std::{collections::BTreeMap, path::PathBuf};

use aphrody_config::{
    CliOverrides, Config, ConfigLayer, LayerSource, builtin_providers_layer_value,
    load_project_layer, load_user_layer, resolve,
};
use serde_json::Value;

/// Apply `APHRODY_PROFILE` to the overrides.
pub fn apply_environment_profile(mut overrides: CliOverrides) -> CliOverrides {
    overrides.profile = aphrody_config::profile::select_profile(
        overrides.profile.as_deref(),
        std::env::var(aphrody_config::profile::ENV_APHRODY_PROFILE)
            .ok()
            .as_deref(),
    );
    overrides
}

pub fn profile_workspace(config: &Config) -> miette::Result<PathBuf> {
    aphrody_agent_home::paths::resolve_workspace(config.active_profile.as_deref(), None)
        .map_err(|error| miette::miette!("exec: {error}"))
}

pub fn load_config(overrides: &CliOverrides) -> miette::Result<Config> {
    let overrides = apply_environment_profile(overrides.clone());
    let env = |name: &str| std::env::var(name).ok();
    let mut layers = vec![ConfigLayer::new(
        LayerSource::Builtin,
        aphrody_config::builtin_providers_layer_value(&env),
    )];
    let home = aphrody_models::paths::state_dir().map_err(|error| miette::miette!("{error}"))?;
    if let Some(layer) = aphrody_config::load_user_layer(&home.join("config.toml"))
        .map_err(|error| miette::miette!("exec: {error}"))?
    {
        layers.push(layer);
    }
    let (initial, _) =
        aphrody_config::resolve(layers.clone(), &overrides, "llama", &BTreeMap::new())
            .map_err(|error| miette::miette!("exec: {error}"))?;
    if initial.compat.read_codex_home {
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                    .map(|path| PathBuf::from(path).join(".codex"))
            });
        if let Some(path) = codex_home
            && let Some(layer) = aphrody_config::load_codex_compat_layer(&path.join("config.toml"))
                .map_err(|error| miette::miette!("exec: {error}"))?
        {
            layers.insert(1, layer);
        }
    }
    let (config, warnings) = aphrody_config::resolve(layers, &overrides, "llama", &BTreeMap::new())
        .map_err(|error| miette::miette!("exec: {error}"))?;
    for warning in warnings {
        eprintln!("warning: {warning}");
    }
    Ok(config)
}

/// Whether an Antigravity token is readable on this host. Decides the default provider.
fn is_antigravity_available() -> bool {
    aphrody_antigravity::client::AntigravityClient::from_credential_manager().is_ok()
}

/// Resolve the effective configuration (builtin, user, project layers and overrides).
///
/// # Errors
/// Fails when the state directory or the layers cannot be resolved.
pub fn resolve_config(
    profile: Option<String>,
    oss: bool,
    local_provider: Option<String>,
    config_overrides: &[String],
) -> miette::Result<(Config, Vec<String>)> {
    let env = |k: &str| std::env::var(k).ok();
    let builtins = ConfigLayer::new(LayerSource::Builtin, builtin_providers_layer_value(&env));
    let mut layers = vec![builtins];

    let state = aphrody_models::paths::state_dir().map_err(|e| miette::miette!("{e}"))?;
    if let Ok(Some(user_layer)) = load_user_layer(&state.join("config.toml")) {
        layers.push(user_layer);
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Ok(Some(proj_layer)) = load_project_layer(&cwd) {
        layers.push(proj_layer);
    }

    let overrides = CliOverrides {
        profile,
        oss,
        local_provider,
        config_overrides: config_overrides.to_vec(),
        ..CliOverrides::default()
    };
    let default_provider = if is_antigravity_available() {
        "antigravity"
    } else {
        "llama"
    };
    let (config, warnings) = resolve(layers, &overrides, default_provider, &BTreeMap::new())
        .map_err(|e| miette::miette!("Failed to resolve configuration: {e}"))?;
    Ok((
        config,
        warnings.into_iter().map(|w| w.to_string()).collect(),
    ))
}

/// The resolved configuration as JSON; warnings go to stderr.
///
/// # Errors
/// See [`resolve_config`].
pub fn config_resolved(
    profile: Option<String>,
    oss: bool,
    local_provider: Option<String>,
    config_overrides: &[String],
) -> miette::Result<Value> {
    let (config, warnings) = resolve_config(profile, oss, local_provider, config_overrides)?;
    for w in warnings {
        eprintln!("warning: {w}");
    }
    Ok(config.to_json())
}
