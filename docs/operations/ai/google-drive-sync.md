<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron Agent Home ↔ Google Drive

The canonical `@aphrody/google` package owns Drive/Docs API access and the two-way sync engine. `@aphrody/workspace` in Aphrody Infra only schedules it. The local root is `~/.aphrody/workspaces/dbfr`; its Drive root is the shared `dbfr` folder. Only the seven default Agent Home Markdown files are synchronized: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and `BOOT.md`. The original Shenron Google Doc is an index of these seven documents. `MEMORY.md`, `memory/`, and `knowledge.db*` remain local.

## Credentials

The root `.env` contains private-file paths and public IDs, not credential values. Keep the service-account JSON and installed OAuth client JSON under `~/.aphrody/private/google/` with directory mode `0700` and file mode `0600`. Keep the Google cookie file at `~/.aphrody/google-cookies.json` with mode `0600`. `GOOGLE_APPLICATION_CREDENTIALS` points to the service account for Vertex/Gemini.

The Drive folder is in a human user's My Drive. A service account cannot own new files there because it has no Drive storage quota. Drive sync therefore uses `APHRODY_GOOGLE_DRIVE_AUTH=gcloud-user`, which obtains a scoped token from the already authorized Google Cloud CLI account. The official `googleapis` library performs all Drive and Docs requests. The installed OAuth client can be used instead by running `aphrody-google drive auth-login`, then setting `APHRODY_GOOGLE_DRIVE_AUTH=oauth-user`; its refresh token stays in the private directory.

## Commands

From the Aphrody root:

```sh
bun packages/google/google/bin/aphrody-google.ts drive status
bun packages/google/google/bin/aphrody-google.ts drive sync --dry-run
bun packages/google/google/bin/aphrody-google.ts drive sync
```

The Infra daemon is `packages/infra/workspace/src/agent-home-drive-sync.ts` in the Aphrody monorepo. It watches the local tree and also polls Drive every five minutes with Bun cron. Its systemd unit is `yolo/config/host/systemd/shenron/shenron-agent-home-drive-sync.service`. The service uses `--env-file=.env` for the child sync process.

The private state file is `~/.aphrody/drive-sync/dbfr-google-api.json`. It records Drive IDs, local SHA-256 hashes, and remote modification times after each file, so an interrupted transfer resumes. A lock prevents concurrent sync processes. The seven default documents are restored from the other side if one is missing. If both sides changed, sync stops and reports the conflict without making a copy or overwriting either version.

## Markdown

Each of the seven default Markdown files is a native Google Doc containing its Markdown source as plain text. Edits in that Doc sync back into the corresponding `.md` file. Changes inside `memory/` and `knowledge.db*` are outside this sync.

The engine rejects symbolic links and unsafe or duplicate Drive names. Google Docs are the only native Google document type it can round-trip as local text. Keep Google Sheets and Slides outside this sync folder until a format mapping is implemented.

## Agent, memory, and training pipeline

`crates/ai/agent-home/sync-contract.json` owns the seven-file list for the Rust crate, Bun transport, and Infra watcher. After every successful Drive pass, `aphrody-agent-home` validates a coherent local revision, including the strict `SOUL.md` schema and the per-file size limit. The memory bridge upserts the seven documents into `aphrody-memory` at `~/.aphrody/private/memory/agent-home.sqlite`; unchanged records keep their identity and timestamps. This database is outside the Agent Home. The engine reloads the Agent Home before each turn of a long-lived session and keeps the last valid prompt if an edit is temporarily invalid.

Infra then runs the `aphrody-train` candidate pipeline. Its private configuration is `~/.aphrody/private/agent-training.json`. The configured DBFR LoRA job waits automatically for `~/.aphrody/train/dbfr/rollouts`, `gold.jsonl`, and the local base model at `~/.aphrody/models/dbfr-base`. These must be DBFR training data and a held-out gold set; the seven instruction documents are runtime behavior, not training examples. The scheduler checks every five minutes and on local edits. It trains once per Agent Home revision, training configuration, and input hash, and records completed candidate jobs under `~/.aphrody/train/dbfr/jobs/`. It uses the shared `../aphrody-py` workspace (or `APHRODY_PY_ROOT`), the `aphrody-train` member's `full` dependencies, and the Rust `aphrody-train` GPU lease. A candidate is not installed automatically: the current promotion CLI refuses unmeasured artifacts. Retrieval models require independent baseline and candidate Recall@5 plus per-tag scores from a shadow index; a corresponding behavioral gate for LoRA is not implemented.

The `aphrody-ai` facade now exposes `agent_home`, `memory`, `train`, `rag_eval`, and `supervisor` as the canonical surfaces. Only the seven default Markdown files are sent to Google; the memory database, training inputs, jobs, and gold data stay local.
