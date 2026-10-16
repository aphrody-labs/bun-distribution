<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody OS architecture: the agentic fabric

The [gap remediation status](./ARCHITECTURE-GAPS-STATUS.md) records the current implementation
limits and production exit conditions.

## Drive ownership and migration

The [nested Drive workspace](../../../../apps/aphrody-drive/README.md) is an additive FSL-licensed
source import for the local filesystem backend, daemon, CLI, indexing, sync,
archive adapters and their native build patches. Its `Cargo.toml` is excluded
from the Apache-2.0 OS workspace so licensing and Cargo dependency resolution
remain explicit. The UI desktop build helper prefers the OS-owned daemon and
falls back to the retained UI copy for standalone checkouts;
installed runtime and data parity still require qualification. The HTTP site
belongs to `aphrody-web/crates/aphrody-site`, while presentation and the
TypeScript client remain in `aphrody-ui`.

The imported archive safety model is a [stub](../../../crates/os/kernel/comps/drive/README.md#known-safety-gap)
that returns safe verdicts; its “model loaded” log is not evidence of active
prompt-injection screening. AI model implementation belongs to `aphrody-ai`
behind a process contract, with OS enforcing the resulting filesystem policy.

Aphrody OS is a privileged user-space control plane and desktop shell. It does **not** boot from
BIOS or UEFI bare-metal and does not replace the host operating system kernel; `aphrody-kernel`
owns the lowest practical agent authority: a local privileged process hosting system supervision,
cross-platform coreutils, Windows control, file virtualisation, process policy, PTY, and browser subsystems.

The system targets three execution environments without bare-metal driver bloat:
1. **Windows 11**: Win32, Job Objects, Named Pipes, Rust `aphrody-winclean`, DirectComposition/CEF.
2. **Linux**: POSIX/`rustix`, Wayland/X11, Unix domain sockets, cgroups, and Proton/Wine compatibility.
3. **Web / WASI**: Sandboxed execution, Origin Private File System (OPFS), Web Workers, and WebGPU/Canvas.

See [RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md](./research/RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md) for
the foundational research on Rust OS state-of-the-art and bare-metal fact-checking.

```
   Desktop: COSMIC/GNOME Shell (aphrody-ui: app-ui, libaphrody) Terminal: Nushell
              │ window subsystem & desktop facades                   │
   ┌──────────┴──────────────────────────────────────────────────────┴─────────┐
   │          aphrody-kernel  (privileged fabric router, MCP server)           │
   │   tools/list · tools/call · skills · system/register_subsystem ·          │
   │   bus events · Unix socket / Windows named pipe / stdio                   │
   └────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────┘
        │              │              │              │              │
   systemd / init   coreutils      admin (WinClean)  shell/browser  compat
   service DAG      POSIX/Win      services/registry Nushell/Obscura Wine/Proton
   journald logs    pure Rust      screen & windows  Web Browser    .NET / pwsh
        ▲
        │ MCP (stdio: `aphrody-mcp`)
   aphrody agents (AI layer, separate repository)
```

## The contract: `aphrody-subsystem`

Every subsystem implements `SystemSubsystem`:

| Part | Method | Meaning |
|---|---|---|
| Tools | `tools()`, `call(tool, arguments)` | MCP tools. Names are global; the kernel refuses collisions. |
| Skills | `skills()` | Named sequences of tool calls. String arguments take `{{param}}` and `{{previous}}` (the previous step's result). A placeholder that is a whole string keeps its JSON type. |
| Sub-agent | `run(bus)` | A background routine started once, reacting to and publishing `Event { source, kind, payload }` on the shared `AgentBus`. |

A skill is also published as the tool `skill_<name>`, so any MCP client can run it. Skill steps
cannot call skills (no recursion).

The kernel's `AgentBus` is a bounded, in-memory broadcast channel. It is not itself an audit log.
For a durable local audit, start the kernel with `--audit-log <absolute-path>` (or
`APHRODY_KERNEL_AUDIT_LOG`): the kernel bridges future bus events into the `aphrody-events` NDJSON
sink without delaying tool dispatch. `system/audit_status` reports the configured path, bridge
state, lagged events and write failures; production monitoring must treat either counter as an
incomplete audit record.

## The kernel: `aphrody-kernel`

- **Registry, caching and O(1) routing.** `Kernel::register` verifies names, indexes tools,
  rebuilds atomic precomputed caches and starts sub-agents. Tool calls are dispatched in O(1)
  via a direct dispatch table mapping tool names directly to their owning `SystemSubsystem`
  instance. `tools/list` responses are precomputed in `cached_mcp_tools` (`Arc<Vec<Value>>`),
  answering in O(1) without iterating over subsystems or re-allocating JSON.
- **Bounded transport.** Each connection limits inbound lines to 64 MiB before allocation can
  exceed that limit, queues at most eight outbound messages, and runs at most 16 requests at
  once. Excess requests receive an overload error; requests time out after 300 seconds and are
  cancelled on disconnect. Event notifications can be dropped when the outbound queue is full.
- **Protocol.** Newline-delimited JSON-RPC 2.0. MCP methods (`initialize`, `ping`,
  `tools/list`, `tools/call`, `notifications/tools/list_changed`) plus `skills/list`,
  `skills/run`, `system/subsystems`, `system/subsystem_tools`, `system/register_subsystem`, `system/subscribe`
  (bus events as `system/event` notifications) and `system/publish`. Tool failures are
  results with `isError`, as MCP specifies; results that already are MCP `CallToolResult`s
  (Obscura screenshots) pass through unchanged.
- **Transports.** Per-user local endpoint: `$XDG_RUNTIME_DIR/aphrody-os.sock` or
  `/tmp/aphrody-os-<user>.sock` (mode 0600) on Unix, `\\.\pipe\aphrody-os-<user>` (remote
  clients rejected) on Windows, overridable with `APHRODY_OS_SOCKET`. Every connection is
  served concurrently, so a peer can answer the kernel's calls to its own subsystem while its
  own request is in flight.
- **Trust boundary.** The local endpoint uses one OS-user trust domain by default. A production
  kernel started with `--auth-file <absolute-policy-path>` authenticates each session and enforces
  its assigned tool prefixes plus event and subsystem-registration rights; see
  [`YOLO-AUTHORITY.md`](../../reference/os/YOLO-AUTHORITY.md).
- **Execution policy.** Start the kernel with `--exec-policy <absolute-policy-path>` (or
  `APHRODY_KERNEL_EXEC_POLICY`) to enforce tool-level authorization via `aphrody-execpolicy`
  before dispatch on every `Kernel::call` (blocking forbidden tools across RPC, A2A, and skills).
  Process sandboxing still requires runtime-level argv/filesystem enforcement.
- **Remote subsystems.** A connection that sends `system/register_subsystem` becomes a
  subsystem: the kernel sends it `tools/call` requests and unregisters it when it disconnects.
  `aphrody_kernel::client::host_remote` does this for a Rust process; `@aphrody/os`
  (`packages/os`) for Bun.
- **Binary.** `aphrody-kernel serve` (admin, shell and browser built in), `aphrody-mcp` (MCP on
  stdio: relays to the running kernel, or runs one in-process), and the client commands `tools`,
  `skills`, `call <tool> <json>`, `run-skill <name> <json>`, and `a2a <target> <tool> <json>`.
  Global flags include `--socket <path|pipe>`, `--auth-file <path>`, and `--exec-policy <path>`.

### High-performance architecture and O(1) dispatch

The kernel control plane is built for microsecond-scale tool inspection and sustained agentic burst throughput:

1. **Precomputed `cached_mcp_tools` O(1) cache:** `Registry::rebuild_cache()` materializes a ready-to-serve `Arc<Vec<Value>>` of all registered tools and exposed skills formatted according to the MCP specification. Incoming `tools/list` requests are answered in $O(1)$ time by cloning the `Arc` pointer, completely eliminating repeated iteration over subsystems, memory re-allocations and serializations on every discovery query.
2. **Direct dispatch O(1) map:** Rather than resolving a tool name through an intermediate subsystem key (`tool -> subsystem_name -> entry`), the registry maintains `dispatch: HashMap<String, Arc<dyn SystemSubsystem>>`. Every `Kernel::call` executes in direct $O(1)$ lookup to the target subsystem Arc pointer.
3. **`BufWriter` with bounded output:** `transport.rs` batches messages from a bounded queue into a 64 KB writer. A slow peer can delay a request response; the queue cannot grow without limit.
4. **Bounded input and task admission:** the reader checks line length before appending bytes, parses JSON, resolves responses to kernel-initiated remote calls inline, and admits at most 16 concurrent requests. This prevents remote subsystem replies from deadlocking behind the request limit.

## Subsystems

| Subsystem | Crate | Tools | Skills | Sub-agent |
|---|---|---|---|---|
| `systemd` | `aphrody-systemd` | `systemd_list_units`, `systemd_unit_status`, `systemd_start_unit`, `systemd_stop_unit`, `systemd_restart_unit`, `systemd_journal_query` | `systemd_inspect` | Ring-3 session supervisor, INI parser, dependency DAG, restart policy, in-memory circular `journald` |
| `coreutils` | `aphrody-coreutils` | `coreutils_run`, `coreutils_status`, `coreutils_catalog`, generated `coreutils_<utility>` tools; `uutils_run`, `uutils_catalog`, generated `uutils_<utility>` tools | — | Pinned upstream uutils `coreutils` multicall plus cross-platform `findutils`, `grep`, `sed`, `diffutils`, and `tar`; invoked without a shell and bounded for kernel transport. |
| `compat` | `aphrody-compat` | `compat_runtimes_status`, `compat_wine_detect`, `compat_dotnet_detect`, `compat_pwsh_detect` | — | Cross-platform compatibility runtime bridge (Wine/Proton, .NET 10 NativeAOT, pwsh) |
| `cloud` | `aphrody-kernel` (native) | `github_status`, `github_branches`, `github_tree`, `gcp_status`, `gcp_storage_list` | — | Native GitHub repository inspection (status, branches, commit DAG/trees) and GCP/Gemini credentials, project status, and GCS storage listing |
| `infra` | `aphrody-kernel` (native) | `infra_exec`, `infra_sftp_list`, `infra_sftp_read`, `infra_sync`, `infra_git_status` | — | Remote infrastructure control plane (`vps`, `dbfr`): in-process SSH execution, native SFTP navigation, differential sync (`fast-rsync`/`rclone`), remote Git inspection; dynamic runner resolution without hardcoded paths |
| `shell` | `aphrody-nu` | `nu_eval` (structured JSON result, data passed through `vars` as `$env`, timeout via Nushell signals), `nu_commands`, `nu_help` | `largest_files`, `system_snapshot` | — |
| `admin` | `aphrody-kernel` + `aphrody-winclean` | All 166 frozen WinClean compatibility tools dispatch to Rust through the kernel. Calls run with the kernel process token. | — | — |
| `aphrody_web` | `aphrody-browser` + optional Aphrody Web Browser MCP provider | Obscura `browser_*`, rendered `web_fetch`, profile routed `web_browser_fetch`, and noncolliding provider tools | `read_page` | — |
| `aphrody-ai` | optional `aphrody-mcp server` process from the sibling AI repository | AI-owned MCP tools not already registered by OS/Web; availability follows the installed binary's feature set | — | — |
| `bun_docs` | `aphrody-bun-docs` | `bun_docs_search`, `bun_docs_read`, `bun_docs_list`, `bun_node_equivalent` (offline over the fork docs pinned in `docs/reference/upstream-bun/SOURCE.json` + the n2b registry) | `bun_docs_lookup` | — |
| `window` | `aphrody-app` | `window_list`, `window_open` (http/https), `window_focus`, `window_close`, `window_set_bounds`, `window_set_state`, `window_set_title`, `desktop_notify`, `clipboard_read`, `clipboard_write` | `open_beside` | full autonomous window authority; agents may control every Aphrody window, including `main`; focus and close are published as `window/focused`, `window/closed` |

Crates of this table that live in sibling category repositories: `aphrody-nu` / `aphrody-shell`
(`aphrody-shell`), `aphrody-browser` (`aphrody-web`) and `aphrody-app`
(`aphrody-ui`), `aphrody-bun-docs` (`aphrody-compat`). The kernel links them by relative path; see
[`README.md`](../../products/os/README.md#sibling-repositories).

The desktop hosts the kernel with the web subsystem when it starts first, or joins the
running kernel with the window subsystem. Tauri is also the desktop runtime authority: its
`resource_dir` is packaged read-only input and its platform-resolved `app_data_dir` owns the
canonical `profiles/`, `assets/`, `binaries/` and `sqlite/` state tree exposed by
`aphrody_runtime_layout`. CEF (`tauri-runtime-cef`) is the webview implementation beneath Tauri; Obscura remains
the browser/crawler implementation and is never substituted by the shell webview. When
`APHRODY_WEB_MCP_BIN` is configured, the kernel discovers Aphrody Web MCP tools and includes
them in `aphrody_web`; it does not register a second web subsystem. `http`, `static`, `fast`,
`stealth` and `max` requests go to the Aphrody Web Browser backend, while `render` uses Obscura. The Tauri
desktop calls the same kernel tools; interactive previews remain owned by `window`.

The kernel also discovers an installed `aphrody-mcp` binary as a separate local
`aphrody-ai` subsystem. It launches `aphrody-mcp server` over stdio, excludes Web names and
names already owned by OS subsystems, then registers the remaining tools. Set
`APHRODY_AI_MCP_BIN` to an explicit binary path to require that provider, or to an empty value to
disable discovery. This is a process boundary: the OS Cargo workspace does not link AI crates.
Only the local kernel endpoint receives these tools; this does not publish privileged tools on
the Aphrody site or its public MCP route.

When `APHRODY_YOLO=1` and the agent is authenticated, the kernel is the full
autonomous authority for the declared Aphrody OS/AI/infra scope. The window
subsystem therefore permits agents to control every window, including `main`;
see [`YOLO-AUTHORITY.md`](../../reference/os/YOLO-AUTHORITY.md).

### Cloud subsystem (`cloud`)

The `cloud` subsystem (`crates/os/kernel/core/src/cloud.rs`) embeds native, privileged git repository analysis and Google Cloud / Gemini environment verification directly into the kernel:

- **`github_status`**: Current branch, upstream tracking (`ahead`/`behind` counters), status porcelain v1 modified and untracked file inventory, and last commit metadata. Resolves `repo_path` or falls back safely to current working directory.
- **`github_branches`**: Enumerates all local and tracking remote branches with commit SHA, upstream target and divergence status.
- **`github_tree`**: Lists tree entries (mode, blob/tree type, SHA, size, and relative path) at a specific Git reference (default `HEAD`) or subdirectory (`path`).
- **`gcp_status`**: Inspects Google Cloud SDK authentication, active project (`gcloud config get-value project` or `CLOUDSDK_CORE_PROJECT`/`GCP_PROJECT`), and Gemini API keys presence (`GEMINI_API_KEY`, `GOOGLE_API_KEY`).
- **`gcp_storage_list`**: Lists objects, storage prefixes, and sizes in a Google Cloud Storage bucket (`gcloud storage ls` or `gsutil ls`).

### Dynamic infrastructure subsystem (`infra`)

The `infra` subsystem (`crates/os/kernel/core/src/infra.rs`) provides remote host control and synchronization targeting production aliases (`vps`, `dbfr`):

- **`infra_exec`**: Runs remote commands over in-process SSH with JSON output and exit status tracking.
- **`infra_sftp_list`**: Traverses remote directories over native SFTP, returning entry metadata (size, file permissions, `is_dir`).
- **`infra_sftp_read`**: Reads remote configuration or log files via native SFTP.
- **`infra_sync`**: Executes differential synchronization (`fast-rsync` / `rclone`) between local and remote directories; safe dry-run by default (`apply: false`).
- **`infra_git_status`**: Probes the working tree state, dirty files, and commit logs of a remote production repository.

#### Dynamic runner resolution (zero hardcoded paths)

To avoid fragile machine-specific paths, `resolve_infra_invoker()` discovers the infrastructure runner dynamically using a hierarchical strategy:
1. **Global PATH**: Checks if `aphrody-ssh` is installed and responds to `--version`.
2. **Environment overrides**: Inspects `APHRODY_INFRA_PATH` (exact `Cargo.toml` path) or `APHRODY_INFRA_DIR`.
3. **Workspace relative traversal**: Checks `../aphrody-infra/Cargo.toml` (sibling repository) and `aphrody-infra/Cargo.toml` (child submodule).
4. **User home hierarchy**: Checks `~/src/aphrody-infra/Cargo.toml` and `~/aphrody-infra/Cargo.toml` resolved via `USERPROFILE` (Windows) or `HOME` (Unix).
5. **Target binary discovery & cargo fallback**: Looks for existing compiled binaries under `target/debug/aphrody-ssh[.exe]` or `target/release/aphrody-ssh[.exe]`, falling back cleanly to `cargo run --manifest-path ... -p aphrody-ssh --`.

## Connecting an agent

In the `aphrody-ai` agent configuration (`config.toml`):

```toml
[mcp_servers.aphrody-os]
command = "aphrody-kernel"
args = ["mcp"]
```

The agent then sees the OS tools as `mcp__aphrody-os__<tool>` next to its own. Verified with
`aphrody app-server`: `tools/list` returns `nu_eval`, `nu_commands`, `nu_help`, the browser
tools and the `skill_*` tools.

## Polyglot subsystems

```ts
import { registerSubsystem } from "@aphrody/os";

await registerSubsystem({
  name: "bun_text",
  tools: [{ name: "bun_reverse", description: "Reverse a string.", handler: ({ text }) => [...String(text)].reverse().join("") }],
});
```

The same wire protocol serves a uv (Python) process: connect to the endpoint, `initialize`,
`system/register_subsystem`, then answer `tools/call` requests with MCP results.

## Architecture References & Roadmaps

- [Rust OS Architecture & Bare-Metal Research](./research/RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md) - Deep dive into Rust bare-metal vs user-space control plane, Limine, memory allocators, TTAS locking, and driver stratification.
- Graphical OS Shell Specification (`docs/design/GRAPHICAL-OS-SHELL-SPEC.md` (not in repo) in the sibling `aphrody-ui` repository) - 8 Pillars of the Aphrody OS desktop shell (`libaphrody`, `app-ui`, `aphrody-systemd`, `aphrody-coreutils`, `aphrody-compat`).

## Roadmap & Planned Extensions

| Item of the target design | Status |
|---|---|
| WASM plugins (Wasmtime, Component Model, WIT `subsystem-driver`, `ResourceLimiter`) | Architecture defined; remote-subsystem protocol is the extension point. |
| Dedicated Wayland compositor (Smithay / WGPU) | Research complete; desktop window authority is Tauri/CEF across Windows and Linux. |
| uv (Python) SDK | Protocol operational via NDJSON endpoint; standalone package planned. |
| Vision / coding sub-agents (Florence-2, Qwen2.5-Coder) | AI layer (`aphrody-ai`), which consumes OS kernel tools via MCP. |
| Screen capture & UIA observation | Fully operational via `admin` (`aphrody-winclean`) and wired into `aphrody-app` desktop facades. |
