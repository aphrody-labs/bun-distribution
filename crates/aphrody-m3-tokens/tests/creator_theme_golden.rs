// SPDX-License-Identifier: Apache-2.0
//! Golden check of the creator site theme.
//!
//! `packages/infra/product/resources/creator/site/theme.json` is the
//! [`ThemeExport`](aphrody_m3_tokens::theme::ThemeExport) of the logo seed (`#951ae2`) in the
//! `fidelity` variant at contrast 0; the site build (`build.ts`) turns it into `theme.css`.
//! Rewrite it with `APHRODY_UPDATE_TOKENS=1 scripts/build/rust/cargo-serial.sh test -p
//! aphrody-m3-tokens --test creator_theme_golden`.

#![cfg(feature = "std")]

use std::{fs, path::PathBuf};

use aphrody_m3_tokens::theme::ThemeRequest;
use serde_json::json;

const SEED: &str = "#951ae2";
const PATH: &str = "packages/infra/product/resources/creator/site/theme.json";

fn export_json() -> String {
    let export = ThemeRequest::parse(Some(SEED), Some("fidelity"), Some(0.0))
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

#[test]
fn creator_theme_export_is_current() {
    let expected = export_json();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docs/material/cargo")
        .join(PATH);
    if std::env::var_os("APHRODY_UPDATE_TOKENS").is_some() {
        fs::write(&path, &expected).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
        return;
    }
    let actual =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    assert!(
        actual == expected,
        "{PATH} is stale; regenerate with APHRODY_UPDATE_TOKENS=1 (see this file's docs)"
    );
}
