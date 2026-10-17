// SPDX-License-Identifier: Apache-2.0
//! `sync_external_agents`: mirror the sessions of the other coding agents on
//! this machine (Antigravity CLI, Codex, Claude Code) into
//! `~/.aphrody/sessions/<agent>/<session_id>.jsonl` and return the JSON
//! summary.
//!
//! Same library call as `aphrody ai sync-sessions`
//! ([`aphrody_session::external`]): incremental per-file byte offsets, an
//! exactly-once mirror, optional live-process attribution and the feed of
//! user/assistant turns into the local memory store. Runs on the blocking
//! pool; a concurrent CLI `--watch` loop is serialised by the library's lock.

use aphrody_memory::SqliteLocalProvider;
use aphrody_session::external::{self, AgentKind, SyncOptions};
use rmcp::schemars;

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
pub(crate) struct SyncExternalAgentsRequest {
    #[schemars(
        description = "Only sync this agent: \"agy\" (Antigravity CLI), \"codex\" or \
                              \"claude\" (Claude Code). Omit to sync all three."
    )]
    pub(crate) agent: Option<String>,
    #[schemars(
        description = "Match running agent processes to the sessions they write \
                              (sysinfo). Default true."
    )]
    pub(crate) live: Option<bool>,
    #[schemars(
        description = "Also feed user/assistant turns into the local memory store \
                              (~/.aphrody/memory/memory.sqlite, owner id external:<agent>). \
                              Default true."
    )]
    pub(crate) memory: Option<bool>,
}

/// Run one sync pass and render its summary (or the error) as JSON text.
pub(crate) async fn sync_external_agents(request: SyncExternalAgentsRequest) -> String {
    let agents = match request
        .agent
        .as_deref()
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        Some(raw) => match raw.parse::<AgentKind>() {
            Ok(agent) => vec![agent],
            Err(error) => return error_json(&error.to_string()),
        },
        None => AgentKind::ALL.to_vec(),
    };
    let options = match SyncOptions::discover() {
        Ok(options) => options
            .with_agents(agents)
            .with_probe_processes(request.live.unwrap_or(true)),
        Err(error) => return error_json(&error.to_string()),
    };
    let feed_memory = request.memory.unwrap_or(true);
    let runtime = tokio::runtime::Handle::current();
    let joined = tokio::task::spawn_blocking(move || {
        if feed_memory {
            let store = open_sync_memory(&options)?;
            external::sync_into_memory(&options, &store, &runtime)
                .map_err(|error| error.to_string())
        } else {
            external::sync(&options).map_err(|error| error.to_string())
        }
    })
    .await;
    match joined {
        Ok(Ok(report)) => serde_json::to_string(&report)
            .unwrap_or_else(|error| error_json(&format!("cannot encode the summary: {error}"))),
        Ok(Err(error)) => error_json(&error),
        Err(error) => error_json(&format!("sync task failed: {error}")),
    }
}

fn open_sync_memory(options: &SyncOptions) -> Result<SqliteLocalProvider, String> {
    let Some(domain) = options.domain_filter.as_deref() else {
        return SqliteLocalProvider::open_default().map_err(|error| error.to_string());
    };
    let root = external::domain_profile_dir(domain).map_err(|error| error.to_string())?;
    let state = aphrody_models::paths::state_dir().map_err(|error| error.to_string())?;
    let mut layers = vec![aphrody_config::ConfigLayer::new(
        aphrody_config::LayerSource::Builtin,
        aphrody_config::builtin_providers_layer_value(&|name| std::env::var(name).ok()),
    )];
    if let Some(layer) = aphrody_config::load_user_layer(&state.join("config.toml"))
        .map_err(|error| error.to_string())?
    {
        layers.push(layer);
    }
    let (config, _) = aphrody_config::resolve(
        layers,
        &aphrody_config::CliOverrides {
            profile: Some(domain.to_owned()),
            ..Default::default()
        },
        "llama",
        &std::collections::BTreeMap::new(),
    )
    .map_err(|error| error.to_string())?;
    let services = aphrody_agent_home::ProfileServiceContext::from_config(root, &config)
        .map_err(|error| error.to_string())?;
    SqliteLocalProvider::open_profile(&services).map_err(|error| error.to_string())
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unknown_agent_is_refused_before_touching_the_disk() {
        let out = sync_external_agents(SyncExternalAgentsRequest {
            agent: Some("cursor".to_owned()),
            ..SyncExternalAgentsRequest::default()
        })
        .await;
        let value: serde_json::Value = serde_json::from_str(&out).expect("json");
        assert!(
            value["error"]
                .as_str()
                .is_some_and(|error| error.contains("cursor")),
            "{out}"
        );
    }

    #[test]
    fn the_tool_is_annotated_local_and_non_destructive() {
        let hints = crate::protocol::annotations_for("sync_external_agents");
        assert_eq!(
            hints.open_world_hint,
            Some(false),
            "reads only this machine"
        );
        assert_eq!(hints.destructive_hint, Some(false), "append-only mirror");
        assert_eq!(
            hints.read_only_hint,
            Some(false),
            "writes the mirror and the memory store"
        );
    }

    #[test]
    fn the_request_schema_names_its_three_fields() {
        let schema = rmcp::schemars::schema_for!(SyncExternalAgentsRequest);
        let json = serde_json::to_value(&schema).expect("schema");
        for field in ["agent", "live", "memory"] {
            assert!(
                json["properties"].get(field).is_some(),
                "{field} missing: {json}"
            );
        }
    }
}
