<!-- SPDX-License-Identifier: Apache-2.0 -->
# Terminal backend and the microsoft/terminal reference build

## `aphrody-terminal-backend`

### Native VT engine

The backend uses the published Rio `rio-vt` 0.5.28 crate with its PTY feature
disabled. `PtySession` remains the exclusive owner of ConPTY and
`openpty` through `portable-pty`. Native hosts can opt into Rio parsing with
`spawn_with_terminal_state` and pull a text-only `TerminalSnapshot`; Rio's
cursor-position replies are routed back to that PTY. The default `spawn`
streams bytes without parsing because the desktop already runs wterm/Ghostty
as its VT engine. Do not attach two reply-producing emulators to one session.
Rio's GPU renderer is not a dependency or integrated into the desktop.

Cargo pins the exact release and records its MIT source in `Cargo.lock`.
Aphrody-owned code remains Apache-2.0.

The crate (`crates/shell/terminal-backend`) bridges a real shell to a browser or desktop
renderer:

- **PTY**: [`portable-pty`](https://crates.io/crates/portable-pty) opens a pseudo-terminal on
  every supported platform — ConPTY on Windows, POSIX `openpty` on Linux and macOS — so the
  backend never carries platform-specific PTY code of its own. It stays on `portable-pty` 0.8:
  0.9 opens ConPTY with `PSEUDOCONSOLE_INHERIT_CURSOR`, so the child blocks until the client
  answers a DSR cursor query (`ESC[6n`); upgrading needs CPR handling in the backend and its
  clients (see the `RUSTSEC-2017-0008` note in `deny.toml`).
- **Default shell** (`default_shell`, used when `PtyConfig::shell` is `None`): on Windows `pwsh`
  if it resolves on `PATH` (with `PATHEXT`), otherwise `cmd`; on Unix `$SHELL`, otherwise
  `/bin/bash`. The Windows lookup runs in-process through the
  [`which`](https://crates.io/crates/which) crate — no `where.exe` child process, and the
  current directory only counts when `PATH` lists it.
- **Transport**: one WebSocket per session (`tokio-tungstenite`). Binary frames carry raw PTY
  bytes in both directions; text frames carry JSON control messages (`resize`, `data`). The
  wire protocol is documented at the top of `src/lib.rs`.
- **Session** (`PtySession`, `src/session.rs`): the transport-free core. It streams
  `PtyEvent::Output` bytes on a bounded channel (backpressure, never drops) and sends one
  `PtyEvent::Exit { code }` after the last output; `write`, `resize` and `close` drive it.
  `PtyConfig` also carries shell `args` and extra `env`.
- **Session lifecycle** (`handle_conn`, a WebSocket client of `PtySession`): a `resize` message
  is applied to the PTY as soon as it arrives. When the client disconnects, the shell is stopped
  (`TerminateProcess` on Windows, `SIGHUP` on Unix) and the PTY is closed; when the shell exits,
  its remaining output is flushed and the server closes the WebSocket. Teardown waits at most 5 seconds for the output to
  drain, so a process that outlives the shell and keeps the PTY open (a background job) cannot
  pin the session. The unit tests drive these paths over a real loopback WebSocket.
- **Coord proxy** (`src/coord.rs`, a re-export of `aphrody_a2a_coord::proxy`): exposes an append-only JSONL mailbox as an NDJSON snapshot,
  an SSE stream, or a tailing stream. The caller injects the file path.
- **Desktop integration**: the in-process PTY session API and the Tauri wiring are specified in
  [`DESKTOP-PTY.md`](../../../reference/shell/terminal/DESKTOP-PTY.md).
- **systemd**: `sd_notify` / `start_watchdog_loop` implement `Type=notify` readiness and the
  watchdog on Unix and are no-ops elsewhere. Unit files and ports belong to `aphrody-infra`.

Design lineage (still true from the pre-split audits of 2026-05-17..19, now retired):
`vercel-labs/wterm` inspired the binary WebSocket framing; `microsoft/terminal` (AtlasEngine,
ConPTY, `profiles.schema.json`) is an algorithmic reference only and is never linked. The LLM panes
and browser bridge that those audits described were separate `aphrody-terminal-*` crates of the former
monorepo and are not part of this repository. The VT state (`aphrody-terminal-core`), the WASM bindings
(`aphrody-shell-web`) and the Tauri plugin (`aphrody-shell-tauri`) now live under `crates/shell/`; see
[the consolidated status](../STATUS.md).

## Building microsoft/terminal locally (reference only)

`scripts/build/shell/terminal-build.ts` (Bun, no console window) builds a local checkout of
[microsoft/terminal](https://github.com/microsoft/terminal) with the Visual Studio 2026
toolset (v145) and Windows SDK 10.0.26100.0 instead of the upstream v143 / 10.0.22621.0 pins.
The checkout is not tracked here (`vendor/` is git-ignored).

1. Clone upstream and apply the local patch set:

   ```powershell
   git clone https://github.com/microsoft/terminal vendor/terminal
   git -C vendor/terminal apply --ignore-whitespace ../../docs/reference/shell/terminal/PATCHES.diff
   ```

   [`PATCHES.diff`](../../../reference/shell/terminal/PATCHES.diff) switches the vcpkg overlay triplets to `v145`, silences C4875
   (ms-gsl 3.1.0 still uses the deprecated `[[gsl::suppress(token)]]` form that v145 rejects
   under `TreatWarningAsError`), and makes `TargetPlatformVersion` overridable in
   `src/wap-common.build.pre.props`.

2. Build (any shell; the script captures the newest Visual Studio 2026 developer environment
   through vswhere and `VsDevCmd.bat` itself):

   ```sh
   bun scripts/build/shell/terminal-build.ts --project Conhost\\Host_EXE        # smoke build
   bun scripts/build/shell/terminal-build.ts --configuration Release           # full solution
   bun scripts/build/shell/terminal-build.ts --terminal-root D:/src/terminal   # checkout elsewhere
   ```

The script restores NuGet packages with a current `nuget.exe` (the bundled NuGet cannot parse
`.slnx`) and passes the toolset/SDK overrides to MSBuild.
