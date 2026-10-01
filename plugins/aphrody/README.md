<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody — the unified Aphrody plugin

This is the single first-party plugin for Aphrody AI/LLM, Dragon Ball/Shenron,
the OS kernel, Aphrody Web, N2B and WinClean. It bundles their skills and agents
for Claude Code, Codex and Antigravity (`agy`), and connects to the Aphrody
kernel's unified MCP endpoint. Runtime and product source remains in
its owning repository; this plugin is the one shared agent entry point.

**Version: 1.5.0** · License: Apache-2.0 · Owner: [aphrody-code](https://github.com/aphrody-code)

Platform priority: Linux Ubuntu 26.04 (#1), Windows 11 (#2), WebAssembly (#3).

## Install

```bash
# Run these from the aphrody-ai repository root; the OS checkout is a sibling.
cargo build --manifest-path ../aphrody-os/Cargo.toml --release -p aphrody-kernel --locked
cp ../aphrody-os/target/<triple>/release/aphrody-kernel ~/.local/bin/  # aphrody-kernel.exe on Windows

# Build the internal AI/Web provider used by the kernel MCP
cargo build --release -p aphrody-mcp --locked
```

The web engine (`aphrody package install`) must be installed for the Aphrody Web
tools that are not served natively in Rust.

## Client manifests

| Client | Manifest | MCP declaration |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | `.mcp.json` |
| Codex | `.codex-plugin/plugin.json` | `.mcp.json` |
| Antigravity (`agy`) | `plugin.json` | `mcp_config.json` (compatibility projection) |

The plugin connects to `aphrody-kernel mcp` as its single public MCP endpoint.
The kernel routes to its internal AI/Web provider, including `aphrody-mcp`, and
deduplicates overlapping tools. `.mcp.json` is canonical; `mcp_config.json` is
its byte-for-byte Antigravity projection.

## MCP servers

### `aphrody-kernel mcp`

The kernel exposes the installed OS catalog (coreutils, systemd, compat,
render3d, cloud, infra, nu shell, browser, admin, bun_docs), verified with
`aphrody-kernel tools`. The catalog is live and may grow without changing this
README. The server uses the whole protocol so agents can treat
these tools as native ones, like `Read` or `WebFetch`:

- **Every tool is titled and annotated** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`): the read-only tools can run without
  confirmation, the destructive ones (account actions, live Photoshop scripts,
  X purges) are flagged.
- **Protocol version negotiation** (2024-11-05 to 2025-11-25) and
  **`structuredContent`** for JSON answers.
- **Resources**: `aphrody://guide/tools` (which tool replaces which built-in) and
  `aphrody://tools/catalog` (the live catalog with its hints).
- **Prompts**: `research`, `read-page`, `crawl-site`, `migrate-to-bun`.
- **Instructions** and the plugin's `SessionStart` hook (`aphrody-kernel tools`)
  tell the agent to use `aphrody_search` instead of a built-in web search,
  `universal_web_fetch` / `aphrody_google_fetch` instead of a built-in fetch, and
  so on.

### Internal AI and Web provider

The kernel routes AI, RAG, Dragon Ball/Shenron and Web tools through its internal
provider. Its tool catalog depends on installed providers and build features;
`tools/list` is authoritative. Shenron owns editorial records and source URLs;
Aphrody supplies the MCP transport and compute.

### High-performance kernel engine

The server is backed by high-performance O(1) routing and buffered transport:
- **Precomputed `cached_mcp_tools` O(1) cache**: `tools/list` returns an `Arc<Vec<Value>>`
  precalculated on registration, answering discovery requests instantly without iterating
  subsystems or re-serializing JSON.
- **Direct dispatch O(1) map**: `dispatch: HashMap<String, Arc<dyn SystemSubsystem>>` routes
  calls directly to the subsystem Arc pointer, eliminating intermediate indirection.
- **Transport `BufWriter` with opportunistic batch draining**: 64 KB buffer in `transport.rs`
  drains queued messages via `queue.try_recv()` during bursts before a single flush,
  minimizing syscall flushes.
- **Decoupled asynchronous JSON parsing**: Inbound line reading delegates JSON parsing
  into concurrent Tokio tasks (`tokio::spawn`), preventing connection reader stalls.

Tool families:

- **Aphrody**: docs search (Context7, Microsoft Learn), reverse-engineering
  triage, recon, voice, Adobe Firefly and Photoshop, A2A, schemas,
  `aphrody_web_call`.
- **N2B**: the `n2b` tool runs the Node-to-Bun scanner and codemods in-process.
- **Cloud (native Rust)**: `github_status`, `github_branches`, `github_tree`,
  `gcp_status`, `gcp_storage_list` for local and tracking Git repository inspection,
  branches, commit DAGs, GCP credentials, active project, and Gemini API keys.
- **Dynamic Infra (native Rust)**: `infra_exec`, `infra_sftp_list`, `infra_sftp_read`,
  `infra_sync`, `infra_git_status` for remote host management (`vps`, `dbfr`) via
  in-process SSH, native SFTP, differential sync (`fast-rsync`/`rclone`), and Git checks.
  Dynamic invoker resolution without hardcoded paths (PATH, env vars, relative workspace
  paths, user home, target binaries or cargo fallback).
- **Google, search and Gemini in native Rust**: `aphrody_search`,
  `aphrody_google_translate`, `aphrody_google_detect_language`,
  `aphrody_google_supported_languages`, `aphrody_google_tts`, `aphrody_google_dns`,
  `aphrody_google_suggest`, `aphrody_google_books`, `aphrody_google_calendar_public`,
  `aphrody_google_sheet_export`, `aphrody_google_doc_export`, `aphrody_google_fetch`,
  `aphrody_gemini_rust`, `aphrody_gemini_ask`. They use the Google and Gemini
  cookie jars of the installation; when the native path fails (blocked SERP,
  browser profile, web or Python Gemini engine) the call falls back to the web
  engine.
- **The rest of Aphrody Web** (`aphrody_browser_*`, crawl, scrape, archive, wiki,
  X/Grok, FUT, assets, recon): served through the internal web engine backend,
  under the same `aphrody_*` names.

On Windows, the kernel's `--features winclean` exposes the frozen WinClean compatibility
catalog through the same kernel. The implementation is Rust-only; consumers
use kernel tools and never a DLL or a second WinClean MCP server. The contract is
[`docs/WINCLEAN-RUST-CONVERGENCE.md`](../../../aphrody-os/docs/WINCLEAN-RUST-CONVERGENCE.md).

## Slash commands

`/docs`, `/status`, `/package`, `/n2b`, `/web` and the `winclean-*` compatibility commands. All invoke the
canonical Aphrody OS/kernel path.

## Agents

- Aphrody CLI and workspace: `aphrody-cli`, `explore`, `build`, `test-runner`,
  `lint-workflow`, `code-review`, `cargo-auditor`, `cross-platform-validator`,
  `rust-architect`, `rust-engineer`, `docs-researcher`.
- Aphrody Web: `web-engineer` handles live research, crawl/browser work and
  Rust/MCP implementation.
- N2B: `node2bun`.
- Dragon Ball/Shenron: `dbfr-ocr`, `dbfr-traducteur`, `dbfr-wiki`.

## Skills

Counts and cross-references are enforced by `scripts/validate-plugin.sh`
(descriptions <= 260 chars: every skill, agent and command description is
loaded into each session, so the catalogue is kept small).

- Autonomy, cloud and infra: `yolo` (aliases `yolo-grind`, `yolo-perfect-grind`,
  `start`), `cloud`, `deploy` (through kernel `infra` and `aphrody-infra`),
  `unified-workflow`, `a2a-protocol`.
- Docs and authoring: `docs`, `skill-creator`, `best-stack-2026`.
- Aphrody CLI and AI/LLM: `aphrody-cmd-ai-creative`, `aphrody-cmd-codex`,
  `aphrody-cmd-re-forensics`, `aphrody-cmd-system-net`, `aphrody-rag`,
  `aphrody-train`.
- Dragon Ball/Shenron: `dragon-ball`, `dragon-ball-canon`,
  `dragon-ball-japonais`, `databooks-ocr`, `shenron-admin`, `toriyama-svg`.
- Aphrody Web: `web` routes everyday web, crawl and browser tasks through the
  live Aphrody CLI/MCP; load `web-frames`, `web-grok-xai`, `web-x-client` or
  `web-xcom` only for those focused domains.
- Windows: `winclean` (+ `_shared` rules), `powershell-expert`, `csharp-async`,
  `dpapi-timing-audit`.
- Reverse engineering: `auto-re`, `deep-analysis`, `pe-symbol-recovery`,
  `protocol-reverse-engineering`.
- Rust, C++ and shell: `rust-best-practices-2026`, `rust-async-patterns`,
  `rust-target-check`, `cpp-pro`, `nushell-pro`, `cross-platform-cli-toolbelt`,
  `bun`, `n2b`.
- UI and design: `m3`, `material-3`, `responsive-adaptive`, `color-expert`,
  `tailwindcss`, `shadcn`, `tauri-v2`, `render-pipeline`,
  `remotion-best-practices`, `developing-genkit-js`.

Generic engineering agents and skills (YOLO loops, deployment, security,
performance, design systems) live in the separate `yolo` plugin; the plugin
keeps only what serves Aphrody, Aphrody Web and N2B.

## Hooks

- `SessionStart`: `aphrody-kernel tools` puts the live kernel catalog in the agent's context.
- `PreToolUse` (Bash): `hooks/scripts/enforce-web-test-scope.sh` blocks a bare
  `bun test` inside the web engine package, which walks `vendor/` and reports
  pre-existing failures.

## Documentation

[`aphrody-os/docs/ARCHITECTURE.md`](../../../aphrody-os/docs/ARCHITECTURE.md)
documents the kernel/MCP contract and [`aphrody-ai/docs/README.md`](../../docs/README.md)
indexes the AI documentation. [Dragon Ball integration](docs/DRAGON-BALL.md)
records Shenron ownership, research rules and MCP boundaries. Aphrody Web
(`docs/WEB-RUNTIME.md`) is documented in the sibling `aphrody-web` repository and N2B
(`docs/n2b/`) in `aphrody-compat`.

## Unified render pipeline

The OS rendering contract is centralized in `crates/aphrody-render`: one M3
adaptive geometry contract is shared by 2D and 3D surfaces, with deterministic
CPU RGBA validation and native/web consumers routed through `packages/canvas`
and `packages/material-web`. Tauri/Wry, Obscura and WASM are hosts of that
contract. GPU backends are not advertised before a real device/surface exists,
and the OS carries no IEVR dependency. See the `render-pipeline` skill for the
scoped gates and invariants.
