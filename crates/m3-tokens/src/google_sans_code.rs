// SPDX-License-Identifier: Apache-2.0
//! Google Sans Code variable-font axis tokens.
//!
//! Google Sans Code is the monospaced member of the Google Sans family used on
//! code surfaces (Gemini, AI Studio). The upright variable font ships two
//! interpolation axes:
//!
//! | Axis tag | Description                              | Min | Default | Max |
//! |----------|------------------------------------------|-----|---------|-----|
//! | `wght`   | Weight (CSS `font-weight`)               | 300 |  400    | 800 |
//! | `MONO`   | Monospace (0 = proportional, 1 = mono)   |   0 |    1    |   1 |
//!
//! Provenance: `GoogleSansCode[MONO,wght].ttf` (version 7.001) from the
//! official upstream release
//! <https://github.com/googlefonts/googlesans-code/releases/tag/v7.001>
//! (`GoogleSansCode-v7.001.zip`), stored as
//! `crates/m3-tokens/fonts/google-sans-code/GoogleSansCode-Variable.ttf` and shipped
//! under the SIL Open Font License v1.1
//! (`crates/m3-tokens/fonts/google-sans-code/OFL.txt`, copied from the same archive).
//! SHA-256 of the TTF:
//! `74642762fae66d5883077794a763e1086394b8cb72f2623e456e06359dc5c64b`.
//!
//! Item names carry a `code`/`CODE` prefix because the `facade::typography` glob
//! re-exports this module next to [`crate::google_sans_flex`].

use crate::google_sans_flex::Axis;

/// Weight axis (CSS `font-weight`).
pub const CODE_WGHT: Axis = Axis {
    tag: "wght",
    min: 300.0,
    default: 400.0,
    max: 800.0,
};

/// Monospace axis (0 = proportional, 1 = fixed pitch).
pub const CODE_MONO: Axis = Axis {
    tag: "MONO",
    min: 0.0,
    default: 1.0,
    max: 1.0,
};

/// Both axes in the order of the upstream filename (`[MONO,wght]`).
pub const CODE_ALL_AXES: [&Axis; 2] = [&CODE_MONO, &CODE_WGHT];

/// File name of the variable font under `crates/m3-tokens/fonts/google-sans-code/`.
pub const CODE_TTF_FILE_NAME: &str = "GoogleSansCode-Variable.ttf";

/// Raw TTF bytes for Google Sans Code (upright, `MONO` + `wght` axes).
pub const CODE_TTF_DATA: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/fonts/google-sans-code/GoogleSansCode-Variable.ttf"
));

/// Google Sans Code variable-font axis tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GoogleSansCodeAxes {
    /// Monospace axis (0.0 to 1.0).
    pub mono: f32,
    /// Font weight axis (300.0 to 800.0).
    pub wght: f32,
}

impl GoogleSansCodeAxes {
    /// The font's default axis values (Regular, fully monospaced).
    pub const DEFAULT: Self = Self {
        mono: 1.0,
        wght: 400.0,
    };

    /// Clamp every field into its axis range.
    #[must_use]
    pub fn clamped(self) -> Self {
        Self {
            mono: CODE_MONO.clamp(self.mono),
            wght: CODE_WGHT.clamp(self.wght),
        }
    }
}

impl Default for GoogleSansCodeAxes {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// Produce a CSS `font-variation-settings` value, e.g. `"MONO" 1, "wght" 400`.
#[cfg(feature = "std")]
#[must_use]
pub fn code_font_variation_settings(a: &GoogleSansCodeAxes) -> String {
    let a = a.clamped();
    format!(
        "\"MONO\" {mono}, \"wght\" {wght:.0}",
        mono = a.mono,
        wght = a.wght
    )
}

/// Emit a `@font-face` declaration block pointing at the variable font
/// shipped at `crates/m3-tokens/fonts/google-sans-code/GoogleSansCode-Variable.ttf`.
///
/// `relative_url` is the URL prefix used in the consumer page (e.g.
/// `"../../../assets/fonts/google-sans-code/"`).
#[cfg(feature = "std")]
#[must_use]
pub fn export_code_font_face(relative_url: &str) -> String {
    code_font_face_block(&format!("url('{relative_url}{CODE_TTF_FILE_NAME}')"))
}

/// Emit a `@font-face` declaration block with the variable font embedded as base64.
#[cfg(feature = "std")]
#[must_use]
pub fn export_code_base64_font_face() -> String {
    use base64::prelude::*;
    let encoded = BASE64_STANDARD.encode(CODE_TTF_DATA);
    code_font_face_block(&format!("url('data:font/ttf;base64,{encoded}')"))
}

#[cfg(feature = "std")]
fn code_font_face_block(src_url: &str) -> String {
    let mut s = String::with_capacity(src_url.len() + 256);
    s.push_str("@font-face {\n");
    s.push_str("  font-family: 'Google Sans Code';\n");
    s.push_str("  src: ");
    s.push_str(src_url);
    s.push_str(" format('truetype-variations');\n");
    s.push_str("  font-weight: 300 800;\n");
    s.push_str("  font-style: normal;\n");
    s.push_str("  font-display: swap;\n");
    s.push_str("}\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be_u16(bytes: &[u8], at: usize) -> u16 {
        u16::from_be_bytes([bytes[at], bytes[at + 1]])
    }

    #[test]
    fn embedded_font_is_a_real_truetype_file() {
        assert!(
            CODE_TTF_DATA.len() > 100_000,
            "font is {} bytes",
            CODE_TTF_DATA.len()
        );
        assert_eq!(
            &CODE_TTF_DATA[..4],
            &[0x00, 0x01, 0x00, 0x00],
            "TrueType sfnt version"
        );
        let num_tables = usize::from(be_u16(CODE_TTF_DATA, 4));
        let tags: Vec<&[u8]> = (0..num_tables)
            .map(|i| &CODE_TTF_DATA[12 + i * 16..12 + i * 16 + 4])
            .collect();
        for required in [b"fvar", b"glyf", b"name", b"cmap"] {
            assert!(
                tags.contains(&&required[..]),
                "missing table {:?}",
                required
            );
        }
    }

    #[test]
    fn license_is_ofl() {
        let ofl = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fonts/google-sans-code/OFL.txt"
        ));
        assert!(ofl.contains("SIL Open Font License, Version 1.1"));
        assert!(ofl.contains("Google Sans Code Project Authors"));
    }

    #[test]
    fn axes_match_upstream_fvar() {
        assert_eq!(CODE_ALL_AXES.len(), 2);
        assert_eq!(
            (CODE_WGHT.min, CODE_WGHT.default, CODE_WGHT.max),
            (300.0, 400.0, 800.0)
        );
        assert_eq!(
            (CODE_MONO.min, CODE_MONO.default, CODE_MONO.max),
            (0.0, 1.0, 1.0)
        );
    }

    #[test]
    fn defaults_and_clamping() {
        assert_eq!(
            GoogleSansCodeAxes::default(),
            GoogleSansCodeAxes {
                mono: 1.0,
                wght: 400.0
            }
        );
        let a = GoogleSansCodeAxes {
            mono: 2.0,
            wght: 100.0,
        }
        .clamped();
        assert_eq!(
            a,
            GoogleSansCodeAxes {
                mono: 1.0,
                wght: 300.0
            }
        );
    }

    #[cfg(feature = "std")]
    #[test]
    fn css_exports_contain_required_fields() {
        let vs = code_font_variation_settings(&GoogleSansCodeAxes {
            mono: 0.5,
            wght: 900.0,
        });
        assert_eq!(vs, "\"MONO\" 0.5, \"wght\" 800");

        let face = export_code_font_face("../../../assets/fonts/google-sans-code/");
        assert!(face.contains("font-family: 'Google Sans Code'"));
        assert!(face.contains("font-weight: 300 800"));
        assert!(face.contains("google-sans-code/GoogleSansCode-Variable.ttf"));
        assert!(face.contains("truetype-variations"));

        let embedded = export_code_base64_font_face();
        assert!(
            embedded.contains("data:font/ttf;base64,AAEAAA"),
            "base64 of 00 01 00 00"
        );
    }
}
