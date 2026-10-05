<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell / terminal stack: wasm, web, Tauri, serverless (definitive plan)

Date: 2026-10-02. Status: active implementation plan. Section 1 is the baseline read from before implementation;
the task status and [current shell status](../../products/shell/STATUS.md) record subsequent changes.
Rules: root `CLAUDE.md`. Workers never run Cargo; the lead runs one check at a time through
`scripts/build/rust/cargo-serial.sh`. Claim each owner path in `.coord/claims/shell-wasm-stack.json` (not in repo) before editing.

## 1. Verified state (read from the repo, 2026-10-02)

| Piece | Path | Real vs stub |
| --- | --- | --- |
| VT state (Rio `rio-vt` 0.5.28) | `crates/shell/terminal-core` | Real. `TerminalState::{new,ingest,resize,take_replies,snapshot,styled_snapshot}`. Compiles for wasm. Selection, scrollback, damage, graphics not exposed (ENGINE-SELECTION.md). |
| WASM bindings | `crates/shell/web` | Real: `WebTerminal`, `WebShell`, `resize_frame`, `data_frame`. `LocalShell` (`local.rs`) is a toy line editor with 9 builtins (help echo clear env set history version exit). No pipes, no quoting, no files, no coreutils, no scripting. |
| Tauri PTY plugin | `crates/shell/tauri` | Real: 4 `#[tauri::command]` over native PTY, mock-app test. |
| Real webview e2e | `crates/ui/app/examples/shell_e2e.rs`, `scripts/build/shell/tauri-e2e.sh` | Real (CEF under Xvfb since decision 21; WebKitGTK on Broadway before, not re-run). |
| TS transports | `packages/shell/web/src/index.ts` | Real: `webSocketTransport`, `tauriTransport`, `localTransport`, `attach`. Tests: `shell-web.test.ts`, `browser.test.ts` (headless Chrome), `live-backend.test.ts` (live PTY). |
| Native PTY + WS server | `crates/shell/terminal-backend` | Real (portable-pty, 1598 lines). Native only. |
| Nushell | `crates/shell/nu` (nu 0.115.1, features `brotli`, `os`, `rmp-serde`, `sqlite`) | Real, native only. Not built for wasm; wasm viability is unproven. |
| Ratatui TUI | `crates/shell/tui` | Real, native only. Out of scope here. |
| Coreutils | `crates/os/coreutils` | **Adapter only.** `subsystem.rs` spawns a pinned uutils multicall binary (`APHRODY_COREUTILS_BIN` or `target/aphrody-uutils/...`) as a subprocess; also wraps findutils/grep/sed/diffutils/tar companions. No uutils library code is linked, nothing compiles for wasm. MCP tools `coreutils_status/catalog/run` and `uutils_*` front it. uutils sources are not in `.cache/upstream` and not in `config/upstream-sources.json`'s listing; locate or add before T7. |
| Sandbox | `crates/os/sandbox` | **Native policy + helper real** (Landlock/seccomp unix, Low-IL windows, `SandboxPolicy`, `CommandRunner` trait, `MockCommandRunner`, `patch_guard`). **wasm is a stub** (`wasm.rs`: two no-op functions; `runner.rs` gates tokio on non-wasm). It is a command-confinement crate, not a remote-sandbox abstraction. |
| VFS / OPFS | none | No shell VFS exists. `crates/os/fsindex` and `crates/os/drive` are different concerns (indexing, cloud drive); reuse only the ideas. |
| Renderer | wterm/Ghostty DOM in `crates/ui/app` | Active renderer by decision (ENGINE-SELECTION.md). Native wgpu renderer is the UI owner's future work. |

## 2. Layer model (one owner per layer, no duplicates)

```
 L5 Renderer      DOM (wterm/Ghostty, existing) | later native wgpu (aphrody-ui)
 L4 Client        @aphrody/shell-web  (attach, Transport interface)
 L3 Transport     WebSocket | Tauri invoke+Channel | in-worker local | HTTP/SSE+WS to sandbox host
 L2 Session       ShellSession trait: input bytes -> output bytes, resize, exit  (NEW, small)
 L1 Engine        a) LocalShell (wasm, extended)  b) native PTY (portable-pty)  c) remote sandbox host
 L0 VT core       aphrody-terminal-core (Rio VT), runs client-side for every engine
```

Decisions:

1. **VT core runs in the client for every engine.** Remote and native PTYs stream raw bytes; the VT state is always
   `TerminalState` in wasm. The Tauri/WS paths already follow this. No server-side VT parsing for the web path
   (avoids duplicate VT replies, see ENGINE-SELECTION.md).
2. **Shell engine in wasm = grow `LocalShell`, not port Nushell first.** Nushell with `os/network/sqlite` features is not
   a known wasm32 build; treat it as a time-boxed spike (T9), not a dependency of the milestone. The in-wasm engine is a
   small POSIX-ish interpreter (quoting, pipes, redirects, `&&`/`||`, env, cwd, globbing) over a command registry and the VFS.
   Before writing a parser, T6 checks `best-stack-2026` and the ecosystem catalog for an existing wasm-clean crate
   (candidates to evaluate: `brush-parser` for POSIX/bash parsing only, `shlex`, `nu-parser` with default-features off,
   `uucore`). Choose by wasm32 build and licence; record the choice in an ADR under `docs/decisions/shell/`.
3. **Coreutils in wasm = a `ShellCommand` registry over VFS and pipeline bytes.** `crates/os/coreutils` stays the native
   subprocess owner. T6 measured that `uu_echo` compiles for wasm but writes to process stdout, while `uu_wc` fails
   on `errno` for the unknown OS target. Link a uutils utility only when its API can consume VFS and return byte output;
   the measured allow-list (cat, echo, head, tail, wc, sort, uniq, tr, cut, basename, dirname, printf, true/false,
   seq, tee) uses small `own` implementations where that contract is unavailable. Each entry declares its source in
   the registry and generated [utility table](../../reference/shell/WASM-UTILITIES.md).
4. **VFS trait first, OPFS second.** One `Vfs` trait (read/write/stat/readdir/mkdir/remove/rename, async-free core,
   byte-based paths) with `MemVfs` (tests, serverless), `OpfsVfs` (browser snapshot mirror), and a Tauri-fs host
   adapter. The browser shell runs in a dedicated Web Worker, which opens OPFS files asynchronously at startup and
   then persists versioned, checksummed VFS images through `FileSystemSyncAccessHandle`. The main thread keeps
   renderer + VT. Directory APIs remain asynchronous even inside the worker.
5. **Serverless/cloud = a `SandboxHost` trait, with providers behind it.** Not `aphrody-sandbox` (that is local
   confinement). Define `SandboxHost { spawn(spec) -> Session, upload/download via Vfs-like calls, kill, ttl }` and make
   the Session speak the same wire frames as the PTY WebSocket (`resize_frame`/`data_frame`), so L3's WebSocket
   transport serves it unchanged. Providers (Cloudflare Containers/Sandbox, E2B, Fly Machines, Firecracker on the
   vps/dbfr hosts) are adapters, each its own task, none before the trait and a mock host test exist.
   Reuse `aphrody-terminal-backend` as the PTY-in-container entrypoint (it already is a PTY WebSocket server).
6. **Tauri = native PTY, not the wasm engine, by default.** `tauriTransport` over `aphrody-shell-tauri` for real shells;
   `localTransport` remains available offline. Streaming should move from polling/events to a Tauri `Channel`
   (T4) with backpressure; keep command names stable.
7. **Security (YOLO policy, owner directive):** no approval prompts, but remote paths require auth (token on WS/HTTP, as
   `APHRODY_OS_AUTH_TOKEN` does locally), origin check, output/size caps (reuse the 1 MiB/8 MiB limits from coreutils
   adapter), idle TTL, and per-session quotas. Record these in T10 tests, not just docs.

## 3. Reuse map (check before proposing new)

| Need | Reuse | Do not create |
| --- | --- | --- |
| VT | `aphrody-terminal-core` | another VT crate |
| wasm bindings | `aphrody-shell-web` | a second wasm crate for the same API; new engines live in new library crates it depends on |
| Native PTY | `aphrody-terminal-backend`, `aphrody-shell-tauri` | wasm PTY emulation |
| Native coreutils | `aphrody-coreutils` adapter, MCP `coreutils_*`/`uutils_*` | changes to it for wasm |
| Native confinement | `aphrody-sandbox` (`SandboxPolicy`, `CommandRunner`) | re-implement policy; only add a wasm `CommandRunner` impl if needed |
| Wire frames | `crates/shell/web/src/wire.rs` | new framing |
| TS client | `@aphrody/shell-web` | a second client package |
| Tests | `packages/shell/web/test/*`, `scripts/build/shell/tauri-e2e.sh`, `scripts/build/shell/build-wasm.sh` | new harness runners |
| Tauri driving/verification | MCP `aphrody_tauri_*` tools | custom webdriver code |
| Nushell | `aphrody-nu` (native) | wasm fork unless T9 proves it |

Ecosystem catalog check: `docs/ecosystem/ECOSYSTEM.md` lists no wasm VFS, OPFS, WASI, or remote-sandbox-host crate. New crates
below are therefore justified; names follow `docs/architecture/rust-crate-naming.md` (`aphrody-<domain>-<name>`, to be
confirmed by the lead against that file).

## 4. Tasks

Status 2026-10-02: T1-T11 and T14 have code or recorded spikes; T12 has an E2B adapter with live provider qualification outstanding; T13 has the app panel and browser proof, with the Tauri screenshot/DOM gate outstanding. T3 passed 15 native unit tests, strict Clippy, wasm32 check and release build, the owning Bun tests (3 pass, 2 environment-gated skips), and a generated-WASM `WebShell` pipeline smoke. T5 passed four native VFS tests, 15 web-engine tests, strict Clippy, wasm32 and Windows GNU checks, a generated-WASM release build, and a real Chromium test running the shared VFS conformance suite and proving OPFS persistence across reload. Windows MSVC check is environment-blocked by the `simdutf` build script (no authentic MSVC toolchain under the Windows BuildTools directory). T11 passed shared host conformance on the mock and native PTY adapters, six native tests, strict Clippy, wasm32 and Windows GNU checks, plus the live Bun WebSocket PTY test. T8's worker client passed that Chromium OPFS test, its sandbox transport passed an authenticated live PTY round trip, and its Channel path passed mock bridge tests. T14's `check-all.sh` passed the WASM build, six Bun tests, typecheck and real Tauri LOCAL/REMOTE markers; both touched documentation trees passed link checks. See [STATUS](../../products/shell/STATUS.md).

Owner paths are exclusive per task; two tasks never edit the same file. Tasks that add a workspace member or
dependency also need a one-line root `Cargo.toml` edit: the lead (integrating agent) does root `Cargo.toml`/`bun.lock`
edits to avoid collisions; workers list the lines they need in their report. No worker runs Cargo; "Test" is run by the lead
serially.

### T1. ShellSession trait and engine seam
- Owner: `crates/shell/session/` (new crate `aphrody-shell-session`), no other paths.
- Deps: none.
- Content: `ShellSession` (input, resize, poll/take output, exited), `ShellEngine` factory trait; wasm-clean, no tokio.
- Test: unit tests with a scripted fake engine; `cargo check -p aphrody-shell-session --target wasm32-unknown-unknown` (lead).

### T2. Vfs trait + MemVfs
- Owner: `crates/shell/vfs/` (new crate `aphrody-shell-vfs`).
- Deps: none.
- Content: `Vfs` trait, `MemVfs`, path normalisation, error type, size/inode caps. Conformance test-suite exported as a
  function so every backend runs the same tests.
- Test: conformance suite on `MemVfs` (native) and wasm32 check; property tests for path normalisation.

### T3. Extend LocalShell onto session + vfs (the in-wasm engine)
- Owner: `crates/shell/web/src/local.rs`, new `packages/fut/fut/src/engine/` (if split), `crates/shell/web/Cargo.toml`.
- Deps: T1, T2. Parser choice ADR from T6 (parser-only part may start with a handwritten tokenizer).
- Content: line editor with history/arrow keys, cwd, quoting, pipes, redirects, `&&`/`||`, env expansion, command registry
  trait `ShellCommand`, builtins (`cd pwd ls cat mkdir rm cp mv touch` over the Vfs) kept in-crate until T7 lands.
  Keep the existing wasm_bindgen API names (`WebShell`) stable; add `WebShell::with_vfs` only if T5 needs it.
- Test: existing `crates/shell/web` unit tests plus new ones driven through `TerminalState` (as the current test does);
  `packages/shell/web/test/shell-web.test.ts` extended by T8, not here.

### T4. Tauri streaming over Channel
- Owner: `crates/shell/tauri/`, `crates/shell/tauri/permissions/`.
- Deps: none (parallel to T1-T3).
- Content: add a Tauri 3 `Channel`-based output stream with bounded backpressure alongside existing events; keep current
  command names and capability `aphrody-shell-tauri:default`. Session cleanup on webview close.
- Test: existing mock-app test extended (lead runs); `scripts/build/shell/tauri-e2e.sh` unchanged and must still pass.
  `tauriTransport` update is T8's.

### T5. OPFS Vfs backend + worker host
- Owner: `crates/shell/aphrody-shell-vfs-opfs/` (portable snapshot mirror), `crates/shell/web/` (WASM binding), and
  `packages/shell/web/src/worker.ts`.
- Deps: T2 (trait + conformance suite), T3 (engine to host).
- Content: `OpfsVfs` mirrors `MemVfs` synchronously and encodes bounded, checksummed images. The worker owns the
  WASM shell and two OPFS image slots, writing through `FileSystemSyncAccessHandle` and retaining the previous
  generation for recovery. It exchanges bytes with the main thread via transferable `ArrayBuffer` messages.
  `index.ts` is not touched (T8).
- Test: conformance suite run in headless Chrome via the existing `APHRODY_CHROME` path used by `browser.test.ts`
  (new test file `packages/shell/web/test/opfs.test.ts` (not in repo) owned by T5); persistence across reload asserted.

### T6. Parser/crate selection spike and ADR
- Owner: `docs/decisions/shell/wasm-shell-engine.md` (new). Read-only elsewhere.
- Deps: none; must finish before T3's parser work and T7's allow-list.
- Content: use `aphrody:best-stack-2026` and `ecosystem` skills plus actual wasm32 build attempts (lead runs) of:
  `brush-parser`, `nu-parser`, `uucore`, representative `uu_*`. Outcome table with wasm32 result, licence, size cost.
- Test: ADR lists the exact commands and results; no claim without a recorded build.

### T7. Coreutils-in-wasm registry
- Owner: `crates/shell/aphrody-shell-wasm-utils/` (`aphrody-shell-wasm-utils`); consumed by T3 via the `ShellCommand` trait.
- Deps: T1 (trait), T2 (Vfs), T6 (allow-list).
- Content: per-utility registration over `Vfs`. Link uutils crates only where the measured library API can use that
  VFS and return pipeline bytes; the current measured set needs small implementations instead. Each utility is tagged
  `source = own` in the [generated table](../../reference/shell/WASM-UTILITIES.md). Does not touch `crates/os/coreutils`.
- Test: golden tests comparing output with the native pinned uutils binary (`coreutils_run` MCP tool / `APHRODY_COREUTILS_BIN`)
  on the same fixtures (native, lead); wasm32 check; Bun test in T8 that runs `ls | wc -l` end to end.

### T8. TS client: worker + Channel + sandbox transports
- Owner: `packages/shell/web/src/index.ts`, `packages/shell/web/test/shell-web.test.ts`, `packages/shell/web/package.json`.
- Deps: T4 (Channel), T5 (worker), T11 (sandbox wire contract, for the `sandboxTransport` type only).
- Content: `workerTransport` (OPFS-backed local), `tauriTransport` Channel mode, `sandboxTransport` (WebSocket with
  bearer token and reconnect/resume). Same `Transport` interface; split `index.ts` into files only if this task owns all of them.
- Test: `bun test` in `packages/shell/web` (WASM in Bun) plus `typecheck`; browser test with headless Chrome.

### T9. Nushell-in-wasm feasibility spike (optional, non-blocking)
- Owner: `docs/research/shell/nushell-wasm.md` (not in repo) (new). No code in the tree unless the spike succeeds, then a follow-up task.
- Deps: T6.
- Content: build `nu-parser`/`nu-engine`/`nu-command` with `default-features = false` and without `os`/`network`/`sqlite`
  for wasm32; report what compiles, what a Vfs-backed `nu` would need. Do not change `aphrody-nu`.
- Test: recorded build log summary; go/no-go.

### T10. Serverless session hardening (limits, auth, TTL)
- Owner: `crates/shell/terminal-backend/src/` (only the WebSocket server module, claim the exact file first) and its
  `tests/`.
- Deps: none.
- Content: bearer token + Origin check on the WS endpoint, per-session output/size caps, idle TTL, max sessions;
  config via env, defaults safe for exposure. No change to PTY lifecycle.
- Test: extend `crates/shell/terminal-backend/tests` (unauthenticated rejected, oversize frame dropped, TTL closes);
  `packages/shell/web/test/live-backend.test.ts` still passes (it will need the token env; update by T8).

### T11. SandboxHost trait + mock host + wire contract
- Owner: `crates/shell/sandbox-host/` (not in repo) (new crate `aphrody-shell-sandbox-host`), contract doc
  `docs/apis/shell/sandbox-host.md` (not in repo).
- Deps: T1.
- Content: `SandboxHost` trait (spawn/kill/ttl/limits/files), session = `ShellSession` speaking existing wire frames,
  `MockHost` (in-process, backed by `MemVfs` + T3 engine) and `LocalPtyHost` (wraps `aphrody-terminal-backend`, native).
  No cloud provider code here; do not depend on `aphrody-sandbox` except to reuse `SandboxPolicy` as an optional input.
- Test: trait conformance suite run on `MockHost` and `LocalPtyHost`; WebSocket round trip via `packages/shell/web`
  live test with `APHRODY_SHELL_LIVE_BIN`.

### T12. Cloud provider adapter (first one only)
- Owner: `crates/shell/aphrody-shell-sandbox-host-e2b/`, `docs/decisions/shell/sandbox-provider.md`.
- Deps: T10, T11. Decision first: pick one provider from {Cloudflare Containers/Sandbox, E2B, Fly Machines, Firecracker on
  owned hosts}; use `aphrody:deploy` and `docs` skills for current APIs; record cost, cold start and licence. Secrets stay
  in the existing protected stores; never in the repo.
- Test: the T11 conformance suite against the real provider, gated by `APHRODY_E2B_LIVE=1` and credentials so default CI skips it and records the skip. The real-provider gate is still outstanding.

### T13. UI wiring (renderer consumers)
- Owner: `crates/ui/app` shell panel files only (claim the exact files; the UI owner's other paths untouched).
- Deps: T8.
- Content: select transport per environment (Tauri -> `tauriTransport`; browser -> `workerTransport`; hosted -> `sandboxTransport`),
  keep wterm/Ghostty DOM renderer; no VT replies duplicated (client VT only feeds snapshots/replies when wterm is not rendering).
- Test: `scripts/build/shell/tauri-e2e.sh` (LOCAL and REMOTE markers still hold); MCP `aphrody_tauri_*` screenshot/DOM snapshot
  of the running app for the shell panel.

### T14. Docs and gates
- Owner: `docs/products/shell/README.md`, `docs/architecture/shell/` (not in repo) (new), `scripts/build/shell/` (new script files only).
- Deps: after T3, T5, T8 land; update as others land.
- Content: replace the "WASM, web and Tauri" section with the layer model; add `scripts/build/shell/check-all.sh` (not in repo) that
  chains the existing owners (`build-wasm.sh`, `bun test`, `tauri-e2e.sh`) without new runners.
- Test: running the script (lead); doc links checked by the workspace doc audit (`bun run` owner script of `@aphrody/workspace`).

## 5. Parallelism and file-collision matrix

Wave A (parallel, disjoint paths): T1, T2, T4, T6, T9, T10.
Wave B: T3 (needs T1, T2), T11 (needs T1), T7 (needs T1, T2, T6).
Wave C: T5 (needs T2, T3), T8 (needs T4, T5, T11), T12 (needs T10, T11).
Wave D: T13, T14.

Shared files with a single owner (lead only): root `Cargo.toml`, `Cargo.lock`, `bun.lock`, `.coord/claims/*`.
`crates/shell/web/Cargo.toml` belongs to T3 only; later tasks request dependency lines from T3's owner or the lead.
`packages/shell/web/src/index.ts` belongs to T8 only; T5's worker is a separate file.

## 6. Acceptance per layer

| Layer | Gate | Command / source |
| --- | --- | --- |
| L0 VT core | unit tests; wasm32 check | `cargo-serial.sh test -p aphrody-terminal-core`; check `--target wasm32-unknown-unknown` |
| L1 engine (wasm) | scripted sessions render through `TerminalState`; `ls | wc -l`, redirects, cd persist | `crates/shell/web` tests; T7 golden tests vs native uutils |
| VFS | shared conformance suite on MemVfs, OpfsVfs (Chrome), Tauri-fs adapter | T2, T5 |
| L2 session | fake-engine tests | T1 |
| L3 WebSocket | live PTY round trip, auth rejection | `live-backend.test.ts`, T10 tests |
| L3 Tauri | permission-checked IPC in a real webview, streaming over Channel | `scripts/build/shell/tauri-e2e.sh` (`E2E_RESULT`, `LOCAL[...tauri-wasm]`, `REMOTE[...pty-42]`) |
| L3 sandbox | conformance suite on MockHost, LocalPtyHost, then provider (flagged) | T11, T12 |
| L4 client | `bun test`, `tsc --noEmit` | `packages/shell/web` |
| L5 renderer | real-webview e2e plus DOM/screenshot via MCP `aphrody_tauri_*` | T13 |
| Whole | `check-all.sh`; wasm32 + Linux + Windows target check for touched crates | `aphrody:rust-target-check`; T14 |

Do not claim parity or deployment readiness from a green build: the browser/OPFS and cloud paths count as verified only
after their listed test runs, and Windows desktop interaction (resize, clipboard, accessibility) remains a separate gate per
ENGINE-SELECTION.md.

## 7. Known risks

- `uu_*` crates may not build for `wasm32-unknown-unknown`; mitigated by the T6 measured allow-list and own reimplementations.
- `wasm-bindgen` and wasm link-change behaviour: follow `rust-best-practices-2026` notes when touching `build-wasm.sh`.
- OPFS sync handles need a worker and secure context; Safari/Firefox support differs, so the conformance run in Chrome is
  necessary, not sufficient.
- Nushell wasm is unproven; the milestone does not depend on it.
- `crates/os/sandbox` can mislead: its wasm module is a stub, so no task relies on it for browser isolation (the browser
  sandbox is the wasm/worker boundary; remote isolation is the SandboxHost provider).
- Working tree already has unrelated uncommitted edits (web-engine, fut, interop); shell tasks must not touch them.
