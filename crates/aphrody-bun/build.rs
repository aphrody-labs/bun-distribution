// SPDX-License-Identifier: Apache-2.0
//! Locates the Material Symbols files that `src/icons` embeds.
//!
//! They have a single owner: Material's `packages/m3-fonts/fonts.lock.json` pins `material-symbols@0.44.8`
//! and `bun packages/m3/scripts/fonts-sync.ts` writes its files, verified by SHA-256, into the git-ignored
//! `packages/m3-fonts/fonts/upstream/material-symbols/`. `APHRODY_SYMBOLS_DIR` names another
//! directory with the same files (a packaged crate has no workspace around it).
//!
//! With every file present and matching its pin, the build sets `cfg(aphrody_symbols)` and
//! `APHRODY_SYMBOLS_DIR` for `include_bytes!`. Otherwise the crate still builds, warns, and icon
//! rendering reports `SvgError::FontsUnavailable`. An explicit `APHRODY_SYMBOLS_DIR` that lacks a
//! file or holds different bytes fails the build instead.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

/// Files read by `src/icons`, relative to the `material-symbols` directory.
const FILES: [&str; 7] = [
    "material-symbols-outlined.woff2",
    "material-symbols-rounded.woff2",
    "material-symbols-sharp.woff2",
    "outlined.css",
    "rounded.css",
    "sharp.css",
    "index.d.ts",
];

struct Pin {
    sha256: String,
    bytes: u64,
}

fn main() {
    println!("cargo::rustc-check-cfg=cfg(aphrody_symbols)");
    println!("cargo::rerun-if-env-changed=APHRODY_SYMBOLS_DIR");
    println!("cargo::rerun-if-env-changed=APHRODY_MATERIAL_CHECKOUT");

    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("set by cargo"));
    let workspace = manifest
        .ancestors()
        .nth(3)
        .expect("crates/ui/bun sits three levels down");
    let material = env::var_os("APHRODY_MATERIAL_CHECKOUT")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            workspace
                .parent()
                .expect("Aphrody workspace parent")
                .join("material")
        });
    let fonts_package = material.join("packages/m3-fonts");
    let lock = fonts_package.join("fonts.lock.json");
    let explicit = env::var_os("APHRODY_SYMBOLS_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from);
    let dir = explicit
        .clone()
        .unwrap_or_else(|| fonts_package.join("fonts/upstream/material-symbols"));

    if lock.is_file() {
        println!("cargo::rerun-if-changed={}", lock.display());
    }
    // Watch the nearest existing directory, never a missing path (Cargo reruns the script on
    // every build for one), so a later `fonts-sync` re-embeds the fonts.
    let floor = if explicit.is_some() {
        dir.parent().unwrap_or(&dir)
    } else {
        fonts_package.as_path()
    };
    if let Some(watch) = dir
        .ancestors()
        .take_while(|p| p.starts_with(floor))
        .find(|p| p.is_dir())
    {
        println!("cargo::rerun-if-changed={}", watch.display());
    }

    let pins = read_pins(&lock);
    match verify(&dir, pins.as_deref()) {
        Ok(()) => {
            let dir = dir.canonicalize().expect("verified directory exists");
            println!("cargo::rustc-env=APHRODY_SYMBOLS_DIR={}", dir.display());
            println!("cargo::rustc-cfg=aphrody_symbols");
        }
        Err(reason) if explicit.is_some() => {
            panic!("APHRODY_SYMBOLS_DIR={}: {reason}", dir.display());
        }
        Err(reason) => {
            println!(
                "cargo::warning=Material Symbols not embedded ({reason}); from the Material checkout run `bun packages/m3/scripts/fonts-sync.ts` \
                 or set APHRODY_SYMBOLS_DIR, then rebuild"
            );
        }
    }
}

/// Pins of the `material-symbols/*` entries of `fonts.lock.json`, or `None` without a lock
/// (packaged crate with an explicit directory).
fn read_pins(lock: &Path) -> Option<Vec<(String, Pin)>> {
    let text = fs::read_to_string(lock).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).expect("fonts.lock.json is JSON");
    let files = value["files"]
        .as_array()
        .expect("fonts.lock.json has a files array");
    Some(
        files
            .iter()
            .filter_map(|entry| {
                let name = entry["dest"].as_str()?.strip_prefix("material-symbols/")?;
                let pin = Pin {
                    sha256: entry["sha256"].as_str()?.to_owned(),
                    bytes: entry["bytes"].as_u64()?,
                };
                Some((name.to_owned(), pin))
            })
            .collect(),
    )
}

fn verify(dir: &Path, pins: Option<&[(String, Pin)]>) -> Result<(), String> {
    for name in FILES {
        let path = dir.join(name);
        let bytes = fs::read(&path).map_err(|_| format!("{} is missing", path.display()))?;
        let Some(pins) = pins else { continue };
        let pin = pins
            .iter()
            .find_map(|(pinned, pin)| (pinned == name).then_some(pin))
            .ok_or_else(|| format!("fonts.lock.json does not pin material-symbols/{name}"))?;
        let digest = hex(&Sha256::digest(&bytes));
        if bytes.len() as u64 != pin.bytes || digest != pin.sha256 {
            return Err(format!(
                "{} differs from its fonts.lock.json pin",
                path.display()
            ));
        }
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
