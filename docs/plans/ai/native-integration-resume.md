# Native integration: resume plan

Status at 2026-10-01 (session closed at the usage limit). Master plan:
[native-integration-master.md](native-integration-master.md). All 22 wave-1
agents were stopped mid-edit; their files are committed as-is
(`9c7889ff`, `c00f2674` and the closing commit). **Nothing from wave 1 has been
compiled.** Expect an error-fix loop.

## Resume order (lead, serial, `nice -n 19`, `-j 6`, agents never run cargo)

1. `git status`, then `git log -3`. Re-read the master plan, section 7.
2. Fix known diagnostics first:
   - `crates/os/kernel`: `crate::paths` (module now declared; check its API
     against `infra.rs`, `mcp_proxy.rs`), `rustls` missing in
     `http_transport.rs` (add to the crate manifest or gate the code).
   - `crates/ai/tools/src/builtin/read_file.rs`: `read_capped` visibility.
   - `crates/ui/app`: `broker::aphrody_command`, `broker::resolve_aphrody_bin`
     (T3 stopped while editing `Meta`/`aphrody_meta`).
   - `crates/infra/git/src/source.rs`: borrow fix applied, uncompiled.
3. Root `Cargo.toml`: add `aphrody-engine-mistralrs` and `aphrody-local-ai`
   workspace entries and any dependency a crate manifest requests
   (`cargo check` names them). mistral.rs only as optional git dep at rev
   `3f2515e9`, feature `engine`, off by default (D1).
4. Check in this order, one `-p` set at a time, fixing before the next:
   `aphrody-git`, `aphrody-models` (+ `--target wasm32-unknown-unknown`),
   `aphrody-model-client`, `aphrody-llama-server`, `aphrody-rag`
   (`--features native`), `aphrody-kernel`, `aphrody-kernel-client`,
   `aphrody-tools`, `aphrody-mcp-client`, `aphrody-app`, `aphrody-app-server`,
   `aphrody-marketplace`, `aphrody-engine-mistralrs`, `aphrody-gateway`,
   then `-p aphrody --bin aphrody`. Then `cargo test` on the same set.
5. `plugins/aphrody/scripts/validate-plugin.sh`; scoped bun checks for
   `packages/ui/m3-ai`.

## Per-track state (what was in flight when stopped)

| Track | State | To finish |
|---|---|---|
| T1 RAG | started `rag-core` fusion kernels, W1 to W7 mostly unstarted | rerun worker on `rag-native-integration.md` |
| T2a | chat-template layer (minijinja) and `InProcessLlama` in progress | finish, then retire supervisor/daemon/caps |
| T2b | NDJSON decoder, Ollama/vLLM/HF request helpers in progress | finish `http.rs`, native Ollama/vLLM clients |
| T2c | read router/gateway; engine crate scaffold only | build `aphrody-engine-mistralrs`, rebuild gateway over `ModelClient`, grep-prove router removal |
| T3 | W2/W3/W5/W7/W8 partly edited in `crates/ui/app` | finish, W4 and W6 after T2 |
| T4 | read-only so far | `marketplace` generator, `.codex/`, `.opencode/`, `opencode.json` |
| T5 | `mcp_config.rs` canonical loader, `call_tool_raw` in progress | dedup MCP clients |
| T6 | docs edited (agy hooks: `Stop` not `AfterAgent`) | A2A peers, conformance tests |
| T7, T8 | partial rewrites of plugin agents and skills (hardcoded paths) | rerun, then validator |
| T9 | no file written | cross-tool reference docs |
| T10 | `paths.rs`, kernel-client endpoint resolver in progress | finish, remove hardcoded paths |
| T11 | `web_fetch.rs` mid-edit | subprocess sweep |

Research agents (Claude, Codex, OpenCode, agy formats) were stopped; their
outputs are under the session task directory and may be lost. Re-run only if
T4/T6/T9 need them.

## Rules that still apply

No branch or worktree; exact-match edits; only the lead edits the root
`Cargo.toml`; D1 to D8 in the master plan; claim:
`.coord/claims/native-integration.json`.
