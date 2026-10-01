# Native inference integration (mistral.rs, vLLM, Ollama)

Status: plan plus a first safe subset. Nothing here was compiled or run; the
lead builds once at the end. Upstream clones are read-only references and are
never vendored. Rule: integrate by Cargo dependency (Rust upstreams) or by wire
protocol over an in-process HTTP client (Go/Python upstreams). Never spawn their
binaries.

## 1. Existing owners

| Capability | Canonical owner (existing) | Notes |
| --- | --- | --- |
| Model-provider abstraction, streaming events | `aphrody-model-client` | `ModelClient`, `ModelStreamEvent`; `openai_compat` already serves llama-server, Ollama, LM Studio, vLLM (chat + responses wires). Used by engine, agent-runtime, router, app-server, cli. |
| Agent turn loop | `aphrody-engine` | Single engine for all surfaces. |
| Provider whitelist/identity | `aphrody-providers` | Also lists ollama/vllm/lmstudio local ids. |
| Local weights lifecycle, catalog, GGUF/safetensors/ONNX header inspection, GPU probe | `aphrody-models` | Store under the aphrody state dir. |
| In-process llama.cpp (GGUF, mtmd, LoRA, grammar, dynamic loading, no CUDA at build time) | `koharu-llama` + `koharu-llama-sys` (crates/koharu) | Already in the root workspace; currently only koharu-library/koharu-ml use it. Not in my scope to edit. |
| ONNX inference | `aphrody-infer` | Execution-provider fallback. `infer/src/llama.rs` is only binary discovery. |
| Managed external llama-server | `aphrody-llama-server` | Subprocess supervisor (see section 3). Also hosts `ensure_oss_ready` for Ollama/LM Studio/vLLM (HTTP only, no spawn). |
| Cost, rate limit, retry, cache | `aphrody-llm-infra` | Only chat uses it. |
| Antigravity | `aphrody-antigravity` (client) + `aphrody-model-antigravity` (ModelClient adapter) | Not duplicates: layered. |
| Gemini CLI adapter | `aphrody-gemini-runtime` | Drives an external product CLI, out of the "inference engine" class. |

## 2. Duplicates found and canonical choice

1. `aphrody-gateway` (OpenAI-compatible server + Cloudflare/Vercel/BYOK adapters)
   vs `aphrody-model-client`. The gateway crate already self-declares
   "Deprecated, replaced by model-client, removal Phase 5". Remaining consumer:
   `apps/cli` (`gateway_cmd`, `aphrody gateway`). Canonical: model-client for
   the client side. The server side (`/v1/chat/completions`, `/v1/models`) has no
   replacement yet: it must move to the OpenAI-compat server chosen below before
   deletion. Not deleted now (consumer not migrated).
2. `aphrody-router` (legacy text router) vs `aphrody-model-client`. Router is a
   shim: consumers `chat`, `ai`. Canonical is model-client; router stays until
   `chat` migrates (chat is outside my scope).
3. Several hand-written OpenAI-style HTTP servers: `gateway/server.rs`,
   `jev/server.rs` (Jev envelope, intentionally different wire), `ocr-vlm/server.rs`
   (a llama-server client, not a server). Real duplicate = gateway server only.
4. Two in-process-GGUF candidates would appear if mistral.rs were also used for
   GGUF. Decision: **koharu-llama is canonical for GGUF**; mistral.rs is added only
   for what llama.cpp does not give us (see section 4).
5. GPU probe: `models::accel` shelled out to `nvidia-smi`. Koharu pipeline already
   uses `nvml-wrapper`. Fixed (section 3).

## 3. Subprocess inventory (crates/ai scope)

| Site | Kind | Status |
| --- | --- | --- |
| `models/src/accel.rs` `nvidia-smi` | GPU probe | **Removed**: now NVML via `nvml-wrapper` (dlopen, absent driver gives CPU only). `parse_nvidia_smi` kept as public parser for captured text. |
| `llama-server/src/supervisor.rs`, `daemon.rs` | spawn detached `aphrody-llama-daemon`, which spawns `llama-server` | Remaining. Removal plan: work item 3. |
| `llama-server/src/caps.rs` | `llama-server --help/--version` probe | Remaining; disappears with work item 3 (in-process build is probed through `llama_cpp` symbols/`koharu-llama` capabilities, not help text). |
| `gemini-runtime/src/lib.rs`, `mcp_client.rs` | Gemini CLI turn, powershell/sh installers, MCP stdio servers | Remaining by design: external vendor CLI and generic MCP stdio transport are protocol subprocesses, not inference. Out of scope to remove; a Gemini REST path already exists in model-client. |
| `infer/src/llama.rs` | discovery only (no spawn) | Keep for `llama-cli`/`llama-bench` users; mark deprecated once item 3 lands. |
| ollama / vllm | none spawned. `ensure_ollama_ready` uses HTTP `/api/tags` + `/api/pull` | Already protocol-only. |

Outside scope but related: `ocr-vlm` spawns `llama-mtmd-cli` per page; it must
move to koharu-llama `mtmd` (owner: OCR).

## 4. Per-capability decision

| Capability | Decision |
| --- | --- |
| GGUF in-process inference | `koharu-llama` (existing, runtime dynamic loading keeps the build hermetic and MSVC `+crt-static` friendly). Add an `InProcessLlama` `ModelClient` in `aphrody-llama-server` (item 3). |
| Safetensors / ISQ quantization / paged attention / continuous batching / vision / MCP | Depend on `mistralrs` (MIT, upstream 0.9.4, edition 2021, rust-version 1.94, MSRV fine for our 1.98.1). Optional feature `mistralrs` in a new engine crate; off by default. License check: MIT, compatible; keep its notice in NOTICE/third-party list. |
| OpenAI-compatible server | `mistralrs-server-core` exposes an axum router (`MistralRsServerRouterBuilder`), which can be merged into the Aphrody axum (workspace axum 0.8, same major as upstream 0.8.8). Use it for the local server once the feature is on; gateway server then retires. Until then gateway's server stays. |
| Ollama | Wire protocol: OpenAI-compat via model-client (done), `/api/tags`, `/api/pull` (done), `/api/show`/`/api/chat` only if a consumer needs native fields. **Local store**: new `aphrody_models::ollama` reads `~/.ollama/models` manifests and blob layout in process (done, section 6) so koharu-llama/mistralrs can load an already-pulled GGUF without running Ollama. Never spawn `ollama`. |
| vLLM | Protocol only: OpenAI-compat (`/v1/chat/completions`, `/v1/completions`, `/v1/models`, plus vLLM extras in `extra_body`). Already served by `openai_compat` (`vllm` provider id). No Python import, no spawn. |
| GPU detection | NVML in-process (done). Optional later: `wgpu` adapters (already in workspace) for non-NVIDIA reporting. |

## 5. Lines the lead must add to the root `Cargo.toml`

I did not edit the root manifest. `nvml-wrapper = "0.13.0"` is already a
workspace dependency and `aphrody-models` now uses it (`workspace = true`);
`Cargo.lock` needs a refresh only for that edge (the package is already locked).

For the later work items (not needed by the current edits):

```toml
# [workspace.dependencies]  (work item 4, optional, default-off in consumers)
mistralrs             = { version = "0.9", default-features = false }
mistralrs-server-core = { version = "0.9", default-features = false }
```

If crates.io 0.9.x is not published for these names, use a git dependency with a
pinned `rev` instead (`git = "https://github.com/EricLBuehler/mistral.rs", rev = "<sha>"`);
verify before adding (unverified here). `mistralrs` pins `candle-*` to a
specific huggingface/candle git rev while the workspace uses crates.io
`candle-* 0.11`: cargo will build both (two copies of candle, no type sharing).
If a shared candle is wanted, add a `[patch.crates-io]` to that rev and re-check
koharu-ml. Decide when item 4 starts.

Features per backend (cuda, metal, flash-attn, mkl, accelerate, nccl) must be
forwarded as consumer-crate features, never enabled by default.

## 6. Done in this change (uncompiled)

- `crates/ai/models/src/accel.rs`: `probe_nvidia` uses NVML; header comments
  updated; `parse_nvidia_smi` unchanged and still tested.
- `crates/ai/models/Cargo.toml`: `nvml-wrapper = { workspace = true }` under the
  host-only (non-wasm32) target table.
- `crates/ai/models/src/ollama.rs` (+ `pub mod ollama` in `lib.rs`, host-only):
  `OllamaName::parse`, `OllamaStore::{discover, at, resolve, list}`,
  `OllamaModel::{gguf_path, layer, read_text}`. Layout contract (default host
  `registry.ollama.ai`, namespace `library`, tag `latest`, `OLLAMA_MODELS`,
  `blobs/sha256-<hex>`, `application/vnd.ollama.image.model`) taken from
  Ollama's `manifest/` and `types/model/name.go`. Read-only, rejects `..`
  segments. Has unit tests, not run.

## 7. Ordered work items

1. Build and test the above (`cargo nextest -p aphrody-models`; check wasm32
   still compiles `aphrody-models`: nvml and `ollama` are host-gated).
2. Make `ensure_oss_ready("llama"|"managed")` and the CLI prefer an existing
   Ollama GGUF via `OllamaStore` when the user names an Ollama tag.
3. `InProcessLlama`: a `ModelClient` over `koharu-llama` in
   `aphrody-llama-server` behind feature `in-process` (needs the lead to add the
   `koharu-llama` workspace path dep to that crate; it is already in the root
   table). Then retire `supervisor`/`daemon`/`caps` subprocess paths after
   consumers (agent-runtime, jev, app-server, cli) switch; keep the external
   server path only as an opt-in attach to a user-run endpoint.
4. mistral.rs feature: new crate `crates/ai/engine-mistralrs` (not created yet)
   implementing `ModelClient`, plus mounting `mistralrs-server-core` router.
   Qualify on Linux CUDA, Windows MSVC (CPU first), wasm32 excluded.
5. Migrate `apps/cli` `gateway` to the mounted server; migrate `chat` off
   `aphrody-router`; then delete `aphrody-gateway` and `aphrody-router`.
6. Move `ocr-vlm` from `llama-mtmd-cli` to koharu-llama `mtmd`.

## 8. Risks

- Build weight: mistral.rs pulls candle, cudarc, tokenizers; must stay
  feature-gated and out of default CLI builds.
- GPU backends: CUDA/Metal features are mutually platform-specific; Linux first,
  Windows MSVC second; wasm32 gets none of the inference engines (only
  protocol clients). macOS best effort.
- Duplicate candle and tokenizers versions (0.21 upstream vs 0.23 workspace)
  are tolerated by cargo but increase compile time and binary size.
- NVML needs `libnvidia-ml` at runtime; on WSL2 it lives in `/usr/lib/wsl/lib`.
  Failure degrades to "no CUDA" silently, as the old probe did.
- koharu-llama API and the `nvml-wrapper` 0.13 calls used
  (`sys_driver_version`, `device_count`, `device_by_index`, `memory_info`,
  `cuda_compute_capability`) were written from knowledge of the API, not
  compiled; adjust on first build.
- Parity is not claimed: mistral.rs server routes, vLLM extras and the Ollama
  native `/api/*` surface are mapped, not tested against live servers.
