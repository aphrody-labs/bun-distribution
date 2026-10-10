# App UI qualification — 2026-10-05

The canonical package is `m3/packages/app-ui` in Aphrody. This batch uses
the real app-server protocol, Tauri IPC and shared M3 server/build owners.

- App UI: 216 Bun tests, 991 assertions, zero failures; TypeScript and strict
  scoped lint/format pass.
- Web transport and shared M3 proxy: 8 tests, 39 assertions, zero failures;
  TypeScript, strict lint and formatting pass.
- Build: 641 files, 63,030,159 bytes in `crates/ui/app/ui-dist`.
- Actual installed Aphrody CLI, isolated state: HTTP health, initialization,
  tools catalog (10 tools) and empty MCP server inventory passed through the
  real M3 proxy. Unknown methods preserve the backend error. No inference ran.
- That installed binary reports `capabilities.aphrody=false` and rejects
  `aphrody/rag/status` with `-32601`. RAG activation is not qualified.
- Chromium 153: 1280×832 and 800×560, distinct light/dark themes, persisted
  18/20 px text and reduced motion; no horizontal overflow, JavaScript errors,
  missing assets or external calls. Native Tauri rendering is not qualified.

The frontend no longer offers fabricated OCR/transcription/indexing controls,
terminal bridges or demonstration agent telemetry. Chat, preferences, command
actions, native Studio contracts and Explorer-to-Chat context have behavioral
coverage. Training displays actual reports/events; the existing Python-backed
launcher is not exposed as an in-process action.

The browser server now reuses M3's proxy for RPC/SSE, forwards failures and serves
the actual bundle. It does not inject fake Tauri globals or invent installed
models, successful downloads, captures, Drive volumes or backend health.

The app dependency cleanup removed four direct dependencies (43 → 39).
Its measured lock graph shrank from 514 to 463 npm instances, with 22 workspace
packages retained and no missing edges. Drei retirement removed 42 lock entries;
this is a dependency measurement, not a runtime speed claim.

Limitations: a frozen parent Bun install still fails with “lockfile had changes”
despite successful normal installation; the failure predates the move. Native
Rust path gates route to the configured VPS factory and were not executed here.
Other packages' pre-existing lint/format warnings are outside this UI batch.
Detailed local receipts remain under Aphrody `.coord/runs/m3-app-backend` and
M3 `.coord/runs/app-ui-chat-behavior`.
