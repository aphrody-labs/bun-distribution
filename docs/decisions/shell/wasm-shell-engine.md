<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR: WASM shell engine and transport choices

Status: accepted (2026-10-02), spike results measured locally.

## Measured

The scratch crate at `/tmp/aphrody-shell-t6-20261002` declared optional dependencies on
`uucore = 0.12.0`, `uu_echo = 0.12.0`, `uu_wc = 0.12.0`, `nu-parser = =0.115.1`,
`brush-parser = 0.4.0` and `brush-core = 0.5.0`, each with default features disabled.
Each feature re-exported its dependency in `src/lib.rs`. Checks ran one at a time through
`scripts/build/rust/cargo-serial.sh check --manifest-path /tmp/aphrody-shell-t6-20261002/Cargo.toml --target wasm32-unknown-unknown --features <feature>`.
The brush check also set `RUSTFLAGS='--cfg getrandom_backend="wasm_js"'`.

| Feature / crate | WASM check | Licence | Dependency graph cost¹ |
| --- | --- | --- | ---: |
| `uucore` 0.12.0 | pass | MIT | 44 packages |
| `uu_echo` 0.12.0 | pass | MIT | 87 packages |
| `uu_wc` 0.12.0 | fail: `errno` rejects target OS `unknown` | MIT | 91 packages |
| `nu-parser` 0.115.1 | pass | MIT | 188 packages |
| `brush-parser` 0.4.0 + `brush-core` 0.5.0 | pass with WASM getrandom flag | MIT | 144 packages |

¹ `cargo tree --manifest-path /tmp/aphrody-shell-t6-20261002/Cargo.toml --target wasm32-unknown-unknown --features <feature> --prefix none | sort -u | wc -l`. This is a dependency count, not a linked WASM size. Parser and utility checks establish compilation only; browser execution and VFS integration require separate proof.

`uu_echo::uumain` writes to process stdout; `uu_wc` opens `std::fs::File`. Neither entry
point accepts the shell's `Vfs` or returns pipeline bytes. The in-browser registry therefore
uses small VFS-backed implementations tagged `source = own` instead of linking a host-I/O
utility solely because it compiles. `aphrody-shell-session` and `aphrody-shell-vfs` also pass
wasm32 checks. The Tauri plugin and PTY backend passed native tests (34 tests).

## Decisions

1. Engine in the browser: keep `LocalShell` as the floor. Its small parser is already used by the
   verified browser path. Brush and Nushell parser crates compile but add larger dependency
   graphs; adopt one behind `ShellEngine` only when a concrete missing grammar feature warrants
   its cost and a browser run proves it. Nushell and the TUI stay native.
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
