<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Shell

Embedded Nushell, PTY/WebSocket terminal backend, Rio VT parsing and the Ratatui
agent surface. The facade is `aphrody-shell`; implementations are `aphrody-nu`,
`aphrody-terminal-backend` and `aphrody-tui`.

Contracts owns `aphrody-subsystem`, `aphrody-agent-proto` and
`aphrody-kernel-client`, consumed through the monorepo workspace. The agent stays across a
process boundary; there is no AI dependency here. The only Bun package is `@aphrody/shell-web`.

## Runtime

Embedded `aphrody utils` commands use authenticated local kernel IPC, never host
PATH resolution. `APHRODY_OS_SOCKET` selects the endpoint and
`APHRODY_OS_AUTH_TOKEN` supplies authentication. Defaults: 30 seconds and 1 MiB
per output stream; maxima: five minutes and 8 MiB. These bound elapsed execution
and captured output, not total process memory or CPU scheduling.

`portable-pty` owns process lifecycle. The optional Rio VT core produces terminal
state; rendering and complete terminal interaction belong to the host. Preserve
upstream notices and root Cargo patches in consuming workspaces.

## WASM, web and Tauri

The [layer architecture](../../architecture/shell/README.md) names each owner and byte contract.
The [status](./STATUS.md) records tested paths; the
[plan](../../plans/shell/wasm-stack-definitive.md) tracks remaining work.

`aphrody-terminal-core` owns client VT state. `aphrody-shell-web` exposes the WASM terminal and
local command engine; `aphrody-shell-session` and `aphrody-shell-vfs` provide its session and
filesystem contracts. The dedicated browser worker runs that engine over `OpfsVfs` and persists
versioned, checksummed images in OPFS. `@aphrody/shell-web` supplies the worker, WebSocket,
Tauri Channel and local transports behind one interface. `aphrody-shell-tauri` opens native PTY
sessions for the Tauri path. Nushell and the Ratatui TUI remain native.

The desktop app mounts its terminal panel from `m3/packages/app-ui`. It uses Tauri Channel
for native sessions, the OPFS worker in a browser, and `sandboxTransport` when a hosted page
provides `window.__APHRODY_SHELL_HOST__ = { websocketUrl, token, sessionId? }` before the app
bundle loads. Hosted pages must supply their own authenticated endpoint. xterm renders the raw
PTY bytes; the WASM VT parser is not attached to that renderer. The app UI build emits the
worker and WASM files alongside the page.

[`check-all.sh`](../../../../scripts/aphrody/build/shell/check-all.sh) chains the existing WASM build,
package tests and real Tauri webview gate. Set `APHRODY_CHROME` and `APHRODY_SHELL_LIVE_BIN`
to include the real Chromium and PTY browser tests.

## Build and docs

Use the pinned Rust toolchain and shared `sccache` wrapper. Run build-producing Cargo gates
through `scripts/build/rust/cargo-serial.sh` as described in
[AGENTS.md](../../reference/shell/AGENTS.md). Cold Nushell builds take time; PTY tests execute
real commands.

- [Terminal design](./terminal/README.md), [engine selection](../../reference/shell/terminal/ENGINE-SELECTION.md)
- [Nushell embarqué et scripts du dépôt](../../reference/shell/NUSHELL.md)
- [Kernel utilities integration](../../reference/shell/COREUTILS-OS-INTEGRATION.md)
- [Yazi](../../reference/shell/YAZI.md), [TUI motion research](../../research/shell/research/animate-tui-motion.md)

Apache-2.0; the Rio VT dependency is MIT and its exact version is recorded in
`Cargo.lock`. Root-level source patches retain their individual provenance records.
