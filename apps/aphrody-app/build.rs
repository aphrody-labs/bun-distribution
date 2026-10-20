// SPDX-License-Identifier: Apache-2.0
//! Tauri build hook: generates the capability schemas + embeds the config so
//! `tauri::generate_context!()` in `src/lib.rs` has everything it needs.
//!
//! It also stages the binary assets of `ui-dist/fonts` (Google Sans Flex, Roboto Flex, Noto Sans
//! JP, M PLUS 1 Code, Material Symbols, the file-kind icons and sounds). They are committed
//! once, in their canonical packages, and copied here into the directory that Tauri embeds, so a
//! clean clone builds without any staging command (`ui-dist.manifest` lists every pair).

use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process,
};

/// `<destination under ui-dist/> <source under the repository root>`, one pair per line.
const UI_DIST_MANIFEST: &str = include_str!("ui-dist.manifest");

fn main() {
    stamp_build_identity();
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    println!("cargo:rerun-if-changed=ui-dist.manifest");
    // libcef must be the first DT_NEEDED entry of the executable. Chromium resolves libc functions
    // with `dlsym(RTLD_NEXT, ..)` from inside libcef at startup (`close symbol missing`, then a
    // trap): a libc that the link map lists before libcef is invisible to it. Native libraries of
    // the final crate are linked before those of its dependencies, which put `-lstdc++ -lc` (native
    // C++ dependencies) ahead of the `-lcef` that `cef-dll-sys` emits.
    if env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "linux") {
        println!("cargo:rustc-link-lib=dylib=cef");
    }
    // `frontendDist` is generated from the root `packages/app-ui` into
    // ui-dist. Track the generated entry files (not the staged fonts, which are tracked per source
    // below) so Cargo/Tauri re-embed after a UI rebuild.
    for generated in ["ui-dist/index.html", "ui-dist/app.js", "ui-dist/app.css"] {
        println!("cargo:rerun-if-changed={generated}");
    }

    // Must run before `tauri::generate_context!()` expands (it walks `ui-dist` once).
    stage_ui_dist_assets();

    // The CEF runtime keeps control of DPI awareness; the manifest carries CEF's compatibility section.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to build Tauri resources");
}

/// Output of `program args`, or `unknown` when it fails or prints nothing.
fn command_output(program: &str, args: &[&str]) -> String {
    process::Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|output| !output.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

/// Build identity answered by `--host-info` (`src/runtime_host.rs`): target, Git revision, rustc.
fn stamp_build_identity() {
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=YOLO_DESKTOP_TARGET={target}");
    println!(
        "cargo:rustc-env=YOLO_DESKTOP_GIT_REV={}",
        command_output("git", &["rev-parse", "HEAD"])
    );
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    println!(
        "cargo:rustc-env=YOLO_DESKTOP_RUSTC={}",
        command_output(&rustc, &["--version"])
    );
    for name in ["HEAD", "packed-refs"] {
        println!(
            "cargo:rerun-if-changed={}",
            command_output("git", &["rev-parse", "--git-path", name])
        );
    }
    let branch = command_output("git", &["symbolic-ref", "-q", "HEAD"]);
    if branch != "unknown" {
        println!(
            "cargo:rerun-if-changed={}",
            command_output("git", &["rev-parse", "--git-path", &branch])
        );
    }
}

/// Copy every `ui-dist.manifest` source over its missing or different destination.
///
/// A source that cannot be read never fails a plain `cargo check`/`cargo build`: the destination
/// that is already there (an older staging, a legacy checkout) is kept. A destination that stays
/// missing is a warning, and an error when the shipped configuration (`custom-protocol`, which
/// serves the embedded `ui-dist`) is being built, because the webview would lose its fonts.
fn stage_ui_dist_assets() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let repository_root = manifest_dir.join("../..");
    let ui_dist = manifest_dir.join("ui-dist");

    let mut missing: Vec<String> = Vec::new();
    for line in UI_DIST_MANIFEST.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((destination, source)) = line.split_once(' ') else {
            panic!("ui-dist.manifest: expected `<destination> <source>`, got {line:?}");
        };
        let source = repository_root.join(source.trim());
        let destination = ui_dist.join(destination.trim());
        println!("cargo:rerun-if-changed={}", source.display());
        if let Err(error) = sync_file(&source, &destination)
            && !destination.is_file()
        {
            missing.push(format!("{} ({error})", destination.display()));
        }
    }

    if !missing.is_empty() {
        let shown: Vec<&str> = missing.iter().take(3).map(String::as_str).collect();
        let message = format!(
            "aphrody-app: {} ui-dist asset(s) are not staged from their canonical packages \
             (see ui-dist.manifest), e.g. {}",
            missing.len(),
            shown.join("; ")
        );
        assert!(
            env::var_os("CARGO_FEATURE_CUSTOM_PROTOCOL").is_none(),
            "{message}"
        );
        println!("cargo:warning={message}");
    }
}

/// Make `destination` byte-identical to `source`, writing only when they differ.
///
/// The copy goes through a sibling file and a rename, so a concurrent build (rust-analyzer, a
/// second target directory) never sees a half-written font and Tauri never embeds one.
fn sync_file(source: &Path, destination: &Path) -> io::Result<()> {
    let bytes = fs::read(source)?;
    if fs::read(destination).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut name = destination.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".partial-{}", process::id()));
    let partial = destination.with_file_name(name);
    let result = fs::write(&partial, &bytes).and_then(|()| fs::rename(&partial, destination));
    if result.is_err() {
        // Best effort: a leftover would be embedded by Tauri, which walks the whole directory.
        let _ = fs::remove_file(&partial);
    }
    result
}
