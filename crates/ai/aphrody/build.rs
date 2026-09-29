// SPDX-License-Identifier: Apache-2.0
//
// Build script — emits compile-time env vars consumed by VersionCommand
// (commit sha, build epoch, target triple). No external deps; calls git
// directly. Falls back to "unknown" if git is missing or this is a tarball
// build (no .git tree).

use std::process::Command;

/// Main-thread stack reserved for the `aphrody` binaries on Windows (8 MiB).
const MAIN_STACK_BYTES: u64 = 8 * 1024 * 1024;

fn main() {
    let sha = Command::new("git")
        .args(["rev-parse", "--short=10", "HEAD"])
        .output()
        .ok()
        .and_then(|o| if o.status.success() { String::from_utf8(o.stdout).ok() } else { None })
        .map_or_else(|| "unknown".to_string(), |s| s.trim().to_string());
    println!("cargo:rustc-env=APHRODY_GIT_SHA={sha}");

    let unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    println!("cargo:rustc-env=APHRODY_BUILD_UNIX={unix}");

    let target = std::env::var("TARGET").unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=APHRODY_TARGET={target}");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "unknown".into());
    // Keep build metadata separate from the public runtime profile selector.
    // Cargo forwards rustc-env values to `cargo run`/tests; reusing
    // APHRODY_PROFILE here would overwrite the operator's Home Agent profile.
    println!("cargo:rustc-env=APHRODY_BUILD_PROFILE={profile}");

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
            "msvc" => println!("cargo:rustc-link-arg-bins=/STACK:{MAIN_STACK_BYTES}"),
            "gnu" => println!("cargo:rustc-link-arg-bins=-Wl,--stack,{MAIN_STACK_BYTES}"),
            _ => {},
        }
    }

    // Rerun on next build when the commit changes or this script changes.
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs");
}
