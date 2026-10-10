<!-- SPDX-License-Identifier: Apache-2.0 -->

# `aphrody` CLI

The `aphrody` binary is the local entry point for the AI layer. The installed
binary and its Clap help output are authoritative; this page documents stable
entry points without inventing flags.

## Build

```sh
cargo build --release -p aphrody --locked
./target/release/aphrody --help
```

## Stable entry points

| Command | Purpose |
|---|---|
| `aphrody version [--json]` | Build, target and revision metadata. |
| `aphrody doctor [--json]` | Local runtime diagnostics. |
| `aphrody config` | Inspect or update configuration. |
| `aphrody exec`, `resume`, `fork` | Run or continue agent sessions. |
| `aphrody app-server` | Start the local JSON-RPC app server. |
| `aphrody mcp` | Inspect or invoke configured MCP servers. |
| `aphrody model ...` | Model catalog and integrity checks. |
| `aphrody ai env`, `ai status` | Publish the local AI environment (`~/.aphrody/ai/local-ai.{json,env}`); AI layer status. |
| `aphrody ai sync-sessions [--json] [--agent agy\|codex\|claude] [--watch --interval-secs N]` | Mirror Antigravity CLI, Codex and Claude Code transcripts into `~/.aphrody/sessions/<agent>/<session_id>.jsonl` incrementally (per-file byte offsets), attribute live agent processes, feed user/assistant turns into the local memory store (`--no-memory`, `--no-live` to skip). |
| `aphrody infer ...` | Local ONNX/runtime probing when built with `infer`. |
| `aphrody rag ...` | RAG indexing/search when built with `rag`; absent from the default binary. |
| `aphrody a2a ...` | A2A discovery and coordination. |
| `aphrody git ...`, `scan ...`, `re ...` | Repository inspection and forensics. |
| `aphrody ssh ...`, `vpn ...` | Explicit network and host operations. |
| `aphrody antigravity ...`, `agy ...` | Keyless Antigravity integration. |
| `aphrody ocr ...`, `train ...` | Optional OCR and adaptation pipelines. |
| `aphrody docs search <query>` | Multi-source documentation lookup (Context7, MS Learn, GitHub llms.txt). |
| `aphrody awesome presets\|fetch\|search\|digest` | Explore, search and generate prompt digests from curated Awesome lists. |
| `aphrody ingest <source>` | Ingest a Git repository URL or local directory into a prompt-ready LLM digest. |
| `aphrody completions ...` | Shell completion generation. |

The default binary also exposes `auth`, `mirror`, `codex`, `gemini`, `bxc`,
`google`, `translate`, `n2b`, `nie`, `term`, `memory`, `chat`, `hermes`,
`agent`, `agy-loop`, `session`, `notify`, `mail`, `self`, `package`, `oc-*`,
`notebooklm`, `logo`, `design`, `ide`, `winclean`, `gateway`, `cros`, `search`,
`runtime`, `job` and `help`; `forensics`, `index` and `firefly` appear only in
builds with the matching feature. The five ecosystem pillar commands (`aphrody web`,
`aphrody os`, `aphrody infra`, `aphrody shell`, `aphrody native`) expose diagnostic
status and bridge entry points into their respective sibling layers. Query the installed
binary with `aphrody <command> --help` before automating a command. Any unrecognised
token is routed to the natural-language A2A fallback dispatcher (`auto_command`) and
requires a running listener.

## Inspection examples

```sh
aphrody version
aphrody doctor --json
aphrody config path
aphrody model list --json
aphrody mcp --help
aphrody infer --help
aphrody ocr --help
aphrody exec --stub --ephemeral --json "Return exactly OK"
```

Commands that touch hosts, credentials, model stores, deployment or durable
data require command-specific review. Prefer read-only or dry-run modes.

## Release gate

Run `bun run verify:release -- --scoped` for the maintained CLI/Bun surfaces.
Run `bun run verify:release` before a release tag; strict mode additionally
checks the complete locked Cargo workspace and exits non-zero when any path
dependency is not buildable. The command performs tests and package dry-runs;
it never publishes or deploys.

## Boundaries

Native integrations are feature- and target-gated. A parsed command does not
prove that its optional backend is installed. Missing capabilities must be
reported explicitly.

The 2026-09-22 audit verified the installed Windows binary (`1.0.0-canary`),
model registry integrity (`model doctor --json`), PE triage, config resolution,
the offline stub turn and shell completion generation. Default `rag` help is
absent without the opt-in `rag` feature.

Deployment is owned by `aphrody-infra`; the VPS no longer runs Aphrody. For MCP use [MCP.md](../MCP.md).
For agent operation use [AGENTS.md](../AGENTS.md).
