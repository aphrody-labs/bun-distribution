// SPDX-License-Identifier: Apache-2.0
//! Idempotent bridge from Agent Home revisions into the existing memory SDK.

use aphrody_agent_home::SyncSnapshot;

use crate::{MemoryBackend, MemoryError, MemoryRecord};

/// Number of changed records and the coherent Agent Home revision.
#[derive(Debug, Clone)]
pub struct IngestReport {
    /// Content-addressed revision of all seven default documents.
    pub revision: String,
    /// Number of records inserted or updated.
    pub changed: usize,
}

/// Upsert the seven validated documents into a memory backend. Unchanged
/// documents retain their record ID, creation time and embedding.
pub async fn ingest_agent_home(
    backend: &mut impl MemoryBackend,
    snapshot: &SyncSnapshot,
) -> Result<IngestReport, MemoryError> {
    let mut changed = 0;
    for doc in &snapshot.documents {
        let key = format!("agent-home/{}", doc.filename);
        let previous = backend.get(&key).await?;
        if previous.as_ref().and_then(|record| record.metadata.get("blake3"))
            == Some(&serde_json::Value::String(doc.hash.clone()))
        {
            continue;
        }
        let mut record =
            previous.unwrap_or_else(|| MemoryRecord::new("agent_home_directives", &doc.content));
        record.ns = "agent_home_directives".into();
        record.content.clone_from(&doc.content);
        record.embedding = None; // A changed directive invalidates its former vector.
        record.updated_at = chrono::Utc::now();
        record.metadata.insert("filename".into(), serde_json::Value::String(doc.filename.clone()));
        record.metadata.insert("blake3".into(), serde_json::Value::String(doc.hash.clone()));
        record
            .metadata
            .insert("revision".into(), serde_json::Value::String(snapshot.revision.clone()));
        backend.put(&key, record).await?;
        changed += 1;
    }
    Ok(IngestReport { revision: snapshot.revision.clone(), changed })
}
