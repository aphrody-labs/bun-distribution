---
name: best-stack-2026
description: "Rust crate chooser: recommended crate and version per domain, rejected alternative and why, licence and platform caveats (verified 2026-10). Use before adding or bumping a Cargo.toml dependency, for which-crate or X-vs-Y questions, or flagged crates."
license: Apache-2.0
metadata:
  version: "2.0.0"
  source: "crates.io API + RustSec advisory-db, verified 2026-10-01"
---

# Best Rust stack (October 2026)

When asked "what should I use for X in Rust?", pick from this table, name the rejected
alternative and give the one-line reason. Naming what was ruled out is half the value.

## Before answering

1. **Read the project first.** If `Cargo.toml` / `[workspace.dependencies]` already has a
   crate for the domain, or pins a version, reuse it; do not introduce a second HTTP client,
   TLS stack or error crate. Match the project's licence (check `license` in `Cargo.toml`
   and `deny.toml`).
2. **Versions drift.** The versions below were current on 2026-10-01. Before writing a
   `Cargo.toml` line, confirm with `cargo add <crate>` (picks the newest compatible),
   `cargo search <crate> --limit 1`, or `https://crates.io/api/v1/crates/<crate>`
   (`max_stable_version`). Write the caret range of the major (`"0.8"`, `"1"`), not a patch pin.
3. **Health check.** `cargo deny check advisories` / `cargo audit` flag RustSec
   advisories, including `unmaintained` notices.
4. For language/toolchain questions defer to `rust-best-practices-2026`.

Three failure modes this table protects against: **licence contamination** (GPL/AGPL linked
into a permissive binary), **cross-platform breakage** (system OpenSSL, GTK) and **bit-rot**
(popular but unmaintained crates).

## Canonical table

### Web / HTTP / API

| Domain | Pick | Reject | Why |
|---|---|---|---|
| HTTP server | `axum` 0.8 | `actix-web` 4 for greenfield; raw `hyper` | tokio/tower native, composes with every tower layer |
| HTTP client | `reqwest` 0.13 (rustls; `rustls-no-provider` to choose the crypto provider) | `surf`, `isahc`, `curl` | de facto standard, pure-Rust TLS |
| HTTP/3, QUIC | `quinn` 0.11 | `quiche` | pure Rust, tokio + rustls |
| WebSocket | `tokio-tungstenite` 0.30 | `ws` (unmaintained) | tokio native, Autobahn-clean |
| gRPC | `tonic` 0.14 + `prost` 0.14 | `grpcio` (C++ core) | pure Rust, hyper/tower based |
| GraphQL | `async-graphql` 7 | `juniper` | subscriptions, federation |
| OpenAPI | `utoipa` 6 (server docs); `progenitor` 0.15 (client codegen) | Java `openapi-generator` | derive macros, native Rust |

### Async runtime

| Domain | Pick | Reject | Why |
|---|---|---|---|
| Runtime | `tokio` 1 (`rt-multi-thread`, `macros`; `full` only in binaries) | `async-std` (discontinued); `smol` unless tiny | the ecosystem standard |
| Task sets | `tokio::task::JoinSet` | `Vec<JoinHandle>` | abort-on-drop, join_next |
| Streams | `futures` 0.3 + `tokio-stream` 0.1 | | full Stream/Sink |
| Cancellation | `tokio-util` 0.7 `CancellationToken` | ad-hoc `AtomicBool` flags | hierarchical, awaitable |
| Channels | `tokio::sync::{mpsc, oneshot, broadcast, watch}` | `crossbeam-channel` in async code | integrates with `select!` |
| Sync locks | `std::sync::Mutex` (fast since 1.62) or `parking_lot` 0.12 | holding any sync guard across `.await` | std is fine; parking_lot for fairness/no poisoning |

### Database / persistence

| Domain | Pick | Reject | Why |
|---|---|---|---|
| Postgres / MySQL / SQLite, SQL-first | `sqlx` 0.9 (`runtime-tokio`, `tls-rustls`, `macros`) | raw `tokio-postgres` for app code | compile-time-checked `query!` |
| ORM | `sea-orm` 2 (async) or `diesel` 2.3 + `diesel-async` 0.9 | sync `diesel` inside async handlers | pick an ORM only if dynamic queries need it |
| Migrations | `sqlx-cli` (with sqlx) / `diesel_cli` | | matches the query layer |
| Embedded KV | `redb` 4 (B-tree, ACID) or `fjall` 3 (LSM, write-heavy) | `sled` (0.34 frozen since 2021, 1.0 never shipped); `lmdb-rkv` | maintained, pure Rust |
| SQLite (sync) | `rusqlite` 0.40 with `bundled` | system libsqlite | no version drift |
| Redis | `redis` 1.7 (`tokio-comp`, cluster) | `fred` (no release since 2025-02); `darkredis` | maintained, async, cluster |
| In-process analytics | `duckdb` (crate versions track DuckDB, e.g. 1.10506 = DuckDB 1.5.x) | shelling out to Python | columnar, embedded |

### Crypto / TLS

| Domain | Pick | Reject | Why |
|---|---|---|---|
| TLS | `rustls` 0.23 with `aws-lc-rs` (default) or `ring` 0.17 provider | `native-tls` / `openssl` | no system OpenSSL; same behaviour on all OSes |
| Hash | `sha2` 0.11 (general), `blake3` 1.8 (speed) | OpenSSL digests | RustCrypto, SIMD |
| AEAD | `aes-gcm` 0.11, `chacha20poly1305` 0.11 | OpenSSL EVP | constant-time, RustCrypto traits |
| Signatures / KEX | `ed25519-dalek` 3, `x25519-dalek` 3 | hand-rolled | audited |
| Password hashing | `argon2` 0.6 | `bcrypt` for new schemes | OWASP recommendation |
| Random | `rand` 0.10 (or `getrandom` 0.3 for raw bytes) | mixing rand majors in one workspace | rand 0.10 renamed several APIs; check the changelog when bumping |
| JWT | `jsonwebtoken` 11 (enable one crypto backend feature: `aws_lc_rs` or `rust_crypto`) | hand-rolled JWT | maintained, all common algs |

### Serialisation / parsing / formats

| Domain | Pick | Reject | Why |
|---|---|---|---|
| JSON | `serde` 1 + `serde_json` 1 | | universal |
| YAML | `yaml_serde` 0.10 (official YAML-org fork; `serde_yaml = { package = "yaml_serde", version = "0.10" }` keeps imports) | `serde_yaml` (archived 2024), `serde_yaml_ng`, `yaml-rust` (RustSec unmaintained) | maintained |
| TOML | `toml` 1 (plain parse); `toml_edit` (format-preserving edits) | | `toml` reached 1.0 (TOML 1.1 spec) |
| Compact binary | `postcard` 1 (also no_std), `bitcode` 0.6, `wincode` 0.6, or `rkyv` 0.8 (zero-copy) | `bincode` (RUSTSEC-2025-0141: development ceased; 3.0.0 is a tombstone, 1.3.3 frozen) | maintained alternatives listed by RustSec |
| CBOR | `ciborium` 0.2 | `serde_cbor` (RustSec unmaintained) | |
| MessagePack | `rmp-serde` 1.3 | `msgpack` | serde compatible |
| Protobuf | `prost` 0.14 | `protobuf` v2 | tonic-aligned |
| ELF/PE/Mach-O | `goblin` 0.10 (high level) or `object` 0.40 (read/write, used by the toolchain) | `elf` crate | |
| Disassembly | `iced-x86` 1.21 (x86/x64), `capstone` 0.14 (multi-arch) | `unicorn-engine` (GPL-2.0), `radare2` bindings (LGPL/GPL) | permissive licences |
| PDB symbols | `pdb` 0.8 (stable but no release since 2022; `pdb-addr2line` for lookups) | hand-parsing MSF | |
| Compression | `zstd` 0.14, `flate2` 1.1, `lz4_flex` 0.14 | C bindings when pure Rust exists | |
| Archives | `tar` >= 0.4.45 (RUSTSEC-2026-0067/0068, CVE-2026-33056), `zip` 8 | older `tar`, `zip` < 2 | symlink/permission fixes |
| Byte search | `memchr` 2.8, `aho-corasick` 1.1 | hand-rolled SIMD | |

### CLI / config / observability / agents

| Domain | Pick | Reject | Why |
|---|---|---|---|
| Arguments | `clap` 4.6 (`derive`, `env`) | `structopt` (merged into clap) | completions, man pages |
| Embedded shell | `nu-cli` / `nu-protocol` 0.116 (Nushell crates; versions move in lockstep, bump all together) | hand-rolled DSL | structured pipelines |
| MCP server/client | `rmcp` 3 (official Rust SDK; features e.g. `server`, `transport-io`, `transport-streamable-http-server`, `macros`) | hand-rolled JSON-RPC | spec-tracking SDK |
| System info | `sysinfo` 0.39 (disable default features, enable `system`/`disk` etc.) | parsing `/proc` or WMI by hand | cross-platform |
| Layered config | `figment` 0.10 or `config` | hand-rolled merge | file + env + CLI layers |
| Errors | `anyhow` 1 (apps), `thiserror` 2 (libs) | `failure`, `error-chain` (archived) | |
| Logging | `tracing` 0.1 + `tracing-subscriber` 0.3 (`env-filter`) | `log` + `env_logger` for new apps | spans, structured fields |
| OpenTelemetry | `opentelemetry` 0.33 + `tracing-opentelemetry` 0.34 (keep the pair in sync) | raw Jaeger clients | vendor-neutral |
| Metrics | `metrics` 0.24 + `metrics-exporter-prometheus` 0.18 | `prometheus` crate directly | facade, swappable backend |
| Lazy statics | `std::sync::LazyLock` / `OnceLock` | `lazy_static`, `once_cell::sync::Lazy` | in std since 1.80 |
| Retry/backoff | `backon` | `backoff` (RustSec unmaintained) | |
| Human-readable durations | `jiff` 0.2 (`SignedDuration` / `Span` parse "1h 30m") | `humantime` (RustSec unmaintained) | |

### Terminal / TUI

| Domain | Pick | Reject | Why |
|---|---|---|---|
| TUI | `ratatui` 0.30 | `tui` (archived), `cursive` | active, large widget ecosystem |
| Terminal I/O | `crossterm` 0.29 | `termion` (Unix only) | Windows support |
| ANSI parsing | `vte` 0.15 | hand-rolled state machine | |
| Progress bars | `indicatif` 0.18 | | |
| Line editor | `reedline` 0.52 or `rustyline` | | |
| Colours | `owo-colors` 4, `anstream`/`anstyle` (what clap uses) | `atty` (RustSec unsound/unmaintained; use `std::io::IsTerminal`) | |

### GUI / desktop / web

| Domain | Pick | Reject | Why |
|---|---|---|---|
| Web-UI desktop app | `tauri` 2.12 (+ official v2 plugins). Tauri 3.0 is in alpha (3.0.0-alpha.x since 2026-09); use it only if the project already does | Electron | small binaries, capability-based permissions |
| Windowing | `winit` 0.30 | `glutin` alone | raw-window-handle |
| GPU | `wgpu` 30 | raw Vulkan/GL | one API for Vulkan/Metal/DX12/WebGPU |
| Immediate-mode GUI | `egui` 0.36 + `eframe` | | fastest to iterate |
| Retained / Elm-style GUI | `iced` 0.14, or `slint` | | |
| Web front-end in Rust | `leptos` 0.8 or `dioxus` 0.7 | `yew` | fine-grained reactivity |
| Raw webview | `wry` 0.57 (via Tauri when possible) | unisolated custom webviews | |

On Linux, `wry`/`tao` (and so Tauri) depend on WebKitGTK and the gtk-rs GTK3 bindings,
which RustSec flags as unmaintained (RUSTSEC-2024-0411 and following, dated 2024-03-04). This is an accepted,
documented exception for Tauri apps; add targeted `ignore` entries in `deny.toml` with a
reason rather than avoiding Tauri. For GTK-free native UI use `egui`/`iced`/`slint` on `wgpu`.

### Networking / IPC

| Domain | Pick | Reject | Why |
|---|---|---|---|
| DNS | `hickory-resolver` 0.26 | `trust-dns-resolver` (renamed) | |
| Raw sockets | `socket2` 0.6 | `nix::sys::socket` directly | cross-platform |
| MQTT | `rumqttc` 0.25 | `paho-mqtt` (C FFI) | pure Rust |
| no_std RPC framing | `postcard` 1 | | |

### Testing / quality

| Domain | Pick | Reject | Why |
|---|---|---|---|
| Runner | `cargo-nextest` | plain `cargo test` for large suites | process isolation, retries |
| Snapshots | `insta` 1.48 | hand-rolled diffs | `cargo insta review` |
| Property tests | `proptest` 1.11 | `quickcheck` | shrinking strategies |
| Mocks | `mockall` 0.15 | | trait codegen |
| Benchmarks | `criterion` 0.8 (or `divan`) | unstable `#[bench]` | statistics |
| Coverage | `cargo-llvm-cov` | `tarpaulin` | source-based |
| Fuzzing | `cargo-fuzz`, `afl` | | |

### AI / ML

Model-runtime crates churn too fast for a static table. Check the project for an existing
owner first (an inference, embedding or RAG crate already in the workspace); otherwise
consult current docs (the `docs` skill) for `ort` (ONNX Runtime), `candle`, `llama-cpp-2`,
`fastembed`, and pick one with an active release in the last six months.

**In the Aphrody monorepo** (root `package.json` named `aphrody`): the canonical AI stack is
`docs/reference/infra/BEST-AI-STACK-CANONICAL.md`, and existing owners come first:
`aphrody-llama-server` (llama.cpp supervisor), `aphrody-infer`, `aphrody-embed`,
`aphrody-rag` / `aphrody-rag-core`, `aphrody-engine` / `aphrody-agent-runtime`,
`aphrody-sandbox` / `aphrody-execpolicy`, `aphrody-a2a*`, `aphrody-mcp` (+ `rmcp`),
`aphrody-train`; binary analysis lives in `aphrody-re` (`crates/os/re`).

## Anti-patterns (flag, recommend, let the user override)

| User proposes | Issue | Recommend |
|---|---|---|
| `openssl` / `native-tls` | system OpenSSL drift on Linux, absent on Windows, large CVE surface | `rustls` 0.23 (`aws-lc-rs` is FIPS-validated if FIPS is required) |
| `actix-web` for greenfield | separate middleware model from tower; smaller ecosystem today | `axum` 0.8 |
| `tokio` 0.2/0.3, `hyper` 0.14 | pre-1.0 / old major APIs | `tokio` 1, `hyper` 1 or `axum` |
| `async-std` | discontinued | `tokio` 1 (or `smol`) |
| `unicorn-engine`, radare2 bindings | GPL/LGPL contamination of a permissive binary | `iced-x86`/`capstone` + `goblin`; emulate out of process if unavoidable |
| `serde_yaml`, `serde_yaml_ng`, `yaml-rust` | archived / frozen / unmaintained | `yaml_serde` 0.10 |
| `bincode` | RUSTSEC-2025-0141, development ceased | `postcard`, `bitcode`, `wincode`, `rkyv` |
| `sled` | 0.34 frozen, 1.0 never released | `redb` or `fjall` |
| `chrono` with default features | pulls unneeded features | `chrono` with `default-features = false, features = ["clock", "serde"]`, or `jiff` 0.2 for new code |
| `time` 0.1/0.2 | pre-1.0, no time zones | `time` 0.3 or `jiff` 0.2 |
| `failure`, `error-chain` | archived | `anyhow` + `thiserror` |
| `lazy_static`, `once_cell::sync::Lazy` | in std since 1.80 | `std::sync::LazyLock` |
| `atty`, `paste`, `proc-macro-error`, `instant`, `derivative`, `backoff`, `humantime`, `rustls-pemfile` | RustSec unmaintained notices | `std::io::IsTerminal`, `pastey`, `proc-macro-error2`, `web-time`, `derive-where`/`educe`, `backon`, `jiff`, `rustls-pki-types` PEM API |
| `dotenv` | RUSTSEC-2021-0141 unmaintained, loading only | `dotenvy` for loading; `figment` for typed config |

Longer rationales for pushback ("why not openssl, everyone uses it?") are in
`references/anti-patterns.md`.

## Answer template

```text
For X in Rust: use **{crate} {major}** ({one-line rationale}).
Reject: {alternative} ({one-line reason}).

[dependencies]
{crate} = { version = "{major}", features = [...] }

Cross-platform: {Linux/Windows/macOS/wasm caveat if any}. Licence: {SPDX}.
```

For multi-domain questions ("REST API with auth and Postgres"), give one block per domain in
build-up order: runtime, server, database, auth, observability. If the user insists on a
rejected crate, accept it and state the watch-point in one sentence.

## Output discipline

- Always give a version (major or caret range) and the rejected alternative.
- Refuse GPL/AGPL crates for permissively licensed projects, stating the contamination risk.
- Never present a version from this table as "latest" without checking when the answer is
  version-sensitive; say "as of 2026-10" otherwise.
- If a crate discovery tool is available (an `awesome_search` MCP tool, `cargo search`,
  lib.rs), use it for domains this table does not cover.
