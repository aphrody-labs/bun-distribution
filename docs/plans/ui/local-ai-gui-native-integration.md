<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local-AI GUI: native integration of Jan's design

Status: active. Scope: the desktop GUI for local inference and model management.
Jan (Apache-2.0, Tauri) is a design reference only: nothing from it is vendored, copied or
linked. Aphrody keeps one implementation per capability and reaches it in process.

## 1. Inventory of existing GUI surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Desktop shell (Tauri `=3.0.0-alpha.3`) | `crates/ui/app` (`aphrody-app`) | Windows, tray, pet, widget, deep links, updater, app-server broker, models hub commands |
| Toolkit-neutral GUI traits | `crates/ui/gui-core` | `WindowHost`, `SurfaceProvider`, `ThemeProvider`, `KernelBridge`; no toolkit types |
| New: local-AI hub | `crates/ui/local-ai` (`aphrody-local-ai`) | Toolkit-free model hub (catalog, store, recommend, verify, remove, pull, hardware) |
| Web-to-Tauri wrapper | `crates/ui/tauri-wrap` | `remote`, `bundle` and `sidecar` modes, debug bridge |
| Tauri MCP bridge | `crates/ui/tauri-mcp` | Debug/automation bridge, not product UI |
| Drive explorer | `crates/ui/drive` | File explorer (its own sidecar files are data, not processes) |
| A2A viewer (WASM) | `crates/ui/a2a-ui` | `.coord` mailbox view |
| Design system | `packages/ui/m3*`, `m3-ai` (chat composer, message bubble, model selector, tool call, markdown, tasks), `m3-react`, `material-web` | M3 components; `m3-ai` is the chat UI kit |
| Scaffolder | `packages/ui/scaffold`, `packages/ui/web-to-tauri` | One scaffolder (`@aphrody/scaffold`) |
| Other web UIs | `apps/koharu/editor`, `packages/koharu/*`, `apps/rg/*`, `apps/shenron/*` | Product UIs, out of scope |

The webview front end consumed by `aphrody-app` is the bundled `ui-dist` (`@aphrody/app-ui`); its source
is not under `packages/ui` in this checkout (unverified owner, see section 8).

### Duplicates found

1. Model management logic existed twice: the CLI (`apps/cli/src/model_cmd.rs`, which builds the JSON
   documents) and the desktop, which re-ran the CLI as a child process and re-parsed its output
   (`crates/ui/app/src/models.rs`). The desktop copy of the process plumbing is removed (section 4).
   Remaining duplication: the CLI still shapes the same JSON by itself; it should call
   `aphrody-local-ai` (work item W3, CLI owner).
2. `crates/ui/tauri-wrap/src/sidecar.rs` is a generic sidecar mode for wrapped third-party sites. It is
   a product feature of the wrapper, not Aphrody's own inference path; keep, never use it for Aphrody AI.
3. `m3-ai` (UI kit) and any ad hoc chat view in `ui-dist` must be one component set: chat rendering
   belongs to `m3-ai`.

## 2. Jan design extracted, mapped to Aphrody owners

| Jan feature (design) | Jan mechanism | Aphrody canonical owner | Status |
| --- | --- | --- | --- |
| Local inference engine | `tauri-plugin-llamacpp` spawns a `llama-server` sidecar, reads GGUF facts, plans launch | `crates/ai/llama-server` (`ServerClient`, plan, facts, supervisor), `crates/ai/infer`, `crates/ai/engine` | Owner exists; GUI must call it through a typed handle (W4) |
| Second engine (MLX) | `tauri-plugin-mlx` | Out of scope (macOS best effort) | Gap, deferred |
| Hardware detection | `tauri-plugin-hardware` | `aphrody-models::accel::probe` (NVML in process) plus `aphrody-native` topology | Done, in process |
| Model hub (browse, download, resume) | download extension, hub route | `aphrody-models` catalog, `Downloader`, `ModelStore`; GUI facade `aphrody-local-ai::ModelHub` | Done, in process |
| Hugging Face search/import | hub route | `aphrody-models` `ModelRef` (HF pinned refs) | Partial: no free-text HF search; gap W6 |
| Import external stores | none | `models::aphrody_model_scan_external` (Ollama, LM Studio, HF cache) | Done (scan only; adopt via `ModelStore::adopt_local`) |
| Threads and messages storage | conversational extension, `core/threads` | `crates/ai/session`, `crates/ai/rollout`, `aphrody-app-server` thread/turn protocol | Owner exists |
| Chat loop, tools, subagents, skills, plans | `core/agent/*` | `aphrody-chat`, `aphrody-agent-runtime`, `aphrody-tools`, `aphrody-skills`, `aphrody-supervisor` | Owner exists, reached through app-server protocol |
| Assistants (system prompt presets) | assistant extension | `aphrody-prompts`, `aphrody-agent-home`, skills | Owner exists; GUI list view is a gap (W5) |
| MCP servers manager | settings/mcp-servers, `core/mcp` | `aphrody-mcp`, `aphrody-mcp-client`, `aphrody-mcp-oauth` | Owner exists; GUI settings view gap (W5) |
| RAG and attachments | rag extension, vector-db plugin | `aphrody-rag` (store, indexer, hybrid search, reranker), `aphrody-embed` | Owner exists; no GUI view model yet (W5) |
| Web search | websearch plugin | `aphrody-web` (Obscura / Aphrody Web MCP) | Owner exists |
| Local OpenAI-compatible API server | `core/server`, settings/local-api-server | `aphrody-gateway` (`router`, `serve_gateway`, loopback `127.0.0.1:8795`, origin allow-list) | Owner exists; GUI toggles it in process (W4) |
| Providers (remote keys) | settings/providers | `aphrody-providers`, `aphrody-model-client`, gateway adapters | Owner exists |
| Settings, shortcuts, privacy, proxy | settings routes | `tauri-plugin-store` preferences + `tauri-plugin-global-shortcut` already in `aphrody-app` | Done |
| System monitor | route | `aphrody-native` topology (telemetry command) | Done |
| Updater, tray, deep links | `core/updater` | `aphrody-app::integration` | Done |
| opencode / openfox web UIs | HTTP server + web client | Not adopted: Aphrody's web client is the M3 UI over the same app-server/gateway protocol | Decision: no import |

Principle: the GUI is a thin client. Inference, threads, tools, RAG and MCP stay in `crates/ai/**`; the
GUI never contains a second copy of that logic.

## 3. Toolkit-agnostic core API surface

`aphrody-local-ai` (new, `crates/ui/local-ai`, no toolkit, IPC or runtime types in its API):

```text
ModelHub::new() / ModelHub::with_root(path)
  .store_root()                       -> PathBuf
  .catalog(task?)                     -> serde_json::Value   (CLI-identical schema)
  .installed(task?)                   -> Value
  .recommend(task, prefer)            -> Value
  .hardware()                         -> aphrody_models::HardwareProfile
  .verify(spec) / .remove(spec)       -> Value               (blocking; run on a blocking pool)
  .pull(spec, force, cancel: Future<Output=()>, on_progress: FnMut(PullProgress)) -> Value
HubError { Model, Invalid, Cancelled }
```

Adapters translate only: Tauri (`crates/ui/app/src/models.rs`: commands, `aphrody://model-pull`
event, `Pulls` cancel map), and later COSMIC/egui/web adapters in their own crates over the same type.
The JSON documents keep the CLI `--json` schema, so `@aphrody/app-ui` is unchanged. Next layer
(W4/W5) adds typed (non-JSON) view models in the same crate: `ChatThreadSummary`, `McpServerEntry`,
`RagSourceEntry`, `LocalServerState`, each a plain serde struct built from the owning crate.

## 4. Subprocess and sidecar inventory

| Spawn | Where | Disposition |
| --- | --- | --- |
| `aphrody model <catalog,list,recommend,verify,rm,path,accel>` (one-shot) | `crates/ui/app/src/models.rs` | Removed: in process via `aphrody-local-ai` |
| `aphrody model pull --json` (long-running, stderr progress parsing, kill on cancel) | same | Removed: in-process `pull_spec`, progress callback, cancel by dropping the transfer (resume via `.part`) |
| `aphrody model accel` for GPU names | same | Removed: `aphrody-models::accel::probe` (NVML via dlopen) |
| `aphrody app-server` over stdio JSON-RPC | `crates/ui/app/src/broker.rs` | Remaining, W2: run `aphrody_app_server::serve_stdio` in process over `tokio::io::duplex`; keep the broker's id rewriting, replay and event routing unchanged |
| `aphrody …` one-shot commands (`ai env`, windows host, capture) | `crates/ui/app/src/desktop.rs` (file currently modified by another agent) | Remaining, W7: replace each with the owning crate call (`aphrody-kernel`, `aphrody-capture`) |
| `externalBin` `aphrody` and `sd-daemon` binaries | `crates/ui/app/binaries`, resolved by `resolve_aphrody_bin` | Remaining until W2 and W7 land; then drop `externalBin` and `APHRODY_BIN` |
| `llama-server` (llama.cpp) | `crates/ai/llama-server` | Remaining by design: llama.cpp is a native engine driven as an external binary, never linked (owner: inference agent). Target (W4): GUI uses its supervisor library API, no shell/CLI hop; a linked engine (`mistral.rs`, via `aphrody-engine`/`aphrody-infer`) removes it later |
| `tauri-wrap` sidecar mode | `crates/ui/tauri-wrap/src/sidecar.rs` | Keep: wraps third-party web projects only |
| `xdg-open` / `explorer` / `open -R` | `crates/ui/drive/src/files.rs` | Keep (OS shell integration; `tauri-plugin-opener` could replace, low priority) |
| `nvidia-smi` | none (NVML used) | Not present |

Note: the models-dir preference is still exported to the app-server child as `APHRODY_MODELS_DIR`; once
the broker is in process this must become an explicit `AppServer` option, because mutating the process
environment is `unsafe` in edition 2024 and is not acceptable.

## 5. Dependency lines the lead must add

The new crate is picked up by the existing `members = ["crates/ui/*", ...]` glob, and `aphrody-app`
depends on it by path, so no root edit is required to build. Optional, for other consumers:

```toml
# root Cargo.toml [workspace.dependencies]
aphrody-local-ai = { path = "crates/ui/local-ai", version = "1.0.0-canary" }
```

All other dependencies used (`aphrody-models`, `futures-util`, `serde_json`, `thiserror`, `tempfile`,
`tokio`) are already workspace dependencies. `Cargo.lock` will gain the `aphrody-local-ai` package and a
new edge from `aphrody-app`; the lead regenerates it. For W2 `aphrody-app` additionally needs
`aphrody-app-server = { workspace = true }` (already declared at the root).

## 6. Ordered work items

1. W1 (done): `aphrody-local-ai` crate and in-process Models hub commands in the Tauri adapter.
2. W2: in-process app-server broker (`serve_stdio` over `tokio::io::duplex`, task supervision with restart,
   `AppServer` models-dir option instead of an env var). Needs the app-server owner to expose a
   constructor taking the store root. Then remove the `aphrody app-server` spawn and `aphrody-proc` use.
3. W3: CLI `model_cmd.rs` calls `aphrody-local-ai` for the JSON documents (apps/cli owner), ending the
   last duplicate of the shaping code.
4. W4: `LocalServerState` view model plus commands to start/stop the gateway (`serve_gateway`) and the
   llama-server supervisor in process; GUI shows loopback `127.0.0.1:8795` base URL and the model loaded.
5. W5: typed view models for assistants, MCP servers and RAG sources over their owning crates; M3 screens
   in `packages/ui/m3-ai` (settings lists, hub cards) so every toolkit shares the same data.
6. W6: Hugging Face search in `aphrody-models` (inference agent) and a hub screen section.
7. W7: replace `aphrody_command()` one-shots in `desktop.rs` by crate calls, drop `externalBin`.
8. W8: a `crates/ui/cosmic` (or egui) adapter over `ModelHub` to prove toolkit independence; reuse COSMIC
   libraries before writing widgets.

## 7. What was implemented in this change

- `crates/ui/local-ai/{Cargo.toml,src/lib.rs}`: the new crate with unit tests.
- `crates/ui/app/src/models.rs`: now an adapter; command names, event name, argument names and JSON
  shapes are unchanged. `stored_models_dir`, `MODELS_DIR_ENV`, `Pulls`, `PULL_EVENT` kept for the broker.
- `crates/ui/app/Cargo.toml`: path dependency on `aphrody-local-ai`, comment updated.

Behavior notes: `verify` of a corrupt artefact returns `intact: false` (as before) instead of a CLI
non-zero exit; `recommend` still errors when nothing fits; the `.part` resume contract is unchanged.

## 8. Unverified

Nothing was compiled or run (the lead builds once at the end). Unconfirmed: that the Tauri command futures
satisfy `Send` with the `pull_spec` future (expected, reqwest-based); the `ModelTask::all`,
`SpeedTier::as_str` and `PullOutcome::transferred` signatures were read from the CLI usage, not rustdoc;
the front-end package that produces `ui-dist` and `docs/reference/ui/DESKTOP-INTEGRATION.md` (which still
states downloads run in the CLI) were not edited because they are outside this change's ownership.
