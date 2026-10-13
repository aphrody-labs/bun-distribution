// SPDX-License-Identifier: Apache-2.0
//! Golden check of the Aphrody brand theme exports consumed by `@aphrody/app-ui`.
//!
//! `m3/packages/app-ui/src/generated/brand-theme{,-high-contrast}.json` are the
//! [`ThemeExport`](aphrody_m3_tokens::theme::ThemeExport) of the identity pet seed at contrast 0
//! and 1; `bun run brand` in app-ui turns them into `src/brand.css`. Rewrite them with
//! `APHRODY_UPDATE_TOKENS=1 scripts/build/rust/cargo-serial.sh test -p aphrody-m3-tokens --test
//! brand_theme_golden`.

#![cfg(feature = "std")]

use std::{fs, path::PathBuf};

use aphrody_m3_tokens::theme::ThemeRequest;
use serde_json::{Value, json};

fn pet_seed() -> String {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/mcu-pet.json")).unwrap();
    fixture["seed"].as_str().unwrap().to_owned()
}

fn export_json(contrast: f64) -> String {
    let export = ThemeRequest::parse(Some(&pet_seed()), Some("tonal-spot"), Some(contrast))
        .unwrap()
        .export();
    let value = json!({
        "schema_version": export.schema_version,
        "spec_version": export.spec_version,
        "seed": export.seed,
        "variant": export.variant,
        "contrast_level": export.contrast_level,
        "light": export.light,
        "dark": export.dark,
    });
    let mut text = serde_json::to_string_pretty(&value).unwrap();
    text.push('\n');
    text
}

fn check(relative: &str, expected: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(relative);
    if std::env::var_os("APHRODY_UPDATE_TOKENS").is_some() {
        fs::write(&path, expected).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
        return;
    }
    let actual =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    assert!(
        actual == expected,
        "{relative} is stale; regenerate with APHRODY_UPDATE_TOKENS=1 (see this file's docs)"
    );
}

#[test]
fn brand_theme_exports_are_current() {
    check(
        "m3/packages/app-ui/src/generated/brand-theme.json",
        &export_json(0.0),
    );
    check(
        "m3/packages/app-ui/src/generated/brand-theme-high-contrast.json",
        &export_json(1.0),
    );
}
