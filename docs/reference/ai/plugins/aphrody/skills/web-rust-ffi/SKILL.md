---
name: web-rust-ffi
description: "Bun-Rust FFI in Aphrody Web: cdylib extern C, lol_html, V8, x-client/x-algorithm, workspace rusqlite, tokio in FFI, cross-platform builds."
metadata:
  short-description: Implement safe cross-platform Aphrody Web Rust FFI.
---

# Aphrody Web Rust FFI (cdylib for Bun)

The hot path of aphrody web lives in Rust, exposed to Bun via cdylib + N-API style FFI (or raw extern "C" with bun:ffi or manual).

## Crate Layout (in rust-bridge/)
- `crates/aphrody-web-ffi` (the cdylib exporting the bxc_* C symbols; library name `bxc_rust_bridge`)
- `crates/aphrody-x` (native X GraphQL/REST + rusqlite store + ranking helpers)
- crates/x-algorithm (pure Rust port of xai-org/x-algorithm For You ranking, used via FFI or re-exported)

## Critical Rules
- **Single rusqlite**: libsqlite3-sys "links" = "sqlite3". Only one version of rusqlite (0.37) can be linked in the cdylib. All crates in the workspace must use `{ workspace = true }` for rusqlite.
- **Workspace Cargo.toml**: Define [workspace.dependencies] rusqlite = { version = "0.37", features = ["bundled"] } etc. Use in member crates.
- **no_mangle + extern "C"**: For symbols called from Bun (or via the bridge lib).
- **Async in FFI**: Use tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(...) inside the extern "C" fn. Never leak runtimes.
- **Error handling**: Return *mut c_char (JSON or null). Caller frees with CString.
- **Build**: `cargo build -p aphrody-web-ffi --release` (or via `bun run build:linux`). Output in rust-bridge/target/release/libbxc_rust_bridge.{so,dylib,dll}

## Cross-Platform Notes
- Linux: .so (default target)
- macOS: .dylib (x86_64-apple-darwin + aarch64-apple-darwin for universal if needed)
- Windows: .dll (x86_64-pc-windows-msvc). Also produce .exe for standalone tools.
- In Bun code: use `dlopen` with platform-specific name or `process.platform` + `process.arch` to pick the right file. Provide `BXC_RUST_BRIDGE_LIB` override.

## Common FFI Pattern (from Aphrody Web)
```rust
#[no_mangle]
pub extern "C" fn aphrody_x_algorithm_rank(
    candidates_json: *const c_char,
    context_json: *const c_char,
    top_k: i32,
) -> *mut c_char {
    // parse with serde, call pure algo, return CString::new(json).unwrap().into_raw()
}
```

Bun side lazily dlopen the lib on first use; falls back to pure JS for some paths (title, stripTags, markdown) if cdylib missing.

## When adding new Rust functionality
1. Add or extend a crate under rust-bridge/crates/
2. Export via the main cdylib lib.rs (re-export or thin wrapper)
3. Add TS declarations in rust-bridge/src/ or the consuming package
4. Update build scripts and CLAUDE.md / plugin docs
5. Add tests (cargo test in the crate + Bun test that exercises the FFI path)
6. Document in the skill or references/

See `crates/aphrody-x` and `crates/aphrody-x-algorithm` for patterns (the ranking algorithm was split out of the client for clean separation).

Use the web-rust-ffi-reviewer agent for reviews.
