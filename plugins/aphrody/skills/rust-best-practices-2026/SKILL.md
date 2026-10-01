---
name: rust-best-practices-2026
description: "Current Rust (stable 1.94-1.98, edition 2024): new std APIs to prefer, async closures, precise capturing, unsafe rules, wasm link change, Cargo warnings, Tokio discipline, supply-chain gates. Use when writing, reviewing or modernising Rust."
version: "2.0.0"
source: "blog.rust-lang.org release posts 1.94.0-1.98.1, verified 2026-10-01"
---

# Rust best practices (stable 1.98, edition 2024)

A snapshot of what changed recently in stable Rust and how it should change the code being
written. Release cadence is six weeks, so check the newest posts at
`https://blog.rust-lang.org/releases/` when a question depends on something newer than 1.98.

## 1. Read the project before writing Rust

- **Toolchain**: `rust-toolchain.toml` (`channel`, `targets`, `components`) and
  `rust-version` in `Cargo.toml`. New std APIs below are only usable when `rust-version`
  (MSRV) is at least the release that stabilised them; otherwise keep the workaround.
- **Edition**: `edition = "2024"` implies `resolver = "3"` (MSRV-aware resolution).
- **Workspace**: if `[workspace.dependencies]` exists, add versions there and use
  `foo = { workspace = true }` in members; honour `[workspace.lints]` / `[lints] workspace = true`.
- **Gates**: use the commands the project documents (README, CI workflow, `justfile`,
  `Makefile.toml`, `xtask`). Default to `cargo check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test` (or `cargo nextest run`) scoped to the changed crate with `-p <crate>`.
- **Compiler cache**: use `sccache` only if the project or user config sets
  `RUSTC_WRAPPER`/`build.rustc-wrapper`; check with `sccache --show-stats`.
- Mark internal crates `publish = false` unless they are meant for crates.io.

## 2. Recent stable features to prefer

| Since | Feature | Replaces |
| --- | --- | --- |
| 1.95 | `cfg_select! { unix => {..} windows => {..} _ => {..} }` | the `cfg-if` crate |
| 1.95 | if-let guards: `Some(x) if let Ok(y) = f(x) => ..` | nested `match`/`if let` |
| 1.95 | `Vec::push_mut` / `insert_mut`, `VecDeque::push_{front,back}_mut`, `LinkedList::push_*_mut` return `&mut T` | push then re-index |
| 1.95 | `Atomic{Bool,Usize,Isize,Ptr}::update` / `try_update` | hand-written CAS loops |
| 1.95 | `bool: TryFrom<{integer}>` | `match n { 0 => false, 1 => true, .. }` |
| 1.95 | `MaybeUninit<[T; N]>` <-> `[MaybeUninit<T>; N]` via `From`/`AsRef`/`AsMut` | transmutes |
| 1.95 | `core::hint::cold_path()` | `#[cold]` helper fns for one branch |
| 1.95 | `<*const T>::as_ref_unchecked`, `<*mut T>::as_mut_unchecked` | `&*ptr` (still UB if null/invalid) |
| 1.95 | `Layout::repeat`, `repeat_packed`, `extend_packed`, `dangling_ptr` | manual layout math |
| 1.96 | `assert_matches!` / `debug_assert_matches!` (`use core::assert_matches;`) | `assert!(matches!(..))` (no Debug output) |
| 1.96 | `core::range::{Range, RangeFrom, RangeInclusive, RangeToInclusive}`: `Copy` + `IntoIterator` | storing `std::ops::Range` (not `Copy`) |
| 1.96 | `From<T>` for `LazyLock`, `LazyCell`, `AssertUnwindSafe` | wrapper closures |
| 1.97 | integer `highest_one`, `lowest_one`, `isolate_highest_one`, `isolate_lowest_one`, `bit_width` (also on `NonZero`) | `leading_zeros` arithmetic |
| 1.98 | `str::strip_circumfix` / `[T]::strip_circumfix` | `strip_prefix(..).and_then(strip_suffix)` |
| 1.98 | `str::substr_range`, `[T]::subslice_range` | pointer arithmetic on sub-slices |
| 1.98 | `String::from_utf16le` / `from_utf16be` (+ `_lossy`) | manual `u16` chunking |
| 1.98 | integer `format_into(&mut core::fmt::NumBuffer<_>)` | `itoa`-style crates for hot paths |
| 1.98 | `f32`/`f64` `algebraic_add`/`_sub`/`_mul`/`_div`/`_rem` | `fast-math` hacks; allows reassociation |

Caveat on if-let guards: their patterns do not count towards exhaustiveness, so keep a
fallback arm.

```rust
// 1.95 cfg_select!: first matching arm wins
cfg_select! {
    unix => { mod posix; use posix as sys; }
    windows => { mod win; use win as sys; }
    _ => { compile_error!("unsupported platform"); }
}

// 1.96 assert_matches!: panics with the Debug value on mismatch
use core::assert_matches;
assert_matches!(parse("42"), Ok(42));

// 1.96 Copy range in a struct
#[derive(Clone, Copy)]
struct Span(core::range::Range<usize>);
```

## 3. Edition 2024 idioms

- **Async closures**: take `impl AsyncFn(..) -> T` (`AsyncFnMut`, `AsyncFnOnce`, in the
  prelude) instead of `Fn() -> Pin<Box<dyn Future>>`; call sites use `async || { .. }`.
- **Precise capturing**: return-position `impl Trait` captures all in-scope lifetimes by
  default, so `+ '_` is usually redundant. Narrow with `-> impl Iterator<Item = &'a str> + use<'a>`.
- **`unsafe_op_in_unsafe_fn`** warns by default: wrap each unsafe operation inside an
  `unsafe fn` in its own `unsafe { }` block, with a `// SAFETY:` comment.
- **`unsafe extern "C" { .. }`** is required for extern blocks; mark individually safe
  items `safe fn`.
- **`static_mut_refs`** denies references to `static mut`: use `OnceLock`, `LazyLock`,
  `Mutex`/`RwLock` or atomics.
- `gen` is a reserved keyword; rename identifiers (or use `r#gen`).

## 4. Breaking or behavioural changes to plan for

- **1.96, wasm**: `wasm32-*` targets no longer link with `--allow-undefined`. Undefined
  imports become link errors. Fix by naming the host module:

  ```rust
  #[link(wasm_import_module = "host")]
  unsafe extern "C" {
      fn host_log(ptr: *const u8, len: usize);
  }
  ```

  Temporary escape hatch only: `RUSTFLAGS=-Clink-arg=--allow-undefined`.
- **1.97**: v0 symbol mangling is the default (affects tools that parse symbol names, e.g.
  profilers or symbol-stripping scripts); linker stderr now surfaces as the
  `linker_messages` warning lint (silence via `[lints.rust] linker_messages = "allow"` only if
  the message is understood).
- **1.97 Cargo**: `CARGO_BUILD_WARNINGS=allow|warn|deny`. In CI prefer
  `CARGO_BUILD_WARNINGS=deny cargo build --keep-going` to collect every error, instead of
  `RUSTFLAGS=-Dwarnings` (which invalidates the build cache).
- **Custom target JSON specs** are nightly-only; use built-in triples.

## 5. Security baseline

- CVE-2026-33056 (Cargo tar extraction, alternate registries): fixed in Cargo 1.94.1.
  CVE-2026-5223 / CVE-2026-5222 (tarball symlinks, URL-normalised auth): fixed in 1.96.
  Any toolchain at or above 1.96.0 covers all three; crates.io users were not affected.
- Run the supply-chain gates the project has: `cargo deny check` (licences, bans,
  advisories), `cargo audit`, `cargo vet`. When adding a private `[registries]` entry,
  confirm the registry has rescanned its crates.

## 6. Async traits and `Send`

| Need | Use |
| --- | --- |
| Static dispatch | native `async fn` in traits (stable since 1.75) |
| `Send` futures from a trait | `trait-variant` (`#[trait_variant::make(Send)]`) |
| `dyn Trait` with async methods | `dynosaur` (keeps native AFIT) or `async-trait` (boxes) |
| tower `Service` | its own `poll_ready`/`call` model; `async-trait` where needed |

## 7. Tokio discipline

- Never block a worker: `std::fs`, `std::thread::sleep`, CPU-heavy loops go in
  `tokio::task::spawn_blocking` or use `tokio::fs`.
- Only cancellation-safe futures belong in `tokio::select!` branches (documented per method;
  e.g. `AsyncReadExt::read` is, `read_exact` and "collect into a Vec" loops are not). Otherwise
  move the work into a spawned task and select on its `JoinHandle`.
- Do not hold a `std::sync::Mutex` guard across `.await`; scope it or use `tokio::sync::Mutex`.
- Bound concurrency with `Semaphore` / `JoinSet`, and propagate shutdown with
  `tokio_util::sync::CancellationToken`. See the `rust-async-patterns` skill for full patterns.

## 8. Tooling

| Task | Tool |
| --- | --- |
| Fast test runner | `cargo nextest run` |
| Strict lint | `cargo clippy --all-targets -- -D warnings` (add `-W clippy::pedantic` if the project opts in) |
| UB check in unsafe code | `cargo +nightly miri test` |
| Macro expansion | `cargo expand` |
| Benchmarks | `criterion` (in-process), `hyperfine` (CLI) |
| Cross-compile | `cargo zigbuild`, `cross`; multi-target checks via the `rust-target-check` skill |
| Prebuilt binaries | `cargo binstall <crate>` |
| Disk pressure | delete `target/*/incremental` or use `cargo sweep`, rather than a full `cargo clean` |

Shell tool choices are covered by the `cross-platform-cli-toolbelt` skill; crate choices by
`best-stack-2026`.

## Sources

- Release index: https://blog.rust-lang.org/releases/
- 1.95.0: https://blog.rust-lang.org/2026/04/16/Rust-1.95.0/
- 1.96.0: https://blog.rust-lang.org/2026/05/28/Rust-1.96.0/
- 1.97.0: https://blog.rust-lang.org/2026/07/09/Rust-1.97.0/
- 1.98.0: https://blog.rust-lang.org/2026/08/20/Rust-1.98.0/
- CVE-2026-33056: https://blog.rust-lang.org/2026/03/21/cve-2026-33056/
- Edition 2024 guide: https://doc.rust-lang.org/edition-guide/rust-2024/
