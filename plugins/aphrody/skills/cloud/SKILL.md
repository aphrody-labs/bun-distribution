---
name: cloud
description: "Kernel cloud control plane: native GitHub inspection (status, branches, commit trees) and Google Cloud Platform / Gemini environment and GCS storage tools."
---

# cloud — kernel cloud control plane

The `cloud` subsystem (`crates/os/kernel/src/cloud.rs`) embeds native, privileged
Git repository analysis and Google Cloud Platform / Gemini environment verification
directly into `aphrody-kernel`. All tools are read-only and run in-process.

## GitHub tools

| Tool | Parameters | Description |
|---|---|---|
| `github_status` | `repo_path?: string` | Current branch, upstream tracking (`ahead`/`behind` counters), status porcelain v1 modified and untracked file inventory, and recent commit history. |
| `github_branches` | `repo_path?: string` | Local and tracking remote branches with commit SHA, upstream target and divergence status. |
| `github_tree` | `repo_path?: string`, `ref_name?: string`, `path?: string` | List tree entries (mode, blob/tree type, SHA, size, and relative path) at a specific Git reference (default `HEAD`) or subdirectory (`path`). |
| `git_ingest` | `repo_path?: string`, `max_file_size?: number`, `include_patterns?: string[]`, `exclude_patterns?: string[]` | Ingest repository or directory into prompt-ready LLM digest (GitIngest standard: token estimation, ASCII tree, delimited file contents). |

`repo_path` defaults to the current working directory if omitted.

## Google Cloud & Gemini tools

| Tool | Parameters | Description |
|---|---|---|
| `gcp_status` | `project?: string` | Inspects Google Cloud CLI credentials, active GCP project ID (`gcloud config get-value project` or `CLOUDSDK_CORE_PROJECT`/`GCP_PROJECT`), and Gemini API keys availability (`GEMINI_API_KEY`, `GOOGLE_API_KEY`). |
| `gcp_storage_list` | `bucket: string`, `prefix?: string` | List objects, sizes and storage prefixes in a Google Cloud Storage bucket (`gcloud storage ls` or `gsutil ls`). |

## Execution via aphrody-kernel

Run directly through the kernel CLI or MCP:

```bash
aphrody-kernel call github_status '{"repo_path": "."}'
aphrody-kernel call github_branches '{}'
aphrody-kernel call github_tree '{"ref_name": "HEAD", "path": "crates"}'
aphrody-kernel call gcp_status '{}'
aphrody-kernel call gcp_storage_list '{"bucket": "aphrody-artifacts"}'
```
