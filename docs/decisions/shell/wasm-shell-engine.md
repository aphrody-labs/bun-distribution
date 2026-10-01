<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR: WASM shell engine and transport choices

Status: accepted (2026-10-02), spike results measured locally.

## Measured

- `brush-core 0.5.0` + `brush-parser 0.4.0` pass `cargo check --target wasm32-unknown-unknown`
  (scratch crate outside the repo, not a workspace member; `getrandom_backend="wasm_js"` rustflag). Compile only: no run in a browser yet.
- `aphrody-shell-session` and `aphrody-shell-vfs` pass the same check.
- `aphrody-shell-tauri` (channel streaming, window cleanup) and `aphrody-terminal-backend`
  (session/idle/frame/output limits) pass their tests natively (34 tests).

## Decisions

1. Engine in the browser: keep `LocalShell` builtins as the floor; adopt `brush-core` behind the
   `ShellEngine` trait once a browser run proves it (no pluggable FS: bridge through `Vfs` at builtin level).
   Nushell and the TUI stay native.
2. Tauri streaming: `Channel` (`aphrody_shell_open_channel`) is the preferred path; the `emit` event path stays
   as a compatibility fallback. Coalesce frames (64 KiB or ~16 ms) and bound the queue so the PTY reader awaits
   rather than drops output.
3. Renderer: keep the xterm-like surface so `ghostty-web` (MIT, WASM VT, xterm.js-compatible API) or xterm.js
   can be swapped without changing `Transport`.
4. Persistence: OPFS-backed `Vfs` in a worker (T5), `MemVfs` as the conformance reference.

## Prior art (web research, not yet reproduced here)

- browser-terminal v0.5.0: Rust/WASM core, writable OPFS mounted at `/scratch` by default.
- wasm_os: WASM microkernel with syscalls over a SharedArrayBuffer ring.
- Reports of Tauri IPC terminal output as JSON number arrays with no coalescing or backpressure
  (Clavyn issue 48); recommended fix is one binary Channel with credit-based flow control.
- libghostty-vt WASM is claimed faster than xterm.js on IO, reflow and rendering (author's benchmark, unverified here).
