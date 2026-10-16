<!-- SPDX-License-Identifier: Apache-2.0 -->

# WASM shell stack: upstream facts (2026-10-02)

Method: read-only GitHub MCP queries against upstream sources. Nothing was
built and cargo was not run. "Unverified" marks anything not confirmed in
upstream source. crates.io was not reachable from this tool, so published
versions are inferred from upstream manifests and tags.

## 1. reubeno/brush (brush-core)

Source: https://github.com/reubeno/brush, main at `8b539ddbb0b265d2703d841b48933d6de601cfc2`.
Latest release: `brush-shell-v0.4.0` (2026-05-03), tag `brush-v0.4.0` = `96a26d0c66cbc018a1517e9562944418fef5b272`.

| Item | Finding | Evidence |
| --- | --- | --- |
| wasm32-unknown-unknown | Supported. Built in CI on ubuntu-24.04 via `cross`. Changelog: "Enable building for wasm32-unknown-unknown (#425)". Needs rustflag `--cfg getrandom_backend="wasm_js"` | `.github/workflows/ci.yaml` (not in repo), `.cargo/config.toml`, `CHANGELOG.md` |
| wasm32-wasip2 | Supported. CI builds it and runs a subset of integration tests under wasmtime (`xtask test`, "Add basic wasm32-wasip2 tests to CI (#1098)"). Built with minimal features | `.github/workflows/ci.yaml` (not in repo), `xtask/src/test.rs` |
| Platform layer | `brush-core/src/sys/wasm/{mod.rs,fs.rs}`; everything else (process, signal, terminal, fd, pipes, poll, users, network, env, input, commands) reuses `sys/stubs`. So no subprocess spawn, no job control, no terminal ioctls on wasm | `brush-core/src/sys/wasm/mod.rs` |
| Known wasip2 gap | `File::try_clone()` is unsupported on wasip2, so `OpenFile::clone()` falls back to a failing writer: output redirection is broken under wasi (test marked `incompatible_platforms: ["wasi"]`) | `brush-shell/tests/cases/brush/tracing.yaml` |
| Excluded from wasi tests | compat, interactive and completion suites | `xtask/src/test.rs` |

Dependency gating in `brush-core/Cargo.toml` (version `0.5.0`, `brush-parser ^0.4.0`):

| Dependency | Gate | Effect on wasm |
| --- | --- | --- |
| `nix 0.31.2` (fs, poll, process, resource, signal, term, user), `libc`, `command-fds`, `terminfo`, `uzers` | `cfg(unix)` | Not pulled on wasm. nix is not a blocker |
| tokio (net, process, rt-multi-thread, signal) + `hostname` | `cfg(any(unix, windows))` | Not pulled on wasm |
| tokio `io-util, macros, rt, sync` | `cfg(target_family = "wasm")` | Single-thread runtime only. Use a current-thread runtime and `block_on`; no threads |
| `getrandom 0.4.2` (`wasm_js`) + `uuid` (`js`) | `wasm32-unknown-unknown` only | Requires wasm-bindgen/JS host. Not needed on wasip2 |
| features | `default = []`, `serde`, `experimental-parser` | No feature blocks wasm. The blockers are target-gated, not feature-gated |

Related manifests: `brush-parser/Cargo.toml` and `brush-shell/Cargo.toml` carry the same getrandom/uuid wasm block. `brush-shell` (the binary) pulls crossterm and is not the embedding surface.

Embedding with custom IO / filesystem (partially verified):
- Embed `brush-core` (library), not `brush-shell`. Build a `Shell` through its builder (`bon`-generated) and run commands with `run_string`; stdio is passed as `OpenFiles`/`OpenFile` objects, which is where a custom stdin/stdout/stderr is plugged in. Exact API names at 0.5.0 are unverified; read `brush-core/src/{shell,openfiles}.rs` and `brush-core/src/sys/wasm/fs.rs` before coding.
- There is no pluggable VFS trait. On wasm the filesystem is whatever `std::fs` maps to: WASI preopens on wasip2, and on wasm32-unknown-unknown std::fs is unsupported (unverified in detail; `sys/wasm/fs.rs` is a thin shim). A custom filesystem therefore means a WASI host that preopens a virtual FS (wasip2 route), or patching `sys/wasm/fs.rs`.
- Caveat above: redirections to files fail on wasip2 until `try_clone` is worked around.

Crate versions: `brush-core 0.5.0`, `brush-parser 0.4.0`, `brush-shell 0.4.0` (manifest and tags). Whether `brush-core 0.5.0` is the version on crates.io: unverified. Verify with `cargo info brush-core` (non-building) before pinning.

## 2. coder/ghostty-web

Source: https://github.com/coder/ghostty-web, `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`. Latest release `v0.4.0` (2025-12-09). Only one release listed.

| Item | Finding |
| --- | --- |
| npm package | `ghostty-web` 0.4.0 (README also references `@ghostty-web/demo`) |
| Licence | MIT (`package.json`, `LICENSE`) |
| Description | Ghostty VT parser compiled to WASM, ~400 KB, zero runtime deps, canvas renderer (`CanvasRenderer`) |
| Build | Zig + Bun; Ghostty source plus `patches/ghostty-wasm-api.patch` (not in repo). Not built by us |
| Load wasm | `import { init, Terminal } from 'ghostty-web'; await init();` (`init()` calls `Ghostty.load()` once, shared instance). The wasm is `ghostty-vt.wasm`, exported as `ghostty-web/ghostty-vt.wasm` and copied to `dist/`. Custom instance: `const ghostty = await Ghostty.load(); new Terminal({ ghostty })`. How `Ghostty.load()` resolves the URL (import.meta.url vs path option): unverified, read `lib/ghostty.ts` |
| Entry points | ESM `dist/ghostty-web.js` (not in repo) (generated or machine-local artifact; presence depends on the build host), UMD `dist/ghostty-web.umd.cjs` (not in repo) (generated or machine-local artifact; presence depends on the build host), types `dist/index.d.ts` (not in repo) (generated or machine-local artifact; presence depends on the build host) |

xterm.js-compatible surface (from `lib/index.ts`, `lib/terminal.ts`, `lib/addons/fit.ts`):

| API | Present |
| --- | --- |
| `new Terminal(options)` with `fontSize`, `theme` (`ITerminalOptions`, `ITheme`) | yes |
| `open(el)`, `write(data)`, `writeln`, `resize(cols, rows)`, `focus`, `blur`, `clear`, `reset`, `paste`, `scrollToBottom`, `dispose` | yes |
| Events `onData`, `onResize`, `onKey`, `onBell`, `onTitleChange`, `onScroll`, `onCursorMove`, `onRender`, `onSelectionChange` | yes (each returns an `IDisposable`, `IEvent` typed) |
| `loadAddon(addon)` (`ITerminalAddon.activate(term)`) | yes |
| `FitAddon`: `fit()`, `proposeDimensions()`, `observeResize()` (ResizeObserver, 100 ms debounce), `dispose()` | yes, exported from the root |
| Extras | `OSC8LinkProvider`, `UrlRegexProvider`, `LinkDetector`, `SelectionManager`, `InputHandler`, `KeyEncoder` |
| Gaps vs xterm | Only the FitAddon is bundled. No WebGL, search, serialize, attach, clipboard or image addons. `FitAddon` reaches into `terminal.renderer`, so it works only with this Terminal. Unverified: `onWriteParsed`, `buffer` API depth, `options` live-setters |

## 3. xtermjs/xterm.js (fallback)

Source: https://github.com/xtermjs/xterm.js. Latest stable release `6.0.0` (2025-12-22), previous `5.5.0`. Package `@xterm/xterm` 6.0.0, MIT, entry `lib/xterm.mjs`, CSS `css/xterm.css`, types `typings/xterm.d.ts`. (The 6.0.0 package.json at tag `6.0.0` is the evidence; newer minor releases were not listed.)

| Item | API |
| --- | --- |
| Core | `new Terminal(opts)`, `open(el)`, `write(data, cb?)`, `writeln`, `resize(c, r)`, `onData`, `onResize`, `onKey`, `onBell`, `onTitleChange`, `onBinary`, `loadAddon` |
| Addons in 6.0.0 tree (`addons/`) | `addon-attach`, `addon-clipboard`, `addon-fit`, `addon-image`, `addon-ligatures`, `addon-progress`, `addon-search`, `addon-serialize`, `addon-unicode-graphemes`, `addon-unicode11`, `addon-web-links`, `addon-webgl` (npm names `@xterm/addon-*`) |
| Headless | `@xterm/headless` for VT state without a DOM |

Exact method signatures for 6.0.0 were not read (unverified); check `typings/xterm.d.ts`. Note ghostty-web's own devDependencies still pin `@xterm/xterm ^5.5.0`.

## 4. uutils/coreutils on wasm32-wasip2

Source: https://github.com/uutils/coreutils, `2b85f6f12875d97abcbe8e2157000d7dde702823`. No release or tag was queried.

| Item | Finding |
| --- | --- |
| CI | `.github/workflows/wasi.yml` (not in repo) runs unit tests for `wasm32-wasip1` and `wasm32-wasip2` under wasmtime. Per-utility excluded set: `df\|du\|env\|more` (`EXCLUDE` list; derived from `./util/show-utils.sh`) |
| Selection feature | `feat_wasm = ["feat_common_core", "nproc"]` in root `Cargo.toml`. Build: `cargo build --target wasm32-wasip2 --no-default-features --features feat_wasm` (CI uses the `CICD.yml` flags at line ~391) |
| Per-utility | `-p uu_<name>` crates, or `--no-default-features --features <name>` on `coreutils`. The wasi.yml TODO list names utilities not yet integration-tested, and the integration list names those that are (base32/64, basename, cat, comm, cp, cut, dirname, echo, expand, expr, factor, false, fold, head, link, ln, mktemp, nl, numfmt, od, paste, printf, shuf, sum, tail, tee, test, touch, tr, true, truncate, unexpand, unlink, wc, yes, plus two `ls` cases) |
| Embedded caveat | Issue #14561 (open, 2026-09-14): `uucore` panics with empty argv in a component (`util_name()` / `EXECUTION_PHRASE` index `ARGV[0]`), which is a trap on wasm. Directly relevant to calling utilities as in-process library calls |
| PR #14562 (open) | Fixes `env` on wasip2 (`std::os::wasi::ffi` is unstable on p2; uses encoded-bytes API), restores `env` to `feat_common_core`, guards empty WASI argv, adds a p2 CI step. The `rustix/std` part is already on main (commit `17f1a5de9` via `uucore`'s `fs` feature) |
| Current state | `env` excluded from `feat_common_core` and `feat_wasm` until #14562 merges (commit `c9077c764`). `df`, `du`, `more` fail to compile on both wasi targets. Pin a commit and re-check before relying on any single utility |

Practical rule for Aphrody: use `uucore` only after the empty-argv fix lands, or set argv explicitly in the host; keep the allow-list in `feat_wasm` plus the tested list above. Utilities needing processes, users, ttys, mounts (`ls` colour, `df`, `du`, `who`, `stty`, etc.) are not expected to work (unverified individually).

## 5. rio-vt (raphamorim/rio, pinned =0.5.28)

Source: https://github.com/raphamorim/rio, tag `v0.5.28` = `37624389e8dde79ba25a8147a5e809c01d16d1c9` (latest tag listed). `rio-vt/Cargo.toml`: version inherited from the workspace (0.5.28 by tag; the workspace file was not read). Description: "Embeddable terminal core: VT state machine, grid, PTY driver, selection, search".

wasm-specific points in the manifest:

| Item | Detail |
| --- | --- |
| wasm gate | Native-only deps under `cfg(not(target_arch = "wasm32"))`: `corcovado`, `teletypewriter` (PTY), `simdutf` (SIMD UTF-8/base64; scalar fallback on wasm), `copypasta`, `raw-window-handle`, `sugarloaf`, `rio-window`. wasm32 (both unknown-unknown and wasip2, since both are `target_arch = wasm32`) gets `web-time 1.1.0` instead |
| Time | `web-time` replaces std `Instant`, which panics on wasm32-unknown-unknown. On wasip2 this works too (unverified at runtime) |
| Default feature | `default = ["pty"]`, with `pty = ["dep:corcovado", "dep:teletypewriter"]`. Those optional deps exist only on non-wasm targets, so on wasm use `default-features = false` (VT-only embedder). Whether `pty` code is also `cfg`-gated on wasm: unverified |
| Other features | `graphics` (image crate, off by default), `clipboard`, `x11`, `wayland`, `renderer`, `wgpu`, `rio-window`; none needed for wasm |
| Always-on deps | `regex`, `regex-automata`, `flate2`, `parking_lot`, `serde`, `rio-graphics`, `rio-grapheme-width`, `rio-unicode`, `memchr`, `smallvec`, `rustc-hash`, `base64`, `bitflags`, `cursor-icon`, `tracing` | 
| Threading | `parking_lot` on wasm32-unknown-unknown without atomics/threads is fine for single-thread use; `flate2` default backend is pure Rust (`miniz_oxide`), unverified for workspace feature selection |
| Not verified | Whether `rio-vt` has any CI wasm build, whether `rio-graphics` (always-on) compiles on wasm with `image` off, size, and whether a wasm demo exists. Compile it once through `scripts/build/rust/cargo-serial.sh check -p rio-vt --target wasm32-unknown-unknown --no-default-features` (lead only) |

## Summary for the stack

- Shell: `brush-core` is the only candidate with first-class wasm32-unknown-unknown and wasip2 CI. Biggest functional gap is redirections on wasip2 and no subprocess/job-control (utilities must be linked in-process, e.g. uutils).
- Terminal front end: `ghostty-web` for fidelity, `@xterm/xterm` 6.0.0 plus `@xterm/addon-fit` as fallback; both expose `write`, `onData`, `resize`, `loadAddon`, so one adapter can cover both.
- Coreutils: use `feat_wasm`; wait for #14562 for `env` and the argv trap.
- VT core (Rust side): `rio-vt =0.5.28` with `default-features = false` on wasm.
