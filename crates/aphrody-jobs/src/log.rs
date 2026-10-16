// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Per-job NDJSON logs.
//!
//! One append-only file per job, one JSON object per line. Appending rather
//! than accumulating in the database keeps a job that produces megabytes of
//! output from bloating the queue file that every `list` call reads — and lets
//! `tail -f` work on a running job.

use std::{
    io::Write as _,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};

use crate::error::Result;

/// Severity of a log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Normal progress.
    Info,
    /// Something recoverable.
    Warn,
    /// The reason a run failed.
    Error,
}

/// One line of a job's log.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LogLine {
    /// When it was written.
    pub at: DateTime<Utc>,
    /// Severity.
    pub level: LogLevel,
    /// Human-readable message.
    pub message: String,
    /// Optional structured payload, for a machine reader.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Append-only log directory, one file per job.
#[derive(Debug, Clone)]
pub struct JobLogs {
    root: PathBuf,
}

impl JobLogs {
    /// Logs under `root`, one `<job-id>.ndjson` per job.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The directory holding the logs.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Path of one job's log, whether or not it exists yet.
    #[must_use]
    pub fn path_for(&self, job_id: &str) -> PathBuf {
        // Job ids are UUIDs, but a caller-supplied id must never be able to
        // escape the log directory.
        let safe: String = job_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        self.root.join(format!("{safe}.ndjson"))
    }

    /// Append one line.
    ///
    /// # Errors
    ///
    /// [`crate::JobError::Io`] when the directory or file cannot be written,
    /// [`crate::JobError::Json`] when the line cannot be serialised.
    pub fn append(&self, job_id: &str, line: &LogLine) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        let mut file =
            std::fs::OpenOptions::new().create(true).append(true).open(self.path_for(job_id))?;
        let mut encoded = serde_json::to_string(line)?;
        encoded.push('\n');
        file.write_all(encoded.as_bytes())?;
        Ok(())
    }

    /// Append an info line.
    ///
    /// # Errors
    ///
    /// As [`Self::append`].
    pub fn info(&self, job_id: &str, message: impl Into<String>) -> Result<()> {
        self.append(
            job_id,
            &LogLine { at: Utc::now(), level: LogLevel::Info, message: message.into(), data: None },
        )
    }

    /// Append an error line.
    ///
    /// # Errors
    ///
    /// As [`Self::append`].
    pub fn error(&self, job_id: &str, message: impl Into<String>) -> Result<()> {
        self.append(
            job_id,
            &LogLine {
                at: Utc::now(),
                level: LogLevel::Error,
                message: message.into(),
                data: None,
            },
        )
    }

    /// Read a job's log back.
    ///
    /// A line that does not parse is **skipped, not fatal**: a log truncated by
    /// a crash mid-write must still be readable up to the break, which is
    /// exactly when someone needs to read it. `tail` caps the result to the
    /// last N lines.
    ///
    /// # Errors
    ///
    /// [`crate::JobError::Io`] when the file exists but cannot be read.
    pub fn read(&self, job_id: &str, tail: Option<usize>) -> Result<Vec<LogLine>> {
        let path = self.path_for(job_id);
        if !path.is_file() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path)?;
        let mut lines: Vec<LogLine> =
            raw.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        if let Some(n) = tail
            && lines.len() > n
        {
            lines.drain(..lines.len() - n);
        }
        Ok(lines)
    }

    /// Delete a job's log, if it has one. Returns whether a file was removed.
    ///
    /// # Errors
    ///
    /// [`crate::JobError::Io`] when the file exists but cannot be removed.
    pub fn remove(&self, job_id: &str) -> Result<bool> {
        let path = self.path_for(job_id);
        if path.is_file() {
            std::fs::remove_file(path)?;
            return Ok(true);
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_append_in_order_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        logs.info("job-1", "starting").unwrap();
        logs.error("job-1", "boom").unwrap();

        let read = logs.read("job-1", None).unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].message, "starting");
        assert_eq!(read[1].level, LogLevel::Error);
    }

    #[test]
    fn a_job_with_no_log_reads_as_empty_not_as_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(JobLogs::new(dir.path()).read("never-ran", None).unwrap().is_empty());
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        for i in 0..5 {
            logs.info("j", format!("line {i}")).unwrap();
        }
        let read = logs.read("j", Some(2)).unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[1].message, "line 4");
    }

    #[test]
    fn a_truncated_last_line_does_not_lose_the_lines_before_it() {
        // The state a crash mid-write leaves behind - and precisely when the
        // log is worth reading.
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        logs.info("j", "complete line").unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(logs.path_for("j"))
            .unwrap()
            .write_all(b"{\"at\":\"2026-09-07T00:00")
            .unwrap();

        let read = logs.read("j", None).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].message, "complete line");
    }

    #[test]
    fn a_hostile_id_cannot_escape_the_log_directory() {
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        let path = logs.path_for("../../etc/passwd");
        assert_eq!(path.parent(), Some(dir.path()));
        assert!(!path.to_string_lossy().contains(".."));
    }

    #[test]
    fn structured_data_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        logs.append(
            "j",
            &LogLine {
                at: Utc::now(),
                level: LogLevel::Warn,
                message: "partial".into(),
                data: Some(serde_json::json!({ "pages": 3 })),
            },
        )
        .unwrap();
        let read = logs.read("j", None).unwrap();
        assert_eq!(read[0].data, Some(serde_json::json!({ "pages": 3 })));
    }

    #[test]
    fn removing_a_log_reports_whether_there_was_one() {
        let dir = tempfile::tempdir().unwrap();
        let logs = JobLogs::new(dir.path());
        assert!(!logs.remove("j").unwrap());
        logs.info("j", "x").unwrap();
        assert!(logs.remove("j").unwrap());
        assert!(logs.read("j", None).unwrap().is_empty());
    }
}
