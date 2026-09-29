// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! Typed Rust access to Aphrody Web Browser Actors shared with Bun and MCP.
//!
//! The web runtime owns discovery and execution. This module only drives its bounded JSON
//! CLI contract; it never implements a second Actor engine.

use std::{
    io::Write as _,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    BxcCli,
    cli::Run,
    error::{BxcError, Result},
};

/// Default deadline for Actor discovery.
pub const LIST_BUDGET: Duration = Duration::from_secs(30);
/// Default deadline for one Actor run. Callers can supply a larger budget.
pub const RUN_BUDGET: Duration = Duration::from_secs(300);

/// Actor discovered by Aphrody Web Browser, including installed package Actors.
#[derive(Debug, Clone, Deserialize)]
pub struct ActorManifest {
    /// Stable Actor name.
    pub name: String,
    /// Optional display title.
    pub title: Option<String>,
    /// Optional description.
    pub description: Option<String>,
    /// Directory containing the Actor manifest.
    pub path: PathBuf,
}

/// An Actor invocation. `actor` may be a discovered name or an explicit path.
#[derive(Debug, Clone)]
pub struct ActorRunRequest {
    /// Actor name or path.
    pub actor: String,
    /// JSON input written to the Actor's default key-value store.
    pub input: Option<Value>,
    /// Output directory. When absent, a private temporary directory is created.
    pub storage_dir: Option<PathBuf>,
    /// Whether BXC purges an existing storage directory before the run.
    pub purge: bool,
}

impl ActorRunRequest {
    /// Create a run with default storage and purge settings.
    #[must_use]
    pub fn new(actor: impl Into<String>) -> Self {
        Self { actor: actor.into(), input: None, storage_dir: None, purge: true }
    }
}

/// Structured result from Aphrody Web Browser's Actor runtime.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorRunResult {
    /// Actor name or path used for the run.
    pub actor: String,
    /// Absolute output directory retained after the run.
    pub storage_dir: PathBuf,
    /// JSON written by the Actor, when it produced `OUTPUT.json`.
    pub output: Option<Value>,
}

impl BxcCli {
    /// Discover Actors from Aphrody Web Browser and installed Web packages.
    ///
    /// # Errors
    /// Returns a typed CLI error on timeout, nonzero exit or malformed JSON.
    pub async fn list_actors(&self, budget: Duration) -> Result<Vec<ActorManifest>> {
        let run = self.run(&["actor".into(), "list".into(), "--json".into()], budget).await?;
        let body = checked_json(self, &run, budget)?;
        serde_json::from_str(body).map_err(|error| BxcError::CliOutput {
            bin: self.path().to_path_buf(),
            expected: "Actor manifest array JSON",
            detail: error.to_string(),
        })
    }

    /// Run one Actor through Aphrody Web Browser and return its structured result.
    ///
    /// When no directory is supplied, the returned directory remains available
    /// for inspection. The caller owns its eventual cleanup.
    ///
    /// # Errors
    /// Returns a typed CLI error on timeout, nonzero exit or malformed JSON.
    pub async fn run_actor(
        &self,
        request: &ActorRunRequest,
        budget: Duration,
    ) -> Result<ActorRunResult> {
        let storage_dir = match &request.storage_dir {
            Some(path) => path.clone(),
            None => create_storage_dir()?,
        };
        let mut args = vec![
            "actor".into(),
            "run".into(),
            request.actor.clone(),
            "--storage-dir".into(),
            storage_dir.to_string_lossy().into_owned(),
            "--json".into(),
        ];
        let input_file = request.input.as_ref().map(create_input_file).transpose()?;
        if let Some(file) = &input_file {
            args.push("--input-file".into());
            args.push(file.0.to_string_lossy().into_owned());
        }
        if !request.purge {
            args.push("--no-purge".into());
        }
        let run = self.run(&args, budget).await;
        drop(input_file);
        let run = run?;
        let body = checked_json(self, &run, budget)?;
        serde_json::from_str(body).map_err(|error| BxcError::CliOutput {
            bin: self.path().to_path_buf(),
            expected: "Actor run result JSON",
            detail: error.to_string(),
        })
    }
}

fn checked_json<'a>(cli: &BxcCli, run: &'a Run, budget: Duration) -> Result<&'a str> {
    if run.timed_out {
        return Err(BxcError::CliTimeout {
            bin: cli.path().to_path_buf(),
            secs: budget.as_secs(),
            bytes: run.stdout.len(),
        });
    }
    if !run.ok() {
        // Actor input can contain credentials. Never put CLI arguments or raw
        // child output into a public error.
        return Err(BxcError::CliFailed {
            bin: cli.path().to_path_buf(),
            args: "actor [input redacted]".into(),
            code: run.code.map_or_else(|| "no exit code".into(), |code| code.to_string()),
            detail: String::new(),
        });
    }
    let body = run.stdout.trim();
    if body.is_empty() {
        return Err(BxcError::CliOutput {
            bin: cli.path().to_path_buf(),
            expected: "Actor JSON",
            detail: "empty stdout".into(),
        });
    }
    Ok(body)
}

fn create_storage_dir() -> Result<PathBuf> {
    let ticks = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    for attempt in 0..8 {
        let path = std::env::temp_dir()
            .join(format!("aphrody-actor-{}-{ticks}-{attempt}", std::process::id()));
        #[cfg(unix)]
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(not(unix))]
        let builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt as _;
            builder.mode(0o700);
        }
        match builder.create(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(source) => return Err(BxcError::ActorStorage { path, source }),
        }
    }
    let path = std::env::temp_dir().join(format!("aphrody-actor-{}-{ticks}", std::process::id()));
    Err(BxcError::ActorStorage {
        path,
        source: std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Actor storage directory collision",
        ),
    })
}

struct ActorInputFile(PathBuf);

impl Drop for ActorInputFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn create_input_file(input: &Value) -> Result<ActorInputFile> {
    let ticks = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    for attempt in 0..8 {
        let path = std::env::temp_dir()
            .join(format!("aphrody-actor-input-{}-{ticks}-{attempt}.json", std::process::id()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                let guard = ActorInputFile(path.clone());
                file.write_all(input.to_string().as_bytes())
                    .map_err(|source| BxcError::ActorInput { path, source })?;
                return Ok(guard);
            },
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(source) => return Err(BxcError::ActorInput { path, source }),
        }
    }
    let path = std::env::temp_dir()
        .join(format!("aphrody-actor-input-{}-{ticks}.json", std::process::id()));
    Err(BxcError::ActorInput {
        path,
        source: std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Actor input file collision",
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::Source;

    #[test]
    fn malformed_and_failed_runs_keep_input_out_of_errors() {
        let cli = BxcCli::from_source(Source::Path(PathBuf::from("bxc")));
        let run = Run {
            args: vec!["actor".into(), "run".into(), "--input".into(), "secret-value".into()],
            code: Some(65),
            stdout: "secret-value".into(),
            stderr: "secret-value".into(),
            timed_out: false,
        };
        let error = checked_json(&cli, &run, RUN_BUDGET).unwrap_err().to_string();
        assert!(!error.contains("secret-value"));
        assert!(error.contains("65"));
    }

    #[test]
    fn input_file_is_private_and_removed() {
        let file = create_input_file(&serde_json::json!({"token": "secret-value"})).unwrap();
        let path = file.0.clone();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"token":"secret-value"}"#);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o077, 0);
        }
        drop(file);
        assert!(!path.exists());
    }
}
