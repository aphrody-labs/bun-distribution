// SPDX-License-Identifier: Apache-2.0
//! Font qualification: the axis tables of `google_sans_flex` / `google_sans_code` equal the
//! `fvar` table of the embedded Google Sans fonts, and of the upstream files pinned in
//! `m3/packages/m3-fonts/fonts.lock.json` when `fonts-sync` has fetched them.
#![cfg(feature = "std")]

use std::path::Path;

use aphrody_m3_tokens::google_sans_code::{CODE_ALL_AXES, CODE_TTF_DATA, CODE_WGHT};
use aphrody_m3_tokens::google_sans_flex::{ALL_AXES, Axis, TTF_DATA};
use read_fonts::{FontRef, TableProvider};

/// `(tag, min, default, max)` of every `fvar` axis.
fn fvar_axes(data: &[u8]) -> Vec<(String, f32, f32, f32)> {
    let font = FontRef::new(data).expect("sfnt");
    let fvar = font.fvar().expect("fvar table");
    fvar.axes()
        .expect("fvar axes")
        .iter()
        .map(|axis| {
            (
                axis.axis_tag().to_string(),
                axis.min_value().to_f32(),
                axis.default_value().to_f32(),
                axis.max_value().to_f32(),
            )
        })
        .collect()
}

fn assert_axes(label: &str, data: &[u8], expected: &[&Axis]) {
    let mut actual = fvar_axes(data);
    actual.sort_by(|a, b| a.0.cmp(&b.0));
    let mut ours: Vec<_> = expected
        .iter()
        .map(|axis| (axis.tag.to_owned(), axis.min, axis.default, axis.max))
        .collect();
    ours.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(actual, ours, "{label}: fvar axes differ from the Rust axis table");
}

fn upstream(dest: &str) -> Option<Vec<u8>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../m3/packages/m3-fonts/fonts/upstream")
        .join(dest);
    std::fs::read(path).ok()
}

#[test]
fn google_sans_flex_axes_match_fvar() {
    assert_axes("embedded GoogleSansFlex", TTF_DATA, &ALL_AXES);
    if let Some(data) = upstream("google-sans-flex/GoogleSansFlex-Variable.ttf") {
        assert_axes("pinned upstream GoogleSansFlex", &data, &ALL_AXES);
    }
}

#[test]
fn google_sans_code_axes_match_fvar() {
    assert_axes("embedded GoogleSansCode", CODE_TTF_DATA, &CODE_ALL_AXES);
    // The google/fonts build pinned in fonts.lock.json (fork commit 9710da1e) only carries
    // `wght`; the embedded file is a different build that adds `MONO`.
    if let Some(data) = upstream("google-sans-code/GoogleSansCode-Variable.ttf") {
        assert_axes("pinned upstream GoogleSansCode", &data, &[&CODE_WGHT]);
    }
}
