<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody YOLO runtime

`aphrody-yolo` (`crates/infra/yolo` in this repository) is the autonomous execution runtime of
Aphrody. It carries the YOLO doctrine: continuous autonomy, deterministic orchestration,
reversible decisions taken without waiting, and validation before delivery. Restored from the
retired `aphrody-os` monolith (`docs/reference/infra/APHRODY-YOLO-RUNTIME.md`); the kernel and the plugin it
drives now live in the `aphrody-os` category repository.

It is not defined as a CLI, a library or an MCP server: those are control and integration
surfaces. Its identity is the runtime that connects the Aphrody subsystems and keeps their
execution state.

## YOLO authority

YOLO is a persistent operational authority: repeated human approvals are removed for reversible
decisions covered by the mission. It is neither a network protocol nor a convenience flag. The
authenticated markers are defined in `~/.codex/YOLO-NHITL.md`.

| Runtime control | Enforcement |
|---|---|
| Scope | `--root` selects the working directory and resolves relative `map` and `fs` paths; mission prompts assign file families. It is not a filesystem sandbox. |
| Duration | `--once`, `--max-ticks` and `--interval-secs` bound controlled runs. |
| Authority | The runtime orchestrates; `aphrody-kernel` (`aphrody-os`) holds the OS capabilities and the host process token. |
| Windows elevation | The kernel is started through `C:\Windows\System32\sudo.exe` when an administrator token is required; YOLO then calls its MCP endpoint. |
| Revocation | Stopping the process interrupts the ticks; no OS privilege is bypassed. |
| Traceability | Per-tick manifest, JSONL journal, heartbeat and A2A envelopes. |
| Recovery | Lane prompts request owner gates; Git records changes for audit and rollback. YOLO does not invoke `verify` during `autopilot`. |

The canonical launcher of an administrator kernel is `aphrody kernel elevate` in
`aphrody-os`. It runs the kernel through the native Windows sudo and keeps the current
directory. YOLO then connects to the kernel socket:

```powershell
# from ../aphrody-os
aphrody kernel elevate -- aphrody-kernel serve
# from this repository
cargo run -p aphrody-yolo -- win status
cargo run -p aphrody-yolo -- autopilot --once
```

| Subsystem | Role in the runtime |
|---|---|
| `map` | Workspace topology, source boundaries and MRX audit. |
| `detect` | Type, language, symbol and validation-gate detection. |
| `shell` | Authenticated client of the kernel `shell` subsystem: structured Nushell pipelines and existing OS utilities. |
| `fs` | Explicit path metadata index stored as plain text. |
| `win` | Proxy to the kernel `admin` subsystem; no WinClean DLL is loaded in YOLO. |
| `verify` | Cargo, Bun, uv, PowerShell and Nushell gates. |
| `grind` / `autopilot` | Persistent ticks and agent-harness orchestration. |

The `aphrody-yolo` binary is the execution plane: missions, lanes, gates and evidence.
`aphrody-kernel` is the local control plane: MCP, IPC, shell, browser and Windows
administration. OS calls go through the kernel; YOLO recreates neither a WinClean catalog, nor an
MCP server, nor a system authority.

## Permanent cycle

Each tick ingests the priority plan or explicit goals, selects at most four tasks, infers a
role from each title, then writes a manifest. `autopilot` normally runs Lead lanes
in parallel; `--sequential` waits for each lane before starting the next in a shared checkout.
It then starts an independent Auditor lane. Lanes and the
auditor classify results as `FAIT`, `INCOMPLET` or `NON_FAIT`.

The runtime also publishes each tick in `.coord/`: an ISO-8601 heartbeat and a JSONL A2A
envelope, so peers can consume the state without parsing logs.
`autopilot --once --goal "..."` runs an explicit mission even when the repository
has unrelated plan items. Repeat `--goal` for up to four missions. From a sibling repository, the runtime resolves the
unified YOLO manifest in `../aphrody-ai/plugins/aphrody`.

```text
plan or direct mission
  -> up to 4 owning Lead lanes
  -> owner-gate requests in lead prompts
  -> independent Auditor lane
  -> manifest + heartbeat + A2A envelope
  -> next tick or perfection oracle
```

Persistent artifacts:

| Path | Content |
|---|---|
| `var/yolo/runs/<run-id>/manifest.json` | Tasks, roles and tick identity. |
| `var/yolo/ticks.jsonl` (not in repo) | Append-only tick journal. |
| `.coord/heartbeat-aphrody-yolo.txt` (not in repo) | Peer heartbeat. |
| `.coord/inbox-from-aphrody-yolo.jsonl` (not in repo) | A2A `fact` envelopes. |

## Local control plane

From this repository (the kernel commands run in `../aphrody-os`):

```powershell
cargo run -p aphrody-yolo -- doctor
cargo run -p aphrody-yolo -- detect crates/aphrody-yolo/src/main.rs
cargo run -p aphrody-yolo -- verify --tier tools,pwsh,nushell,uv
cargo run -p aphrody-yolo -- map scan
cargo run -p aphrody-yolo -- map check
cargo run -p aphrody-yolo -- shell eval "ls | first 5"
cargo run -p aphrody-yolo -- shell describe ls
cargo run -p aphrody-yolo -- fs build
cargo run -p aphrody-yolo -- fs search Cargo
cargo run -p aphrody-yolo -- win status
cargo run -p aphrody-yolo -- win catalog computer
cargo run -p aphrody-yolo -- win call get_os_info
cargo run -p aphrody-yolo -- system
cargo run -p aphrody-yolo -- plan
cargo run -p aphrody-yolo -- check
cargo run -p aphrody-yolo -- grind --dry-run
cargo run -p aphrody-yolo -- grind --goal "Fix the next runtime defect"
cargo run -p aphrody-yolo -- autopilot --once --dry-run
cargo run -p aphrody-yolo -- --root . autopilot --once --dry-run --goal "Maintain Rust crates in this repository"
cargo run -p aphrody-yolo -- --root . autopilot --once --sequential --dry-run --goal "Review Cargo manifests" --goal "Review Bun scripts"
cargo run -p aphrody-yolo -- autopilot --max-ticks 3
# kernel (aphrody-os)
cargo run -p aphrody-kernel -- serve
```

| Command | Role |
|---|---|
| `verify` | Runs the Cargo, Bun, uv, PowerShell and Nushell tiers. |
| `detect <file>` | Detects type, language, MIME, build/test gates and symbols. |
| `map` | Produces or checks `path.json` and `monorepo-map.json`. |
| `shell` | Routes Nushell to `aphrody-kernel/shell` with structured output. |
| `fs` | Builds, queries and checks a plain-text path metadata index. |
| `win` | Routes the administration catalog and calls to `aphrody-kernel/admin` over local MCP. |
| `system` | Exposes orchestration dependencies, the FS index state and kernel availability. |
| `plan` | Resolves tasks and validation gates. |
| `check` | Validates the manifest, agents and skills of the Aphrody plugin (`plugins/aphrody` of the `--root`, else the canonical `../aphrody-os/plugins/aphrody`). |
| `grind` | Writes a bounded YOLO tick. |
| `autopilot` | Starts ticks through an installed harness, with the host process permissions. |

`map --out`, `map --map` and `fs --database` accept an absolute path or a path relative to
`--root`. With `--json`, the output of executed gates stays on stderr so stdout only carries the
runtime's JSON records. `autopilot --harness` fails explicitly when the requested harness is not
available; it never silently switches to another one.

MRX is part of `aphrody-yolo map`. There is no MRX crate, no YOLO Bun package and no YOLO
executor in Python, PowerShell, Bash or TypeScript.

`map` and `fs` do not duplicate work: the first resolves workspace topology and source
boundaries; the second indexes path metadata only. Building the index is always explicit.
For repeated path searches, OS owns the SQLite FTS5 `aphrody-fsindex` index.
Shell's `aphrody utils` reaches OS `grep` and `find` through kernel IPC, while
YOLO `detect` classifies a selected file. YOLO `fs` is a plain-text path list,
not a content search engine. YOLO connects through the shared
`aphrody-kernel-client`; `shell`, `win` and `system` require a running kernel
and its configured authentication token.

`--socket` (or `APHRODY_OS_SOCKET`) selects the kernel endpoint. `win` commands fail when the
`admin` subsystem is unreachable: YOLO never creates a second local Windows authority.
