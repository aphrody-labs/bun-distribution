<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell and terminal layers

> Path reconciliation (2026-10-07): `crates/shell/aphrody-shell-sandbox-host-e2b` (not in repo) → `crates/shell/aphrody-shell-sandbox-host/src/e2b.rs`; `crates/shell/aphrody-shell-vfs-opfs` (not in repo) → `crates/shell/web/src/opfs.rs`. Original dated observations below retain their historical scope.

The [current status](../../products/shell/STATUS.md) records which paths have passed real host
checks. The [implementation plan](../../plans/shell/wasm-stack-definitive.md) tracks remaining
work.

| Layer | Owner | Contract |
| --- | --- | --- |
| VT state & GPU Grid | `crates/shell/aphrody-term`, `crates/shell/terminal-core` | Ingest raw output bytes, produce a terminal snapshot and replies. `aphrody-term` brings 16B `PackedCell` L1 cache alignment, fast-path ASCII `memchr`, `FairMutex` (256 Ko bounded leases), and WebGPU instanced quads via Sugarloaf. |
| In-Process Shell Engine | `crates/compat/bun-bridge`, `crates/shell/nu` | Dual-engine execution: Nushell 0.116 for interactive typed exploration; Bun Shell native AST parser (`AstArena` bump allocator) + JSC for 0ms-fork agent execution. |
| Engines and sessions | `crates/shell/web`, `crates/shell/session`, `crates/shell/terminal-backend` | Browser commands use `LocalShell` and `ShellSession`; native and Tauri shells use `PtySession`. All exchange input and output bytes. |
| Filesystem | `crates/shell/vfs`, `crates/shell/web/src/opfs.rs` | The synchronous `Vfs` trait serves shell commands. `MemVfs` is the reference; `OpfsVfs` encodes bounded, checksummed snapshots. |
| Hosts & MicroVMs | `crates/shell/aphrody-shell-sandbox-host`, `crates/shell/aphrody-shell-sandbox-host/src/wasm_guest.rs` | `SandboxHost` handles session, limits and file transfer across local PTY, E2B cloud provider, and in-process Full-WASM microVMs (`v86` x86 JIT and `container2wasm` OCI runner). |
| Transports | `packages/shell/web`, `crates/shell/tauri` | The TypeScript `Transport` interface carries bytes over a dedicated OPFS worker, Tauri Channel, or authenticated WebSocket. |
| Computer-Use Controller | `crates/shell/aphrody-term/src/computer_use.rs` | High-throughput agent screen capture (>10 GB/s direct memory scraping) and programmatic key/text injection without X11/Wayland latency. |
| Renderer | `crates/shell/aphrody-term`, `crates/ui/app` | Instanced WebGPU 2-pass quad coalescing (background quads + glyph atlas) with Wayland `niri` or headless agent buffer support. |

## Production 2026 Stack Architecture

The complete production architecture is specified in [La Stack Utile & Optimisée (Production 2026)](../runtime-native/STACK-PRODUCTION-2026.md) and [Virtualisation Full-WASM & MicroVM](../runtime-native/WASM-CONTAINER-V86.md).

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
`SandboxHost`; `crates/os/kernel/comps/sandbox` is the separate native command policy owner.

## Qualification

Run [`check-all.sh`](../../../scripts/build/shell/check-all.sh) to build the WASM binding, run
the Bun package checks and exercise a real Tauri webview. Set `APHRODY_CHROME` to run the
Chromium browser tests and `APHRODY_SHELL_LIVE_BIN` to the built PTY `serve` example for the
live WebSocket test. The script uses the repository's serialized Cargo wrapper through its
existing owner scripts.

