// SPDX-License-Identifier: Apache-2.0
//! Golden test: every mirrored `md.comp.*` token equals the pinned Google value.
//!
//! Sources: `tests/fixtures/google/material-web/_md-comp-*.scss` (material-web v2.5.0, design
//! system 34.0.21), pinned by sha256 in `tests/fixtures/google/PROVENANCE.json`. References to
//! system tokens are resolved through the pinned `_md-sys-*.scss` files, never through the Rust
//! tables under test.
#![cfg(feature = "std")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aphrody_m3_tokens::component::{ALL, TokenValue};
use aphrody_m3_tokens::{scheme::Role, shape};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/google")
}

/// `$name: value;` declarations of one Google Sass token file.
fn sass_vars(file: &str) -> BTreeMap<String, String> {
    let path = fixtures().join("material-web").join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    text.lines()
        .filter_map(|line| line.strip_prefix('$'))
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| {
            (name.trim().to_owned(), value.trim().trim_end_matches(';').trim().to_owned())
        })
        .filter(|(_, value)| !value.ends_with("null"))
        .collect()
}

fn number(text: &str, unit: &str) -> Option<f32> {
    text.strip_suffix(unit)?.parse().ok()
}

/// A Google value resolved to the shape of [`TokenValue`].
#[derive(Debug, PartialEq)]
enum Google {
    Px(f32),
    Number(f32),
    Percent(f32),
    Role(Role),
    Shape { name: String, px: f32 },
    Elevation(u8),
    Type(String),
}

struct Sys {
    shape: BTreeMap<String, String>,
    state: BTreeMap<String, String>,
    motion: BTreeMap<String, String>,
    elevation: BTreeMap<String, String>,
    focus: BTreeMap<String, String>,
}

impl Sys {
    fn load() -> Self {
        Self {
            shape: sass_vars("_md-sys-shape.scss"),
            state: sass_vars("_md-sys-state.scss"),
            motion: sass_vars("_md-sys-motion.scss"),
            elevation: sass_vars("_md-sys-elevation.scss"),
            focus: sass_vars("_md-sys-state-focus-indicator.scss"),
        }
    }

    fn resolve(&self, local: &BTreeMap<String, String>, raw: &str) -> Google {
        let lookup = |table: &BTreeMap<String, String>, key: &str| {
            table.get(key).cloned().unwrap_or_else(|| panic!("unresolved Google reference {raw}"))
        };
        if let Some(role) = raw.strip_prefix("md-sys-color.$") {
            return Google::Role(Role::from_name(role).unwrap_or_else(|| panic!("role {role}")));
        }
        if let Some(key) = raw.strip_prefix("md-sys-shape.$") {
            let px = number(&lookup(&self.shape, key), "px").expect("shape px");
            let name = key.trim_start_matches("corner-").trim_start_matches("value-").to_owned();
            return Google::Shape { name, px };
        }
        if let Some(key) = raw.strip_prefix("md-sys-state.$") {
            return Google::Number(lookup(&self.state, key).parse().expect("state number"));
        }
        if let Some(key) = raw.strip_prefix("md-sys-motion.$") {
            return Google::Number(lookup(&self.motion, key).parse().expect("motion number"));
        }
        if let Some(key) = raw.strip_prefix("md-sys-elevation.$level") {
            assert!(self.elevation.contains_key(&format!("level{key}")), "{raw}");
            return Google::Elevation(key.parse().expect("elevation level"));
        }
        if let Some(key) = raw.strip_prefix("md-sys-state-focus-indicator.$") {
            return Google::Px(number(&lookup(&self.focus, key), "px").expect("focus px"));
        }
        if let Some(key) = raw.strip_prefix("md-sys-typescale.$") {
            let name = key.strip_suffix("-size").unwrap_or_else(|| panic!("typescale {raw}"));
            return Google::Type(name.to_owned());
        }
        if let Some(key) = raw.strip_prefix('$') {
            return self.resolve(local, &lookup(local, key));
        }
        if let Some(px) = number(raw, "px") {
            return Google::Px(px);
        }
        if let Some(percent) = number(raw, "%") {
            return Google::Percent(percent);
        }
        Google::Number(raw.parse().unwrap_or_else(|_| panic!("unsupported Google value {raw}")))
    }
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() <= 1e-4
}

fn matches(ours: TokenValue, google: &Google) -> bool {
    match (ours, google) {
        (TokenValue::Dp(dp), Google::Px(px)) => close(dp, *px),
        (TokenValue::Role(role), Google::Role(theirs)) => role == *theirs,
        (TokenValue::Opacity(n) | TokenValue::Number(n), Google::Number(theirs)) => {
            close(n, *theirs)
        },
        (TokenValue::Percent(p), Google::Percent(theirs)) => close(p, *theirs),
        (TokenValue::Elevation(level), Google::Elevation(theirs)) => level == *theirs,
        (TokenValue::Type(name), Google::Type(theirs)) => name == theirs,
        (TokenValue::Shape(corner), Google::Shape { name, px }) => {
            let ours_name = shape::ALL
                .iter()
                .zip(shape::NAMES)
                .find(|(token, _)| **token == corner)
                .map(|(_, name)| name);
            ours_name == Some(name.as_str()) && close(f32::from(corner.dp), *px)
        },
        // Google sometimes publishes a literal size where we reuse the shape scale value.
        (TokenValue::Dp(dp), Google::Shape { px, .. }) => close(dp, *px),
        _ => false,
    }
}

#[test]
fn component_tokens_match_google_material_web() {
    let sys = Sys::load();
    let mut failures = Vec::new();
    let mut declared = 0usize;
    let mut published = 0usize;
    for table in ALL {
        let local = sass_vars(&format!("_md-comp-{}.scss", table.component));
        published += local.len();
        declared += table.tokens.len();
        for token in table.tokens {
            let Some(raw) = local.get(token.name) else {
                failures
                    .push(format!("{}.{}: not in the Google file", table.component, token.name));
                continue;
            };
            let google = sys.resolve(&local, raw);
            if !matches(token.value, &google) {
                failures.push(format!(
                    "{}.{}: ours {:?}, Google {raw} = {google:?}",
                    table.component, token.name, token.value
                ));
            }
        }
        eprintln!(
            "md.comp.{}: {}/{} tokens mirrored",
            table.component,
            table.tokens.len(),
            local.len()
        );
    }
    eprintln!("total: {declared}/{published} Google component tokens mirrored and verified");
    assert!(failures.is_empty(), "component tokens diverge from Google:\n{}", failures.join("\n"));
}

#[test]
fn every_table_has_a_pinned_source() {
    let provenance: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures().join("PROVENANCE.json")).expect("provenance"),
    )
    .expect("provenance json");
    let files = provenance["files"].as_array().expect("files");
    for table in ALL {
        let path = format!("material-web/_md-comp-{}.scss", table.component);
        assert!(
            files.iter().any(|file| file["path"] == path.as_str()),
            "{path} is not pinned in PROVENANCE.json"
        );
    }
}
