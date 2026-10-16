<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent protocol and desktop fact-check — 2026-09-26

This dated note records a source check of ACP, Codex desktop integration,
Codexia, Jan, and the Tauri local-inference plugin claims. Repository trees,
READMEs, manifests, and official protocol documentation were checked on
2026-09-26. GitHub language percentages and exact dependency versions are
time-sensitive and are intentionally omitted unless they are part of a
checked manifest.

## Verified facts

| Subject | Finding | Primary source |
|---|---|---|
| ACP Rust SDK | The SDK crate is `agent-client-protocol`; its Rust docs describe both `Agent` and `Client` implementations. The current `main` source digest reports crate version `2.2.0`, stable v1 examples, and v2 examples gated by `unstable_protocol_v2`. | [Rust library docs](https://agentclientprotocol.com/libraries/rust), [SDK source](https://github.com/agentclientprotocol/rust-sdk/tree/main) |
| ACP status | ACP v1 documentation describes JSON-RPC agent/client sessions. The ACP announcement labels v2 a Draft and says behavior may change; v2 production use should be version-negotiated and gated, with v1 retained for compatibility. | [v1 overview](https://agentclientprotocol.com/protocol/v1/overview), [v2 draft announcement](https://agentclientprotocol.com/announcements/acp-v2-draft) |
| Aphrody protocol ownership | `aphrody-contracts` owns `aphrody-agent-proto` (Submission/Event NDJSON) and `aphrody-app-protocol` (Codex app-server v2 types). Neither is ACP. The AI repo has a Codex-shaped app-server, not an ACP endpoint/client. | [`aphrody-contracts` README](../../../products/contracts/README.md), [`aphrody-ai` app-server README](../../../../../crates/aphrody-app-server/README.md) |
| Official Codex desktop | The `openai/codex` README says `codex app` launches the desktop app experience. It is an official Codex entry point and must not be described as a third-party GUI. | [OpenAI Codex README](https://github.com/openai/codex#readme) |
| Codexia | `milisp/codexia` is a real repository. Its README describes Codex CLI, Claude Agent, and external ACP agent support; its root has separate `src/`, `src-tauri/`, and `web/` directories plus a Cargo workspace. Do not infer internal file names or capabilities from that tree alone. | [Codexia repository](https://github.com/milisp/codexia), [README](https://github.com/milisp/codexia/blob/master/README.md) |
| Jan | `janhq/jan` `main` contains `adk/`, `core/`, `extensions/`, `protocol/`, `src-tauri/`, and `web-app/`. Its README documents compiling the bundled llama.cpp engine through Ninja/CMake toolchains and `JAN_ENGINE_VARIANT`; it names `tauri-plugin-llamacpp`. No evidence supports invented source paths such as `loop.rs`, `upstream.rs`, or `SseAccumulator`. | [Jan repository](https://github.com/janhq/jan), [README](https://github.com/janhq/jan/blob/main/README.md), [Tauri plugin guide](https://github.com/janhq/jan/blob/main/src-tauri/plugins/CONTRIBUTING.md) |
| `tauri-plugin-llm` | Contrary to the claim that this repository does not exist, `crabnebula-dev/tauri-plugin-llm` is public and its README documents loading and running local GGUF/Safetensors models using Candle. The repository declares PolyForm Noncommercial licensing. It is a real option to evaluate, but its license and project status must be checked before adoption; it is not interchangeable with Jan's llama.cpp plugin or a generic sidecar. | [Plugin README](https://github.com/crabnebula-dev/tauri-plugin-llm), [manifest](https://github.com/crabnebula-dev/tauri-plugin-llm/blob/main/Cargo.toml), [license](https://github.com/crabnebula-dev/tauri-plugin-llm/blob/main/LICENSE_POLYFORM-NONCOM) |
| Awesome search | `aphrody awesome search` returned zero curated matches for ACP and Tauri Codex GUI in the checked presets. This means the configured curated lists had no matching entries; it does not prove that relevant projects do not exist. | Local command `aphrody awesome search 'ACP agent client protocol' --preset agents`; `aphrody awesome search 'Tauri Codex GUI' --preset coding` |

## Corrections to earlier claims

- Jan is not Electron-only; its checked `main` tree includes a Tauri host and
  the Rust/C++ inference integration listed above.
- The previously named Jan internals `loop.rs`, `upstream.rs`, and
  `SseAccumulator` were fabricated and must not be repeated as repository facts.
- Codexia is real; the names `CodexGui`, `Pasture`, and `Codapter` were not
  verified projects and should not be recommended as such.
- The official Codex desktop is launched through `codex app` according to the
  current official README.
- `tauri-plugin-llm` is real. The accurate caveat is its PolyForm
  Noncommercial license and its distinct Candle-based design, not its
  nonexistence or lack of local inference.
- Sidecar (`tauri-plugin-shell` plus an inference server) and native inference
  plugins are architectural options, not an exhaustive list of proven
  production approaches.

## Tool evidence and limits

- `aphrody docs search 'Agent Client Protocol Rust SDK' --limit 5 --digest`
  ran, but returned community GitHub search results, so those results were not
  treated as authoritative protocol evidence.
- `aphrody awesome presets` and the two searches above ran successfully.
- `aphrody ingest` produced a digest of 88 files under the ACP Rust SDK crate
  (`461.0k` estimated tokens); targeted inspection confirmed the package
  version and stable/draft example split. The attempted Jan subpath ingestion
  did not return a completion result, so Jan claims above were checked against
  its GitHub tree, README, and plugin guide instead.
- `aphrody i --help` was routed by the installed binary to `cargo add --help`;
  this CLI has no top-level `i` command in the checked command definitions.
  No dependency was added.

## Aphrody implementation status

ACP support is **not implemented** in Aphrody as of this check. The contract
repo's agent and app-server protocol crates are different wire contracts.
Any ACP work needs an explicit integration design and interop proof; adding
the upstream SDK alone would not make Aphrody an ACP client or agent.
