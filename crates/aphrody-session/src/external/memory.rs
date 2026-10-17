// SPDX-License-Identifier: Apache-2.0
//! Feed synced records into aphrody's long-term memory through the Tier-1
//! [`MemoryProvider`] trait of `aphrody-memory` (the same surface the chat
//! loop recalls from; locally `SqliteLocalProvider::open_default`).
//!
//! Only conversational records are fed ([`MEMORY_ROLES`]: what the user asked
//! and what the agent answered); tool calls, tool output and reasoning stay in
//! the mirror, where they are complete. Each external agent writes under its
//! own owner id ([`memory_agent_id`], e.g. `external:codex`), so the chat
//! loop's own recall — keyed by its agent id — is not diluted, while a caller
//! can recall across agents explicitly.
//!
//! Record ids are deterministic ([`memory_record_id`]): a batch fed twice
//! (a run rolled back after the feed, then retried) replaces rather than
//! duplicates in providers that honour the id (`SqliteLocalProvider` upserts).

use aphrody_memory::{
    provider::MemoryProvider,
    types::{MemoryError, MemoryQuery, MemoryRecord, now_unix_ms},
};
use serde_json::json;

use super::{
    AgentKind, ExternalRecord, MemoryFeedReport, Role, SyncError, SyncOptions, SyncReport,
    sync_with,
};

/// Roles fed into memory.
pub const MEMORY_ROLES: [Role; 2] = [Role::User, Role::Assistant];

/// Memory owner id of an external agent's records.
#[must_use]
pub fn memory_agent_id(agent: AgentKind) -> String {
    format!("external:{agent}")
}

/// Recall recent conversations from all coding agents in one workspace.
/// Unknown workspaces are excluded; native ownership and record ids remain intact.
///
/// # Errors
/// Returns the underlying provider search error.
pub async fn workspace_memory(
    provider: &dyn MemoryProvider,
    workspace: &std::path::Path,
    limit: usize,
) -> Result<Vec<MemoryRecord>, MemoryError> {
    let workspace = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    let mut records = Vec::new();
    for agent in [AgentKind::Claude, AgentKind::Codex, AgentKind::Agy] {
        for record in provider
            .search(MemoryQuery::for_agent(memory_agent_id(agent)))
            .await?
        {
            let Some(path) = record.metadata["workspace"].as_str() else {
                continue;
            };
            let path = std::path::Path::new(path);
            if path.canonicalize().unwrap_or_else(|_| path.to_path_buf()) == workspace {
                records.push(record);
            }
        }
    }
    records.sort_by(|a, b| {
        b.created_at_unix_ms
            .cmp(&a.created_at_unix_ms)
            .then(a.id.cmp(&b.id))
    });
    records.truncate(limit);
    Ok(records)
}

/// Deterministic memory id of a record.
#[must_use]
pub fn memory_record_id(record: &ExternalRecord) -> String {
    format!(
        "external:{}:{}:{}:{}",
        record.agent, record.session_id, record.offset, record.part
    )
}

/// The memory entry of a synced record.
#[must_use]
pub fn to_memory_record(record: &ExternalRecord) -> MemoryRecord {
    let created_at_unix_ms = record
        .ts
        .and_then(|ts| u64::try_from(ts.timestamp_millis()).ok())
        .unwrap_or_else(now_unix_ms);
    MemoryRecord {
        id: memory_record_id(record),
        agent_id: memory_agent_id(record.agent),
        content: record.text.clone(),
        tags: vec![
            "external-session".to_owned(),
            record.agent.as_str().to_owned(),
            record.role.as_str().to_owned(),
        ],
        created_at_unix_ms,
        metadata: json!({
            "session_id": record.session_id,
            "workspace": record.workspace,
            "role": record.role,
            "ts": record.ts,
            "source_path": record.source_path,
            "offset": record.offset,
            "part": record.part,
            "truncated": record.truncated,
        }),
    }
}

/// Add the conversational records of `records` to `provider`. Returns how
/// many were written.
///
/// # Errors
///
/// The first [`MemoryError`] the provider returns; records before it are
/// already written (and are idempotent on retry).
pub async fn feed_memory(
    provider: &dyn MemoryProvider,
    records: &[ExternalRecord],
) -> Result<u64, MemoryError> {
    let mut fed = 0;
    for record in records
        .iter()
        .filter(|record| MEMORY_ROLES.contains(&record.role))
    {
        provider.add(to_memory_record(record)).await?;
        fed += 1;
    }
    Ok(fed)
}

/// [`sync_with`] whose sink is [`feed_memory`]: each batch is written to its
/// mirror, then fed to `provider`, then committed. A provider failure rolls
/// the batch's source back (reported as an issue) so the next run retries it.
///
/// `runtime` drives the provider's futures from the calling thread, which must
/// not be a runtime worker: call this from `tokio::task::spawn_blocking` (or
/// from plain synchronous code).
///
/// # Errors
///
/// See [`sync_with`].
pub fn sync_into_memory(
    options: &SyncOptions,
    provider: &dyn MemoryProvider,
    runtime: &tokio::runtime::Handle,
) -> Result<SyncReport, SyncError> {
    let mut fed = 0u64;
    let mut report = sync_with(options, |batch| {
        fed += runtime
            .block_on(feed_memory(provider, batch))
            .map_err(|error| error.to_string())?;
        Ok(())
    })?;
    report.memory = Some(MemoryFeedReport {
        provider: provider.provider_kind().as_str().to_owned(),
        records_fed: fed,
        roles: MEMORY_ROLES.to_vec(),
    });
    Ok(report)
}
