<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody OS utility runtime integration plan

> Path reconciliation (2026-10-07): `crates/os/coreutils` (not in repo) → `crates/os/kernel/core/src/coreutils.rs`. Original dated observations below retain their historical scope.

## Objective

Make the pinned, headless Aphrody OS utility runtime available to interactive
Nushell and PTY sessions without treating `PATH` or a host installation as an
authority. The user-visible result is a coherent POSIX-like environment on
Windows and Linux while preserving Nushell's structured pipeline and the
kernel's MCP/API contract.

The runtime is owned by `aphrody-os`:

- `uutils/coreutils` multicall distribution;
- uutils `findutils`, `grep`, `sed`, `diffutils`, and `tar` companions;
- bounded `coreutils_*` and `uutils_*` MCP tools;
- explicit binary pinning and build provenance.

This repository owns only shell integration: command discovery, structured
Nushell values, terminal session setup, and presentation of kernel results.
It must not copy utility implementations, create a second MCP server, or
silently substitute host GNU, BusyBox, PowerShell, or Microsoft packages.

## Non-goals

- Do not make `procps`, `util-linux`, `shadow`, ACL, or service-management
  commands appear on Windows. They are Linux-only capabilities with explicit
  owners and truthful availability responses.
- Do not put privileged operations behind a shell alias. Elevation and policy
  stay in the kernel `admin` and execution-policy subsystems.
- Do not embed `microsoft/coreutils` as another runtime. It is a Windows
  compatibility/package layer over uutils-derived sources and can be used as
  a Windows interoperability oracle only.
- Do not change process-global `PATH` for the desktop, terminal host, or
  kernel process.

## Target architecture

```text
Nushell source or PTY command
             |
             v
aphrody-shell command bridge
  - validates literal argv and working directory
  - preserves Nushell records/lists
             |
             v
local kernel IPC: tools/call
  coreutils_run / coreutils_<utility>
  uutils_run    / uutils_<utility>
             |
             v
aphrody-coreutils
  pinned upstream binary, no shell, timeout/output limits
             |
             v
structured result -> Nushell Value / PTY rendering
```

The bridge is an IPC client, not a direct dependency from `aphrody-nu` to
`aphrody-coreutils`. This prevents a circular dependency between the shell
subsystem and the kernel registration binary, and keeps the same policy,
auditing and remote-client semantics for terminal, TUI, desktop and API use.

## Public shell contract

Add a dedicated `aphrody` Nushell command group implemented by
`aphrody-nu`. It uses a configured local kernel endpoint and never invokes a
shell to compose a command.

| Nushell command | Kernel tool | Input | Output |
| --- | --- | --- | --- |
| `aphrody utils status` | `coreutils_status` | none | record: binary, availability, companion state |
| `aphrody utils catalog` | `coreutils_catalog`, `uutils_catalog` | none | table of utility, provider, availability |
| `aphrody utils run <utility> ...args` | `coreutils_run` or `uutils_run` | literal strings, `cwd`, timeout, output mode | record with exit code, stdout, stderr, truncation and structured data |
| `aphrody utils <utility> ...args` | generated named tool when available | literal strings, `cwd`, timeout, output mode | same record |

`aphrody utils run` selects `coreutils_run` for a command listed by
`coreutils_catalog`; it selects `uutils_run` only for a companion listed by
`uutils_catalog`. An unknown or unavailable command is a typed Nushell error,
not a fallback to `PATH`.

The result remains a record. `--format json` maps a valid JSON stdout payload
to `data`; `--format jsonl` maps it to a list of records. Text remains in
`stdout`. A non-zero utility exit is represented by `exit_code` and stderr;
it does not erase the captured output. `--check` is the only mode that turns a
non-zero exit into a Nushell failure.

## Terminal-session contract

The interactive PTY keeps the host's configured shell as its process owner.
It must not rewrite inherited `PATH`. Instead it exposes an explicit
bootstrap command for a user who wants the Aphrody utility environment:

```nu
source (aphrody utils env)
```

`aphrody utils env` returns a generated Nushell module containing only wrapper
commands for utilities confirmed by the kernel catalog. Each wrapper delegates
through the bridge above. The module is session-local and records the kernel
endpoint plus catalog revision. It is regenerated after a kernel/runtime
upgrade. This makes `ls`, `grep`, and similar commands available in a PTY
without creating persistent aliases or shadowing commands outside an opted-in
session.

Wrappers must use an explicit namespace escape (`^ls` or a documented
`host ls` helper) so a user can intentionally call the host executable. The
generated module never overrides Nushell's structured built-ins unless the
user requests the `aphrody utils env --override-nu` profile.

## Delivery phases

## Implementation status — 2026-09-28

This section records source state in the current working trees. It is not a
claim that the operating-system runtime is installed, deployed, or reachable.

| Phase | Status | Evidence / remaining proof |
| --- | --- | --- |
| 0 — runtime proof | Incomplete | `aphrody-os` contains the adapter, pinned-source build script, and uutils submodule declarations. A clean submodule build plus `coreutils_status`, both catalogs, and representative calls through a running kernel have not been verified in this integration. |
| 1 — typed kernel IPC | Implemented in source; gate pending | The shared `aphrody-kernel-client` crate in `aphrody-contracts` owns local IPC and MCP framing. `aphrody-nu` consumes it through the sibling path dependency; no direct `aphrody-os` runtime dependency is added. Run the contracts workspace gates before treating the client as releasable. |
| 2 — Nushell command group | Implemented in source; live behavior pending | The embedded engine registers `aphrody utils status`, `catalog`, `run <utility> ...args`, and the named-utility form. Calls use literal argv, dynamic kernel catalogs, structured JSON values, bounded timeout/output options, and Nushell interrupt cancellation. Unit tests cover command registration, input validation, catalog selection, bounds, and cancellation; they do not replace a live kernel round trip. |
| 3 — opted-in PTY environment | Not implemented | The PTY still launches its configured host shell. There is no `aphrody-utils` profile, generated `aphrody utils env` module, automatic bootstrap, or Windows/Unix end-to-end proof. The proposed `source (aphrody utils env)` flow below is a target contract, not a currently available command. |
| 4 — compatibility and quality | Incomplete | A cross-platform matrix, hostile-process integration tests, Linux execution proof, and complete shell/OS gates remain outstanding. |

The `aphrody utils` command currently exists in the embedded Nushell engine;
it is not automatically installed into arbitrary Nushell processes launched by
the PTY backend. Until Phase 3 is implemented, use it through the embedding
that registers `AphrodyUtils`, and do not assume that entering an ordinary PTY
provides kernel-backed utility names.

### Phase 0 — runtime proof

Owner: `aphrody-os`.

1. Build pinned uutils sources for Windows and Linux.
2. Verify `coreutils_status`, both catalogs, and representative calls through
   an isolated kernel endpoint.
3. Package the binaries or set only the documented `APHRODY_COREUTILS_BIN`
   path. No runtime `PATH` search is allowed.

Exit criteria: a catalog reports the same expected portable command families
on both hosts, with platform-specific gaps declared rather than hidden.

### Phase 1 — typed kernel IPC client

Owner: `aphrody-shell`, consuming the existing kernel transport contract from
`aphrody-os`/`aphrody-contracts` through an approved direction. If no stable
client crate can be consumed without a dependency cycle, extract the client
transport/protocol into the contract owner first; do not duplicate JSON-RPC.

1. Add `KernelUtilityClient` with endpoint, request timeout and cancellation.
2. Encode requests as JSON objects; reject NUL and non-string argv values.
3. Decode tool results into a shell-owned `UtilityResult` record.
4. Preserve `stdout_truncated`, `stderr_truncated`, `timed_out`, and
   `parse_error` verbatim.
5. Add a fake IPC server test for malformed responses, timeout and cancellation.

Exit criteria: no shell crate imports the OS implementation crate directly and
all bridge failures have actionable typed errors.

### Phase 2 — Nushell command group

Owner: `aphrody-nu`.

1. Register `aphrody utils` commands in the embedded engine.
2. Convert Nushell lists/records only at the transport boundary; never inject
   unescaped values into source text.
3. Support `--cwd`, `--timeout`, `--max-output-bytes`, `--format`, and
   `--check` with the kernel's maximum bounds.
4. Render catalog records as native Nushell tables and JSON/JSONL `data` as
   values suitable for pipelines.
5. Keep the existing isolated evaluation model: environment variables and
   definitions never leak between calls.

Exit criteria: `aphrody utils grep aphrody README.md --format text` and a
JSONL-producing command can be piped into `where`, `select`, and `to json`
without text re-parsing.

### Phase 3 — opted-in PTY environment

Owner: `aphrody-terminal-backend` plus `aphrody-nu`.

1. Add a session flag/profile `aphrody-utils` that starts Nushell and sources
   the generated module after the endpoint handshake.
2. Keep standard PTY sessions unchanged by default.
3. Display the active runtime revision and endpoint availability in terminal
   session metadata, never credentials or policy contents.
4. On disconnect, wrappers return a clear kernel-unavailable error and do not
   fall back to host commands.

Exit criteria: Windows ConPTY and Unix PTY integration tests prove that an
opted-in session uses the kernel path while a default session does not.

### Phase 4 — compatibility and quality

Owner: both repositories, with `aphrody-infra` owning packaged-runtime proof.

1. Maintain a cross-platform command matrix for coreutils and companions.
2. Compare selected Windows behavior to `microsoft/coreutils` only as an
   external oracle; fixes belong upstream in uutils when portable.
3. Exercise hostile argv, oversized output, timeout, broken JSON/JSONL,
   disconnected kernel and unavailable binary paths.
4. Run the shell and OS focused gates, then the cross-repository checks
   mandated by each repository's `AGENTS.md`.

Exit criteria: Windows and Linux proof records show the same declared contract
and every unsupported capability states its platform/owner.

## Security and UX invariants

- The bridge sends argv arrays, never command strings or shell fragments.
- The kernel remains the only runtime authority and audit point.
- Every process has a timeout; stdout and stderr have independent caps and
  truncation flags.
- `cwd` is explicit and validated by the spawned runtime; no implicit global
  `chdir` is permitted.
- Catalog discovery is dynamic but treated as untrusted input until names pass
  the same utility-name validation as the kernel.
- Terminal accessibility remains native: minimum 18 px text, high contrast,
  visible static focus/cursor, keyboard operation and screen-reader labels.

## Files expected to change

| Repository | Owner paths | Purpose |
| --- | --- | --- |
| `aphrody-os` | `crates/os/kernel/core/src/coreutils.rs`, `crates/os/kernel/core`, `third_party/uutils-*`, build/package scripts | Runtime and MCP authority |
| `aphrody-contracts` when needed | transport/client contract only | Break any dependency cycle without duplication |
| `aphrody-shell` | `crates/shell/nu`, `crates/shell/terminal-backend`, tests and this document | IPC bridge, structured commands, opted-in PTY bootstrap |
| `aphrody-infra` | package/deployment evidence | Runtime artifact and live-host proof |

No change belongs in `aphrody-ui` unless it presents the shell session; no
change belongs in the AI layer.
