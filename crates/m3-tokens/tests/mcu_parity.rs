// SPDX-License-Identifier: Apache-2.0
//! Bit-exact parity with `@material/material-color-utilities` 0.4.0.
//!
//! `tests/fixtures/mcu.json` is produced by `m3/packages/m3-theme/scripts/mcu-fixture.ts`
//! (`bun run fixture:mcu`) from the reference implementation.

use aphrody_m3_tokens::{
    blend::custom_color,
    cam16::ViewingConditions,
    hct::Hct,
    palette::TonalPalette,
    scheme::{DynamicScheme, Palettes, Role, Variant},
};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/mcu.json")).expect("valid fixture")
}

fn u32_of(v: &Value) -> u32 {
    u32::try_from(v.as_u64().expect("argb")).expect("argb fits u32")
}

fn f64_of(v: &Value) -> f64 {
    v.as_f64().expect("number")
}

#[test]
fn viewing_conditions() {
    let f = fixture();
    let vc = &f["viewing_conditions"];
    let ours = ViewingConditions::standard();
    for (name, value) in [
        ("n", ours.n),
        ("aw", ours.aw),
        ("nbb", ours.nbb),
        ("c", ours.c),
        ("fl", ours.fl),
        ("z", ours.z),
    ] {
        let expected = f64_of(&vc[name]);
        assert!(
            (value - expected).abs() <= 1e-12 * expected.abs().max(1.0),
            "{name}: {value} vs {expected}"
        );
    }
}

#[test]
fn hct_from_argb() {
    for entry in fixture()["hct"].as_array().unwrap() {
        let argb = u32_of(&entry[0]);
        let hct = Hct::from_argb(argb);
        for (got, want, what) in [
            (hct.hue, &entry[1], "hue"),
            (hct.chroma, &entry[2], "chroma"),
            (hct.tone, &entry[3], "tone"),
        ] {
            assert!(
                (got - f64_of(want)).abs() < 1e-9,
                "{argb:#010x} {what}: {got} vs {want}"
            );
        }
    }
}

#[test]
fn hct_solver() {
    let f = fixture();
    let points = f["solve"].as_array().unwrap();
    let mismatches: Vec<String> = points
        .iter()
        .filter_map(|p| {
            let (h, c, t, want) = (f64_of(&p[0]), f64_of(&p[1]), f64_of(&p[2]), u32_of(&p[3]));
            let got = Hct::new(h, c, t).to_argb();
            (got != want).then(|| format!("({h}, {c}, {t}): {got:#010x} vs {want:#010x}"))
        })
        .collect();
    assert!(
        mismatches.is_empty(),
        "{} of {} differ: {:?}",
        mismatches.len(),
        points.len(),
        &mismatches[..mismatches.len().min(10)]
    );
}

#[test]
fn tonal_palettes() {
    for p in fixture()["palettes"].as_array().unwrap() {
        let palette = TonalPalette::from_hue_and_chroma(f64_of(&p["hue"]), f64_of(&p["chroma"]));
        assert_eq!(
            palette.key_color.to_argb(),
            u32_of(&p["key"]),
            "key colour of {p:?}"
        );
        for (tone, want) in p["tones"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                palette.tone(tone as f64),
                u32_of(want),
                "tone {tone} of hue {}",
                p["hue"]
            );
        }
    }
}

fn assert_roles(scheme: &DynamicScheme, roles: &Value, label: &str) {
    for (name, want) in roles.as_object().unwrap() {
        let role = Role::from_name(name).unwrap_or_else(|| panic!("unknown role {name}"));
        let got = scheme.argb(role);
        assert_eq!(
            got,
            u32_of(want),
            "{label} {name}: {got:#010x} vs {:#010x}",
            u32_of(want)
        );
    }
}

#[test]
fn dynamic_schemes() {
    let f = fixture();
    let schemes = f["schemes"].as_array().unwrap();
    for s in schemes {
        let variant = Variant::from_name(s["variant"].as_str().unwrap()).unwrap();
        let dark = s["dark"].as_bool().unwrap();
        let contrast = f64_of(&s["contrast"]);
        let scheme = DynamicScheme::from_argb(u32_of(&s["seed"]), variant, dark, contrast);
        assert_roles(
            &scheme,
            &s["roles"],
            &format!(
                "{:#010x} {} dark={dark} contrast={contrast}",
                u32_of(&s["seed"]),
                variant.name()
            ),
        );
    }
    assert_eq!(schemes.len(), 160);
}

#[test]
fn spaceui_schemes() {
    for s in fixture()["spaceui"].as_array().unwrap() {
        let accent = Hct::from_argb(u32_of(&s["accent"]));
        let neutral = Hct::from_argb(u32_of(&s["neutral"]));
        let dark = s["dark"].as_bool().unwrap();
        let base = Palettes::of(Variant::TonalSpot, &accent);
        let chroma = if neutral.chroma < 1.0 {
            0.0
        } else {
            neutral.chroma.min(12.0)
        };
        let palettes = Palettes {
            primary: TonalPalette::from_hct(accent),
            neutral: TonalPalette::from_hue_and_chroma(neutral.hue, chroma),
            neutral_variant: TonalPalette::from_hue_and_chroma(
                neutral.hue,
                if chroma == 0.0 { 0.0 } else { chroma + 4.0 },
            ),
            ..base
        };
        let scheme = DynamicScheme::with_palettes(accent, Variant::TonalSpot, dark, 0.0, palettes);
        assert_roles(
            &scheme,
            &s["roles"],
            &format!("spaceui {:#010x}", u32_of(&s["neutral"])),
        );
    }
}

#[test]
fn custom_colors() {
    for c in fixture()["custom"].as_array().unwrap() {
        let got = custom_color(
            u32_of(&c["source"]),
            u32_of(&c["value"]),
            c["blend"].as_bool().unwrap(),
        );
        assert_eq!(got.value, u32_of(&c["harmonized"]), "{c:?}");
        let light = [
            got.light.color,
            got.light.on_color,
            got.light.color_container,
            got.light.on_color_container,
        ];
        let dark = [
            got.dark.color,
            got.dark.on_color,
            got.dark.color_container,
            got.dark.on_color_container,
        ];
        let want = |key: &str| {
            c[key]
                .as_array()
                .unwrap()
                .iter()
                .map(u32_of)
                .collect::<Vec<_>>()
        };
        assert_eq!(light.to_vec(), want("light"), "light {c:?}");
        assert_eq!(dark.to_vec(), want("dark"), "dark {c:?}");
    }
}
