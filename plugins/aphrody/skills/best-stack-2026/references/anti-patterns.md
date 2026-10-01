# Anti-pattern reference — why each rejected stack was rejected

This file expands the one-line rationales in `SKILL.md`'s anti-patterns table
into full justifications. Consult when the user pushes back on a rejection
("why not openssl? everyone uses it") and you need the longer story.

## openssl (0.9 / 0.10)

**Issue 1 — system dep drift.** `openssl-sys` links against the OpenSSL
package installed on the build host. Ubuntu 20.04 ships 1.1.1, 22.04 ships
3.0, 24.04 ships 3.0 too but with different cipher defaults. The resulting
binary works on the build box and fails on a slightly older or newer target.
`rustls` ships its own crypto provider and has zero system deps.

**Issue 2 — CVE history.** OpenSSL averages 6-10 high-severity CVEs per
year. Even if you patch promptly, the audit surface is enormous (≈500 KLOC
of C). `rustls` is ≈40 KLOC of Rust, externally audited (Cure53 in 2020 and
2023), and the cryptographic primitives are pluggable (`ring` or
`aws-lc-rs`).

**Issue 3 — cross-platform.** OpenSSL doesn't ship on Windows (vcpkg or
manual install). `rustls` works identically on Linux, Windows MSVC, and
wasm32. For any project shipping on more than one OS, this is decisive.

**When OpenSSL is unavoidable.** FIPS 140-3 boundary requirement that
mandates a FIPS-validated module — even then, prefer `aws-lc-rs` (which is
FIPS validated) over raw `openssl-sys`.

## actix-web 4.x for greenfield

actix-web is not unsafe or buggy — it is technically excellent and still in
production at major companies. The case against it for new code in 2026:

1. **Ecosystem alignment.** `axum` lives in the tokio/tower ecosystem; the
   middleware story (tower::Layer) composes directly with all tower crates
   (load balancing, retries, rate limits). actix has its own middleware
   model that doesn't reuse tower.
2. **Maintenance velocity.** actix-web releases averaged 2.x per quarter in
   2021–2022, ~1 per quarter in 2024, and roughly 1 release in the first
   half of 2026. axum and tower keep weekly velocity. For a 5-year project,
   pick the ecosystem with the longer expected lifetime.
3. **Onboarding tax.** Most current Rust web tutorials and example
   repositories target axum. New hires will land faster on axum.

**When actix is the right choice.** Existing actix codebase you don't want
to rewrite; a team with deep actix experience; need for the actix Actor
model in the same process. Otherwise, axum.

## tokio 0.2 / 0.3

Pre-1.0. Different `Runtime` API, no `JoinSet`, different `select!` macro,
`block_on` location moved, channels differ. Anything you write against 0.2
will need a substantial rewrite to compile against 1.x. There is no upgrade
path that is not a port. Start on 1.x.

## hyper 0.14 raw

hyper is a brilliant low-level library, but you very rarely want to write
the routing, body extraction, error mapping, and middleware glue yourself.
`axum` is the thin layer on top of hyper that handles those concerns; it
also follows hyper's 1.x migration so you're not stuck on 0.14 forever.

If you genuinely need the low level (custom protocol on top of HTTP/2, raw
server with non-HTTP framing), use `hyper` 1.x directly, not 0.14.

## async-std

The project has been effectively unmaintained since 2023. There is no
known successor — the ecosystem consolidated on tokio. Anything you build
on async-std today inherits frozen dependencies and unfixed bugs in the
runtime. There is no benefit over tokio that justifies the deprecation
risk.

## tao + wry (Linux)

On Linux, `wry` uses WebKitGTK and `tao` uses the gtk-rs GTK3 bindings, which
RustSec flags as unmaintained (RUSTSEC-2024-0411 and following, 2024-03-04).
There is no patched release, so `cargo deny` reports them for every Tauri app on
Linux. This is an accepted cost of Tauri: record a targeted `ignore` with a
reason in `deny.toml`. If the UI does not need a web view, `egui`/`iced`/`slint`
on `wgpu` avoid GTK entirely.

## unicorn-engine (GPL-2.0)

GPL-2.0 is **viral**: linking unicorn-engine into a binary makes the whole
binary GPL. For a project distributed under Apache-2.0 or MIT this is a licence
violation once released. The only safe usage is as an
**out-of-process** executable invoked via FFI/subprocess with no static
linking — which defeats most of the reason to embed an emulator.

For analysis-only workflows, `iced-x86` (Apache-2.0) handles x86 decoding
without emulation. For multi-arch, `capstone` (Apache-2.0). For emulation
with a permissive license: there is no perfect substitute today — most
high-quality CPU emulators are GPL. Plan a subprocess boundary if you
truly need emulation, or evaluate if static analysis suffices.

## radare2-rs

radare2's core is LGPL-3.0 with GPL-3.0 components. Similar contamination
story to unicorn. Use `goblin` + `capstone` + your own analysis layer.

## serde_yaml 0.9 / serde_yaml_ng

`serde_yaml` was archived upstream in 2024. The `serde_yaml_ng` fork has not
released since 2024-05. The maintained successor is `yaml_serde` (published by
the YAML organization). Keep existing imports with a package rename:

```toml
serde_yaml = { package = "yaml_serde", version = "0.10" }
```

## chrono 0.4 default features

The default features pull in `oldtime` (CVE history) and bloat the build.
For new code, prefer `jiff` 0.2 (time-zone aware by default, immutable
values, a single coherent API). For chrono-dependent code, set
`default-features = false` and enable only `clock` and `serde`.

## time 0.1 / 0.2

Pre-1.0 APIs. Use `time` 0.3, or `jiff` 0.2 when time-zone arithmetic matters.

## failure / error-chain

Both were popular pre-`?` operator (Rust 1.39, late 2019). `anyhow`
(applications) + `thiserror` (libraries) is the consensus pattern post-2020
and remains so in 2026.

## Mixing rand majors

The current major is `rand` 0.10. Mixing majors in one workspace compiles
`rand` several times and gives incompatible `Rng` traits, so match whatever
major the workspace already uses (`cargo tree -d -i rand` shows duplicates),
and bump all members together.

## bincode

RUSTSEC-2025-0141 (2025-12-16): the bincode team ceased development after a
harassment incident. 1.3.3 is considered complete; 3.0.0 is not a usable
upgrade. RustSec lists `wincode`, `postcard`, `bitcode` and `rkyv` as
alternatives. Existing on-disk formats written with bincode 1 can keep using
1.3.3; new formats should pick an alternative.

## native-tls on Linux

`native-tls` selects the platform's TLS implementation: Schannel on
Windows, SecureTransport on macOS, OpenSSL on Linux. The Linux path
inherits all OpenSSL system-dep issues. For portable Linux binaries
(containers, distroless, musl) this is a non-starter. reqwest 0.13 uses rustls
by default.

## dotenv (for parsing)

`dotenv` is unmaintained (RUSTSEC-2021-0141). Use `dotenvy` to load `.env`
files; for typed, layered configuration use `figment`
(`Env::prefixed("APP_")`) or `config`.

## lazy_static, once_cell::sync::Lazy

`std::sync::LazyLock` stabilised in Rust 1.80 (July 2024). For any new
code under 1.80+, the std type is preferred. `once_cell` remains useful
for `OnceCell` (non-static), but the `Lazy` use case is std now.

## error-chain style chained errors

Pre-`?` operator pattern. The modern equivalent is:

```rust
use anyhow::{Context, Result};

fn load_config(path: &Path) -> Result<Config> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    toml::from_str(&text)
        .with_context(|| format!("parsing {}", path.display()))
}
```

This produces a chain on display (`anyhow::Error: Display` walks the
chain) without the boilerplate of error-chain's macro-driven types.
