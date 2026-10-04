<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native terminal engine selection

**Decision date:** 2026-09-28. **Selected engine:** Rio `rio-vt` 0.5.28 from
crates.io, whose published source records upstream commit
`37624389e8dde79ba25a8147a5e809c01d16d1c9`.

## Decision

Rio is the optional native terminal state engine for Aphrody Shell. It provides the complete
Rust terminal state layer: ANSI/VT parsing, Unicode and grapheme handling,
scrollback, selection, search, terminal damage, Kitty/iTerm/Sixel graphics
events and PTY-facing events. `aphrody-terminal-backend` uses `rio-vt` without
its PTY feature: Aphrody retains `portable-pty` for the already-qualified
ConPTY/openpty lifecycle. Rio parsing is opt-in through
`PtySession::spawn_with_terminal_state`; the default desktop path continues
to use its existing wterm/Ghostty renderer and must not receive duplicate VT replies.
`TerminalState::styled_snapshot()` exposes visible cells, resolved VT styles,
wide-cell occupancy and cursor state to a future native renderer. It does not
yet expose all graphics, selection, scrollback or damage needed for full parity.

Rio's GPU/windowing crates (`sugarloaf`, `rio-window`, `rioterm`) are not
dependencies and are not copied into this repository. They are not wired into
the desktop. The current DOM terminal is a Tauri/M3 desktop
proof surface, not the product GUI target. The target is a native Rust/`wgpu`
host owned by `aphrody-ui`; see its `design/aphrody-m3/docs/reference/NATIVE-DESKTOP.md`. Rio's `wgpu 30`
cannot share the current Aphrody `wgpu 26` device directly. Its existing DOM
terminal has native text selection, find and accessibility; replacing it
requires equivalent native capabilities in the UI owner.

## Comparison

| Candidate | Complete native capabilities | Decision |
| --- | --- | --- |
| Rio 0.5.28 | Rust VT core plus GPU renderer, desktop/windowing layers, images, splits and browser targets; `rio-vt` is explicitly embeddable and published | **Selected**: modern modular architecture and an embeddable VT core, without altering the existing PTY contract |
| WezTerm | Mature Rust terminal, GPU rendering, tabs, panes, multiplexer, SSH and Lua ecosystem; most complete standalone Rust terminal in this comparison | Not embedded: its application/multiplexer graph would duplicate Aphrody's PTY and desktop responsibilities |
| Alacritty | Mature, fast Rust terminal core and standalone GPU application | Not selected: its reusable core is narrower, while its application renderer is not an embeddable native host contract |
| COSMIC Terminal | `alacritty_terminal`, `cosmic-text` and `wgpu`, integrated with COSMIC | Not selected: its GUI is tied to the COSMIC desktop stack rather than Aphrody's cross-platform UI boundary |
| Ghostty / Windows Terminal | Strong modern terminal applications | Not selected: they are not Rust-native engines for this repository (Zig and C++ respectively) |

The criteria are different: **WezTerm wins on standalone features**, while
**Rio wins as an embeddable Rust VT core** for this backend. For the existing
Tauri webview, **wterm/Ghostty remains the active renderer** because its DOM
text supports selection, find and accessibility. This is the current proof
surface, not the final renderer decision. It is not a claim that Rio has a richer
feature set than WezTerm or that its GUI already runs inside Aphrody.

Primary sources: [Rio](https://github.com/raphamorim/rio),
[WezTerm features](https://github.com/wezterm/wezterm/blob/main/docs/features.md),
[Alacritty](https://github.com/alacritty/alacritty/blob/master/README.md),
[COSMIC Terminal](https://github.com/pop-os/cosmic-term), and
[wterm](https://github.com/vercel-labs/wterm/blob/main/README.md).

## Verification requirements

The registry dependency must remain pinned to the qualified `rio-vt` release
with its MIT license recorded by Cargo, and pass this repository's Windows and
Linux gates. A backend gate proves parsing and PTY lifecycle only. It does not prove a Rio desktop renderer: that requires a Windows desktop run exercising
interactive programs, resize, clipboard, graphics and accessibility.
