// SPDX-License-Identifier: Apache-2.0

//! Glyph extraction against a real variable font shipped by this repository, verified by
//! rendering the produced SVG (ink must appear, and weight must change the ink coverage).

use aphrody_svg::{
    glyph::{Glyph, GlyphOptions, glyph_outline},
    raster::{RenderOptions, render},
};

const FONT: &[u8] = aphrody_m3_tokens::google_sans_code::CODE_TTF_DATA;

fn ink(svg: &str) -> usize {
    let r = render(
        svg,
        RenderOptions {
            height: Some(64),
            ..RenderOptions::default()
        },
    )
    .expect("render");
    r.rgba
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|p| p[3] > 127)
        .count()
}

#[test]
fn letter_renders_and_weight_axis_applies() {
    let light = GlyphOptions {
        axes: vec![("wght".into(), 300.0)],
        ..GlyphOptions::default()
    };
    let bold = GlyphOptions {
        axes: vec![("wght".into(), 800.0)],
        ..GlyphOptions::default()
    };
    let a = glyph_outline(FONT, Glyph::Char('H'), &light)
        .expect("font")
        .expect("mapped");
    let b = glyph_outline(FONT, Glyph::Char('H'), &bold)
        .expect("font")
        .expect("mapped");
    assert!(
        a.path.starts_with('M') && a.path.contains('Z'),
        "{}",
        a.path
    );
    assert!(a.ascent > 0.0 && a.descent > 0.0 && a.advance > 0.0);
    let (ink_a, ink_b) = (ink(&a.to_svg(Some(64.0))), ink(&b.to_svg(Some(64.0))));
    assert!(ink_a > 50, "light H has ink: {ink_a}");
    assert!(
        ink_b > ink_a,
        "bold ({ink_b}) inks more than light ({ink_a})"
    );
}

#[test]
fn rescales_to_requested_units_and_skips_unmapped() {
    let opts = GlyphOptions {
        units_per_em: Some(960.0),
        ..GlyphOptions::default()
    };
    let g = glyph_outline(FONT, Glyph::Char('o'), &opts)
        .expect("font")
        .expect("mapped");
    assert!((g.units_per_em - 960.0).abs() < f32::EPSILON);
    assert!(g.advance < 960.0 * 1.5);
    assert!(
        glyph_outline(FONT, Glyph::Char('\u{10FFFD}'), &opts)
            .expect("font")
            .is_none()
    );
}
