// SPDX-License-Identifier: Apache-2.0
// Derived from BXC scripts/consolidate-dragonball-crawls.ts (Apache-2.0).
//! Non-destructive consolidation retains every raw field in a protected read
//! model. Domain projection is a separate operation with source-policy checks.
use super::documents::write_private;
use super::export_bxc;
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConsolidatedDragonBallReport {
    pub schema: String,
    pub inputs: Vec<PathBuf>,
    pub rows_read: usize,
    pub records: usize,
    pub database: PathBuf,
    pub jsonl: PathBuf,
    pub exported_documents: usize,
}

pub fn consolidate_bxc(
    databases: &[PathBuf],
    output: &Path,
) -> Result<ConsolidatedDragonBallReport, String> {
    if databases.is_empty() {
        return Err("at least one BXC database is required".into());
    }
    std::fs::create_dir_all(output).map_err(|error| error.to_string())?;
    let destination = output.join("bxc.sqlite");
    if destination.exists() {
        return Err(format!(
            "refusing to overwrite existing consolidated database: {}",
            destination.display()
        ));
    }
    let temp = output.join(format!(".bxc-{}.sqlite", std::process::id()));
    let mut create = std::fs::OpenOptions::new();
    create.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        create.mode(0o600);
    }
    let file = create.open(&temp).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    let result = (|| {
        let mut output_db = Connection::open(&temp).map_err(|error| error.to_string())?;
        output_db.execute_batch("PRAGMA journal_mode=DELETE;CREATE TABLE scrapes(id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT NOT NULL UNIQUE,profile TEXT NOT NULL,status INTEGER,content TEXT,metadata TEXT,markdown TEXT,json_data TEXT,openapi_spec TEXT,vector TEXT,timestamp TEXT NOT NULL);CREATE INDEX idx_scrapes_timestamp ON scrapes(timestamp);CREATE VIRTUAL TABLE scrapes_fts USING fts5(url,title,markdown);").map_err(|error|error.to_string())?;
        let transaction = output_db.transaction().map_err(|error| error.to_string())?;
        let mut rows_read = 0;
        for path in databases {
            let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| error.to_string())?;
            let columns = source
                .prepare("PRAGMA table_info(scrapes)")
                .map_err(|error| error.to_string())?
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|error| error.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?;
            if columns.is_empty() {
                return Err(format!("{} has no scrapes table", path.display()));
            }
            let fields = [
                "url",
                "profile",
                "status",
                "content",
                "metadata",
                "markdown",
                "json_data",
                "openapi_spec",
                "vector",
                "timestamp",
            ];
            let projection = fields
                .iter()
                .map(
                    |field| {
                        if columns.iter().any(|column| column == field) { *field } else { "NULL" }
                    },
                )
                .collect::<Vec<_>>()
                .join(",");
            let mut query = source
                .prepare(&format!("SELECT {projection} FROM scrapes ORDER BY id"))
                .map_err(|error| error.to_string())?;
            let mut rows = query.query([]).map_err(|error| error.to_string())?;
            while let Some(row) = rows.next().map_err(|error| error.to_string())? {
                let url: Option<String> = row.get(0).map_err(|error| error.to_string())?;
                let Some(url) = url.filter(|url| !url.is_empty()) else { continue };
                let metadata: Option<String> = row.get(4).map_err(|error| error.to_string())?;
                let mut metadata_value = metadata
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<Value>(value).ok())
                    .and_then(|value| value.as_object().cloned())
                    .unwrap_or_default();
                if let Some(raw) = metadata {
                    metadata_value.insert("originalMetadata".into(), json!(raw));
                }
                metadata_value.insert("crawlSource".into(), json!(path));
                transaction.execute("INSERT INTO scrapes(url,profile,status,content,metadata,markdown,json_data,openapi_spec,vector,timestamp) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(url) DO UPDATE SET profile=excluded.profile,status=excluded.status,content=excluded.content,metadata=excluded.metadata,markdown=excluded.markdown,json_data=excluded.json_data,openapi_spec=excluded.openapi_spec,vector=excluded.vector,timestamp=excluded.timestamp WHERE excluded.timestamp>=scrapes.timestamp",params![url,row.get::<_,Option<String>>(1).map_err(|error|error.to_string())?.unwrap_or_else(||"unknown".into()),row.get::<_,Option<i64>>(2).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(3).map_err(|error|error.to_string())?,serde_json::to_string(&metadata_value).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(5).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(6).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(7).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(8).map_err(|error|error.to_string())?,row.get::<_,Option<String>>(9).map_err(|error|error.to_string())?.unwrap_or_else(||"1970-01-01T00:00:00Z".into())]).map_err(|error|error.to_string())?;
                rows_read += 1;
            }
        }
        transaction.execute_batch("INSERT INTO scrapes_fts(rowid,url,title,markdown) SELECT id,url,coalesce(json_extract(metadata,'$.title'),''),coalesce(markdown,'') FROM scrapes;").map_err(|error|error.to_string())?;
        let records = transaction
            .query_row("SELECT count(*) FROM scrapes", [], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?;
        let records = usize::try_from(records).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        drop(output_db);
        std::fs::rename(&temp, &destination).map_err(|error| error.to_string())?;
        let jsonl = output.join("shenron-documents.jsonl");
        let exported_documents = export_bxc(std::slice::from_ref(&destination), &jsonl)?;
        let report = ConsolidatedDragonBallReport {
            schema: "aphrody-dragon-ball-consolidated/v1".into(),
            inputs: databases.to_vec(),
            rows_read,
            records,
            database: destination.clone(),
            jsonl,
            exported_documents,
        };
        write_private(
            &output.join("manifest.json"),
            &serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
        )?;
        Ok(report)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_consolidation_preserves_original_fields_and_source_databases() {
        let dir = std::env::temp_dir()
            .join(format!("aphrody-dragon-ball-consolidation-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.sqlite");
        let source = Connection::open(&input).unwrap();
        source.execute_batch("CREATE TABLE scrapes(id INTEGER PRIMARY KEY,url TEXT,profile TEXT,status INTEGER,content TEXT,metadata TEXT,markdown TEXT,json_data TEXT,openapi_spec TEXT,vector TEXT,timestamp TEXT);INSERT INTO scrapes VALUES(1,'https://www.kanzenshuu.com/test/','static',200,'raw','{\"title\":\"old\"}','old','{}','spec','vector','2026-01-01T00:00:00Z'),(2,'https://www.kanzenshuu.com/test/','static',200,'raw2','{\"title\":\"new\"}','new','{}','spec2','vector2','2026-01-02T00:00:00Z');").unwrap();
        drop(source);
        let before = std::fs::read(&input).unwrap();
        let report = consolidate_bxc(std::slice::from_ref(&input), &dir.join("merged")).unwrap();
        assert_eq!(report.rows_read, 2);
        assert_eq!(report.records, 1);
        assert_eq!(report.exported_documents, 1);
        assert_eq!(before, std::fs::read(&input).unwrap());
        let db = Connection::open_with_flags(&report.database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
        assert_eq!(
            db.query_row("SELECT vector FROM scrapes", [], |row| row.get::<_, String>(0)).unwrap(),
            "vector2"
        );
        assert!(consolidate_bxc(&[input], &dir.join("merged")).is_err());
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
