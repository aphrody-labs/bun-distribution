// SPDX-License-Identifier: Apache-2.0
#![cfg(feature = "svg")]

//! Pixel parity: rasterizes `aphrody_icons::icon_svg` output and Google's own
//! `materialsymbolsoutlined` SVG exports (`tests/fixtures/*.svg`, Apache-2.0, see
//! `tests/fixtures/LICENSE-NOTICE.txt`) at the same size with `aphrody_svg::diff` (resvg), and
//! requires every pixel to match exactly or differ by at most one 8-bit channel step
//! (anti-aliasing jitter), per-channel.

use aphrody_icons::{Axes, Style};

fn assert_pixel_perfect(name: &str, fixture_file: &str, axes: Axes) {
    let fixture_svg = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(fixture_file),
    )
    .unwrap_or_else(|e| panic!("reading fixture {fixture_file}: {e}"));

    let generated = aphrody_icons::icon_svg(name, Style::Outlined, axes, Some(24.0))
        .unwrap_or_else(|| panic!("{name}: aphrody-icons produced no SVG"));

    const RASTER_SIZE: u32 = 256;
    let report = aphrody_svg::diff::diff_svg(&fixture_svg, &generated, RASTER_SIZE, 1)
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    assert!(
        report.max_delta <= 1,
        "{name}: max per-channel delta {} > 1 ({} pixels differ)",
        report.max_delta,
        report.mismatched_pixels,
    );
}

#[test]
fn close_is_pixel_perfect() {
    assert_pixel_perfect("close", "close_default.svg", Axes::default());
}

#[test]
fn home_is_pixel_perfect() {
    assert_pixel_perfect("home", "home_default.svg", Axes::default());
}

#[test]
fn search_is_pixel_perfect() {
    assert_pixel_perfect("search", "search_default.svg", Axes::default());
}

#[test]
fn settings_is_pixel_perfect() {
    assert_pixel_perfect("settings", "settings_default.svg", Axes::default());
}

#[test]
fn favorite_default_is_pixel_perfect() {
    assert_pixel_perfect("favorite", "favorite_default.svg", Axes::default());
}

#[test]
fn favorite_fill1_is_pixel_perfect() {
    assert_pixel_perfect("favorite", "favorite_fill1.svg", Axes { fill: 1.0, ..Axes::default() });
}

#[test]
fn unknown_icon_name_returns_none() {
    assert!(
        aphrody_icons::icon_svg("not-a-real-icon-name", Style::Outlined, Axes::default(), None)
            .is_none()
    );
}

#[test]
fn icon_names_are_sorted_and_nonempty() {
    let names: Vec<&str> = aphrody_icons::icon_names(Style::Outlined).collect();
    assert!(names.len() > 4000, "expected thousands of Material Symbols, got {}", names.len());
    assert!(names.windows(2).all(|w| w[0] < w[1]), "icon_names should be sorted");
    assert!(names.contains(&"home"));
}
