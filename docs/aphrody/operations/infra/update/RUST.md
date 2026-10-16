<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust ecosystem bump (`yolo update rust`)

Owner: Infra (`packages/infra/update/src/ecosystems/rust.ts`, exported as `runRust`). Part of the
[update pipeline](../UPDATE.md); this page is the policy and the runbook for everything Cargo: the toolchain channel,
the lock, direct dependency requirements, advisories and git remotes.

Run it from the repository root:

```sh
yolo update rust <status|plan|apply|verify|doctor|fix> [flags]
bun run rust:doctor      # every gate of the Rust workspace, report only
bun run rust:fix         # the same gates, repairing what is mechanical first
```

## Policy

- Cargo runs only through `scripts/build/rust/cargo-serial.sh`, one command at a time, never in the background. Workers
  never run Cargo; the integrating agent does. The module follows the same rule: every Cargo call is the wrapper.
- `Cargo.lock` is only ever changed by `cargo update` (never by hand, never bulk-updated to remove duplicate versions).
- Direct requirements are declared in `[workspace.dependencies]` and inherited; a member that still carries its own
  requirement is bumped in its own manifest by the module.
- A bump moves in three tiers: the **in-range refresh** (lock only), **precise** moves (one crate at a time when a bulk
  refresh left it behind), and **majors** (the manifest requirement changes, consumers are fixed). Majors are never part of
  a plain `apply`; each one is a transaction that rolls back when it cannot be fixed cheaply.
- Holds are data, not folklore: `tools/config/deps/rust-holds.json` (never move) and `tools/config/deps/advisory-holds.json`
  (advisories that no bump can fix). An exact `=x.y.z` requirement is a deliberate pin: reported as `[exact pin]`, moved only
  by an explicit `apply --majors <crate>`.
- Tauri family crates belong to `yolo ops tauri-sync` (`tools/config/tauri-upstream.json`); the module reports them as
  `[owner: tauri-sync]` and refuses to move them.
- `rust-toolchain.toml` moves only through `yolo update tools rust --apply`, together with the category repositories
  (see the header of that file). The module reports the gap, it does not change the channel.

### Resolver rule (`.cargo/config.toml`)

`[resolver] incompatible-rust-versions = "allow"`. The integrated `crates/ui/taffy` still declares `rust-version = "1.71"`;
with Cargo's default `fallback` that single member made `cargo update` downgrade openssl, quinn-proto, serde_with and
others to releases that build on Rust 1.71 (security fixes included). The workspace builds on one pinned modern toolchain,
so the lock always resolves to the newest release.

## Commands

| Command | Does |
| --- | --- |
| `rust status [--strict] [--json]` | pinned vs installed vs latest stable and nightly; every direct requirement behind the crates.io sparse index (`range` = newer release inside the requirement, `beyond` = a breaking release outside it, with MSRV note, `YANKED`); OSV advisories on `Cargo.lock` that are not in `advisory-holds.json` (`--strict` exits 1 when open); lock pins that drifted; Cargo git remotes and `~/source` pins that moved (`sources/drift.ts`) |
| `rust plan [--no-cargo] [--json]` | what `apply` would do: the `cargo update --dry-run` list, the precise updates, the lock pins to restore, **majors** with the consumers and manifests that must change, and the held crates |
| `rust apply [--majors a,b+c] [--skip-refresh] [--keep]` | 1. in-range refresh through `cargo.ts` (snapshot `target/update/Cargo.lock.before` (not in repo), journal run); 2. `cargo update -p name@ver --precise X` for direct crates the refresh left behind (a transitive requirement blocks some: reported as `blocked`, not fatal); 3. lock pins and their `relock` repair; 4. `cargo check --workspace`; 5. each `--majors` group as a transaction. `a,b` = two transactions, `a+b` = one transaction for crates that must move together (`nu-command+nu-engine`, `resvg+usvg`). `--skip-refresh` runs only the majors. `--keep` leaves a failing major in place so the code can be fixed forward |
| `rust verify [--crates a,b]` | `cargo check --workspace`, `cargo clippy -p <touched>` (touched crates are recorded by `apply` in `target/update/rust-touched.json` (not in repo)), `cargo deny --format json check advisories` when `cargo-deny` is installed; crates named in `advisory-holds.json` are expected findings, any other flagged crate fails the step |

| `rust doctor [--fix] [--only a,b] [--skip a,b] [--strict] [--allow-dirty] [--verbose]` | every gate of the workspace in one action, see [Doctor](#doctor-one-action-for-the-whole-workspace) |
| `rust fix [...]` | `doctor --fix` |

A major transaction: snapshot `Cargo.lock` and the edited manifests under `target/update/rust/<stamp>-major-<crates>/`,
rewrite every requirement (`bumpReq` keeps the operator and the number of components: `0.7` to `0.8`, `=1.7.0` to
`=1.19.0`; compound requirements are refused), `cargo update -p crate@old ...`, then `cargo check` of the consumers.
A consumer that only builds the crate behind a feature is checked with the features that enable it (`--features`
derived from `dep:crate` entries), not blindly.

## Doctor: one action for the whole workspace

`yolo update rust doctor` (`bun run rust:doctor`) proves the state of the Cargo workspace; `yolo update rust fix`
(`bun run rust:fix`) is the same run with the repair step first. Owner module:
`packages/infra/update/src/ecosystems/rust-doctor.ts`; data: `tools/config/update/rust-doctor.json`; nextest profile:
`.config/nextest.toml` (`doctor`). Each stage is one Cargo command through `cargo-serial.sh`, in this order:

| Stage | Proves | `fix` repairs |
| --- | --- | --- |
| `lock` | `Cargo.lock` matches the manifests (`cargo metadata --locked`); the lock pins of `rust-holds.json` are in place | pins and their `relock`; a lock that drifted (Cargo re-resolves it, never a bulk update) |
| `format` | `cargo fmt --all -- --check -l` against `rustfmt.toml`, one row per crate | `cargo fmt -p <crate>` |
| `compile` | `cargo clippy --workspace --all-targets --keep-going`: errors, warnings and lints with crate, file and line | `cargo clippy --fix` for machine-applicable suggestions, then `cargo fmt` of the crates that were formatted |
| `features` | one `cargo check --workspace --all-targets` with every member feature switched on, minus `features.skip` | |
| `targets` | `cargo check --target <triple>` for `targets[]`: `wasm32-unknown-unknown`, and `x86_64-pc-windows-msvc` through `cargo xwin` (downloads and caches the MSVC CRT and SDK on first use) | |
| `test` | `cargo nextest run --workspace --profile doctor` (JUnit at `target/nextest/doctor/junit.xml` (not in repo), one retry marks a test flaky) and `cargo test --workspace --doc` | |
| `deny` | `cargo deny check advisories`; crates in `advisory-holds.json` are notes, any other one is an error | |
| `bumps` | `rust status`: toolchain pin against stable, yanked or in-range releases left behind, open OSV advisories, held crates | |

Targets are data (`targets[]` in `tools/config/update/rust-doctor.json`):

- `packages: "auto"` selects the members with a dependency gated on the target family (`match`), plus `include[]`
  (artifacts with no gated dependency, such as `aphrody-shell-web`), minus `exclude[]` (host-only crates, each with its
  reason, printed as a note).
- `isolate: true` checks one package at a time. wasm32 needs it: a set unifies features, and one member asking for
  tokio's `net` (mio) fails every other member of the set. A browser crate must therefore declare its own minimal
  `tokio` and `reqwest` in its wasm table; the workspace entries are host-sized and Cargo cannot switch their
  features off.
- `runner: "xwin"` runs `cargo xwin check`. The MSVC STL that cargo-xwin downloads refuses a Clang older than its own
  floor (error `STL1000`), and cargo-xwin drives `clang-cl` through the first `clang` on `PATH`, so the doctor puts
  the newest `/usr/lib/llvm-<N>/bin` first. `env.CL_FLAGS` adds target-only C flags (`-msse4.1` for the SIMD sources
  of `libwebp-sys`, which `cl.exe` compiles without a flag and `clang-cl` does not).

Rules of the repair:

- A vendored crate (`vendored[]`: `koharu*`, `obscura*`, `taffy`) is never rewritten; its warnings and formatting are notes.
- A crate that already has uncommitted changes when the doctor starts is not rewritten unless `--allow-dirty`: in a shared
  checkout those edits may belong to another agent. Commit your own work first, or pass the flag.
- Anything the doctor cannot repair is listed with crate, file, line and lint, or with the reason it was not proven.
  A skipped feature, an excluded target package and an excluded test are printed as notes on every run; a missing tool
  (`cargo-xwin`, a target that is not installed, `cargo-deny`) is a warning, never a pass.

Severity and exit code: `error` (does not compile, failing test, open advisory, yanked crate, drifted pin) exits 1;
`warning` (lint, formatting, flaky test, unproven target, pin behind stable) exits 1 only with `--strict`; `info` are the
documented notes. `--only` and `--skip` take stage names; `--verbose` lists the notes and streams Cargo's own output.
The report is `target/update/rust-doctor/report.json` (not in repo), with the raw output of each stage next to it (`<stage>.out`,
`<stage>.log`). A warning already reported by `compile` is not repeated by `features` or `targets`.

Cost on a warm cache: `lock`, `format` and `compile` take about a minute. `features`, `targets` and `test` compile code
that the default build never touches; the first run after a toolchain or lock change is long.

## Reading the output

- `range` rows that remain after `apply` are blocked by a transitive exact or tilde requirement (the `blocked` line names
  it). Current example: `deno_error 0.7.3` is excluded by `deno_core 0.412` (`=0.7.1`).
- `beyond` rows are the majors. Read the consumer list in `plan`, then the release notes (Context7 or the GitHub release
  page) before attempting one.
- Only registry dependencies are considered. Path-patched crates (`taffy`, `simdutf`, `tauri-plugin-dialog`,
  see `[patch.crates-io]`) and workspace entries that no member uses have no lock entry and are skipped.

## Held crates

Every entry is in `tools/config/deps/rust-holds.json`. Advisory-driven ones are also in `tools/config/deps/advisory-holds.json`.

| Crate | Stays | Why |
| --- | --- | --- |
| `yara-x` | `=1.7.0` | 1.19 to 1.21 need wasmtime ^43 to ^45, which carry RUSTSEC-2026-0222/0269/0316 (fixed from 46.0.3). 1.7.0 keeps wasmtime 36.0.16. Advisory hold. |
| `yara-x-macros`, `-parser`, `-proto` | lock `1.7.0` | Companions of `yara-x`: their `^1.7.0` range let `cargo update` move them to 1.21.0, which broke `cargo check -p aphrody-re --features yara` (build script: `ModuleOptions` has no field `rust_module`). `apply` restores the lock pin; pinning `yara-x-macros` makes Cargo re-pick the `syn`/`prettyplease` pair of `bindgen 0.73.2` (syn 2 with prettyplease 0.3, which does not compile), so the hold carries `relock: ["bindgen@0.73.2"]` (`cargo update -p bindgen@0.73.2 --recursive`). |
| `portable-pty` | `0.8` | 0.9.0 breaks headless Windows clients (desktop PTY note). `serial` stays flagged as an unmaintained advisory because of it. |
| `ort` | `=2.0.0-rc.12` | `magika 1.1.0` (latest, optional in `aphrody-re`) pins `ort =2.0.0-rc.12`, so `rc.13` cannot resolve in the same graph. |
| `fastembed` | `5.17.3` | 5.17.4 and 7.x require `ort =2.0.0-rc.13` (see `ort`). |
| `cssparser`, `selectors` | `0.37`, `0.38` | cssparser 0.38 drops `ParserInput` and the `Parser<'i,'t>` second lifetime; selectors 0.41 removes `Impl` from `NonTSPseudoClass`/`PseudoElement` and needs cssparser 0.38. Porting `obscura-render` (`css.rs`, `style.rs`), `obscura-dom` (`selector.rs`) and the vendored `taffy` parse feature is its own task. |
| Rust toolchain | `1.98.1` | Latest stable is 1.99.0; the pin moves with `tools rust --apply` and the category repositories, followed by a full rebuild. Not part of a crate bump. |

Unused `[workspace.dependencies]` entries (`uu_cp`, `uu_mkdir`, `uu_mv`, `uu_touch`, `uu_uname`, `uu_whoami`, `redis`,
`mlua`, `tree-sitter`, ...) have no lock entry, so they are not bumped; delete or use them separately.

## 2026-10-02 bump record

Lock refresh inside ranges (about 240 lock packages) plus these direct majors, each checked on its consumers and the
whole workspace (`cargo check --workspace --all-targets`) and tested on the touched crates:

| Crate | From | To | Fix needed |
| --- | --- | --- | --- |
| `gix` | 0.83 | 0.88 | `find_remote(name.as_ref())` ambiguity (`aphrody-git`) |
| `nu-*` (7 crates) | 0.115.1 | 0.116.0 | none; pin `nushell` in `tools/config/update/pins.json` follows `Cargo.toml` |
| `octocrab` | 0.50 | 0.54 | none |
| `jsonschema` | 0.35 | 0.58 | none |
| `json5` | 0.4 | 1.3 | none |
| `toml_edit` | 0.22 | 0.25 | none (needed the html5ever fix below to build `aphrody`) |
| `notify-debouncer-full` | 0.6 | 0.7 | none |
| `tower-http` | 0.6 | 0.7 | none |
| `tokio-tungstenite` | 0.24 and 0.26 | 0.30 | `Message::Binary`/`Text` take `Bytes`/`Utf8Bytes` (`terminal-backend` lib and tests) |
| `sha2` | 0.10 | 0.11 | digests no longer implement `LowerHex`: hex formatted by hand in `aphrody-identity`, `-sql`, `-wsl`, `-marketplace`, `-manga`, `-rag`, `-winclean`, `koharu-library` |
| `sha1`, `md-5` | 0.10 | 0.11 | none |
| `aes` | 0.8 | 0.9 | `BlockEncrypt` is `BlockCipherEncrypt` (`aphrody-re`) |
| `aes-gcm` | 0.10 | 0.11 | `aead::OsRng` removed; `Key`/`Nonce` built with `try_from` (`aphrody-base`, `aphrody-secrets`, benches) |
| `argon2` | 0.5 | 0.6 | none |
| `html5ever` | 0.39 | 0.40 | atoms implement two `AsRef`s: `.as_ref()` became `&*atom` (`obscura-dom`, `-js`, `-render`, `-cdp`, `-browser`, `web-crawl`, `web-bridge`, `aphrody-ffi`) |
| `resvg`, `usvg` | 0.47 | 0.48 | none |
| `shlex` | 1.3 | 2.0 | none |
| `jieba-rs` | 0.10 | 0.11 | none |
| `rmcp` | `=3.4.1` | `=3.5.0` | none |
| `swash` | `=0.2.0` | `=0.2.10` | none |
| `wreq`, `wreq-util` | `=6.0.0-rc.29`, `=3.0.0-rc.12` | `=6.0.0-rc.31`, `=3.0.0-rc.14` | none (checked with `--features stealth`) |
| `pollster` | 0.4 | 1.0 | none; `cfg(windows)` only: proven by the doctor's Windows MSVC target check |
| `getrandom` | 0.2 | 0.4 | `getrandom::getrandom` is `getrandom::fill` (`a2a-coord`, `a2a-client`, `terminal-backend`); the browser backend is the `wasm_js` feature (`aphrody-base`, `aphrody-antigravity`), proven by the wasm32 target check |

Not moved, with the reason in the table above: `fastembed`, `ort`, `cssparser`, `selectors`,
`yara-x`, `portable-pty`.

Found by the first doctor run after the bump and repaired with it: `sha2` 0.11 digest formatting in `aphrody ocr`
(behind the `ocr` feature), `MangaPipelineOptions` literals behind the `koharu` feature, and the browser randomness
backend of `aes-gcm` 0.11 (`getrandom` 0.4 without `wasm_js`), which broke the wasm32 release gate of the CLI.

## Rollback

- Lock only: `cp target/update/Cargo.lock.before Cargo.lock` (written by every refresh).
- One major: the transaction already restored it on failure. After `--keep` or a manual change, copy the files back from
  `target/update/rust/<stamp>-major-<crates>/` (relative paths, `Cargo.lock` included).
- Everything: `git checkout -- Cargo.lock <manifests>` on a clean tree, or restore from the lead's commit; the lock is the
  only record of resolved versions.

## How to do a major by hand

1. `rust plan` lists the consumers and manifests. Read the release notes (Context7 or the GitHub release page); coupled
   crates (`nu-*`, `resvg`+`usvg`, `cssparser`+`selectors`+`html5ever`, `wreq`+`wreq-util`) move in one group.
2. `rust apply --skip-refresh --majors <group>`. On failure the transaction rolls back and prints the compiler errors.
3. To fix forward, repeat with `--keep`, fix the code (usually one pattern repeated), run
   `cargo-serial.sh check --workspace --all-targets --keep-going` until clean, then `rust verify`.
4. If the fix is not cheap, let it roll back and add the crate to `tools/config/deps/rust-holds.json` (and
   `advisory-holds.json` for an advisory) with the blocker, then add a row to the table above.
5. Run `cargo test -p <touched crates>`.

## Known limits

- Optional dependencies are compiled only with their feature, and `cfg(windows)` or wasm32 code only for its target.
  `apply` and `verify` check the declaring consumer with the enabling feature on the host; finish every bump with
  `rust doctor`, whose `features` and `targets` stages compile the rest.
- A `-p` subset unifies features differently from the workspace and can fail on `bindgen` or `syn`; the refresh therefore
  always verifies the whole workspace.
- Cargo may re-resolve unrelated edges when a `--precise` move unlocks a crate (see the `bindgen` relock above). Always
  finish with `cargo check --workspace --all-targets`.

## Links

- [Update pipeline](../UPDATE.md), [dependency inventory](../../../reference/workspace/DEPS-INVENTORY.md)
- `tools/config/deps/rust-holds.json`, `tools/config/deps/advisory-holds.json`, `tools/config/upstream-sources.json`
- `packages/infra/update/src/ecosystems/rust.ts`, `packages/infra/update/test/rust.test.ts`
- `packages/infra/update/src/ecosystems/rust-doctor.ts`, `packages/infra/update/test/rust-doctor.test.ts`,
  `tools/config/update/rust-doctor.json`, `.config/nextest.toml`
- [Cargo build resource policy](../../../CLAUDE.md)
