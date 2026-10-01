# CLI native integration plan (Codex, OpenCode, Antigravity, Ollama)

Scope: `apps/cli` and the agent-runtime crates under `crates/ai/`
(`exec-events`, `app-server`, `config`, `agent-runtime`, `agent-tools`,
`session`, `rollout`, `mcp`, `mcp-client`, `mcp-oauth`, `marketplace`,
`skills`, `skills-forge`, `sdk`, `supervisor`, `toolcall`, `toolcall-repair`,
`patch`, `project-doc`, `prompts`). Inference crates (engine, infer,
llama-server, gateway) and RAG are owned elsewhere; this plan only calls
their public API.

Upstream references are read-only checkouts of codex, opencode,
antigravity-sdk-python, openfox, ollama, vllm, mistral.rs, jan, llama_index.
Nothing is copied into this repository. Status: inventory verified by
reading the source; nothing here was compiled or run (lead builds once).

## 1. Forwarder and subprocess inventory

Forwarders in `apps/cli/src/commands.rs`, dispatched from `apps/cli/src/lib.rs`:

| Command | Spawns | Decision | Reason |
|---|---|---|---|
| `codex` | `codex` binary (`CodexCommand`) | REPLACE, phased | Codex is Rust and Apache-2.0. `exec/resume/fork/app-server/config` already exist in-process. Remaining surface (TUI, login, cloud, apply) moves to the `codex-native` feature (section 4). Until then the forward stays as a fallback, optional, absent = clear message. |
| `agy` | `agy` binary + VPN proxy env | KEEP (optional) | Antigravity CLI is a closed, non-Rust product that cannot be linked. In-process alternative already exists: `aphrody antigravity` (token + RPC) and `agy_backend.rs`. Keep the forward only for the interactive TUI. |
| `gemini` | `gemini` or falls back to `agy` | KEEP, deprecated | Already deprecated; delete after one release. |
| `bxc`, `google` | Aphrody Web binary, Bun fallback | REPLACE (not in this scope) | The web bridge crate owns resolution; target is an in-process call to the Rust Aphrody Web API. Tracked by the Web owner. |
| `nie` | `niers` binary | KEEP (optional) | Separate product with its own release; graceful absence already implemented via `package install nie`. |
| `ssh` | `ssh -G` and `APHRODY_SSH_BIN` override, else in-process `aphrody_ssh` | KEEP | Only the OpenSSH config probe spawns. Default path is in-process. |
| `cros` (gn/ninja via `cmd`), `ide_cmd`, `runtime_cmd` (`uv`), `package_cmd`, `self_cmd`, `vpn_cmd`, `re_auto`, `auto_command` | external tools | KEEP | Wrapping genuine external toolchains (build, package managers). Not duplicates of an Aphrody capability. |

Subprocess spawns inside the agent crates (all legitimate, listed so they stay
audited): `agent-tools/shell.rs` (the agent shell tool), `agent-tools/search_text.rs`
(`rg`; candidate to replace with `grep-searcher`/`ignore` in-process),
`sdk/shell.rs` (duplicate of agent-tools shell, see section 2),
`skills/hooks.rs` (hook commands, the Codex hook contract is a command),
`mcp-client/transport/stdio.rs` (MCP stdio servers, protocol-mandated),
`skills/runtime/cache.rs` (git), `mcp/client_cmd.rs`.

## 2. Duplicates and canonical owner

| Capability | Copies found | Canonical owner | Action |
|---|---|---|---|
| MCP client | `mcp-client` (registry, transports, executor); `mcp/src/client_cmd.rs`; `gemini-runtime/src/mcp_client.rs` | `aphrody-mcp-client` | Make `client_cmd` and gemini-runtime thin callers. |
| MCP server config | `config/src/mcp.rs` `McpServerConfig`; `gemini-runtime/src/mcp_config.rs`; hand-rolled TOML/JSON upserts in `apps/cli/src/codex_provision.rs` and `agy_provision.rs` | `aphrody-config` | One typed model, serialized by per-tool adapters (section 3). |
| Config loader | `aphrody-config` (layers, profiles, policy) and `apps/cli/src/config_cmd.rs` | `aphrody-config` | CLI only renders. |
| Skills discovery | `skills/src/runtime/discover.rs`; `skills-forge/src/registry.rs`; `sdk/src/skills.rs` | `aphrody-skills` (discovery), `skills-forge` (authoring) | `sdk/skills.rs` re-exports discovery. |
| Plugin / marketplace | `marketplace` (index, semver, sha256); `skills/runtime/lockfile.rs`; manifests hand-maintained under `plugins/aphrody` | `aphrody-marketplace` | Add a single `PluginManifest` source (section 3). |
| Hooks | `skills/src/hooks.rs`; hook entries in `plugins/aphrody/hooks.json` | `aphrody-skills::hooks` | Event names normalized per tool by adapter. |
| Shell tool | `agent-tools/shell.rs`; `sdk/shell.rs` | `aphrody-agent-tools` | `sdk` delegates. |
| AGENTS.md discovery | `project-doc` | `aphrody-project-doc` | Already single. |

## 3. One source, per-tool adapters

Authoritative source: `plugins/aphrody/plugin.json` (portable manifest,
`$schema` agent-plugins.org). Generated outputs, never hand-edited:

| Tool | Reads | Adapter output |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json`, `agents/`, `skills/` | manifest, MCP, hooks |
| Codex | `plugin.json` or `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, `.agents/skills`, `hooks.json` (needs `features.hooks`), `.codex/agents/*.toml`, `config.toml` `[mcp_servers]` | manifest, marketplace entry, agents TOML, MCP table |
| Antigravity (agy) | `plugin.json`, `.agents/{plugins,skills,agents,rules}`, `.agents/hooks.json`, `.agents/mcp_config.json` | hooks restricted to PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop; MCP file |
| OpenCode | `opencode.json` (`mcp`, `plugin`, `instructions`, `agent`, `command`), `.opencode/{plugins,skills,agents,commands}`; also reads `.claude/skills` and `.agents/skills` | `opencode.json` fragment. Skills need no copy since OpenCode reads the shared dirs. |

Home placement (`$CODEX_HOME`, `~/.gemini`) currently done by
`codex_provision.rs` / `agy_provision.rs` becomes adapter output written by the
same code path, which removes the two hand-rolled editors.

Known contract bug to fix: `aphrody agy-loop` is documented as driven by an
`AfterAgent` hook, but agy has no such event. The loop driver must be wired to
`Stop` (and `PostInvocation` for per-turn accounting). Event mapping lives in
the agy adapter; verify against `antigravity-sdk-python` hook types before
changing `agy_loop.rs`.

## 4. Codex in-process (`codex-native`)

Codex workspace crates relevant to link instead of fork: `codex-hooks`,
`codex-core-plugins`, `codex-config`, `codex-app-server-protocol`,
`codex-exec`, `apply-patch`, `execpolicy`, `skills`. Not published to
crates.io as a set; consumed as git dependencies pinned to a revision. License
Apache-2.0, compatible with this repository.

Rules:
- Optional feature `codex-native` on `apps/cli`; default build unaffected.
- Prefer protocol/types crates (`app-server-protocol`, hooks, config schema)
  over `codex-core` to keep the dependency closure small. Evaluate closure size
  and duplicate versions with `cargo tree -d` before enabling by default.
- Where Aphrody already implements the contract (`exec-events`,
  `app-server`, `project-doc`, `patch`), keep ours and add conformance tests
  against Codex JSONL/JSON-RPC fixtures instead of adding a second dependency.
- Failing that, implement the contract natively. No vendoring, ever.

## 5. Ollama-style model UX (implemented subset)

Delegating to `aphrody-models` and `aphrody-llama-server`, no inference here:

| Ollama | Aphrody | State |
|---|---|---|
| `ollama list` | `aphrody model list` / `ls` | alias added |
| `ollama show` | `aphrody model info` / `show` | alias added |
| `ollama rm` | `aphrody model rm` / `remove` | alias added |
| `ollama ps` | `aphrody model ps` | new, read-only via `discover_running` |
| `ollama pull` | `aphrody model pull` | existing |
| `ollama run` | planned `aphrody model run <spec>` | needs engine API from inference owner (`ManagedLlamaServer`) |
| `ollama serve` | existing `aphrody gateway` (OpenAI-compatible, 8795) | existing |
| `ollama cp/create` | not planned | no registry equivalent |

JSON output follows the existing `--format/--json/--out` contract.

## 6. Dependency lines for the lead (root Cargo.toml untouched by this work)

No new dependency is required by the code changed so far
(`aphrody-llama-server` is already a dependency of `apps/cli`).
For work item 6 below, under `[workspace.dependencies]`, optional:

```toml
codex-app-server-protocol = { git = "https://github.com/openai/codex", rev = "<pinned>", package = "codex-app-server-protocol" }
codex-hooks               = { git = "https://github.com/openai/codex", rev = "<pinned>", package = "codex-hooks" }
codex-core-plugins        = { git = "https://github.com/openai/codex", rev = "<pinned>", package = "codex-core-plugins" }
```

and in `apps/cli/Cargo.toml`: `codex-native = ["dep:codex-app-server-protocol", "dep:codex-hooks"]`.
Crate package names and the codex-rs workspace layout are unverified against
the pinned revision; confirm before adding. Optional: `ignore`, `grep-searcher`
for in-process text search (work item 8).

## 7. CLI compatibility contract

Preserved: every existing command name, flag and JSON schema, including
`codex/agy/bxc/nie` trailing args, `exec/resume/fork/app-server/config`
Codex-compatible flags, `model *` output formats and exit codes, env
overrides (`APHRODY_CODEX_BIN`, `APHRODY_AGY_BIN`, `BXC_BIN`, `NIE_BIN`,
`APHRODY_SSH_BIN`). Only additive changes: new aliases and `model ps`.
A forwarder is only removed when its in-process replacement passes a fixture
parity test; the forward stays behind the env override for one release.

## 8. Ordered work items

1. Done: Ollama aliases and `model ps` (`apps/cli/src/model_cmd.rs`).
2. Single MCP server model: `aphrody-config` `McpServerConfig` serialized to
   Codex TOML, agy JSON, OpenCode JSON, Claude `.mcp.json`; replace the editors
   in `codex_provision.rs` / `agy_provision.rs`.
3. Manifest generator in `aphrody-marketplace` (portable `plugin.json` to the
   four tool layouts, plus `.codex/agents/*.toml`); add a `--check` mode for CI.
4. Fix `agy-loop` event mapping (`Stop`), add the agy hook adapter.
5. Collapse MCP client copies onto `aphrody-mcp-client`; `sdk/shell.rs` onto
   `agent-tools`.
6. Codex conformance tests (JSONL events, JSON-RPC), then optional
   `codex-native` feature, then drop the `codex` forward by default.
7. `aphrody model run` once the inference owner exposes a stable launch API.
8. Replace the `rg` subprocess in `agent-tools/search_text.rs` with in-process
   search.
9. OpenCode: emit `opencode.json` fragment; conformance-check against its
   config schema in the opencode checkout.
10. Delete `gemini` command after deprecation window.

## 9. Unverified

Nothing compiled or executed. Codex crate names and revisions, agy hook
mapping and the exact openfox/jan contract were not exercised. Items 2-10 are
design only.
