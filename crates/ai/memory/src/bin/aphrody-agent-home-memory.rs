// SPDX-License-Identifier: Apache-2.0
//! Reconcile the seven live Agent Home docs into the existing memory backend.

use std::{env, path::PathBuf};

use aphrody_agent_home::SyncSnapshot;
use aphrody_memory::{agent_home::ingest_agent_home, sqlite::SqliteBackend};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let workspace = PathBuf::from(env::var("APHRODY_AGENT_HOME")?);
    let db = PathBuf::from(env::var("APHRODY_AGENT_HOME_MEMORY_DB")?);
    let parent = db.parent().ok_or("memory database path has no parent")?;
    std::fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let snapshot = SyncSnapshot::capture(workspace)?;
    let mut backend = SqliteBackend::open(&db).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&db, std::fs::Permissions::from_mode(0o600))?;
    }
    let report = ingest_agent_home(&mut backend, &snapshot).await?;
    println!(
        "{}",
        serde_json::json!({"revision":report.revision,"changed":report.changed,"scope":7})
    );
    Ok(())
}
