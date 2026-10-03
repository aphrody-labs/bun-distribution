// SPDX-License-Identifier: Apache-2.0
//! Shared provider configuration and autonomous runtime preparation.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use aphrody_agent_runtime::{RuntimeConfig, resolve_tool_profile};
use aphrody_config::{CliOverrides, Config, ConfigLayer, LayerSource};
use serde_json::{Value, json};

use crate::AppServerError;

pub(crate) fn state_home() -> PathBuf {
    std::env::var_os("APHRODY_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|path| PathBuf::from(path).join(".aphrody"))
        })
        .unwrap_or_else(|| PathBuf::from(".aphrody"))
}

pub(crate) fn select_profile(
    base_home: &Path,
    params: &Value,
) -> Result<Option<String>, AppServerError> {
    let environment = std::env::var(aphrody_config::profile::ENV_APHRODY_PROFILE).ok();
    select_profile_with_environment(base_home, params, environment.as_deref())
}

pub(crate) fn select_profile_with_environment(
    base_home: &Path,
    params: &Value,
    environment: Option<&str>,
) -> Result<Option<String>, AppServerError> {
    let explicit = optional_string(params, "profile")?;
    if let Some(selected) =
        aphrody_config::profile::select_profile(explicit.as_deref(), environment)
    {
        return Ok(Some(selected));
    }
    let configured = aphrody_config::load_toml_file(&base_home.join("config.toml"))
        .map_err(invalid)?
        .and_then(|value| value.get("profile").cloned())
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid("profile in config.toml must be a string"))
        })
        .transpose()?;
    Ok(aphrody_config::profile::select_profile(None, configured.as_deref()))
}

pub(crate) fn profile_home(base_home: &Path, profile: Option<&str>) -> PathBuf {
    let suffix = profile
        .map(aphrody_agent_home::paths::sanitize_profile)
        .filter(|profile| !profile.is_empty());
    suffix.map_or_else(
        || base_home.to_path_buf(),
        |profile| base_home.join(format!("workspace-{profile}")),
    )
}

fn invalid(error: impl std::fmt::Display) -> AppServerError {
    AppServerError::InvalidRequest(error.to_string())
}

#[cfg(test)]
pub(crate) fn resolve(home: &Path, params: &Value) -> Result<Config, AppServerError> {
    resolve_with_profile(home, params, None)
}

pub(crate) fn resolve_with_profile(
    home: &Path,
    params: &Value,
    profile: Option<&str>,
) -> Result<Config, AppServerError> {
    let env = |name: &str| std::env::var(name).ok();
    let mut layers = vec![
        ConfigLayer::new(LayerSource::Builtin, aphrody_config::builtin_providers_layer_value(&env)),
        ConfigLayer::new(
            LayerSource::Builtin,
            toml::Value::try_from(json!({
                "sandbox_mode": "danger-full-access", "approval_policy": "never",
            }))
            .map_err(invalid)?,
        ),
    ];
    if let Some(user) =
        aphrody_config::load_user_layer(&home.join("config.toml")).map_err(invalid)?
    {
        layers.push(user);
    }
    if let Some(config) = params.get("config").filter(|value| !value.is_null()) {
        if !config.is_object() {
            return Err(invalid("config must be an object"));
        }
        let mut value = toml::Value::try_from(config).map_err(invalid)?;
        for (key, entry) in config.as_object().expect("object checked") {
            if key.contains('.') {
                let (path, _) =
                    aphrody_config::parse_override(&format!("{key}=0")).map_err(invalid)?;
                value.as_table_mut().expect("config table").remove(key);
                aphrody_config::apply_override(
                    &mut value,
                    &path,
                    toml::Value::try_from(entry).map_err(invalid)?,
                );
            }
        }
        layers.push(ConfigLayer::new(LayerSource::CliOverride, value));
    }
    let overrides = CliOverrides {
        model: optional_string(params, "model")?,
        model_provider: optional_string(params, "modelProvider")?,
        oss: optional_bool(params, "oss")?.unwrap_or(false),
        local_provider: optional_string(params, "localProvider")?,
        profile: profile.map(str::to_owned),
        ..CliOverrides::default()
    };
    let (config, _) =
        aphrody_config::resolve(layers, &overrides, "llama", &BTreeMap::new()).map_err(invalid)?;
    if config.approval_policy != aphrody_config::AskForApproval::Never
        || config.sandbox_mode != aphrody_config::SandboxMode::DangerFullAccess
    {
        return Err(invalid(
            "this server requires approval_policy=never and sandbox_mode=danger-full-access; \
             configured restrictions cannot be enforced",
        ));
    }
    Ok(config)
}

pub(crate) fn optional_bool(params: &Value, name: &str) -> Result<Option<bool>, AppServerError> {
    params
        .get(name)
        .filter(|value| !value.is_null())
        .map(|value| value.as_bool().ok_or_else(|| invalid(format!("{name} must be a boolean"))))
        .transpose()
}

pub(crate) fn optional_string(
    params: &Value,
    name: &str,
) -> Result<Option<String>, AppServerError> {
    params
        .get(name)
        .filter(|value| !value.is_null())
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid(format!("{name} must be a string")))
        })
        .transpose()
}

pub(crate) fn validate_session_options(params: &Value) -> Result<(), AppServerError> {
    let custom_prompt = optional_string(params, "systemPrompt")?;
    if custom_prompt.as_deref().is_some_and(|prompt| prompt.trim().is_empty()) {
        return Err(invalid("systemPrompt must not be blank; omit it to use the default"));
    }
    let builtins = optional_bool(params, "builtins")?.unwrap_or(true);
    let subagents = optional_bool(params, "subagents")?;
    crate::host_tools::HostTools::declare("validation", params.get("tools"))?;
    if subagents == Some(true) {
        return Err(invalid("subagent delegation is unsupported on this surface"));
    }
    if let Some(owner) = optional_string(params, "permissions")?
        && !matches!(owner.as_str(), "aphrody" | "jan" | "host")
    {
        return Err(invalid("permissions must be aphrody, jan, or host"));
    }
    if (custom_prompt.is_some() || !builtins)
        && !optional_bool(params, "ephemeral")?.unwrap_or(false)
    {
        return Err(invalid(
            "systemPrompt and builtins overrides currently require ephemeral=true; durable runtime-option replay is not implemented",
        ));
    }
    Ok(())
}

pub(crate) fn runtime(
    config: &Config,
    home: &Path,
    cwd: &Path,
    params: &Value,
) -> Result<RuntimeConfig, AppServerError> {
    validate_session_options(params)?;
    let custom_prompt = optional_string(params, "systemPrompt")?;
    let builtins = optional_bool(params, "builtins")?.unwrap_or(true);
    let mut instructions = vec![crate::system_prompt()];
    instructions.extend(config.instructions.iter().cloned());
    instructions.extend(config.developer_instructions.iter().cloned());
    let mut runtime = RuntimeConfig::new(
        config
            .model
            .clone()
            .unwrap_or_else(|| aphrody_models::LocalRole::Chat.default_model().into()),
    )
    .with_yolo()
    .with_model_provider(config.provider.id.clone())
    .with_cwd(cwd)
    .with_system_prompt(instructions.join("\n\n"))
    .with_live_agent_home_workspace(
        aphrody_agent_home::paths::resolve_workspace(config.active_profile.as_deref(), None)
            .map_err(invalid)?,
    );
    if let Some(limit) = config.model_auto_compact_token_limit {
        let limit = u64::try_from(limit)
            .map_err(|_| invalid("model_auto_compact_token_limit must be nonnegative"))?;
        runtime = runtime.with_auto_compact_token_limit(limit);
    }
    if let Some(limit) = params.get("maxToolIterations") {
        let limit = limit
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or_else(|| invalid("maxToolIterations must be a nonnegative integer"))?;
        runtime = runtime.with_max_tool_iterations(limit);
    }
    if config.rag.enabled == Some(true) {
        runtime = runtime.with_rag_db(rag_db_path(config, home, cwd)?);
    }
    if let Some(tool_profile) = resolve_tool_profile(config, home, cwd)
        .map_err(|error| invalid(format!("cannot resolve tool profile: {error}")))?
    {
        runtime = runtime.with_tool_profile(tool_profile);
    }
    if let Some(prompt) = custom_prompt {
        runtime.system_prompt = Some(prompt);
        runtime.live_agent_home_workspace = None;
    }
    if !builtins {
        // Reuse the runtime's exact allow-list. An empty profile removes all
        // built-ins, skills, plugins and MCP contributions, including RAG.
        runtime.tool_profile = Some(aphrody_agent_runtime::ToolProfileSpec {
            builtin_tools: Some(Default::default()),
            ..Default::default()
        });
        runtime.rag_db = None;
    }
    Ok(runtime)
}

pub(crate) fn rag_db_path(
    config: &Config,
    home: &Path,
    cwd: &Path,
) -> Result<PathBuf, AppServerError> {
    Ok(match config.rag.db_path.as_deref() {
        Some(path) => {
            if let Some(suffix) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
                let user_home =
                    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                        .ok_or_else(|| invalid("cannot expand RAG database home path"))?;
                PathBuf::from(user_home).join(suffix)
            } else if Path::new(path).is_absolute() {
                PathBuf::from(path)
            } else {
                cwd.join(path)
            }
        },
        None => home.join("rag/index.db"),
    })
}
