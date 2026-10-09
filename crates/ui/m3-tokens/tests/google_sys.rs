// SPDX-License-Identifier: Apache-2.0
//! Golden test: system tokens (shape, motion, springs, state, elevation, typescale, typeface)
//! against the pinned Google sources in `tests/fixtures/google` (material-web v2.5.0 Sass and
//! Compose material3 `tokens/*.kt`, see `PROVENANCE.json`).
//!
//! Known divergences between the two Google sources, or between Google and an Aphrody product
//! choice, are asserted explicitly so that a change on either side fails the test.
#![cfg(feature = "std")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aphrody_m3_tokens::component::focus_indicator;
use aphrody_m3_tokens::{elevation, motion, shape, state, typography};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/google")
}

fn read(path: &str) -> String {
    let path = fixtures().join(path);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn sass(file: &str) -> BTreeMap<String, String> {
    read(&format!("material-web/{file}"))
        .lines()
        .filter_map(|line| line.strip_prefix('$'))
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().trim_end_matches(';').trim().to_owned()))
        .collect()
}

/// Compose `val Name = <expr>` / `val Name: T\n get() = <expr>` declarations.
fn kotlin(file: &str) -> BTreeMap<String, String> {
    let text = read(&format!("compose-material3/{file}"));
    let mut out = BTreeMap::new();
    let mut pending: Option<String> = None;
    for line in text.lines().map(str::trim) {
        if let Some(name) = pending.take()
            && let Some(expr) = line.strip_prefix("get() = ")
        {
            out.insert(name, expr.to_owned());
            continue;
        }
        let Some(rest) = line.split_once("val ").map(|(_, rest)| rest) else { continue };
        if let Some((name, expr)) = rest.split_once(" = ") {
            out.insert(name.trim().to_owned(), expr.trim().to_owned());
        } else if let Some((name, _)) = rest.split_once(':') {
            pending = Some(name.trim().to_owned());
        }
    }
    out
}

fn num(text: &str) -> f32 {
    let trimmed = text
        .trim()
        .trim_end_matches(".dp")
        .trim_end_matches(".sp")
        .trim_end_matches("px")
        .trim_end_matches("rem")
        .trim_end_matches("ms")
        .trim_end_matches('f');
    trimmed.parse().unwrap_or_else(|_| panic!("not a number: {text}"))
}

fn camel(kebab: &str) -> String {
    kebab
        .split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map_or_else(String::new, |c| c.to_ascii_uppercase().to_string() + chars.as_str())
        })
        .collect()
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() <= 1e-4
}

#[test]
fn shape_scale_matches_material_web_and_compose() {
    let mw = sass("_md-sys-shape.scss");
    let cmp = kotlin("ShapeTokens.kt");
    for (corner, name) in shape::ALL.iter().zip(shape::NAMES) {
        let dp = f32::from(corner.dp);
        assert!(close(num(&mw[&format!("corner-{name}")]), dp), "material-web corner-{name}");
        if name == "full" {
            assert_eq!(cmp["CornerFull"], "CircleShape");
            continue;
        }
        let value = &mw[&format!("corner-value-{name}")];
        assert!(close(num(value), dp), "material-web corner-value-{name}");
        let cmp_value = &cmp[&format!("CornerValue{}", camel(name))];
        let inner = cmp_value.trim_start_matches("CornerSize(").trim_end_matches(')');
        assert!(close(num(inner), dp), "Compose CornerValue{}", camel(name));
    }
}

#[test]
fn durations_and_easings_match_material_web_and_compose() {
    let mw = sass("_md-sys-motion.scss");
    let cmp = kotlin("MotionTokens.kt");
    for duration in motion::ALL_DURATIONS {
        let ms = f32::from(duration.ms);
        assert!(close(num(&mw[&format!("duration-{}", duration.name)]), ms), "{}", duration.name);
        assert!(
            close(num(&cmp[&format!("Duration{}", camel(duration.name))]), ms),
            "{}",
            duration.name
        );
    }
    let bezier = |css: &str| -> Vec<f32> {
        css.trim_start_matches("cubic-bezier(")
            .trim_start_matches("CubicBezierEasing(")
            .trim_end_matches(')')
            .split(',')
            .map(num)
            .collect()
    };
    let easings = motion::ALL_EASINGS.iter().chain([
        &motion::EASING_LEGACY,
        &motion::EASING_LEGACY_ACCELERATE,
        &motion::EASING_LEGACY_DECELERATE,
    ]);
    for easing in easings {
        let ours = bezier(easing.cubic_bezier);
        let mut mw_value = mw[&format!("easing-{}", easing.name)].clone();
        if let Some(alias) = mw_value.strip_prefix('$') {
            mw_value = mw[alias].clone();
        }
        assert_eq!(ours, bezier(&mw_value), "material-web easing-{}", easing.name);
        let cmp_value = &cmp[&format!("Easing{}CubicBezier", camel(easing.name))];
        assert_eq!(ours, bezier(cmp_value), "Compose Easing{}", camel(easing.name));
    }
}

#[test]
fn springs_match_both_google_schemes() {
    let mw = sass("_md-sys-motion.scss");
    let expressive = kotlin("ExpressiveMotionTokens.kt");
    let standard = kotlin("StandardMotionTokens.kt");
    let cases = [
        ("fast-spatial", motion::STANDARD_FAST_SPATIAL, motion::EXPRESSIVE_FAST_SPATIAL),
        ("default-spatial", motion::STANDARD_DEFAULT_SPATIAL, motion::EXPRESSIVE_DEFAULT_SPATIAL),
        ("slow-spatial", motion::STANDARD_SLOW_SPATIAL, motion::EXPRESSIVE_SLOW_SPATIAL),
        ("fast-effects", motion::FAST_EFFECTS, motion::FAST_EFFECTS),
        ("default-effects", motion::DEFAULT_EFFECTS, motion::DEFAULT_EFFECTS),
        ("slow-effects", motion::SLOW_EFFECTS, motion::SLOW_EFFECTS),
    ];
    for (name, std_spring, expr_spring) in cases {
        let key = format!("Spring{}", camel(name));
        assert!(close(num(&mw[&format!("spring-{name}-damping")]), std_spring.damping), "{name}");
        assert!(
            close(num(&mw[&format!("spring-{name}-stiffness")]), std_spring.stiffness),
            "{name}"
        );
        assert!(close(num(&standard[&format!("{key}Damping")]), std_spring.damping), "{name}");
        assert!(close(num(&standard[&format!("{key}Stiffness")]), std_spring.stiffness), "{name}");
        assert!(close(num(&expressive[&format!("{key}Damping")]), expr_spring.damping), "{name}");
        assert!(
            close(num(&expressive[&format!("{key}Stiffness")]), expr_spring.stiffness),
            "{name}"
        );
    }
}

#[test]
fn state_layers_elevation_and_focus_indicator_match_google() {
    let mw = sass("_md-sys-state.scss");
    let cmp = kotlin("StateTokens.kt");
    for (layer, name) in [
        (state::HOVER, "hover"),
        (state::FOCUS, "focus"),
        (state::PRESSED, "pressed"),
        (state::DRAGGED, "dragged"),
    ] {
        assert!(close(num(&mw[&format!("{name}-state-layer-opacity")]), layer.opacity), "{name}");
        assert!(
            close(num(&cmp[&format!("{}StateLayerOpacity", camel(name))]), layer.opacity),
            "{name}"
        );
    }
    assert!(close(num(&mw["disabled-state-layer-opacity"]), state::DISABLED_CONTENT.opacity));

    let mw = sass("_md-sys-elevation.scss");
    let cmp = kotlin("ElevationTokens.kt");
    for (level, (dp, _)) in elevation::LEVELS.iter().enumerate() {
        assert!(close(num(&mw[&format!("level{level}")]), f32::from(*dp)), "level{level}");
        assert!(close(num(&cmp[&format!("Level{level}")]), f32::from(*dp)), "Level{level}");
    }

    let mw = sass("_md-sys-state-focus-indicator.scss");
    assert!(close(num(&mw["thickness"]), focus_indicator::THICKNESS));
    assert!(close(num(&mw["outer-offset"]), focus_indicator::OUTER_OFFSET));
    assert!(close(num(&mw["inner-offset"]), focus_indicator::INNER_OFFSET));
    assert_eq!(
        aphrody_m3_tokens::facade::accessibility::FOCUS_RING_DP as f32,
        focus_indicator::THICKNESS
    );
}

/// Base typescale: size and line height equal both sources; tracking equals material-web
/// (Compose rounds three tracking values to one decimal).
#[test]
fn base_typescale_matches_material_web() {
    let mw = sass("_md-sys-typescale.scss");
    let cmp = kotlin("TypeScaleTokens.kt");
    let mut compose_tracking_rounding = Vec::new();
    for (style, name) in typography::ALL.iter().zip(typography::NAMES) {
        let rem = |key: &str| num(&mw[&format!("{name}-{key}")]) * 16.0;
        assert!(close(rem("size"), style.size_dp), "{name} size");
        assert!(close(rem("line-height"), style.line_height_dp), "{name} line-height");
        assert!(close(rem("tracking"), style.letter_spacing_dp), "{name} tracking");
        let wght = mw[&format!("{name}-wght")].trim_start_matches("'wght' ").to_owned();
        assert_eq!(num(&wght) as u16, style.weight, "{name} weight");

        let key = camel(name);
        assert!(close(num(&cmp[&format!("{key}Size")]), style.size_dp), "{key} size");
        assert!(close(num(&cmp[&format!("{key}LineHeight")]), style.line_height_dp), "{key}");
        let cmp_weight = &cmp[&format!("{key}Weight")];
        let weight = if cmp_weight.ends_with("Medium") { 500 } else { 400 };
        assert_eq!(weight, style.weight, "{key} weight");
        let tracking = num(&cmp[&format!("{key}Tracking")]);
        if !close(tracking, style.letter_spacing_dp) {
            compose_tracking_rounding.push((name, tracking));
        }
    }
    assert_eq!(
        compose_tracking_rounding,
        [("display-large", -0.2), ("title-medium", 0.2), ("body-medium", 0.2)],
        "Compose tracking rounding changed"
    );
}

/// Emphasized typescale equals Compose `TypeScaleTokens.*Emphasized`. material-web v2.5.0
/// diverges on wght (600 where Compose uses Bold) and keeps the base tracking.
#[test]
fn emphasized_typescale_matches_compose() {
    let cmp = kotlin("TypeScaleTokens.kt");
    let mw = sass("_md-sys-typescale-emphasized.scss");
    let mut web_divergences = Vec::new();
    for (style, name) in typography::ALL_EMPHASIZED.iter().zip(typography::NAMES) {
        let key = format!("{}Emphasized", camel(name));
        assert!(close(num(&cmp[&format!("{key}Size")]), style.size_dp), "{key}");
        assert!(close(num(&cmp[&format!("{key}LineHeight")]), style.line_height_dp), "{key}");
        assert!(close(num(&cmp[&format!("{key}Tracking")]), style.letter_spacing_dp), "{key}");
        let weight = match cmp[&format!("{key}Weight")].as_str() {
            "TypefaceTokens.WeightBold" => 700,
            "TypefaceTokens.WeightMedium" => 500,
            _ => 400,
        };
        assert_eq!(weight, style.weight, "{key} weight");

        let wght = num(mw[&format!("{name}-wght")].trim_start_matches("'wght' "));
        let tracking = num(&mw[&format!("{name}-tracking")]) * 16.0;
        if wght as u16 != style.weight {
            web_divergences.push(format!("{name} wght {wght}"));
        }
        if !close(tracking, style.letter_spacing_dp) {
            web_divergences.push(format!("{name} tracking {tracking}"));
        }
    }
    assert_eq!(
        web_divergences,
        [
            "display-large tracking -0.25",
            "title-medium wght 600",
            "title-small wght 600",
            "body-large tracking 0.5",
            "label-large wght 600",
            "label-medium wght 600",
            "label-small wght 600",
        ],
        "material-web emphasized divergences changed"
    );
}

/// Google publishes Roboto (web) / platform sans-serif (Compose) as the baseline typeface;
/// Aphrody ships Google Sans Flex as a product choice. Assert both so a change is noticed.
#[test]
fn typeface_is_a_documented_product_choice() {
    let mw = sass("_md-ref-typeface.scss");
    assert_eq!(mw["brand"], "Roboto");
    assert_eq!(mw["plain"], "Roboto");
    assert_eq!(num(&mw["weight-regular"]), 400.0);
    assert_eq!(num(&mw["weight-medium"]), 500.0);
    assert_eq!(num(&mw["weight-bold"]), 700.0);
    let cmp = kotlin("TypefaceTokens.kt");
    assert_eq!(cmp["Brand"], "FontFamily.SansSerif");
    assert!(typography::ALL.iter().all(|style| style.font == "Google Sans Flex"));
}
