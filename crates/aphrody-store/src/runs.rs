// SPDX-License-Identifier: Apache-2.0
//! Pipeline run journal.

use rusqlite::{OptionalExtension as _, params};
use serde::{Deserialize, Serialize};

use crate::{
    db::HomeDb,
    error::{Result, StoreError},
    time::now_ms,
};

/// Terminal and live states of a pipeline run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    /// In progress.
    Running,
    /// Finished normally.
    Succeeded,
    /// Finished with an error.
    Failed,
    /// Left `running` by a process that died.
    Interrupted,
}

impl RunStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(label: &str) -> Result<Self> {
        Ok(match label {
            "running" => Self::Running,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            "interrupted" => Self::Interrupted,
            other => return Err(StoreError::Invalid(format!("unknown run status `{other}`"))),
        })
    }
}

/// One journal row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunSummary {
    /// Run id.
    pub id: i64,
    /// Source the run worked on, if any.
    pub source_id: Option<i64>,
    /// Stage label (or `pipeline` for a whole run).
    pub stage: String,
    /// Status.
    pub status: RunStatus,
    /// Start, Unix milliseconds.
    pub started_at_ms: i64,
    /// End, Unix milliseconds.
    pub finished_at_ms: Option<i64>,
    /// Counters reported by the stage.
    pub stats: serde_json::Value,
    /// Error text of a failed run.
    pub error: Option<String>,
}

impl HomeDb {
    /// Start a run and return its id.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn begin_run(&self, source_id: Option<i64>, stage: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO pipeline_runs (source_id, stage, started_at_ms) VALUES (?1, ?2, ?3)",
            params![source_id, stage, now_ms()],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Finish a run. A `Failed` status requires an error text.
    ///
    /// # Errors
    ///
    /// [`StoreError::Invalid`] for `Running` or a `Failed` status without error, or SQLite
    /// failures.
    pub fn finish_run(
        &self,
        id: i64,
        status: RunStatus,
        stats: &serde_json::Value,
        error: Option<&str>,
    ) -> Result<()> {
        match (status, error) {
            (RunStatus::Running, _) => {
                return Err(StoreError::Invalid(
                    "a finished run cannot be `running`".into(),
                ));
            }
            (RunStatus::Failed, None) => {
                return Err(StoreError::Invalid("a failed run needs an error".into()));
            }
            _ => {}
        }
        self.conn.execute(
            "UPDATE pipeline_runs SET status = ?2, finished_at_ms = ?3, stats_json = ?4, error = ?5
             WHERE id = ?1",
            params![
                id,
                status.as_str(),
                now_ms(),
                serde_json::to_string(stats)?,
                error
            ],
        )?;
        Ok(())
    }

    /// Mark every `running` run as `interrupted` (call at startup when no other pipeline holds
    /// the database). Returns the number of runs changed.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn interrupt_stale_runs(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "UPDATE pipeline_runs SET status = 'interrupted', finished_at_ms = ?1
             WHERE status = 'running'",
            [now_ms()],
        )?)
    }

    /// The most recent run of a stage.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn last_run(&self, stage: &str) -> Result<Option<RunSummary>> {
        let row = self
            .conn
            .query_row(
                "SELECT id, source_id, stage, status, started_at_ms, finished_at_ms, stats_json, error
                 FROM pipeline_runs WHERE stage = ?1 ORDER BY id DESC LIMIT 1",
                [stage],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, Option<i64>>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, Option<String>>(7)?,
                    ))
                },
            )
            .optional()?;
        row.map(
            |(id, source_id, stage, status, started, finished, stats, error)| {
                Ok(RunSummary {
                    id,
                    source_id,
                    stage,
                    status: RunStatus::parse(&status)?,
                    started_at_ms: started,
                    finished_at_ms: finished,
                    stats: serde_json::from_str(&stats)?,
                    error,
                })
            },
        )
        .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_journaled_from_start_to_finish() {
        let db = HomeDb::open_in_memory().unwrap();
        let id = db.begin_run(None, "scan").unwrap();
        assert_eq!(
            db.last_run("scan").unwrap().unwrap().status,
            RunStatus::Running
        );
        db.finish_run(
            id,
            RunStatus::Succeeded,
            &serde_json::json!({"files": 3}),
            None,
        )
        .unwrap();
        let run = db.last_run("scan").unwrap().unwrap();
        assert_eq!(run.status, RunStatus::Succeeded);
        assert_eq!(run.stats["files"], 3);
        assert!(run.finished_at_ms.is_some());
        assert!(db.last_run("index").unwrap().is_none());
    }

    #[test]
    fn failures_need_an_error_and_running_cannot_finish() {
        let db = HomeDb::open_in_memory().unwrap();
        let id = db.begin_run(None, "chunk").unwrap();
        assert!(
            db.finish_run(id, RunStatus::Failed, &serde_json::json!({}), None)
                .is_err()
        );
        assert!(
            db.finish_run(id, RunStatus::Running, &serde_json::json!({}), None)
                .is_err()
        );
        db.finish_run(id, RunStatus::Failed, &serde_json::json!({}), Some("boom"))
            .unwrap();
        assert_eq!(
            db.last_run("chunk").unwrap().unwrap().error.as_deref(),
            Some("boom")
        );
    }

    #[test]
    fn stale_running_runs_become_interrupted() {
        let db = HomeDb::open_in_memory().unwrap();
        db.begin_run(None, "embed").unwrap();
        assert_eq!(db.interrupt_stale_runs().unwrap(), 1);
        assert_eq!(
            db.last_run("embed").unwrap().unwrap().status,
            RunStatus::Interrupted
        );
        assert_eq!(db.interrupt_stale_runs().unwrap(), 0);
    }
}
