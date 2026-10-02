# Native integration master plan (Aphrody to the cloned upstreams)

Status: active, started 2026-10-01. Owner of this file: the lead session (single
integrating agent). Track plans stay canonical for their own detail:

- [inference-native-integration.md](inference-native-integration.md)
- [cli-native-integration.md](cli-native-integration.md)
- [rag-native-integration.md](rag-native-integration.md)
- [../ui/local-ai-gui-native-integration.md](../ui/local-ai-gui-native-integration.md)

Goal (user, 2026-10-01): wire Aphrody to the upstreams listed in `config/upstream-sources.json`
natively, with no vendoring, no bottleneck, no subprocess and no duplicate,
starting from what Aphrody already has; execute end to end, fix and integrate
everything, with a complete plan and documented execution.

## 1. Upstream references (read-only, never copied into the repo)

Since 2026-10-02 none of these is cloned under `~/source` (it keeps only the four build-required checkouts). Read them live:
`aphrody git upstream info|tree|read|search <id>`, MCP `upstream_*`, or `aphrody-update upstream fetch <id>` for a disposable full clone.
Overview: [../../reference/infra/UPSTREAMS.md](../../reference/infra/UPSTREAMS.md). The revisions below are the ones read on 2026-10-01.

| Upstream (catalogue id) | Rev | Licence | How Aphrody uses it |
|---|---|---|---|
| `mistral.rs` | `3f2515e9` (v0.9.4-3) | MIT | Optional in-process engine through a git dependency pinned to this rev (crates.io only has 0.8.1). |
| `codex` | `d6c3b448a4` | Apache-2.0 | Protocol and schema reference; conformance tests. No crate dependency (see D3). |
| `opencode` | `0112a92c4` | MIT (verify) | Config, plugin, skill, agent, command layouts and server API; generated fragments; optional A2A peer. |
| `antigravity-sdk-python` | `12f9a4c` | Apache-2.0 (verify) | Hook, event and session types; parity with `aphrody-antigravity`. |
| `ollama` | `1abe35e6` | MIT | Wire protocol and on-disk store; native client and store reader. |
| `vllm` | `ab5266769` | Apache-2.0 | Wire protocol extras (rerank, score, tokenize, pooling, metrics); client only. |
| `jan` | `e0c62f863` | Apache-2.0 | Design reference for the local AI hub; concepts only. |
| `llama_index` | `7e2c60a78` | MIT | Coverage grid for the RAG pipeline; concepts only. |
| `litellm` | `b4bb2a77a202` | MIT outside `enterprise/`; separate terms inside | Full SDK/gateway and beta Rust workspace reviewed; external OpenAI-compatible endpoint and routing concepts only. See [review](../../research/ai/litellm-review-2026-10-01.md). |
| `openfox` | `3b434db` | unverified (no root LICENSE) | Concept map only until the licence is confirmed; no code copied. |

## 2. Rules for every worker

1. No cargo, no long builds, no network builds. The lead runs checks once per
   wave, serially, at low priority (`nice -n 19`, `-j 6`). Read real APIs in the
   sources before calling them; never write from memory when the source is
   readable.
2. No branch, no worktree, no commit, no stash, no `git checkout/reset/clean`.
   Other sessions have uncommitted edits in the tree: modify files with
   exact-match `Edit` replacements (re-read the file right before), never rewrite
   a file you did not create, never revert changes you did not make.
3. Stay inside your file ownership (section 3). A file you need that is owned by
   another track gets a minimal additive edit (one `mod`/`use`/registration
   line) or an entry in "Requests to other tracks" in your report.
4. Do not edit the root `Cargo.toml` or `Cargo.lock`. List the exact
   `[workspace.dependencies]` lines you need in your report. Crate-local
   `Cargo.toml` edits are yours when you own the crate.
5. Preserve crate and package names, public APIs, CLI flags, JSON schemas and
   exit codes. Only additive changes, plus removals proven unused by a grep of
   the whole repository (cite the grep).
6. No vendoring: never copy upstream source into the repo. Dependencies are
   crates.io versions or git dependencies pinned to a rev. Licence and
   attribution notes go in the track doc.
7. Core crates stay GUI-toolkit-free and must keep compiling for wasm32 where
   they did (host-only code behind `cfg(not(target_arch = "wasm32"))`).
8. Aphrody is a YOLO OS: no sandboxing, approval gates or allow/deny lists.
   Authentication, integrity, reliability and accuracy of claims still apply.
9. Reuse before writing: COSMIC and other Rust libraries, then existing Aphrody
   owners, then new code. Every removed duplicate names its canonical owner.
10. Update your track doc: mark each work item done, partial or blocked with the
    reason, list files changed, and keep a "Verification" section that states
    precisely what was and was not compiled or run.
11. Final report (under 400 words): files changed, work items completed, items
    not done and why, exact `cargo -p` list to check, new dependency lines for
    the root `Cargo.toml`, requests to other tracks.

## 3. Tracks and file ownership

Every file belongs to one track. `apps/cli/src/{commands,lib,main}.rs` and
`apps/cli/Cargo.toml` are shared registration points: one-line additive `Edit`
replacements only, re-read right before editing.

| Track | Scope | Owned files |
|---|---|---|
| T1 RAG | Plan W1 to W7 | `crates/ai/rag/**`, `crates/ai/rag-core/**`, `crates/ai/rag-eval/**`, `crates/ai/memory/**`, `crates/ai/embed/**`, `crates/ai/context/**`, `crates/ai/config/src/` embed and rerank settings and `config_resolve.rs`, `apps/cli/src/{rag_cmd,memory_cmd,index_cmd}.rs` |
| T2a In-process llama | Plan items 3 and 6 | `crates/ai/llama-server/**`, `crates/ai/ocr-vlm/**`, `crates/ai/engine/**`, `crates/ai/infer/**`, `apps/cli/src/{infer_cmd,oss_cmd,ocr_cmd}.rs` |
| T2b Wire protocols | Ollama, vLLM, Hugging Face | `crates/ai/model-client/**`, `crates/ai/models/**`, `crates/ai/providers/**` |
| T2c mistral.rs and gateway | Plan items 4 and 5 | new `crates/ai/engine-mistralrs/**`, `crates/ai/gateway/**`, `crates/ai/router/**`, `crates/ai/chat/**`, `crates/ai/ai/**`, `crates/infra/aphrody-command/src/gateway_cmd.rs` |
| T3 GUI | Plan W2 to W8 | `crates/ui/**`, `crates/ai/app-server/**`, `packages/ui/m3-ai/**`, `apps/cli/src/{model_cmd,app_server_cmd}.rs`, `docs/reference/ui/**`, `docs/plans/ui/**` |
| T4 Manifests and MCP adapters | CLI items 2, 3, 9 | `crates/ai/marketplace/**`, `crates/ai/config/src/mcp.rs`, `crates/ai/mcp-oauth/**`, `apps/cli/src/{codex_provision,agy_provision,mcp_cmd}.rs`, generated manifests in `plugins/aphrody/` (manifests, `.codex/`, `.opencode/`, `opencode.json`, hooks) |
| T5 Dedup | CLI item 5, 8 | `crates/ai/mcp/**`, `crates/ai/mcp-client/**`, `crates/google/gemini-runtime/**`, `crates/ai/sdk/**`, `crates/ai/agent-tools/**`, `crates/ai/skills/**`, `crates/ai/skills-forge/**` |
| T6 Agent harness peers | Antigravity, OpenCode, Codex protocol, openfox | `crates/google/antigravity/**`, `crates/google/model-antigravity/**`, `crates/ai/agent-runtime/**`, `crates/ai/exec-events/**`, `crates/ai/rollout/**`, `crates/ai/session/**`, `crates/ai/patch/**`, `crates/ai/project-doc/**`, `apps/cli/src/{agy_loop,agy_backend,antigravity_cmd,agent_cmd,agent_run,exec_cmd,session_cmd}.rs`, `crates/os/a2a-*/**` |
| T7 Plugin agents and commands | Path fixes, duplicates | `plugins/aphrody/agents/**`, `plugins/aphrody/commands/**` |
| T8 Plugin skills | Path fixes in project-specific skills | `plugins/aphrody/skills/**` (except skills already generic, see changelog) |
| T9 Reference docs | Cross-tool specs and templates | `docs/reference/ai/**` |
| T10 Kernel portability | Hardcoded paths | `crates/os/kernel/**`, `crates/os/kernel-client/**`, `crates/os/settings/**`, `crates/os/secrets/**` |
| T11 Residual sweep | Subprocess and duplicate clients in the remaining AI crates | `crates/ai/{jev,summary,prompts,translate,vision,voice,llm-infra,ecosystem,firefly,manga,notebooklm,google,gemini-web,http-error,supervisor,tools,toolcall,toolcall-repair,train,messaging,agent-home,ocr,ocr-core,ocr-onnx}/**` |

## 4. Decisions

- D1. mistral.rs is a git dependency pinned to `3f2515e9` inside the new crate
  `aphrody-engine-mistralrs`, optional behind feature `engine`, off by default,
  never in default CLI builds. It runs for safetensors, paged attention and
  vision. GGUF stays on `koharu-llama` (in-process, already in the workspace).
  Two candle copies are accepted because the engine crate exposes only
  `ModelClient`; no candle type crosses the crate boundary.
- D2. `aphrody-gateway` stays the single OpenAI-compatible façade, rebuilt as a
  thin server over any `ModelClient` (in-process llama, mistral.rs, remote
  vLLM or Ollama). Its duplicated client code goes; `aphrody-router` is removed
  only after `chat` and `ai` migrate (grep proof).
- D3. Codex stays protocol-level: Aphrody's own exec, resume, fork, app-server
  and config are checked against the schemas shipped in the clone. No
  `codex-*` crate dependency (large closure, git-only, pinned toolchain). The
  `codex` forward stays an opt-in fallback behind `APHRODY_CODEX_BIN`.
- D4. The deprecated `gemini` command is kept for one more release. Removal is
  recorded as a dated follow-up, not done now.
- D5. Repository URL is `workspace.package.repository` (`aphrody-labs/aphrody`).
- D6. openfox: concept map only until a licence is confirmed upstream.
- D7. Nothing is committed by workers. The lead commits only on request.
- D8. W8 toolkit-independence proof uses `ratatui` (already in the lockfile),
  not a new GUI toolkit.
- D9. LiteLLM remains an external reference and optional remote OpenAI-compatible
  endpoint. Do not add its Python SDK, beta Rust workspace, subprocess, or a
  second provider/router owner. Its Python gateway has a mature feature surface;
  the documented Rust path is opt-in and incomplete, so it does not replace
  Aphrody's local facade. See the [source review](../../research/ai/litellm-review-2026-10-01.md).
- D10. Apply LiteLLM's routing feature list to gaps in the single Aphrody router
  only when a measured use case needs it: deployment-level limits, health and
  cooldown state, bounded retries, cross-group fallbacks, and latency/cost
  selection. Keep key tenancy/spend controls separate from Aphrody OS policy,
  tool authority, secrets and durable agent event contracts.

## 5. Waves

| Wave | Content | Gate |
|---|---|---|
| 1 | T1, T2a, T2b, T2c, T3 (W2, W3, W5, W7, W8), T4, T5, T6, T7, T8, T9, T10, T11 in parallel | Lead: root deps merge, `cargo check` per touched `-p`, fix loop |
| 2 | Cross-track items: T3 W4 and W6 on top of T2, T1 W8 on top of T2c, consumer switches (retire supervisor, router) | Lead: check, tests, wasm32 |
| 3 | Final gate: scoped clippy and tests, `bun` scoped checks for `packages/ui/m3-ai`, plugin validator, doc link check | Lead: results recorded below |

## 6. Verification gate (lead)

```
nice -n 19 cargo check -j 6 -p <touched crates>
nice -n 19 cargo test  -j 6 -p <touched crates>
nice -n 19 cargo check -j 6 -p aphrody-models --target wasm32-unknown-unknown
plugins/aphrody/scripts/validate-plugin.sh
```

## 7. Execution log

| Date | Track | Result | Checks |
|---|---|---|---|
| 2026-10-01 | Pre-wave | Four plan agents (inference, GUI, CLI, RAG) wrote plans and a safe subset: NVML probe, Ollama store reader, `aphrody-local-ai`, `model ps`, native embedder and reranker, two-pass vector search. One build fix by the lead (`store.rs:517`). | `cargo check` for `aphrody-models`, `aphrody-local-ai`, `aphrody-rag --features native`, `aphrody-app`, `aphrody` bin pass; `cargo test` for the first three: 177 tests, 0 failures. |
| 2026-10-01 | Wave 1 (snapshot commit) | Stopped for session budget: T6, T7, T8 (+fork), T9, T11 and all research agents (partial, docs/plugin files may be incomplete). T1, T2a, T2b, T2c, T3, T4, T5, T10 were still running at snapshot. | Nothing compiled. Known diagnostics: kernel `crate::paths` (mod registration), `rustls` missing in a kernel http_transport, `read_capped` visibility in tools, `broker::aphrody_command`/`resolve_aphrody_bin` in ui app. Next: root Cargo.toml merge, serial scoped cargo check fix loop, then wave 2. |
| 2026-10-01 | Stop | All agents stopped at the usage limit; resume plan written. | none |
