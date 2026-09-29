<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron Agent Home ↔ Google Drive

The canonical `@aphrody/google` package owns Drive/Docs API access and the two-way sync engine. `@aphrody/workspace` in Aphrody Infra only schedules it. The local root is `~/.aphrody/workspaces/dbfr`; its Drive root is the shared `dbfr` folder. Only the seven default Agent Home Markdown files are synchronized: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and `BOOT.md`. The original Shenron Google Doc is an index of these seven documents. `MEMORY.md`, `memory/`, and `knowledge.db*` remain local.

## Credentials

The root `.env` contains private-file paths and public IDs, not credential values. Keep the service-account JSON and installed OAuth client JSON under `~/.aphrody/private/google/` with directory mode `0700` and file mode `0600`. Keep the Google cookie file at `~/.aphrody/google-cookies.json` with mode `0600`. `GOOGLE_APPLICATION_CREDENTIALS` points to the service account for Vertex/Gemini.

The Drive folder is in a human user's My Drive. A service account cannot own new files there because it has no Drive storage quota. Drive sync therefore uses `APHRODY_GOOGLE_DRIVE_AUTH=gcloud-user`, which obtains a scoped token from the already authorized Google Cloud CLI account. The official `googleapis` library performs all Drive and Docs requests. The installed OAuth client can be used instead by running `aphrody-google drive auth-login`, then setting `APHRODY_GOOGLE_DRIVE_AUTH=oauth-user`; its refresh token stays in the private directory.

## Commands

From the Aphrody root:

```sh
bun packages/ai/google/bin/aphrody-google.ts drive status
bun packages/ai/google/bin/aphrody-google.ts drive sync --dry-run
bun packages/ai/google/bin/aphrody-google.ts drive sync
```

The Infra daemon is `packages/aphrody-workspace/src/agent-home-drive-sync.ts` in `aphrody-infra`. It watches the local tree and also polls Drive every five minutes with Bun cron. Its systemd unit is `systemd/shenron-agent-home-drive-sync.service`. The service uses `--env-file=/home/aphro/aphrody/.env` for the child sync process.

The private state file is `~/.aphrody/drive-sync/dbfr-google-api.json`. It records Drive IDs, local SHA-256 hashes, and remote modification times after each file, so an interrupted transfer resumes. A lock prevents concurrent sync processes. The seven default documents are restored from the other side if one is missing. If both sides changed, sync stops and reports the conflict without making a copy or overwriting either version.

## Markdown

Each of the seven default Markdown files is a native Google Doc containing its Markdown source as plain text. Edits in that Doc sync back into the corresponding `.md` file. Changes inside `memory/` and `knowledge.db*` are outside this sync.

The engine rejects symbolic links and unsafe or duplicate Drive names. Google Docs are the only native Google document type it can round-trip as local text. Keep Google Sheets and Slides outside this sync folder until a format mapping is implemented.
