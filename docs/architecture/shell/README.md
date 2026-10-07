<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell and terminal layers

> Path reconciliation (2026-10-07): `crates/shell/aphrody-shell-sandbox-host-e2b` (not in repo) → `crates/shell/aphrody-shell-sandbox-host/src/e2b.rs`; `crates/shell/aphrody-shell-vfs-opfs` (not in repo) → `crates/shell/web/src/opfs.rs`. Original dated observations below retain their historical scope.

The [current status](../../products/shell/STATUS.md) records which paths have passed real host
checks. The [implementation plan](../../plans/shell/wasm-stack-definitive.md) tracks remaining
work.

| Layer | Owner | Contract |
| --- | --- | --- |
| VT state | `crates/shell/terminal-core` | Ingest raw output bytes, produce a terminal snapshot and replies. The client owns VT state for every transport. |
| Engines and sessions | `crates/shell/web`, `crates/shell/session`, `crates/shell/terminal-backend` | Browser commands use `LocalShell` and `ShellSession`; native and Tauri shells use `PtySession`. All exchange input and output bytes. |
| Filesystem | `crates/shell/vfs`, `crates/shell/web/src/opfs.rs` | The synchronous `Vfs` trait serves shell commands. `MemVfs` is the reference; `OpfsVfs` encodes bounded, checksummed snapshots. |
| Hosts | `crates/shell/aphrody-shell-sandbox-host`, `crates/shell/aphrody-shell-sandbox-host/src/e2b.rs` | `SandboxHost` handles session, limits and file transfer. Mock and local PTY adapters are qualified; the E2B adapter awaits live provider conformance. |
| Transports | `packages/shell/web`, `crates/shell/tauri` | The TypeScript `Transport` interface carries bytes over a dedicated OPFS worker, Tauri Channel, or authenticated WebSocket. |
| Renderer | `crates/ui/app` | The existing DOM terminal renderer consumes output; it does not parse shell commands. |

## Browser persistence

The browser engine and its VFS mirror run in a dedicated worker. OPFS directory operations are
asynchronous even there, so the worker opens two image files during startup. It uses synchronous
access handles for file I/O and alternates images by generation. The previous valid generation
survives an interrupted write. Main-thread code keeps terminal rendering and VT replies.

## Native and remote sessions

The Tauri plugin sends PTY output through a bounded Channel. The event transport remains a
compatibility fallback. The WebSocket backend authenticates requests, checks Origin/Host, and
limits sessions, frame size, output and idle time. Named PTY sessions retain bounded output
for a 30-second reconnect window; unnamed sessions close on disconnect. Remote provider confinement belongs behind
`SandboxHost`; `crates/os/sandbox` is the separate native command policy owner.

## Qualification

Run [`check-all.sh`](../../../scripts/build/shell/check-all.sh) to build the WASM binding, run
the Bun package checks and exercise a real Tauri webview. Set `APHRODY_CHROME` to run the
Chromium browser tests and `APHRODY_SHELL_LIVE_BIN` to the built PTY `serve` example for the
live WebSocket test. The script uses the repository's serialized Cargo wrapper through its
existing owner scripts.
