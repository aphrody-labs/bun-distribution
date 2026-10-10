<!-- SPDX-License-Identifier: Apache-2.0 -->
# WinClean to Aphrody OS native Rust convergence plan

Status: canonical execution plan  
Date: 2026-09-22  
Scope: `crates/os/kernel/comps/winclean`, Aphrody OS capability crates, kernel, desktop, Bun bindings, and the single Aphrody plugin
Supersedes: the separation decisions of the 2026-05-19 winclean/aphrody unification audit (retired; git history)

## 1. Decision

WinClean is not retained as a parallel product, a second MCP server, or a permanent .NET runtime.
Its complete source is an in-workspace migration corpus owned by `aphrody-winclean`. Every useful
capability is moved into the existing Rust crate that already owns that domain. Windows-specific
operations remain behind the Rust `aphrody-winclean` API. The kernel exposes the resulting tools
through the common `SystemSubsystem` contract.

The final state has:

- one privileged control plane: `aphrody-kernel`;
- one Windows backend: `aphrody-winclean`, implemented in Rust;
- one reverse-engineering engine: `aphrody-re`;
- one process engine: `aphrody-proc`;
- one capture engine: `aphrody-capture`;
- one filesystem index and search path: `aphrody-fsindex` plus `aphrody-search`;
- one desktop and shell experience: `aphrody-app`, Tauri (CEF runtime), and the M3 packages;
- the unified agent plugin at `../aphrody-ai/plugins/aphrody`;
- one tool schema and generated binding pipeline;
- stable WinClean tool names for all consumers;
- no runtime dependency on .NET, NativeAOT, `winclean.dll`, or dynamic C ABI loading.

The migration is complete in the current checkout. Historical wave descriptions below are retained
as provenance; they are not pending work. The production path is Rust-only.

## 2. Verified baseline

The following facts were observed in the current workspace on 2026-09-22.

| Area | Current state | Target |
|---|---|---|
| Source placement | Rust catalog, generated DTOs and handlers are under `crates/os/kernel/comps/winclean` | Legacy C#/C++/SDK corpus removed; provenance docs remain outside the runtime path |
| Rust facade | `aphrody-winclean` dispatches directly in-process | Direct Rust implementations; no `libloading`, DLL discovery or managed fallback |
| Tool surface | `src/tools.json` contains 166 tools | All 166 names mapped to a Rust owner and served by the kernel |
| Kernel | `AdminSubsystem` republishes the complete catalog | Dispatch directly to typed Rust capability handlers |
| Runtime proof | Kernel probe exposed 166 admin tools | Preserve count and JSON contracts through the migration |
| Native build | Legacy NativeAOT projects removed | No .NET/NuGet build is part of the workspace |
| Bun | `packages/os/winclean` tests and typecheck pass | Thin client over `@aphrody/os`; no direct native DLL access |
| Plugin | `../aphrody-ai/plugins/aphrody` is the only active authority | No nested WinClean plugin authority |
| Desktop | `aphrody-app` already owns Tauri window integration | Absorb WinClean Shell and WinUI behavior into the M3 desktop |
| Reverse engineering | `aphrody-re` already implements PE/ELF/Mach-O triage, strings, entropy, disassembly, Go and ASAR support | Fill parity gaps and delete `Winclean.ReverseEngine` |
| Process control | `aphrody-proc` owns process groups, Job Objects, locks, liveness and GPU leases | Add snapshots, affinity, priority, working-set and memory operations |
| Files | `aphrody-fsindex` and `aphrody-search` exist | Own file discovery; the Windows backend only supplies platform metadata |
| Capture | `aphrody-capture` performs Windows capture | Own screen/window frames used by computer-use and OCR |
| Workspace gate | Metadata and full workspace check pass locked/offline | Remaining warnings are upstream future-incompatibility notices, not WinClean code warnings |

The historical audit treated WinClean as a permanent Windows-only .NET specialization. That
decision is obsolete. Its inventory remains useful, but its ownership conclusion does not.

## 3. Non-negotiable architecture rules

### 3.1 One owner per capability

A tool can have aliases and multiple transports, but its implementation has one owner. MCP, Bun,
Tauri commands, CLI commands, and skills call the same Rust service. They do not reimplement it.

### 3.2 No new crate for every WinClean class

The port reduces duplication. New modules are added inside existing domain crates. A new crate is
allowed only when a dependency cycle cannot be removed through a trait or data-contract module.
No such new crate is currently required.

### 3.3 The kernel composes; it does not implement domain logic

`aphrody-kernel` owns lifecycle, privilege, routing, events, transport, and policy. PE parsing,
process memory, capture, registry, services, Steam discovery, and input injection stay outside the
kernel.

### 3.4 Portable logic is separated from Windows bindings

Pure parsing, schema validation, indexing, filtering, hashing, state machines, and serialization
remain platform-neutral. Windows API calls live in `cfg(windows)` backend modules with small safe
wrappers around unsafe FFI.

### 3.5 Compatibility is preserved at the boundary

The 166 current tool names and their JSON input schemas remain valid during the migration. New
typed Rust APIs may use clearer names internally. Compatibility aliases are removed only in a
versioned protocol change after every in-workspace caller is migrated.

### 3.6 Parity precedes deletion

A legacy implementation was deleted after its Rust replacement passed contract, live Windows, and
consumer tests. Source placement alone was not used as migration evidence.

### 3.7 Privilege is centralized

`aphrody-kernel` is the always-available elevated host authority on Windows. Installation verifies
`C:\Windows\System32\sudo.exe`, configures the supported inline mode when explicitly run from an
elevated installer, and launches the kernel with an administrator token. Desktop webviews and Bun
processes consume its local named-pipe contract instead of each carrying a second elevation path.
No UAC bypass or undocumented token theft is part of the design.

### 3.8 First-party code stays in this workspace

All migrated Aphrody source lives under `crates`, `packages`, `scripts`, `plugins`, or `docs`.
External libraries remain normal Cargo dependencies or absorbed upstream workspaces with recorded
provenance. No `third_party` source island is introduced.

## 4. Target architecture

### 4.1 Workspace wiring already active

The kernel links existing workspace owners instead of cloning their logic:

Dispatch ownership is now split at the crate boundary: `aphrody-kernel` performs catalog lookup,
privilege policy and legacy fallback only; the concrete Rust dispatch for migrated tools lives in
`aphrody-winclean::dispatch`. This keeps the control plane compositional and makes the backend
callable from future MCP, CLI and GUI transports without another kernel-local switch.

The live ledger currently selects Rust for all 166 tools. WinML uses the dynamic ONNX Runtime
adapter in `aphrody-winclean::winml`; runtime proof still requires a machine with the DLL and
the requested execution providers installed.

The compatibility boundaries are also deduplicated: `packages/os/winclean` is a private local
Bun facade over `@aphrody/os`; it is not a second publishable runtime. The obsolete
The historical SDK re-export fixtures are removed; Windows Rust dependencies are
workspace-owned and shared by capture and WinClean. Remote-process byte/scalar access is now
implemented by the Rust memory backend with bounded reads/writes and explicit address parsing.

- `aphrody-re` serves binary-analysis dispatches;
- `aphrody-capture` serves `computer_capture_screen` through the kernel transport;
- `aphrody-capture` also owns detailed visible-window enumeration for `list_windows`;
- `aphrody-proc` owns PID liveness and termination for live `kill_process` PIDs;
- `aphrody-fsindex` serves `search_files` when `APHRODY_FSINDEX_DB` points to an existing
  metadata-only FTS5 index. The glob walker remains the compatibility fallback.
- the Rust Windows backend serves bounded, UTF-16-safe WSL status, distribution, process and
  read-only probe calls; `wsl_execute` accepts an argv vector and `wsl_send_signal` accepts only
  the four documented POSIX signals. No arbitrary concatenated shell text is routed through the
  kernel.

The frozen WinClean names and schemas remain unchanged; optimized owners are selected without a
second runtime or duplicate crate.

```text
 agents / skills / CLI / Bun / Tauri M3 desktop
                     |
          local MCP or named-pipe RPC
                     |
        +------------v-------------+
        |      aphrody-kernel       |
        | lifecycle, routing, sudo, |
        | events, tool registry     |
        +------------+-------------+
                     |
              SystemSubsystem
                     |
        +------------v-------------+
        | aphrody-winclean (Rust)   |
        | Windows backend and       |
        | compatibility dispatch    |
        +--+-----+-----+-----+------+
           |     |     |     |
   +-------v+ +--v---+ | +---v-------------------+
   |proc     | |re    | | |Windows-only modules  |
   |process  | |PE/   | | |registry, services,   |
   |memory   | |ASAR  | | |tasks, power, WSL,    |
   +---------+ +------+ | |Steam, input, UIA     |
                 +------v-+-----------------------+
                 | capture / fsindex / search /   |
                 | settings / jobs / a2a          |
                 +--------------------------------+
```

Dependency direction is downward only:

```text
aphrody-app ────────> aphrody-kernel ────────> aphrody-winclean
packages/winclean ──> @aphrody/os RPC                    |
aphrody-yolo ───────> aphrody-kernel client              +--> aphrody-proc
                                                        +--> aphrody-re
                                                        +--> aphrody-capture
                                                        +--> aphrody-fsindex/search
                                                        +--> aphrody-settings/jobs/a2a
```

Domain crates never depend on `aphrody-kernel`. `aphrody-winclean` may compose domain crates, but
those crates never depend back on it.

## 5. Crate ownership matrix

| Capability | Canonical owner | Rust implementation boundary | Legacy source replaced |
|---|---|---|---|
| Tool schemas and compatibility dispatch | `aphrody-winclean` | Static catalog, typed handler registry, DTO compatibility | `WincleanToolCatalog`, NativeAOT exports, SDK generated C ABI |
| Windows process enumeration | `aphrody-proc` | Toolhelp/NtQuery safe snapshots | `NativeProcessEnumerator`, `ProcessManager` |
| Process groups and termination | `aphrody-proc` | Existing Job Object and group APIs extended with snapshots | process control tools |
| Affinity, priority, eco mode, working sets | `aphrody-proc` | Owned process-handle wrapper with access masks | `ProcessGovernor`, `PerfTools` |
| Remote process memory | `aphrody-proc::memory` | Typed `ProcessHandle`, region iterator, reads, writes, allocation, protection, suspend/resume | `MemoryTools`, `MemoryManager` |
| Binary analysis | `aphrody-re` | Existing parsers plus parity DTO adapters | `Winclean.ReverseEngine`, `BinaryTools`, `ReverseTools` |
| File indexing and lookup | `aphrody-fsindex`, `aphrody-search` | Persistent index, structured query, Windows metadata adapter | `SearchService`, `FileSystemScanner`, `search_files` |
| Direct file operations | `aphrody-winclean::filesystem` | Windows semantics and compatibility DTOs over `std::fs` | `FileSystemTools` |
| Capture and frame encoding | `aphrody-capture` | Screen/window capture, PNG/BGRA frames | GDI capture and Vortice capture paths |
| OCR orchestration | `aphrody-winclean::computer` | Capture adapter and OCR provider contract; inference remains outside the OS layer | `computer_ocr` glue |
| Windows, UIA and input | `aphrody-winclean::{window,uia,input}` | `windows` crate bindings, COM apartments, SendInput, window handles | `ComputerUseTools`, `InputTools`, `WindowTools`, `SnapshotTools` |
| Virtual gamepad | `aphrody-winclean::gamepad` | ViGEm capability loaded behind a Rust driver trait | `GamepadTools` |
| Registry and startup entries | `aphrody-winclean::{registry,startup}` | Typed hive/path/value model | `RegistryTools`, `StartupManager` |
| Services and event log | `aphrody-winclean::{service,eventlog}` | SCM and Event Log APIs | `ServiceManager`, `ServiceTools`, `EventLogTools` |
| Scheduled tasks | `aphrody-winclean::task_scheduler` | Task Scheduler COM wrapper | `TaskManager`, `ScheduledTaskTools` |
| Power and performance | `aphrody-winclean::{power,performance}` | PowrProf, NT memory-list and DWM calls | `PowerPlanManager`, `PerfTools` |
| Defender and firewall | `aphrody-winclean::{defender,firewall}` | COM/WMI or documented command surface behind typed results | `DefenderManager`, `FirewallManager` |
| Hardware and network inventory | `aphrody-winclean::{system,network}` | Native Windows APIs and registry; portable DTOs | `SystemProfiler`, `HardwareProfiler`, `NetworkManager` |
| GPU preferences and HAGS | `aphrody-winclean::gpu` | Typed registry and D3D adapter inventory | `GpuManager`, `GpuRegistryTools` |
| WinML/DirectML inspection | `aphrody-winclean::winml` | ONNX metadata and Windows execution provider adapter | `WindowsMlTools`, DirectML dependency |
| WSL | `aphrody-winclean::wsl` | `wsl.exe` process protocol with structured output and signals | `WslManager`, `WslTools` |
| Steam discovery and launch | `aphrody-winclean::steam` | Registry discovery, VDF parser, process observation | `SteamScan`, `SteamLauncherTools`, `SteamTools` |
| Steam credentials | `aphrody-winclean::credential` | Credential Manager safe wrapper; secret bytes never logged | `Winclean.SteamAuth` |
| Coordination state | `aphrody-jobs` plus `aphrody-a2a` | Durable task and status records | `CoordStore`, `CoordTools`, WinClean A2A service |
| Notifications and clipboard | `aphrody-app` window subsystem, fallback in `aphrody-winclean` for headless sessions | Tauri plugins first, Win32 headless backend second | `NotificationTools`, `ClipboardTools` |
| Shell execution | kernel `shell` subsystem | Nushell structured evaluation | `power_shell`, WinClean CLI shell helpers |
| Desktop shell and explorer UX | `aphrody-app` plus M3 packages | Tauri/CEF session shell, adaptive window chrome and explorer surfaces | `Winclean.Shell`, `Winclean.Ui`, Explorer hook UX |
| Bun access | `@aphrody/os`; transitional `packages/os/winclean` alias | Kernel RPC client and generated TypeScript types | `Winclean.Bun`, Bun FFI DLL loading |
| MCP | `aphrody-kernel` | Single MCP server for all OS subsystems | `Winclean.Mcp`, `Winclean.Mcp.Linux` |

## 6. Legacy project disposition

| Legacy project | Content that must be ported | Destination | Removal gate |
|---|---|---|---|
| `Winclean.Core` | system, process, service, startup, task, power, network, WSL, search and database logic | domain crates in section 5 | corresponding Rust unit and live tests pass |
| `Winclean.Mcp` | 166 tool contracts and Windows implementations | `aphrody-winclean` and kernel subsystem | catalog parity is 166/166 and differential suite passes |
| `Winclean.Mcp.Linux` | cross-platform system/service behavior | existing portable crates and kernel adapters | Linux target check and behavior tests pass |
| `Winclean.Native` | C ABI and NativeAOT export host | removed | no consumer loads `winclean.dll` |
| `Winclean.ReverseEngine` | PE analysis, entropy, strings, disassembly, AOB, ASAR, Go | `aphrody-re` | fixture outputs meet parity rules |
| `Winclean.Bun` | Node-API exports | `@aphrody/os` RPC | Bun tests pass without .NET binaries |
| `Winclean.A2a` | coordination store and MCP bridge | `aphrody-a2a`, `aphrody-jobs`, kernel | A2A protocol tests pass |
| `Winclean.Shell` | desktop items, start menu, taskbar, launcher, power and window list | `aphrody-app` | M3 shell e2e covers all user flows |
| `Winclean.Ui` | dashboard and administration pages | `aphrody-app` plus M3 packages | visual and command e2e passes |
| `Winclean.ExplorerHook` | native Explorer hook and FFI | `aphrody-app` explorer integration or a Rust DLL only if Windows injection remains required | explicit feature decision and signed-build test |
| `Winclean.ImageConverter` | image decoding and conversion | `aphrody-capture` | golden-image tests pass |
| `Winclean.Vortice` | D3D11/D2D diagnostics and capture | `aphrody-capture` and `aphrody-winclean::gpu` | GPU smoke tests pass on RTX 4070 |
| `Winclean.SteamScan` | registry/VDF/library scanning and SQLite output | `aphrody-winclean::steam`, shared store where needed | Steam fixture and local smoke tests pass |
| `Winclean.SteamAuth` | Credential Manager vault | `aphrody-winclean::credential` | write/read/delete integration test passes with disposable credential |
| `Winclean.Cli.Legacy` | presentation only | kernel CLI and Nushell | no unique command remains |
| `Winclean.Tests*` | behavioral knowledge and fixtures | Rust integration tests | each relevant assertion is represented |

## 7. Complete 166-tool migration ledger

`crates/os/kernel/comps/winclean/src/tools.json` is the frozen compatibility input. The following inventory
accounts for every currently published tool.

| Count | Prefix/family | Tools | Primary Rust owner |
|---:|---|---|---|
| 25 | `mem` | `mem_allocate`, `mem_dump_region`, `mem_enable_debug_privilege`, `mem_free`, `mem_get_module_base`, `mem_list_modules`, `mem_list_processes`, `mem_protect`, `mem_query_region`, `mem_read_bytes`, `mem_read_c_string`, `mem_read_double`, `mem_read_float`, `mem_read_int32`, `mem_read_int64`, `mem_read_utf16`, `mem_resume_process`, `mem_scan_aob`, `mem_scan_value_int32`, `mem_suspend_process`, `mem_write_bytes`, `mem_write_double`, `mem_write_float`, `mem_write_int32`, `mem_write_int64` | `aphrody-proc::memory` |
| 14 | `get` | `get_active_power_plan`, `get_clipboard_text`, `get_cpu_info`, `get_cpu_usage`, `get_defender_status`, `get_disk_info`, `get_file_info`, `get_gpu_preferences`, `get_hags_mode`, `get_memory_info`, `get_network_adapters`, `get_os_info`, `get_registry_value`, `get_system_profile` | typed modules in `aphrody-winclean`; clipboard can delegate to `aphrody-app` |
| 13 | `window` | `window_capture`, `window_close`, `window_enum_all`, `window_enum_children`, `window_find_by_class`, `window_get_text`, `window_minimise_all`, `window_move`, `window_post_message`, `window_send_message`, `window_set_opacity`, `window_set_text`, `window_set_topmost` | `aphrody-winclean::window`, capture delegated to `aphrody-capture` |
| 11 | `computer` | `computer_capture_screen`, `computer_click`, `computer_click_element`, `computer_drag`, `computer_key`, `computer_observe`, `computer_ocr`, `computer_record_clip`, `computer_scroll`, `computer_speak`, `computer_type` | `aphrody-winclean::computer` plus `aphrody-capture` |
| 11 | `steam` | `steam_get_game`, `steam_get_game_status`, `steam_kill_game`, `steam_launch_and_wait`, `steam_launch_by_app_id`, `steam_list_games`, `steam_list_libraries`, `steam_open_uri`, `steam_scan_summary`, `steam_vault_status`, `steam_wait_for_launch` | `aphrody-winclean::steam` and `credential` |
| 9 | `list` | `list_directory`, `list_listening_ports`, `list_power_plans`, `list_processes`, `list_registry_key`, `list_scheduled_tasks`, `list_services`, `list_tcp_connections`, `list_windows` | filesystem, network, power, process, registry, task, service and window owners |
| 8 | `binary` | `binary_aes_ctr_decrypt`, `binary_entropy_map`, `binary_extract_strings`, `binary_hash_multi`, `binary_list_cpk`, `binary_parse_pe_header`, `binary_section_dump`, `binary_xor_decrypt` | `aphrody-re`; CPK integration may delegate to `aphrody-ievr` |
| 7 | `set` | `set_active_power_plan`, `set_clipboard_text`, `set_gpu_preference`, `set_hags_mode`, `set_process_affinity`, `set_process_priority`, `set_registry_value` | relevant typed owners; process operations in `aphrody-proc` |
| 6 | `gamepad` | `gamepad_create_xbox360`, `gamepad_destroy`, `gamepad_destroy_all`, `gamepad_environment`, `gamepad_press_button`, `gamepad_send_xbox360_state` | `aphrody-winclean::gamepad` |
| 6 | `wsl` | `wsl_execute`, `wsl_get_status`, `wsl_list_distributions`, `wsl_list_processes`, `wsl_read_only_probe`, `wsl_send_signal` | `aphrody-winclean::wsl` |
| 5 | `coord` | `coord_assign_task`, `coord_query_stop`, `coord_read_status`, `coord_read_task`, `coord_report_status` | WinClean compatibility mirror in `coordination.rs`; typed A2A transport remains outside this repository. |
| 5 | `perf` | `perf_dwm_flush`, `perf_empty_working_sets`, `perf_memory_status`, `perf_purge_standby_list`, `perf_set_eco_mode` | `aphrody-proc` and `aphrody-winclean::performance` |
| 4 | `winml` | `winml_get_version`, `winml_inspect_onnx`, `winml_list_providers`, `winml_run_float32` | `aphrody-winclean::winml` |
| 3 | `keyboard` | `keyboard_hold`, `keyboard_release`, `keyboard_scan_code` | `aphrody-winclean::input` |
| 2 | `delete` | `delete_path`, `delete_registry_entry` | filesystem and registry owners |
| 2 | `mouse` | `mouse_drag_to`, `mouse_move_smooth` | `aphrody-winclean::input` |
| 2 | `move` | `move`, `move_path` | input compatibility alias and filesystem owner |
| 2 | `multi` | `multi_edit`, `multi_select` | computer/UIA automation |
| 2 | `search` | `search_files`, `search_windows` | `aphrody-search` and `aphrody-winclean::window` |
| 1 each | singleton families | `analyze_pe`, `aob_scan`, `asar_list`, `click`, `copy_path`, `disable_scheduled_task`, `enable_scheduled_task`, `golang_scan`, `kill_process`, `launch_app`, `power_shell`, `query_event_log`, `read_file`, `resize_window`, `restart_service`, `run_scheduled_task`, `scrape`, `screenshot`, `scroll`, `send_notification`, `shortcut`, `snapshot`, `start_service`, `stop_service`, `switch_to_window`, `trim_process_working_set`, `type`, `wait`, `write_file` | mapped by domain above |

The migration ledger must become machine-readable as
`crates/os/kernel/comps/winclean/tool-migration.json`. Each entry contains:

```json
{
  "name": "list_processes",
  "schema_sha256": "...",
  "owner": "aphrody-proc",
  "rust_handler": "process::list",
  "legacy_oracle": "ProcessTools.ListProcesses",
  "state": "rust",
  "contract_test": "list_processes_contract",
  "live_test": "list_processes_windows"
}
```

The generated tool registry fails the build when a catalog entry has no ledger row, the schema
hash changes without review, two handlers claim the same name, or a `rust` entry still dispatches
through NativeAOT.

## 8. Rust FFI design

### 8.1 Safe handle ownership

Every Windows handle is represented by a non-`Copy` RAII newtype. The type owns `CloseHandle`,
`RegCloseKey`, `CloseServiceHandle`, COM release, virtual-memory release, or the applicable cleanup.
Raw handles do not escape public modules.

### 8.2 Unsafe containment

Each Windows module has this shape:

```text
module/
  mod.rs       public safe types and operations
  windows.rs   minimal unsafe calls and representation conversion
  tests.rs     pure and Windows integration tests
```

Every `unsafe` block states the invariant it relies on. Buffer lengths, UTF-16 termination,
structure versions, access rights, process bitness, pointer width, and COM apartment requirements
are validated before calls.

### 8.3 API selection

Use the workspace `windows` crate as the default binding. Use explicit declarations only for
undocumented NT APIs or driver exports unavailable in metadata. Bindings are pinned centrally in
the root workspace dependency table. No crate adds a second Windows binding version casually.

### 8.4 Error model

Internal APIs return typed errors with operation, target, and Win32/HRESULT/NTSTATUS context. The
compatibility layer converts them once into the existing MCP `CallToolResult`. No module returns
preformatted MCP JSON.

### 8.5 Architecture and process bitness

Memory and module operations detect target architecture before pointer reads. Cross-bitness
limitations are explicit errors. Address arithmetic uses checked `usize`/`u64` conversion and
bounded region iteration.

## 9. Contract and data model

The Rust catalog is frozen as the compatibility fixture and is the agent-visible
runtime authority. Rust owns:

- canonical request and response DTOs with `serde`;
- JSON Schema generation or checked-in schemas;
- a typed `ToolHandler` registry;
- capability metadata: platform, required token, side effects, timeout class, and binary output;
- stable conversion to MCP content blocks;
- generated TypeScript types for `@aphrody/os` and transitional `packages/os/winclean` exports.

The kernel receives typed results and performs transport serialization once. Binary frames remain
binary until the transport boundary; base64 is never used internally between Rust modules.

## 10. Execution waves

### Wave 0 — restore deterministic validation

Deliverables:

1. Restore the missing `proc-macro-error2` patch or remove its root patch entry after proving the
   upstream crate is compatible.
2. Make `cargo metadata --locked` succeed.
3. Capture the 166 tool names, schemas, descriptions, and legacy output fixtures.
4. Add `tool-migration.json` and its completeness test.
5. Remove the duplicate plugin directories under `native/plugins` after verifying their unique
   content is bundled in `../aphrody-ai/plugins/aphrody`.
6. Retain only provenance records; no NativeAOT binary is part of the product path.

Gate:

```powershell
cargo metadata --locked --format-version 1
cargo test -p aphrody-winclean --locked catalog
bun scripts/audit/os/verify-winclean-integration.ts
```

### Wave 1 — typed Rust registry and dual dispatch

Deliverables:

1. Replace generated one-method-per-tool FFI wrappers with a typed Rust handler registry.
2. Add dispatch mode per ledger row: `legacy`, `dual`, or `rust`.
3. In `dual`, run both implementations for deterministic read operations and compare normalized
   results. Mutating operations use explicit test fixtures or dry-run probes, never double-apply.
4. Generate Bun types from the Rust catalog.
5. Add schema snapshot tests in Rust and Bun.

Gate: 166/166 registered, zero duplicate names, zero schema drift.

### Wave 2 — reverse engineering and pure transformations

Port first because these tools are deterministic and mostly overlap `aphrody-re`:

- PE analysis and header parsing;
- AOB scanning;
- entropy maps;
- ASCII/UTF-16 string extraction;
- multi-hash;
- section dump;
- ASAR list;
- Go metadata scan;
- AES-CTR and XOR transforms;
- CPK list through the existing IEVR owner.

Add legacy fixture binaries covering PE32, PE32+, managed PE, malformed input, signed binaries,
packed sections, Go binaries and Electron ASAR. Normalize timestamps and ordering before comparison.

Gate: all reverse tools switch to `rust`; `Winclean.ReverseEngine` has no unique capability.

### Wave 3 — files, search, system inventory, and network

Port read-dominant operations:

- file info, list, read, copy, move, write and delete;
- indexed search;
- process list and system profile;
- OS, CPU, memory, disk, adapters, ports and TCP connections;
- event log queries;
- clipboard and notifications with headless fallback.

Use stable DTO ordering and explicit path normalization. Long scans are cancellable and stream
progress over the kernel event bus rather than blocking a single MCP response indefinitely.

Gate: differential fixtures and live local smoke suite pass under standard and administrator tokens.

### Wave 4 — processes and remote memory

Extend `aphrody-proc` with:

- process snapshot and module iteration;
- priority, affinity, eco mode and working-set operations;
- scoped `SeDebugPrivilege` enablement;
- virtual memory query, read, write, allocate, free and protect;
- typed integer, float, UTF-16 and C-string access;
- bounded AOB/value scanning;
- suspend and resume with balanced state tracking.

Every memory test launches a disposable fixture process compiled for the test. Tests never target an
unrelated user process. Handles and allocations are verified closed/freed after each case.

Gate: all 25 `mem_*` tools and all process/performance tools use Rust; handle-leak test is clean.

### Wave 5 — windows, input, UIA, capture, and gamepad

Deliverables:

- window enumeration, lookup, text, bounds, state, opacity, topmost and messages;
- SendInput keyboard and mouse paths;
- UI Automation snapshot, selection, edit, click and element targeting;
- screen/window capture through `aphrody-capture`;
- observation payload combining windows, UIA and frame metadata;
- record clips with bounded frame queues;
- ViGEm virtual Xbox controller backend;
- `aphrody-app` window tools sharing the same window primitives.

Tauri retains its public prefixes for source compatibility. The desktop adds M3 adaptive
window chrome, close/minimize/maximize controls, dark/light/system themes, global Material Symbols
and the unified explorer surface. WinClean WinUI pages are not copied; their behaviors are exposed
through the shared Rust model and rendered by the existing M3 packages.

Gate: desktop e2e and headless kernel e2e exercise the same Rust handlers.

### Wave 6 — Windows administration

Port:

- registry and startup entries;
- service control manager;
- scheduled tasks;
- power schemes;
- DWM and standby-list operations;
- Defender and firewall status/control;
- GPU preferences and HAGS;
- system and hardware inventory;
- WinML/DirectML provider discovery and float32 inference.

Each mutation has an idempotent query-after-write test and a rollback fixture. Administrator-token
requirements are declared in tool metadata and enforced by the kernel launcher.

Gate: all administration tools use Rust and pass on Windows 11 24H2+.

### Wave 7 — WSL, Steam, credentials, and coordination

Port:

- WSL distribution state, execution, process listing and signals;
- Steam registry/VDF discovery, library/game model, launch/wait/kill/status;
- Credential Manager storage for Steam secrets;
- coordination task/status persistence into `aphrody-jobs` and `aphrody-a2a`.

Credential tests use a unique disposable target name and delete it in test teardown. No secret value
is serialized into logs, MCP error details, snapshots, or fixtures.

Gate: WSL and Steam fixture suites plus local smoke tests pass; coordination has one store.

### Wave 8 — adapters and desktop convergence

Deliverables:

1. Make `packages/os/winclean` a compatibility facade over `@aphrody/os`.
2. Remove Bun FFI, Node-API NativeAOT, and native DLL discovery.
3. Replace WinClean CLI behavior with kernel CLI plus Nushell.
4. Replace WinClean Shell and WinUI pages with `aphrody-app` routes and M3 components.
5. Expose system state as kernel events so desktop, TUI and agents observe one model.
6. Keep one unified plugin at `../aphrody-ai/plugins/aphrody`.

Gate: Bun, desktop, CLI and MCP tests all pass with the .NET runtime absent from `PATH`.

### Wave 9 — remove the migration corpus

After every ledger entry is `rust`:

1. delete the migrated NativeAOT source corpus (done);
2. delete NativeAOT SDK binaries, C headers, duplicate Rust SDK and DLL build scripts (done);
3. delete duplicate PowerShell implementations already represented by Rust or canonical scripts;
4. retain only legally required license/provenance text and non-duplicated fixtures;
5. move retained historical design records to `docs/products/os/packages/winclean` if still useful;
6. rename no Tauri public compatibility symbol;
7. remove .NET, NuGet, NativeAOT and WinClean DLL steps from CI and installers;
8. remove `libloading` from `aphrody-winclean` (done);
9. prove the repository contains no active `Winclean.Mcp`, `Winclean.Native`, or second plugin path.

Gate: all completion criteria in section 14 pass from a clean checkout.

## 11. Testing strategy

### 11.1 Contract tests

For every tool:

- exact name;
- description present;
- input schema hash;
- required fields, defaults and bounds;
- output content-block shape;
- error classification;
- required privilege and platform metadata.

### 11.2 Differential tests

Legacy and Rust outputs are compared after normalizing unstable values such as PIDs, timestamps,
window handles and enumeration order. The comparator is semantic, not a raw JSON string equality.

### 11.3 Windows integration tests

Use disposable resources with unique names:

- child processes and memory fixtures;
- temporary registry subkeys;
- temporary scheduled tasks and services;
- temporary files and directories;
- a disposable Credential Manager entry;
- a test window and UIA tree;
- a generated ONNX model;
- a virtual controller created and destroyed inside the test.

### 11.4 Cross-platform tests

Portable crates compile and test on Windows and Linux. Windows-only functions return a typed
unsupported-platform error off Windows; they do not pull Windows link libraries into portable
targets.

### 11.5 Leak and concurrency tests

Run repeated handle, COM, memory and frame cycles. Validate cancellation, timeouts, concurrent tool
calls, kernel restart and named-pipe reconnect behavior. Long-running calls must not block the
kernel registry lock.

### 11.6 Performance baselines

Record p50/p95 and peak memory for catalog loading, process listing, screen capture, file search,
memory scanning and PE analysis. Rust is not accepted if it introduces an unexplained regression
greater than 10% on deterministic local fixtures.

## 12. Validation commands

Focused commands run on every wave:

```powershell
cargo fmt --all -- --check
cargo check -p aphrody-winclean -p aphrody-kernel --all-targets --locked
cargo clippy -p aphrody-winclean -p aphrody-kernel --all-targets --locked -- -D warnings
cargo test -p aphrody-winclean -p aphrody-kernel --locked
bun test packages/winclean
bun scripts/audit/os/verify-winclean-integration.ts
```

Domain waves add their owner:

```powershell
cargo test -p aphrody-re --locked
cargo test -p aphrody-proc --locked
cargo test -p aphrody-capture --locked
cargo test -p aphrody-fsindex -p aphrody-search --locked
```

Final clean-checkout gate:

```powershell
cargo metadata --locked --format-version 1
cargo check --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
bun install --frozen-lockfile
bun test
bun run build
rg -n "Winclean\.Mcp|Winclean\.Native|winclean\.dll|libloading" crates packages scripts plugins
rg --files crates/aphrody-winclean
```

The final two searches must return only approved historical/provenance references. Their allowlist
is checked in and reviewed; an empty active-source result is required.

## 13. Delivery ledger

Progress is recorded in the machine-readable tool ledger and summarized here. A wave can use only
these states:

| State | Meaning | Required evidence |
|---|---|---|
| `planned` | owner and test route selected | ledger row complete |
| `dual` | Rust implementation exists beside oracle | contract test plus normalized differential result |
| `rust` | all production calls use Rust | focused tests and live Windows proof |
| `removed` | legacy implementation deleted | clean search and workspace gate |

No percentage is reported without deriving it from the 166 ledger entries. Moving files, compiling
the old implementation, or publishing tools through the kernel does not count as a Rust port.

## 14. Definition of done

The convergence is complete only when all conditions are true:

1. `tool-migration.json` contains exactly 166 unique current tool names.
2. Every entry is `rust`, then the legacy source is removed and the removal state is recorded.
3. `aphrody-winclean` contains no NativeAOT loader and no `libloading` dependency.
4. No runtime, test, build or packaging step requires .NET or NuGet.
5. `aphrody-kernel` serves all 166 compatibility tools plus the native subsystem tools without
   name collision.
6. `aphrody-yolo`, Bun, CLI and desktop call kernel capabilities instead of WinClean directly.
7. `../aphrody-ai/plugins/aphrody` is the only plugin authority.
8. Reverse-engineering logic has one implementation in `aphrody-re`.
9. Process and memory logic has one implementation in `aphrody-proc`.
10. Capture logic has one implementation in `aphrody-capture`.
11. WinClean Shell and WinUI user flows exist in the adaptive M3 `aphrody-app` interface.
12. Tauri compatibility prefixes remain intact.
13. Windows administrator startup and `sudo.exe` diagnostics are tested.
14. Workspace Cargo, Bun and desktop gates finish with exit code 0 and no blocking warnings.
15. A clean checkout reproduces generated catalogs and TypeScript bindings without untracked files.

## 15. Convergence status

The implementation sequence above is historical and complete. It is retained as an audit trail,
not as an open work queue. The current product path is Rust-only:

1. the 166-entry catalog and migration ledger are frozen and parity-checked;
2. the kernel `admin` subsystem is the single dispatch authority;
3. Bun and plugin adapters route through the kernel and contain no native loader;
4. the legacy NativeAOT/.NET corpus and duplicate SDK surfaces are removed;
5. the integration gate is the reproducible proof command below.

Only repeatable validation and intentional feature additions may change this document. Historical
references to NativeAOT, .NET and former `Winclean.*` assemblies describe removed inputs and are
not active runtime dependencies.
