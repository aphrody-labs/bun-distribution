// SPDX-License-Identifier: Apache-2.0
#![allow(
    linker_messages,
    reason = "MSVC import-library progress is not a compiler diagnostic"
)]
//! `aphrody` binary entry point.
//!
//! A thin shell over the `aphrody` library crate (`src/lib.rs`): every command
//! lives in the library so the exact same surface is reachable in-process via
//! the `aphrody-ffi` cdylib (Bun `bun:ffi` / any C-ABI host), not only as a
//! spawned process. The global allocator is installed here (in the binary) so
//! the library stays allocator-agnostic and the `aphrody-ffi` cdylib can
//! install its own without a duplicate-`#[global_allocator]` error.

// mimalloc as the global allocator on native targets — fast multithreaded
// allocation for the tokio runtime + reqwest hot paths.
#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// glibc 2.43 gave `acosf` and `atan2f` new symbol versions; a binary linked on a newer host
/// imports `acosf@GLIBC_2.43` and no longer starts on glibc 2.39 (Ubuntu 24.04 user hosts). Defining
/// them in the executable resolves every reference at link time, so no versioned import is
/// left; `libm` is the musl implementation ported to Rust.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod glibc_compat {
    #[unsafe(no_mangle)]
    extern "C" fn acosf(x: f32) -> f32 {
        libm::acosf(x)
    }

    #[unsafe(no_mangle)]
    extern "C" fn atan2f(y: f32, x: f32) -> f32 {
        libm::atan2f(y, x)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() -> std::process::ExitCode {
    // Opt-in process hardening (disable core dumps, block ptrace attach, strip
    // LD_*/DYLD_* loader-injection env vars). DISABLED by default: aphrody runs
    // fully autonomous with guardrails off (cf. CLAUDE.md §0.1) unless
    // `APHRODY_GUARD=1` is set. No-op otherwise, and on wasm. Only the
    // standalone binary is hardened — never the `aphrody-ffi` cdylib, which runs
    // inside a host process (Bun) we must not strip or mark non-dumpable.
    aphrody_guard::pre_main_hardening_if_enabled();
    aphrody::run_native()
}

#[cfg(target_arch = "wasm32")]
fn main() {
    aphrody::run_wasm();
}
