// SPDX-License-Identifier: Apache-2.0
//! Pipeline execution engine for the active Aphrody monorepo.
//!
//! Orchestrates declared Rust and Bun validation stages from infra/config/pipeline.json.

use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineConfig {
    pub schema_version: u32,
    pub name: String,
    pub authority: String,
    pub workspace_root: Option<String>,
    pub stages: Vec<PipelineStage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStage {
    pub id: String,
    pub parallel: bool,
    pub after_deploy: Option<bool>,
    pub steps: Vec<PipelineStep>,
}

/// Program that runs a step inside its repository.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Runner {
    /// `bun <command>`: `package.json` scripts (default).
    #[default]
    Bun,
    /// `just <command>`: root Justfile recipes, including serialized Cargo gates.
    Just,
}

impl Runner {
    /// Executable name looked up on `PATH`.
    #[must_use]
    pub const fn program(self) -> &'static str {
        match self {
            Self::Bun => "bun",
            Self::Just => "just",
        }
    }

    /// Manifests of which one must exist at the repository root for this runner.
    #[must_use]
    pub const fn manifests(self) -> &'static [&'static str] {
        match self {
            Self::Bun => &["package.json"],
            Self::Just => &["Justfile", "justfile"],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStep {
    pub repo: String,
    #[serde(default)]
    pub runner: Runner,
    pub command: Vec<String>,
}

impl PipelineStep {
    /// Human-readable command line, e.g. `bun run lint` or `just clippy`.
    #[must_use]
    pub fn display(&self) -> String {
        let mut line = self.runner.program().to_owned();
        for part in &self.command {
            line.push(' ');
            line.push_str(part);
        }
        line
    }
}

/// Structural problems of a pipeline definition: unsupported schema, duplicate
/// stage ids, empty stages, invalid repository names and empty commands.
#[must_use]
pub fn check_pipeline(config: &PipelineConfig) -> Vec<String> {
    let mut errors = Vec::new();
    if config.schema_version != 1 {
        errors.push(format!("pipeline: unsupported schemaVersion {}", config.schema_version));
    }
    let mut seen = std::collections::BTreeSet::new();
    for stage in &config.stages {
        if !seen.insert(stage.id.as_str()) {
            errors.push(format!("pipeline: stage {} declared twice", stage.id));
        }
        if stage.steps.is_empty() {
            errors.push(format!("pipeline: stage {} has no step", stage.id));
        }
        for step in &stage.steps {
            if !is_repo_name(&step.repo) {
                errors.push(format!(
                    "pipeline: stage {}: invalid repository name {:?}",
                    stage.id, step.repo
                ));
            }
            if step.command.is_empty() || step.command.iter().any(String::is_empty) {
                errors.push(format!(
                    "pipeline: stage {}: {} has an empty command",
                    stage.id, step.repo
                ));
            }
        }
    }
    errors
}

/// Workspace directory name: lowercase ASCII, digits and `-`.
fn is_repo_name(repo: &str) -> bool {
    repo.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && repo.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepExecutionResult {
    pub repo: String,
    pub command: String,
    pub duration_ms: u64,
    pub success: bool,
    pub exit_code: i32,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageExecutionResult {
    pub stage_id: String,
    pub parallel: bool,
    pub duration_ms: u64,
    pub success: bool,
    pub step_results: Vec<StepExecutionResult>,
}

pub fn load_pipeline_config(root: &Path) -> Result<PipelineConfig> {
    let path = root.join("infra/config/pipeline.json");
    let content =
        fs::read_to_string(&path).with_context(|| format!("lecture {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("désérialisation {}", path.display()))
}

fn resolve_repo_path(workspace_root: &Path, step: &PipelineStep) -> Result<PathBuf> {
    if !is_repo_name(&step.repo) {
        bail!("nom de dépôt invalide: {}", step.repo);
    }
    let target = workspace_root.join(&step.repo);
    if !target.exists() {
        bail!("dépôt introuvable à l'emplacement: {}", target.display());
    }
    let manifests = step.runner.manifests();
    if !manifests.iter().any(|name| target.join(name).is_file()) {
        bail!(
            "{} absent de {} (runner {})",
            manifests.join(" / "),
            target.display(),
            step.runner.program()
        );
    }
    Ok(target)
}

pub fn execute_step(workspace_root: &Path, step: &PipelineStep) -> StepExecutionResult {
    let start = Instant::now();
    let cmd_str = step.display();

    let repo_dir = match resolve_repo_path(workspace_root, step) {
        Ok(p) => p,
        Err(e) => {
            return StepExecutionResult {
                repo: step.repo.clone(),
                command: cmd_str,
                duration_ms: start.elapsed().as_millis() as u64,
                success: false,
                exit_code: -1,
                output: e.to_string(),
            };
        },
    };

    let mut cmd = Command::new(step.runner.program()).no_window();
    cmd.args(&step.command);
    cmd.current_dir(&repo_dir);

    match cmd.output() {
        Ok(out) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            let success = out.status.success();
            let mut combined = String::from_utf8_lossy(&out.stdout).to_string();
            if !out.stderr.is_empty() {
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&String::from_utf8_lossy(&out.stderr));
            }
            StepExecutionResult {
                repo: step.repo.clone(),
                command: cmd_str,
                duration_ms,
                success,
                exit_code: out.status.code().unwrap_or(-1),
                output: combined.trim().to_string(),
            }
        },
        Err(e) => StepExecutionResult {
            repo: step.repo.clone(),
            command: cmd_str,
            duration_ms: start.elapsed().as_millis() as u64,
            success: false,
            exit_code: -1,
            output: e.to_string(),
        },
    }
}

pub fn run_stage(workspace_root: &Path, stage: &PipelineStage) -> StageExecutionResult {
    let start = Instant::now();
    let mut step_results = Vec::new();
    let mut success = true;

    for step in &stage.steps {
        let res = execute_step(workspace_root, step);
        if !res.success {
            success = false;
        }
        step_results.push(res);
    }

    StageExecutionResult {
        stage_id: stage.id.clone(),
        parallel: stage.parallel,
        duration_ms: start.elapsed().as_millis() as u64,
        success,
        step_results,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pipeline_config_structure() {
        let json_data = r#"{
            "schemaVersion": 1,
            "name": "test-pipeline",
            "authority": "@aphrody/workspace",
            "workspaceRoot": "../",
            "stages": [
                {
                    "id": "format",
                    "parallel": true,
                    "steps": [
                        { "repo": "aphrody", "command": ["run", "monorepo:layout"] }
                    ]
                }
            ]
        }"#;

        let config: PipelineConfig =
            serde_json::from_str(json_data).expect("valid pipeline config");
        assert_eq!(config.schema_version, 1);
        assert_eq!(config.name, "test-pipeline");
        assert_eq!(config.stages.len(), 1);
        assert_eq!(config.stages[0].id, "format");
        assert_eq!(config.stages[0].steps[0].repo, "aphrody");
        assert_eq!(config.stages[0].steps[0].runner, Runner::Bun);
        assert_eq!(config.stages[0].steps[0].display(), "bun run monorepo:layout");
        assert!(check_pipeline(&config).is_empty());
    }

    #[test]
    fn parses_just_runner_and_rejects_unknown_runner() {
        let step: PipelineStep = serde_json::from_str(
            r#"{ "repo": "aphrody", "runner": "just", "command": ["clippy"] }"#,
        )
        .expect("just step");
        assert_eq!(step.runner, Runner::Just);
        assert_eq!(step.display(), "just clippy");
        assert!(
            serde_json::from_str::<PipelineStep>(
                r#"{ "repo": "x", "runner": "make", "command": ["all"] }"#
            )
            .is_err()
        );
    }

    #[test]
    fn check_pipeline_reports_structural_errors() {
        let config: PipelineConfig = serde_json::from_str(
            r#"{
                "schemaVersion": 1, "name": "p", "authority": "aphrody-infra",
                "stages": [
                    { "id": "lint", "parallel": true, "steps": [
                        { "repo": "../escape", "command": ["run", "lint"] },
                        { "repo": "rg", "command": [] }
                    ]},
                    { "id": "lint", "parallel": false, "steps": [] }
                ]
            }"#,
        )
        .expect("pipeline");
        let errors = check_pipeline(&config);
        let has = |needle: &str| errors.iter().any(|e| e.contains(needle));
        assert!(has("invalid repository name"), "{errors:?}");
        assert!(has("rg has an empty command"), "{errors:?}");
        assert!(has("declared twice"), "{errors:?}");
        assert!(has("has no step"), "{errors:?}");
    }

    #[test]
    fn execute_step_requires_the_runner_manifest() {
        let workspace = tempfile::tempdir().expect("workspace");
        std::fs::create_dir(workspace.path().join("rusty")).expect("repo dir");
        let step = PipelineStep {
            repo: "rusty".into(),
            runner: Runner::Just,
            command: vec!["check".into()],
        };
        let result = execute_step(workspace.path(), &step);
        assert!(!result.success);
        assert_eq!(result.command, "just check");
        assert!(result.output.contains("Justfile"), "{}", result.output);
    }

    #[test]
    fn repository_pipeline_is_well_formed() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let config = load_pipeline_config(&root).expect("infra/config/pipeline.json");
        assert_eq!(check_pipeline(&config), Vec::<String>::new());
        assert!(
            config
                .stages
                .iter()
                .flat_map(|stage| &stage.steps)
                .any(|step| step.runner == Runner::Just),
            "the root Cargo gates run through the serial Just recipes"
        );
        assert!(
            config.stages.iter().flat_map(|stage| &stage.steps).all(|step| step.repo == "aphrody")
        );
    }
}
