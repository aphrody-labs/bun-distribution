<!-- SPDX-License-Identifier: Apache-2.0 -->
# Desktop PTY integration contract

Owner contract for wiring `aphrody-terminal-backend` into the desktop terminal. It covers the
"Terminal / Shell" row of [`aphrody-ai/docs/PLAN.md`](../../../plans/ai/PLAN.md)
("workspace-aware PTY and process lifecycle using the existing implementation"). The delivery
order stays in `PLAN.md`; this document fixes the interfaces and the acceptance evidence.

## Historical baseline (2026-09-27)

> Superseded 2026-10-02: the shipped design is `aphrody-shell-tauri` (`aphrody_shell_open/_channel/write/resize/close`)
> and `rio-vt` is adopted in `aphrody-terminal-core`. See [STATUS](../../../products/shell/STATUS.md).

The table below records the state before the desktop PTY integration. It is
not a current-status report: `aphrody-ui` now has an in-process `PtyRegistry`,
`aphrody_pty_*` commands and a wterm/Ghostty terminal view. This document's
target architecture remains the PTY contract; the optional Rio native VT
state is described in [ENGINE-SELECTION.md](./ENGINE-SELECTION.md).

| Piece | Where | State |
| --- | --- | --- |
| PTY driver | `crates/shell/terminal-backend/src/lib.rs` | `portable-pty` 0.8 (ConPTY / `openpty`). Its only public entry is `serve(addr, PtyConfig)`: a TCP WebSocket server, one session per connection |
| PTY callers | `aphrody-ai` `aphrody term` (`aphrody/src/commands.rs`) | Only caller. The desktop never opens a PTY |
| Desktop terminal | `aphrody-ui` `m3/packages/app-ui/src/components/Terminal/TerminalView.tsx` (not in repo) | Line-mode form: every Enter runs one command through `runTerminalEval` / `runShellCommand` (`tauri-bridge.ts`). No interactive programs, no resize, no streaming, no Ctrl+C |
| Nushell path | `aphrody-app/src/desktop.rs` `terminal_eval` | Kernel tool `nu_eval` (embedded `aphrody-nu`), 30 s timeout. Correct for one-shot evaluation |
| Broken fallbacks | `tauri-bridge.ts` `runTerminalEval`, `runShellCommand` | `aphrody nu -c` (the CLI has no `nu` subcommand); pwsh/cmd go through `aphrody_exec` with no PTY or policy; errors are swallowed by `catch {}` |
| Presentation claims | `TerminalView.tsx` banner and status bar | Advertises "ConPTY Ready · Zellij Mux" and a hard-coded Nushell version that nothing backs |
| Renderer | `m3/packages/app-ui/package.json` (not in repo) | No VT emulator dependency |

## Decisions (fact-checked 2026-09-27)

| Question | Decision | Evidence |
| --- | --- | --- |
| PTY crate | Keep `portable-pty` **0.8.1** | Locked at 0.8.1 in aphrody-shell, -os, -ui and -ai. 0.9.0 (latest release, 2025-02) always passes `PSEUDOCONSOLE_INHERIT_CURSOR \| RESIZE_QUIRK \| WIN32_INPUT_MODE` (`src/win/psuedocon.rs:87`), so headless clients block on `ESC[6n`. Nothing in this contract needs 0.9. Revisit when a release ships upstream `main`'s `windows-sys` port |
| Renderer | `@wterm/react` + `@wterm/dom` + `@wterm/ghostty` 0.5.1 (Apache-2.0, vercel-labs/wterm) | DOM rows, so native selection, browser find and screen readers work (LOW_VISION); libghostty VT core (same emulator as native Ghostty: graphemes, Kitty graphics, OSC 8, synchronized output); React component; answers DSR/CPR. Pre-1.0 "Labs" project: pin exact versions |
| Renderer alternatives | Rejected | `@xterm/xterm` 6.0.0: JavaScript emulator, canvas/WebGL rows, weaker complex-script handling. `ghostty-web` 0.4.0 (MIT): same libghostty core with an xterm.js-compatible API, but canvas rendering and no push since 2026-07. `restty` 0.3.0: WebGPU, 410 stars |
| Rio (`teletypewriter`, `sugarloaf`, `rio-vt`) | Rejected | `teletypewriter` 2.0.1 runs on `corcovado` 0.0.1 (mio fork) and `windows-sys` 0.48, not tokio; `sugarloaf` draws to a native wgpu surface, not a webview pane |
| WezTerm crates beyond `portable-pty` | Rejected | `wezterm-term` is not on crates.io and duplicates the web renderer; `termwiz` duplicates `aphrody-tui`; `wezterm-ssh` 0.4.0 is from 2022 |
| Starship | Nothing to link | Binary hooked by the user's shell config. The PTY launches `nu` and `pwsh` with their user config (no `--no-config-file`, no `-NoProfile`), so an installed Starship prompt appears as it does in any terminal. aphrody ships no `starship.toml` |
| Nushell binary | `aphrody-toolchains` `Toolchain::Nu` | `crates/compat/toolchains/src/lib.rs:85` |

## Target architecture

```text
TerminalView (VT renderer) ──invoke/Channel──▶ aphrody-app (Tauri) ──▶ aphrody-terminal-backend
        ▲                                         PtyRegistry            PtySession (portable-pty)
        └────────────── Channel<PtyEvent> ◀──────────────────────────────── reader task
```

- The desktop embeds the PTY in-process through the library. No loopback TCP port, no
  WebSocket, and no `aphrody-ai` dependency: `aphrody-ui` already depends on `aphrody-shell`
  (`crates/ui/app/Cargo.toml`).
- The WebSocket `serve` stays as a thin adapter over the same session type, so `aphrody term`
  keeps working and the two paths cannot drift.
- `nu_eval` stays the path for structured, one-shot Nushell (tool calls, the agent). The
  interactive terminal runs the `nu` binary (resolved by `aphrody-toolchains`) or `pwsh` / `cmd`
  / `$SHELL` inside the PTY.

## Interfaces

### 1. `aphrody-terminal-backend`: transport-free session (aphrody-shell)

Extract the PTY half of `handle_conn` into a public type. The WebSocket handler becomes a
client of it.

```rust
pub struct PtySession { /* master, writer, child killer, reader task */ }

pub enum PtyEvent {
    Output(Vec<u8>),              // raw bytes, never re-encoded
    Exit { code: Option<u32> },   // sent once, after the output is drained
}

impl PtySession {
    pub fn spawn(cfg: &PtyConfig, events: tokio::sync::mpsc::Sender<PtyEvent>) -> Result<Self>;
    pub fn write(&self, bytes: &[u8]) -> Result<()>;
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()>;
    pub async fn close(self) -> Result<()>;  // same stop + bounded drain as today
}
```

- `PtyConfig` gains `args: Vec<String>` and `env: Vec<(String, String)>`, so the caller can
  pass `nu --login` or a workspace environment. `cwd` must be an existing directory; the caller
  validates it.
- The output channel is bounded. When it is full, the reader applies backpressure; it never
  drops bytes, and it never drops `Exit`.
- `close` keeps the current semantics: `TerminateProcess` on Windows, `SIGHUP` on Unix, then at
  most `TEARDOWN_TIMEOUT` (5 s) to drain.
- Stay on `portable-pty` 0.8.1 (see Decisions).

### 2. `aphrody-app`: Tauri commands (aphrody-ui)

A `PtyRegistry` in Tauri state maps opaque session ids to `PtySession`s.

| Command | Arguments | Result |
| --- | --- | --- |
| `aphrody_pty_open` | `shell: "nushell" \| "pwsh" \| "cmd" \| "default"`, `cwd?`, `cols`, `rows`, `on_event: Channel<PtyEvent>` | `{ id, shell_path }` |
| `aphrody_pty_write` | `id`, `data: Vec<u8>` | `()` |
| `aphrody_pty_resize` | `id`, `cols`, `rows` | `()` |
| `aphrody_pty_close` | `id` | `()` |

- Shell resolution happens on the Rust side, never in the webview: `nushell` goes through
  `aphrody-toolchains`, `default` through `default_shell()`, and `pwsh` / `cmd` only on Windows.
  The webview cannot pass an arbitrary executable path.
- `cwd` defaults to the active workspace root. It must resolve to an existing directory.
- Sessions close when their window closes and on app exit. The registry has a per-window limit
  (default 16).
- Output bytes cross the Channel as binary (`tauri::ipc::Response` or `Vec<u8>`), not as JSON
  number arrays.
- Grant the four commands in the app capability file only, next to the existing allow-list.

### 3. `app-ui`: renderer (aphrody-ui)

- Add `@wterm/react`, `@wterm/dom` and `@wterm/ghostty` at exact versions (see Decisions). They must
  pass `bun install --frozen-lockfile` and the UI design tokens (`UI-DESIGN.md`).
- `TerminalView` keeps its panes, splits and shell picker. Each pane owns one PTY session:
  `onData` goes to `aphrody_pty_write`, `autoResize` + `onResize` go to `aphrody_pty_resize`,
  `PtyEvent::Output` goes to `write`, and `Exit` marks the pane as ended with its code.
- Remove the line-mode input, the `aphrody nu -c` fallback, the `aphrody_exec` pwsh/cmd path and
  the silent `catch {}` blocks. A failed open shows the error in the pane.
- The banner and status bar show only real facts: the resolved `shell_path` and the version
  that the shell itself reports. No "Zellij Mux" or "ConPTY Ready" text.
- Outside Tauri (browser dev server), the terminal says it is unavailable. It does not fake a
  session.

## Out of scope

- Remote PTY over SSH. That is the "Remote / SSH plus Infra" row, through owner-resolved
  destinations.
- Agent-driven shell commands. They go through `aphrody-proc` and the sandbox, not through the
  user terminal.
- A multiplexer (Zellij or tmux) or session persistence across app restarts.

## Acceptance evidence

Each item is a test or a recorded run, not a claim.

1. **Backend unit tests** (`cargo test -p aphrody-terminal-backend`, Windows and Linux):
   - spawn, write `echo` plus a newline, receive the echoed output, then `Exit` with code 0;
   - `resize` changes `stty size` / `$Host.UI.RawUI.WindowSize`;
   - `close` on a live shell returns within `TEARDOWN_TIMEOUT`;
   - a full output channel does not lose bytes (checksum of a large `cat`);
   - the existing WebSocket tests still pass on top of `PtySession`.
2. **Desktop integration test** (`aphrody-app`): open, write, read, resize and close through the
   command handlers without a webview; the registry is empty afterwards.
3. **Manual run** on Windows 11, recorded in the PR:
   - `nu`, `pwsh` and `cmd` panes run interactive programs (`vim` or `hx`, `top` / `btm`, the
     `nu` completion menu);
   - Ctrl+C interrupts `ping -t`;
   - window resize reflows the output;
   - closing a pane leaves no orphan `conhost` / `OpenConsole` / shell process.
4. **Gates**: each touched repository's gates from its `AGENTS.md` (fmt, clippy `-D warnings`,
   tests, `cargo deny`, Bun typecheck and tests).
5. **PLAN.md**: the "Terminal / Shell" row moves from "integration to qualify" to integrated,
   linking this document and the evidence.

## Delivery steps

Each step is one commit in its owning repository, with that repository's gates green.

1. **aphrody-shell:** `PtySession` + `PtyEvent`, `PtyConfig { args, env }`, `serve` rewritten
   on top of them, and the backend tests from item 1.
2. **aphrody-ui (Rust):** `PtyRegistry`, the four `aphrody_pty_*` commands, capability grants,
   cleanup on window close and exit, and the integration test from item 2.
3. **aphrody-ui (web):** VT renderer in `TerminalView`, bridge functions in `tauri-bridge.ts`,
   and removal of the line-mode path, broken fallbacks and false claims.
4. **aphrody-ai:** `aphrody term` still builds against the refactored backend (no behavior
   change). Update the `PLAN.md` row once the acceptance evidence exists.
