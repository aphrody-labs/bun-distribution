<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Shell

Embedded Nushell, PTY/WebSocket terminal backend, Rio VT parsing and the Ratatui
agent surface. The facade is `aphrody-shell`; implementations are `aphrody-nu`,
`aphrody-terminal-backend` and `aphrody-tui`.

Contracts owns `aphrody-subsystem`, `aphrody-agent-proto` and
`aphrody-kernel-client`, consumed through sibling paths. The agent stays across a
process boundary; there is no AI dependency or Bun workspace here.

## Runtime

Embedded `aphrody utils` commands use authenticated local kernel IPC, never host
PATH resolution. `APHRODY_OS_SOCKET` selects the endpoint and
`APHRODY_OS_AUTH_TOKEN` supplies authentication. Defaults: 30 seconds and 1 MiB
per output stream; maxima: five minutes and 8 MiB. These bound elapsed execution
and captured output, not total process memory or CPU scheduling.

`portable-pty` owns process lifecycle. The optional Rio VT core produces terminal
state; rendering and complete terminal interaction belong to the host. Preserve
upstream notices and root Cargo patches in consuming workspaces.

## Build and docs

Use the pinned Rust toolchain and `RUSTC_WRAPPER=`. `just ci` runs the owner gates
in [AGENTS.md](../../reference/shell/AGENTS.md), including the pinned nightly formatter. Cold Nushell
builds take time; PTY tests execute real commands.

- [Terminal design](./terminal/README.md), [engine selection](../../reference/shell/terminal/ENGINE-SELECTION.md)
- [Nushell embarqué et scripts du dépôt](../../reference/shell/NUSHELL.md)
- [Kernel utilities integration](../../reference/shell/COREUTILS-OS-INTEGRATION.md)
- [Yazi](../../reference/shell/YAZI.md), [TUI motion research](../../research/shell/research/animate-tui-motion.md)

Apache-2.0; the Rio VT dependency is MIT and its exact version is recorded in
`Cargo.lock`. Root-level source patches retain their individual provenance records.
