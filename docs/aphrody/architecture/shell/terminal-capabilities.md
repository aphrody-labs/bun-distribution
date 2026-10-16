<!-- SPDX-License-Identifier: Apache-2.0 -->
# Terminal capabilities

This page compares eight modern terminals with Aphrody, sets the target for the Aphrody terminal,
and records what remains to do. Every cell was read in the source code at the versions below
(2026-10-09). `opt-in` means the terminal implements the feature but it is off by default.
`parsed` means the sequence is recognised and then ignored.

## Versions and sources

| Terminal | Version | Sources read |
| --- | --- | --- |
| Windows Terminal (WT) | 1.25.2733 stable, 1.26.2734 preview, `C:\terminal` 1.27-dev `459f92bd4` | `src/terminal/adapter/{DispatchTypes.hpp,adaptDispatch.cpp}`, `src/terminal/parser/OutputStateMachineEngine.cpp`, `src/renderer/atlas/*` |
| VTE | 0.84.1 | `src/{vteseq.cc,modes.py,parser-osc.hh,parser-seq.py,termpropsregistry.cc}`, `meson_options.txt`, `NEWS` |
| COSMIC Terminal | epoch-1.10.0 (alacritty_terminal 0.25.1, cosmic-text 0.19.0, vte 0.15.0) | `Cargo.lock`, `src/{terminal.rs,terminal_box.rs}` |
| Rio | rio-vt 0.5.28 | `src/performer/handler.rs`, `src/crosswords/mod.rs`, `src/ansi/{graphics.rs,mode.rs}`, `src/event/mod.rs` |
| Ghostty | 1.3.1 | `src/terminal/{osc.zig,osc/parsers/*.zig,modes.zig,Terminal.zig,stream.zig}`, `src/termio/stream_handler.zig`, `src/renderer/{shadertoy.zig,shaders/shadertoy_prefix.glsl}`, `src/config/Config.zig` |
| Kitty | 0.49.2 | `kitty/{vt-parser.c,screen.c,modes.h}`, `docs/{graphics-protocol,keyboard-protocol,desktop-notifications,misc-protocol,shell-integration,changelog}.rst` |
| WezTerm | 20240203-110809-5046fc22 | `termwiz/src/escape/{osc.rs,csi.rs}` (not in repo), `term/src/terminalstate/{mod.rs,performer.rs,kitty.rs,sixel.rs}` (not in repo), `docs/escape-sequences.md` (not in repo), `docs/config/lua/config/front_end.md` (not in repo) |
| Alacritty | 0.17.0 (alacritty_terminal 0.26.0, vte 0.15.0) | `extra/man/alacritty-escapes.7.scd` (not in repo), `alacritty_terminal/src/term/mod.rs` (not in repo), `docs/features.md` (not in repo) |

## Matrix

The Aphrody column shows the state before this work, then the target. Before this work, Aphrody had
two engines. `aphrody-term` used its own CSI/SGR/UTF-8 parser and had no OSC, images or replies.
`terminal-core` wraps rio-vt and inherits its parsing, but it surfaced only PTY replies.

| Capability | WT | VTE | COSMIC | Rio | Ghostty | Kitty | WezTerm | Alacritty | Aphrody: before → target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sixel | yes | build option + app opt-in | no | yes | no | no | yes (preliminary) | no | parsed by rio-vt, dropped (cell size 0) → decoded into the image store |
| Kitty graphics | no | no | no | yes | yes | yes | opt-in | no | same → decoded, with placements and z-index |
| iTerm2 OSC 1337 File | no | no | no | yes | parsed | no | yes | no | same → decoded (rio-vt `graphics` feature) |
| OSC 8 hyperlinks | yes | yes | yes | yes | yes | yes | yes | yes | grid only → link colour/underline in the frame, URI exposed |
| OSC 133 marks | yes | yes | no | yes | yes | yes | yes | no | grid marks only → events and jump to prompt |
| OSC 633 (VS Code) | yes | no | no | no | no | ignored | no | no | no → A–D translated to 133, E and P;Cwd as events |
| OSC 9;4 progress | yes | yes | no | yes | yes | yes | no | no | dropped → event |
| OSC 7 cwd | 1.27-dev | yes | no | yes | yes | yes | yes | no | dropped → event |
| OSC 9;9 cwd | yes | no | no | yes | no | no | no | no | dropped → event |
| OSC 52 clipboard | yes (write) | no | yes | yes | yes | yes | yes | yes | dropped → store and load events |
| OSC 9 notify | no (ConEmu) | no | no | yes | yes | yes | yes | no | dropped → event |
| OSC 99 notify | no | no | no | no | no | yes | no | no | no → assembled by id, event |
| OSC 777 notify | opt-in | yes | no | yes | yes | yes | yes | no | dropped → event |
| OSC 0/2 title | yes | yes | yes | yes | yes | yes | yes | yes | dropped → event |
| OSC 22 pointer | no | no | no | yes | yes | yes | no | no | dropped → event |
| OSC 66 text sizing | no | no | no | no | parsed | yes | no | no | no → cells reserved, overlay drawn at scale |
| DEC 2026 sync | yes | no | yes | yes | yes | yes | yes | yes | rio-vt yes |
| Kitty keyboard | 1.27-dev | no | yes | yes | yes | yes | opt-in | yes | rio-vt modes → encoder |
| win32-input 9001 | yes | no | no | no | no | no | yes | no | no → mode tracked, encoder |
| SGR 4:x / 58 | yes | yes | yes | yes | yes | yes | yes | yes | rio-vt yes → drawn |
| Ligatures/shaping | yes (DirectWrite) | no | yes (cosmic-text) | yes | yes | yes | yes | no | no → atlas per grapheme (no ligatures yet) |
| Truecolor | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Bracketed paste 2004 | yes | yes | yes | yes | yes | yes | yes | yes | rio-vt → encoder |
| Focus 1004 | yes | yes | yes | yes | yes | yes | yes | yes | rio-vt → encoder |
| Mouse SGR 1006 | yes | yes | yes | yes | yes | yes | yes | yes | rio-vt → encoder |
| Mouse SGR pixels 1016 | no | no | no | no | yes | yes | yes | no | no → mode tracked, encoder |
| XTVERSION | no | `VTE(ver)` | no | `Rio 0.5.28` | yes | `kitty(ver)` | yes | no | `Rio 0.5.28` → `Aphrody <ver>` |
| DA1 | yes (with 4) | `?61;1;21;22;28c` | yes | `?62;4;6;22;52c` | yes | yes | yes | yes | rio-vt (announces Sixel) |
| DECRQM | yes | yes | yes | yes | yes | yes | yes | yes | rio-vt; 1016/9001 answer 0 → real state |
| User shaders | HLSL, 1 pass (`Time, Scale, Resolution, Background`) | no | no | RetroArch filters | GLSL Shadertoy, chain (`iTime`, `iResolution`, `iCurrentCursor`, ...) | yes (0.49) | no | no | no → WGSL chain, union of the WT and Ghostty uniforms |
| GPU backends | D3D11 (AtlasEngine), D2D fallback | GTK4 GSK (GL/Vulkan) or Cairo | wgpu (iced) | wgpu (Vulkan/Metal/DX12/GL) | OpenGL, Metal | OpenGL 3.3 | WebGpu (wgpu), OpenGL, software | OpenGL | none → wgpu (DX12/Vulkan/Metal/WebGPU) in `crates/ui/render` |

## Delivered

`crates/shell/term-caps` (`aphrody-term-caps`) is the reusable library for the CLI and the shell:

- `detect`: identifies the terminal from the environment (`APHRODY_TERMINAL`, `TERM_PROGRAM`,
  `WT_SESSION`, `KITTY_WINDOW_ID`, `VTE_VERSION`, ...) and the multiplexer (tmux, Zellij, screen).
  Profiles follow the matrix above. DA1, XTVERSION and kitty graphics replies refine the result.
  `image_protocol()` prefers Kitty, then Sixel, then iTerm2. `Capabilities::enabled_ids()` produces
  the `APHRODY_TERM_CAPS` list.
- `probe`: raw-mode query (`/dev/tty` + `poll` on Unix; console VT input + `ReadConsoleInputW` on
  Windows). DA1 is sent last and ends the exchange; RAII guards restore the terminal mode.
- `seq`: emitters for OSC 8/133/633/7/9;9/9;4/52/9/99/777/0/2/22/66, DEC 2026, tmux passthrough
  and `file://` URIs. Every sequence is terminated by ST, and the text it carries is stripped of
  control characters.
- `image`: encoders for Kitty (PNG in 4096-byte chunks, or raw RGBA), iTerm2 and Sixel
  (216-colour cube, RLE, transparency).
- `links`: wraps the paths that exist on disk (`path:line:col`, Windows drive letters, MSVC
  `(l,c)`) in OSC 8, skipping SGR sequences and lines that already contain OSC 8.
- `NU_MODULE` (`nu/aphrody-term.nu`): enables Nushell shell integration according to
  `APHRODY_TERM_CAPS`. It emits OSC 9;4 indeterminate after 1 s through `job spawn` and clears it
  in `pre_prompt`. It also exports the `img`, `lk` (OSC 8 links on stderr) and `caps` commands.

Gates passed on 2026-10-09:
`cargo test -p aphrody-term-caps` (26 tests),
`cargo clippy -p aphrody-term-caps --all-targets -- -D warnings`, and the same clippy run with
`--target x86_64-unknown-linux-gnu`.

## Measurements (before)

These were measured with `crates/shell/aphrody-term/examples/term_bench.rs`, release build, on a
16 MiB VT corpus with a 120x40 frame.

| Measurement | Before |
| --- | --- |
| `aphrody-term` ingest (own parser) | 45.1 MB/s |
| `aphrody-term` `render_frame` | 18.5 µs/frame, 2330 quads |
| `terminal-core` (rio-vt) ingest | 46.6 MB/s |
| `terminal-core` `styled_snapshot` | 345.9 µs/frame (one `String` per cell) |

Command: `APHRODY_LOCAL_CARGO=1 bash scripts/build/rust/cargo-serial.sh run --release -p aphrody-term --example term_bench`.

## Remaining work (in order)

1. **terminal-core as the only owner of VT state.**
   - Add the `images` feature (`rio-vt/graphics`, on by default) and the workspace dependency
     `rio-graphics = { version = "=0.5.28", default-features = false }`.
   - Add `TerminalState::with_config` with cell sizes in pixels
     (`CrosswordsSize::new_with_dimensions`). Without them, `insert_graphic` silently drops every
     image.
   - Collect `RioEvent`s in a `Listener`: rewrite XTVERSION, and answer `ColorRequest` and
     `TextAreaSizeRequest` after `advance`.
   - Add a side scanner (memchr on ESC) for OSC 133/633/99/66/22 and for `CSI ? 1016/9001 h/l`.
     It splits the chunk to inject 133 after 633, and spaces for OSC 66.
   - Add an `ImageStore` fed by `graphics_take_queues()`. Atlas keys are `(1<<32)+id`; kitty keys
     are the image id.
   - Add `placements(&mut Vec<_>)` with these rows:
     - view top = `lines_evicted + history_size - display_offset`;
     - UV = `src_*/total_*` for Sixel and iTerm2;
     - `resolve_source_rect` for Kitty.
   - Add an allocation-free cell visitor, a palette (269 entries), and input encoders
     (legacy/kitty/win32 keys, X10/SGR/SGR-pixel mouse, focus, paste).
   - Add tests with Sixel, Kitty and iTerm2 fixtures.
2. **Unify `aphrody-term`.**
   - Make `TerminalGrid` a wrapper around `TerminalState` and delete `parser.rs` and `PackedCell`.
   - Have `Frame` emit background, decoration, glyph, image and cursor quads.
   - Add golden tests in `tests/golden/*.txt` (`APHRODY_BLESS=1`).
   - Adapt the consumers: `crates/ai/agent-tools/src/computer_use.rs` (574-678, 1779-1799) and
     `crates/infra/aphrody-command/src/pillars_cmd.rs` (`ShellAction::Term`/`ComputerUse`).
3. **GPU renderer in `crates/ui/render`.**
   - Add a `terminal` feature (`gpu` + `aphrody-term`).
   - Add an R8 atlas built with fontdue and Google Sans Code
     (`aphrody_m3_tokens::google_sans_code::CODE_TTF_DATA`).
   - Render these passes: backgrounds, images z<0, glyphs, decorations, images z≥0, animated cursor.
   - Add a smooth-scroll uniform.
   - Add a WGSL user-shader chain (`fn shade(uv, frag_coord) -> vec4<f32>`, ping-pong, error
     scope).
   - Add `Option<Overlay3d>` over `Renderer3d::with_device`.
   - Add the planned `examples/terminal_demo` (not in repo), and a headless test that is skipped when no adapter is
     available.
4. **CLI.**
   - Add `ShellAction::{Caps{json,probe}, Img{file,width,protocol}, Links}` to `pillars_cmd.rs`,
     and make `Status` report real detection.
   - With no arguments, `Start` should:
     - write `NU_MODULE` to `$APHRODY_HOME/shell/aphrody-term.nu`;
     - export `APHRODY_EXE` and `APHRODY_TERM_CAPS`;
     - run `nu -e "use '<path>' *"` (disable with `APHRODY_SHELL_INTEGRATION=0`).
   - `Links` must stream line by line and flush after each line.
5. **Gates and measurements.**
   - `cargo test` and `clippy -D warnings` on terminal-core, aphrody-term, aphrody-render
     (`--features terminal`), agent-tools and aphrody-command.
   - `cargo check --target x86_64-unknown-linux-gnu` on the cfg-gated crates.
   - Re-run `term_bench` and add an "after" column to the table above.
