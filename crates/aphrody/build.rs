// SPDX-License-Identifier: Apache-2.0
//! Binary-specific Windows link settings: main-thread stack reservation and `/OPT:NOICF`.
const MAIN_STACK_BYTES: u64 = 8 * 1024 * 1024;
fn main() {
    // Main-thread stack for the `aphrody` binaries on Windows. `main` builds
    // the whole clap command tree and drives deep async state machines on the
    // main thread; Windows reserves 1 MiB for it (Linux and macOS: 8 MiB), and
    // a debug build overflows it before printing anything (0xC00000FD on
    // `aphrody version`). Reserve 8 MiB, the value the former monolith passed
    // through its `.cargo/config.toml`, so the fix travels with the crate
    // instead of depending on a workspace-level linker configuration.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" {
        match target_env.as_str() {
            "msvc" => {
                println!("cargo:rustc-link-arg-bins=/STACK:{MAIN_STACK_BYTES}");
                // V8 (via aphrody-kernel -> Obscura): identical COMDAT folding merges distinct
                // external references and V8 aborts at startup; keep /OPT:REF, disable ICF.
                println!("cargo:rustc-link-arg-bins=/OPT:NOICF");
            }
            "gnu" => println!("cargo:rustc-link-arg-bins=-Wl,--stack,{MAIN_STACK_BYTES}"),
            _ => {}
        }
    }
}
