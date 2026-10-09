// SPDX-License-Identifier: Apache-2.0
//! Privileged cloud integration subsystem (`cloud`).
//!
//! Exposes native GitHub inspection (status, branches, commit DAG, trees)
//! and Google Cloud integration (GCP auth status, Gemini API configuration, GCS storage)
//! as first-class kernel tools.

use std::path::PathBuf;

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::paths::{EnvLookup, process_env, var};

/// The project `gcp_status` reports when nothing selects one: the historical default of the
/// Aphrody deployment. The report says so (`project_source: "default"`), so a client outside that
/// deployment can tell a configured project from this fallback.
const DEFAULT_GCP_PROJECT: &str = "aphrody-production";

/// Environment variables that select the project, in precedence order after the `project`
/// argument. The first two are the historical ones; the others are the names the Google client
/// libraries and the Aphrody Vertex tooling already use.
const GCP_PROJECT_ENV: [&str; 4] =
    ["CLOUDSDK_CORE_PROJECT", "GCP_PROJECT", "GOOGLE_CLOUD_PROJECT", "APHRODY_VERTEX_PROJECT"];

/// The kernel-owned cloud control plane (GitHub and Google Cloud).
#[derive(Debug, Default)]
pub struct CloudSubsystem;

impl CloudSubsystem {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

/// Runs a synchronous gix inspection off the async runtime.
async fn blocking(
    job: impl FnOnce() -> Result<Value, SubsystemError> + Send + 'static,
) -> Result<Value, SubsystemError> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|e| SubsystemError::Failed(format!("git inspection task failed: {e}")))?
}

fn resolve_repo_path(given: Option<&str>) -> Result<PathBuf, SubsystemError> {
    if let Some(p) = given {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
        return Err(SubsystemError::InvalidArguments(format!(
            "repository path does not exist: {p}"
        )));
    }
    std::env::current_dir().map_err(|e| {
        SubsystemError::Failed(format!("failed to determine current working directory: {e}"))
    })
}

/// The project `gcp_status` reports and where it came from: the `project` argument, then
/// [`GCP_PROJECT_ENV`] in order, then [`DEFAULT_GCP_PROJECT`]. The source is `"argument"`, the
/// name of the variable, or `"default"`. An empty argument or variable counts as unset.
fn resolve_gcp_project(env: EnvLookup<'_>, argument: Option<&str>) -> (String, &'static str) {
    if let Some(project) = argument.filter(|project| !project.is_empty()) {
        return (project.to_owned(), "argument");
    }
    for key in GCP_PROJECT_ENV {
        if let Some(project) = var(env, key) {
            return (project.to_string_lossy().into_owned(), key);
        }
    }
    (DEFAULT_GCP_PROJECT.to_owned(), "default")
}

#[async_trait]
impl SystemSubsystem for CloudSubsystem {
    fn name(&self) -> &'static str {
        "cloud"
    }

    fn description(&self) -> &'static str {
        "Kernel-owned cloud control plane: native GitHub repository status, branch and commit \
         trees, and Google Cloud Platform / Gemini environment inspection."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "github_status",
                "Inspect current branch, ahead/behind tracking, modified/untracked files and recent commits for a Git repository",
                json!({
                    "type": "object",
                    "properties": {
                        "repo_path": {
                            "type": "string",
                            "description": "Path to the git repository (defaults to current working directory)"
                        }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "github_branches",
                "List local and remote-tracking branches (local first, then by name) with upstream and ahead/behind for local branches; filtered and paginated, 50 per page by default",
                json!({
                    "type": "object",
                    "properties": {
                        "repo_path": {
                            "type": "string",
                            "description": "Path to the git repository (defaults to current working directory)"
                        },
                        "filter": {
                            "type": "string",
                            "description": "Case-insensitive substring of the branch name"
                        },
                        "scope": {
                            "type": "string",
                            "enum": ["all", "local", "remote"],
                            "description": "Which branches to list (default all)"
                        },
                        "limit": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": crate::cloud_git::BRANCH_PAGE_MAX,
                            "description": "Page size (default 50)"
                        },
                        "offset": {
                            "type": "integer",
                            "minimum": 0,
                            "description": "Branches to skip; pass the previous next_offset"
                        }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "github_tree",
                "List tree entries (blobs, trees, sizes) at a specific Git reference or path",
                json!({
                    "type": "object",
                    "properties": {
                        "repo_path": {
                            "type": "string",
                            "description": "Path to the git repository (defaults to current working directory)"
                        },
                        "ref_name": {
                            "type": "string",
                            "description": "Git ref or branch name (defaults to HEAD)"
                        },
                        "path": {
                            "type": "string",
                            "description": "Subdirectory path inside the repository"
                        }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "git_ingest",
                "Local directory ingestion moved to the `git_ingest` tool of `bun mcp` (Bun fork, after `bun mcp install`); this tool only returns GIT_INGEST_LOCAL_MOVED",
                json!({
                    "type": "object",
                    "properties": {
                        "repo_path": {
                            "type": "string",
                            "description": "Path to the local repository or directory (defaults to current working directory)"
                        },
                        "max_file_size": {
                            "type": "integer",
                            "description": "Maximum allowed file size in bytes (defaults to 10MB)"
                        },
                        "include_patterns": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Wildcard pattern(s) of files to include"
                        },
                        "exclude_patterns": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Wildcard pattern(s) of files to exclude"
                        }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "gcp_status",
                "Inspect Google Cloud Platform credentials, active project, and Gemini API key availability",
                json!({
                    "type": "object",
                    "properties": {
                        "project": {
                            "type": "string",
                            "description": "Optional project override to verify"
                        }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "gcp_storage_list",
                "List objects and storage prefixes in a Google Cloud Storage bucket",
                json!({
                    "type": "object",
                    "properties": {
                        "bucket": {
                            "type": "string",
                            "description": "GCS bucket name"
                        },
                        "prefix": {
                            "type": "string",
                            "description": "Optional prefix path inside the bucket"
                        }
                    },
                    "required": ["bucket"]
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "github_status" => {
                let repo_path =
                    resolve_repo_path(arguments.get("repo_path").and_then(Value::as_str))?;
                let path = repo_path.clone();
                blocking(move || crate::cloud_git::status(&path)).await
            },
            "github_branches" => {
                let repo_path =
                    resolve_repo_path(arguments.get("repo_path").and_then(Value::as_str))?;
                let query = crate::cloud_git::BranchQuery {
                    filter: arguments.get("filter").and_then(Value::as_str).map(str::to_owned),
                    scope: arguments
                        .get("scope")
                        .and_then(Value::as_str)
                        .unwrap_or("all")
                        .to_owned(),
                    limit: arguments
                        .get("limit")
                        .and_then(Value::as_u64)
                        .map_or(crate::cloud_git::BRANCH_PAGE, |n| {
                            usize::try_from(n).unwrap_or(usize::MAX)
                        }),
                    offset: arguments
                        .get("offset")
                        .and_then(Value::as_u64)
                        .map_or(0, |n| usize::try_from(n).unwrap_or(usize::MAX)),
                };
                blocking(move || crate::cloud_git::branches(&repo_path, &query)).await
            },
            "github_tree" => {
                let repo_path =
                    resolve_repo_path(arguments.get("repo_path").and_then(Value::as_str))?;
                let ref_name = arguments.get("ref_name").and_then(Value::as_str).unwrap_or("HEAD");
                let subpath = arguments.get("path").and_then(Value::as_str).unwrap_or(".");
                let (ref_name, subpath) = (ref_name.to_owned(), subpath.to_owned());
                blocking(move || crate::cloud_git::tree(&repo_path, &ref_name, &subpath)).await
            },
            "git_ingest" => Err(SubsystemError::InvalidArguments(
                "GIT_INGEST_LOCAL_MOVED: local directory ingestion moved to the `git_ingest` tool of `bun mcp` (Bun fork, run `bun mcp install`)"
                    .into(),
            )),
            "gcp_status" => {
                let gemini_key = std::env::var("GEMINI_API_KEY").ok();
                let google_key = std::env::var("GOOGLE_API_KEY").ok();
                let app_credentials = std::env::var("GOOGLE_APPLICATION_CREDENTIALS").ok();
                let (project, project_source) = resolve_gcp_project(
                    &process_env,
                    arguments.get("project").and_then(Value::as_str),
                );

                let has_api_key = gemini_key.is_some() || google_key.is_some();
                let has_service_account =
                    app_credentials.as_ref().map(|p| PathBuf::from(p).exists()).unwrap_or(false);

                Ok(json!({
                    "configured": has_api_key || has_service_account,
                    "gemini_api_key_configured": has_api_key,
                    "service_account_credentials_path": app_credentials,
                    "service_account_valid": has_service_account,
                    "project": project,
                    "project_source": project_source,
                    "auth_provider": if has_service_account { "ServiceAccount" } else if has_api_key { "ApiKey" } else { "None" },
                }))
            },
            "gcp_storage_list" => {
                let bucket = arguments
                    .get("bucket")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SubsystemError::InvalidArguments("missing bucket".into()))?;
                let prefix = arguments.get("prefix").and_then(Value::as_str).unwrap_or("");
                let client = crate::gcs::http_client()?;
                let config =
                    crate::gcs::GcsConfig::from_env(&client, crate::paths::home_dir().as_deref())
                        .await?;
                crate::gcs::list(&client, &config, bucket, prefix).await
            },
            _ => Err(SubsystemError::UnknownTool(tool.to_owned())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::table;

    #[tokio::test]
    async fn cloud_subsystem_declares_tools() {
        let cloud = CloudSubsystem::new();
        assert_eq!(cloud.name(), "cloud");
        let tools = cloud.tools();
        assert_eq!(tools.len(), 6);
        let names: Vec<_> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"github_status"));
        assert!(names.contains(&"github_branches"));
        assert!(names.contains(&"github_tree"));
        assert!(names.contains(&"gcp_status"));
        assert!(names.contains(&"gcp_storage_list"));
        assert!(names.contains(&"git_ingest"));
    }

    #[tokio::test]
    async fn gcp_status_returns_structured_payload() {
        let cloud = CloudSubsystem::new();
        let res = cloud.call("gcp_status", json!({})).await.expect("call");
        assert!(res.get("auth_provider").is_some());
        assert!(res.get("project").is_some());
        assert!(res.get("project_source").is_some());
    }

    #[tokio::test]
    async fn github_status_in_current_repo() {
        let cloud = CloudSubsystem::new();
        let res = cloud.call("github_status", json!({})).await;
        assert!(res.is_ok(), "github_status failed: {:?}", res.err());
        let val = res.unwrap();
        assert!(val.get("branch").is_some());
        assert!(val.get("recent_commits").is_some());
    }

    #[tokio::test]
    async fn github_branches_in_current_repo() {
        let cloud = CloudSubsystem::new();
        let res = cloud.call("github_branches", json!({})).await;
        assert!(res.is_ok(), "github_branches failed: {:?}", res.err());
        let val = res.unwrap();
        assert!(val.get("branches").is_some());
    }

    #[tokio::test]
    async fn github_tree_in_current_repo() {
        let cloud = CloudSubsystem::new();
        let res = cloud.call("github_tree", json!({ "path": "crates" })).await;
        assert!(res.is_ok(), "github_tree failed: {:?}", res.err());
        let val = res.unwrap();
        assert!(val.get("entries").is_some());
    }

    #[tokio::test]
    async fn cloud_subsystem_handles_errors() {
        let cloud = CloudSubsystem::new();
        let res_unknown = cloud.call("nonexistent_cloud_tool", json!({})).await;
        assert!(matches!(res_unknown, Err(SubsystemError::UnknownTool(_))));

        let res_bad_path = cloud
            .call("github_status", json!({ "repo_path": "C:\\nonexistent\\invalid\\path\\12345" }))
            .await;
        assert!(res_bad_path.is_err());
    }

    #[test]
    fn gcp_project_resolution_order_keeps_the_historical_default() {
        // Nothing configured: the historical default, reported as such.
        let none = table::<&str, &str>([]);
        assert_eq!(resolve_gcp_project(&none, None), ("aphrody-production".to_owned(), "default"));
        // Each variable wins over the ones after it, and the argument wins over all of them.
        let all = table([
            ("APHRODY_VERTEX_PROJECT", "vertex"),
            ("GOOGLE_CLOUD_PROJECT", "google"),
            ("GCP_PROJECT", "gcp"),
            ("CLOUDSDK_CORE_PROJECT", "sdk"),
        ]);
        assert_eq!(resolve_gcp_project(&all, None), ("sdk".to_owned(), "CLOUDSDK_CORE_PROJECT"));
        assert_eq!(resolve_gcp_project(&all, Some("given")), ("given".to_owned(), "argument"));
        let without_sdk = table([
            ("APHRODY_VERTEX_PROJECT", "vertex"),
            ("GOOGLE_CLOUD_PROJECT", "google"),
            ("GCP_PROJECT", "gcp"),
        ]);
        assert_eq!(resolve_gcp_project(&without_sdk, None), ("gcp".to_owned(), "GCP_PROJECT"));
        let without_gcp =
            table([("APHRODY_VERTEX_PROJECT", "vertex"), ("GOOGLE_CLOUD_PROJECT", "google")]);
        assert_eq!(
            resolve_gcp_project(&without_gcp, None),
            ("google".to_owned(), "GOOGLE_CLOUD_PROJECT")
        );
        let vertex = table([("APHRODY_VERTEX_PROJECT", "vertex")]);
        assert_eq!(
            resolve_gcp_project(&vertex, None),
            ("vertex".to_owned(), "APHRODY_VERTEX_PROJECT")
        );
    }

    #[test]
    fn empty_gcp_project_inputs_count_as_unset() {
        let env = table([("CLOUDSDK_CORE_PROJECT", ""), ("GCP_PROJECT", "gcp")]);
        assert_eq!(resolve_gcp_project(&env, Some("")), ("gcp".to_owned(), "GCP_PROJECT"));
    }
}
