// SPDX-License-Identifier: Apache-2.0
//! Contract and color parity for shared native, browser and OS themes.
//!
//! `fixtures/mcu-pet.json` is generated directly from the locked Google MCU
//! 0.4.0 `SchemeTonalSpot` and `MaterialDynamicColors`, using the identity
//! package's measured `PET_COLORS.seed`, for both modes at -1, 0, 0.5 and 1.

#![cfg(feature = "std")]

use aphrody_m3_tokens::{
    color_math::{argb_from_hex, hex_from_argb},
    scheme::{Role, Variant},
    theme::{SCHEMA_VERSION, SPEC_VERSION, ThemeRequest, export_token_tables},
};
use serde_json::Value;

fn pet_fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/mcu-pet.json")).expect("valid Google MCU fixture")
}

fn pet_request(contrast: f64) -> ThemeRequest {
    let fixture = pet_fixture();
    ThemeRequest::parse(fixture["seed"].as_str(), Some("tonal-spot"), Some(contrast)).unwrap()
}

#[test]
fn all_pet_roles_match_the_locked_google_oracle_in_both_modes() {
    let fixture = pet_fixture();
    assert_eq!(fixture["spec_version"], SPEC_VERSION);
    for expected in fixture["schemes"].as_array().unwrap() {
        let request = pet_request(expected["contrast_level"].as_f64().unwrap());
        let export = request.export();
        assert_eq!(export.schema_version, SCHEMA_VERSION);
        assert_eq!(export.spec_version, SPEC_VERSION);
        assert_eq!(export.seed, fixture["seed"]);
        assert_eq!(export.variant, "tonal-spot");
        for (mode, actual) in [("light", &export.light), ("dark", &export.dark)] {
            let expected = expected[mode].as_object().unwrap();
            assert_eq!(actual.len(), Role::ALL.len());
            assert_eq!(expected.len(), Role::ALL.len());
            for role in Role::ALL {
                assert_eq!(
                    actual[role.camel_name()],
                    expected[role.camel_name()].as_str().unwrap(),
                    "{mode} {} contrast={}",
                    role.name(),
                    request.contrast_level()
                );
            }
        }
    }
}

#[test]
fn rejects_invalid_inputs_before_color_generation() {
    for contrast in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.01, 1.01] {
        assert!(ThemeRequest::parse(Some("#8c6c88"), None, Some(contrast)).is_err());
        assert!(ThemeRequest::new(0xFF8C_6C88, Variant::TonalSpot, contrast).is_err());
    }
    assert!(ThemeRequest::new(0x008C_6C88, Variant::TonalSpot, 0.0).is_err());
    for seed in ["", "#zzzzzz", "#12345", "#12345678"] {
        assert!(ThemeRequest::parse(Some(seed), None, None).is_err());
    }
    assert!(ThemeRequest::parse(None, Some("unknown"), None).is_err());
    // Variants of other specs are not silently relabeled as the implemented spec.
    assert!(ThemeRequest::parse(None, Some("cmf"), None).is_err());
    assert!(ThemeRequest::parse(None, Some("fidelity"), None).is_ok());
}

#[test]
fn default_and_textual_requests_share_the_existing_css_contract() {
    assert_eq!(
        ThemeRequest::default(),
        ThemeRequest::parse(None, None, None).unwrap()
    );
    assert_eq!(
        ThemeRequest::parse(Some("#abc"), Some("tonal_spot"), Some(-1.0))
            .unwrap()
            .seed(),
        0xFFAA_BBCC
    );
    let request = pet_request(0.0);
    let export = request.export();
    let css = request.css();
    for role in Role::ALL {
        for mode in [&export.light, &export.dark] {
            assert!(css.contains(&format!(
                "--md-sys-color-{}: {};",
                role.name(),
                mode[role.camel_name()]
            )));
        }
    }
    assert!(css.contains("@media (prefers-color-scheme: dark)"));
    assert!(css.contains(":root.dark"));
    assert!(css.contains("--primary: var(--md-sys-color-primary)"));
}

#[test]
fn every_provided_variant_exports_opaque_complete_schemes() {
    for variant in Variant::ALL {
        let request = ThemeRequest::new(0xFF8C_6C88, variant, 0.5).unwrap();
        let export = request.export();
        for (dark, roles) in [(false, &export.light), (true, &export.dark)] {
            assert_eq!(roles.len(), Role::ALL.len());
            let native = request.scheme(dark);
            for role in Role::ALL {
                let color = &roles[role.camel_name()];
                assert_eq!(color, &hex_from_argb(native.argb(role)));
                assert_eq!(argb_from_hex(color).unwrap() >> 24, 0xFF);
            }
        }
    }
}

#[test]
fn pet_text_pairs_reach_aa_and_high_contrast_reaches_aaa() {
    let pairs = [
        (Role::OnPrimary, Role::Primary),
        (Role::OnPrimaryContainer, Role::PrimaryContainer),
        (Role::OnSecondary, Role::Secondary),
        (Role::OnSecondaryContainer, Role::SecondaryContainer),
        (Role::OnTertiary, Role::Tertiary),
        (Role::OnTertiaryContainer, Role::TertiaryContainer),
        (Role::OnError, Role::Error),
        (Role::OnErrorContainer, Role::ErrorContainer),
        (Role::OnBackground, Role::Background),
        (Role::OnSurface, Role::Surface),
        (Role::OnSurfaceVariant, Role::SurfaceVariant),
        (Role::InverseOnSurface, Role::InverseSurface),
    ];
    for (request, minimum) in [
        (pet_request(0.0), 4.5),
        (pet_request(0.0).high_contrast(), 7.0),
    ] {
        for dark in [false, true] {
            for (foreground, background) in pairs {
                let ratio = request.contrast(dark, foreground, background);
                assert!(
                    ratio >= minimum,
                    "{foreground:?} on {background:?}: {ratio}, dark={dark}, contrast={}",
                    request.contrast_level()
                );
            }
        }
    }
    // Reduced contrast is an explicit user preference, not an AA promise.
    assert!(
        pet_request(-1.0).contrast(false, Role::OnPrimaryContainer, Role::PrimaryContainer) < 4.5
    );
}

#[cfg(feature = "serde")]
#[test]
fn serialization_is_deterministic_and_preserves_every_role() {
    let export = pet_request(0.5).export();
    let first = serde_json::to_string(&export).unwrap();
    assert_eq!(
        first,
        serde_json::to_string(&pet_request(0.5).export()).unwrap()
    );
    let value: Value = serde_json::from_str(&first).unwrap();
    assert_eq!(value["schema_version"], 1);
    assert_eq!(value["spec_version"], "2021");
    assert_eq!(value["contrast_level"], 0.5);
    assert_eq!(value["light"].as_object().unwrap().len(), 49);
    assert_eq!(value["dark"].as_object().unwrap().len(), 49);
}

#[test]
fn exported_design_tables_preserve_scale_order_units_and_emphasized_tracking() {
    let tables = export_token_tables();
    assert_eq!(tables.schema_version, 1);
    assert_eq!(tables.shape.len(), 10);
    assert_eq!(tables.typography.len(), 15);
    assert_eq!(tables.typography_emphasized.len(), 15);
    assert_eq!(tables.motion.easings.len(), 7);
    assert_eq!(tables.motion.durations.len(), 16);
    assert_eq!(tables.motion.web_springs.len(), 12);
    assert_eq!(tables.elevation.len(), 6);
    assert_eq!(
        tables.shape.map(|token| token.dp),
        [0, 4, 8, 12, 16, 20, 28, 32, 48, 9999]
    );
    assert_eq!(tables.shape[9].name, "full");
    let display = tables.typography[0];
    assert_eq!(display.name, "display-large");
    assert_eq!(display.font, "Google Sans Flex");
    assert_eq!(display.weight, 400);
    assert_eq!(display.size_dp, 57.0);
    assert_eq!(display.line_height_dp, 64.0);
    assert_eq!(display.letter_spacing_dp, -0.25);
    let emphasized = tables.typography_emphasized[0];
    assert_eq!(emphasized.name, display.name);
    assert_eq!(emphasized.weight, 500);
    assert_eq!(emphasized.letter_spacing_dp, 0.0);
    assert_eq!(tables.typography[14].name, "label-small");
    assert_eq!(tables.typography_emphasized[14].weight, 700);
    assert_eq!(tables.motion.durations[0].ms, 50);
    assert_eq!(tables.motion.durations[15].ms, 1000);
    assert_eq!(tables.motion.web_springs[0].name, "expressive-fast-spatial");
    assert_eq!(
        tables.motion.web_springs[0].curve,
        [0.475, 1.498, 0.084, 1.0]
    );
    assert_eq!(tables.motion.web_springs[0].ms, 320);
    assert_eq!(tables.elevation.map(|token| token.dp), [0, 1, 3, 6, 8, 12]);
    assert_eq!(tables.elevation[0].shadow, "none");
    assert_eq!(tables.elevation[5].level, 5);
}

#[cfg(feature = "serde")]
#[test]
fn design_table_json_preserves_complete_tables_and_spring_overshoot() {
    let json = serde_json::to_string(&export_token_tables()).unwrap();
    assert_eq!(json, serde_json::to_string(&export_token_tables()).unwrap());
    let value: Value = serde_json::from_str(&json).unwrap();
    for (key, count) in [
        ("shape", 10),
        ("typography", 15),
        ("typography_emphasized", 15),
        ("elevation", 6),
    ] {
        assert_eq!(value[key].as_array().unwrap().len(), count);
    }
    for (key, count) in [("easings", 7), ("durations", 16), ("web_springs", 12)] {
        assert_eq!(value["motion"][key].as_array().unwrap().len(), count);
    }
    assert_eq!(value["typography"][0]["letter_spacing_dp"], -0.25);
    assert_eq!(value["typography_emphasized"][0]["letter_spacing_dp"], 0.0);
    assert!(
        value["motion"]["web_springs"][0]["curve"][1]
            .as_f64()
            .unwrap()
            > 1.0
    );
    assert!(value.get("spec_version").is_none());
}
