// SPDX-License-Identifier: Apache-2.0

//! Pixel parity: rasterizes `bun_rs::icons::icon_svg` output (the former `aphrody-icons` crate)
//! and Google's own `materialsymbolsoutlined` SVG exports (`tests/fixtures/icons/*.svg`,
//! Apache-2.0, see `tests/fixtures/icons/LICENSE-NOTICE.txt`) at the same size with `aphrody_svg::diff` (resvg), and
//! requires every pixel to match exactly or differ by at most one 8-bit channel step
//! (anti-aliasing jitter), per-channel. Without the embedded fonts (`build.rs` warns and
//! `bun_rs::icons::available()` is false) the font-dependent tests are reported as ignored.

use bun_rs::icons::{Axes, Style};

fn assert_pixel_perfect(name: &str, fixture_file: &str, axes: Axes) {
    let fixture_svg = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/icons")
            .join(fixture_file),
    )
    .unwrap_or_else(|e| panic!("reading fixture {fixture_file}: {e}"));

    let generated = bun_rs::icons::icon_svg(name, Style::Outlined, axes, Some(24.0))
        .unwrap_or_else(|| panic!("{name}: bun_rs::icons produced no SVG"));

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
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: from Material run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn close_is_pixel_perfect() {
    assert_pixel_perfect("close", "close_default.svg", Axes::default());
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn home_is_pixel_perfect() {
    assert_pixel_perfect("home", "home_default.svg", Axes::default());
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn search_is_pixel_perfect() {
    assert_pixel_perfect("search", "search_default.svg", Axes::default());
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn settings_is_pixel_perfect() {
    assert_pixel_perfect("settings", "settings_default.svg", Axes::default());
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn favorite_default_is_pixel_perfect() {
    assert_pixel_perfect("favorite", "favorite_default.svg", Axes::default());
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn favorite_fill1_is_pixel_perfect() {
    assert_pixel_perfect("favorite", "favorite_fill1.svg", Axes { fill: 1.0, ..Axes::default() });
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn unknown_icon_name_returns_none() {
    assert!(
        bun_rs::icons::icon_svg("not-a-real-icon-name", Style::Outlined, Axes::default(), None)
            .is_none()
    );
}

#[test]
#[cfg_attr(
    not(aphrody_symbols),
    ignore = "Material Symbols not embedded: run `bun packages/m3/scripts/fonts-sync.ts`"
)]
fn icon_names_are_sorted_and_nonempty() {
    let names: Vec<&str> = bun_rs::icons::icon_names(Style::Outlined).collect();
    assert!(names.len() > 3800, "expected thousands of Material Symbols, got {}", names.len());
    assert!(names.windows(2).all(|w| w[0] < w[1]), "icon_names should be sorted");
    assert!(names.contains(&"home"));
}

#[test]
#[cfg_attr(aphrody_symbols, ignore = "this build embeds the fonts")]
fn missing_fonts_are_reported() {
    assert!(!bun_rs::icons::available());
    assert_eq!(bun_rs::icons::icon_names(Style::Outlined).count(), 0);
    assert!(matches!(
        bun_rs::icons::icon_path("home", Style::Outlined, Axes::default()),
        Err(bun_rs::icons::SvgError::FontsUnavailable)
    ));
    let error = bun_rs::icon_svg_json(r#"{"name":"home"}"#).unwrap_err();
    assert!(error.contains("fonts-sync"), "{error}");
}
