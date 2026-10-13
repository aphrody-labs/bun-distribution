// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 elevation levels.
//!
//! M3 defines six elevation levels (0–5).  Each level has a dp value and a
//! corresponding CSS `box-shadow` string that encodes the overlay + shadow
//! recipe recommended by the specification.
//!
//! Reference: <https://m3.material.io/styles/elevation/tokens>

/// Number of M3 elevation levels (0 through 5 inclusive).
pub const LEVEL_COUNT: usize = 6;

/// Each entry is `(dp_value, css_box_shadow)`.
///
/// The `dp_value` maps to the `--md-sys-elevation-level*` CSS custom property.
/// The `css_box_shadow` string encodes the shadow overlay as a CSS
/// `box-shadow` declaration (RGBA values use the M3 shadow color at the
/// recommended opacity for each level).
///
/// | Index | Level | dp  | Description                      |
/// |-------|-------|-----|----------------------------------|
/// | 0     | 0     | 0   | Resting surface — no shadow       |
/// | 1     | 1     | 1   | FAB, cards at rest                |
/// | 2     | 2     | 3   | Cards hovered / raised buttons   |
/// | 3     | 3     | 6   | Navigation drawer, modals         |
/// | 4     | 4     | 8   | Navigation bar                   |
/// | 5     | 5     | 12  | FAB pressed, dialog              |
pub const LEVELS: [(u8, &str); LEVEL_COUNT] = [
    // Level 0 — no elevation
    (0, "none"),
    // Level 1 — 1 dp
    (
        1,
        "0px 1px 2px 0px rgba(0,0,0,0.30), 0px 1px 3px 1px rgba(0,0,0,0.15)",
    ),
    // Level 2 — 3 dp
    (
        3,
        "0px 1px 2px 0px rgba(0,0,0,0.30), 0px 2px 6px 2px rgba(0,0,0,0.15)",
    ),
    // Level 3 — 6 dp
    (
        6,
        "0px 1px 3px 0px rgba(0,0,0,0.30), 0px 4px 8px 3px rgba(0,0,0,0.15)",
    ),
    // Level 4 — 8 dp
    (
        8,
        "0px 2px 3px 0px rgba(0,0,0,0.30), 0px 6px 10px 4px rgba(0,0,0,0.15)",
    ),
    // Level 5 — 12 dp
    (
        12,
        "0px 4px 4px 0px rgba(0,0,0,0.30), 0px 8px 12px 6px rgba(0,0,0,0.15)",
    ),
];

/// One layer of an elevation shadow, in px (the x offset is always 0).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShadowLayer {
    /// Vertical offset.
    pub y: u8,
    /// Blur radius.
    pub blur: u8,
    /// Spread radius.
    pub spread: u8,
}

impl ShadowLayer {
    /// The layer as a CSS `box-shadow` component with colour expression `color`.
    #[cfg(feature = "std")]
    #[must_use]
    pub fn css(self, color: &str) -> String {
        format!("0px {}px {}px {}px {color}", self.y, self.blur, self.spread)
    }
}

/// Opacity of the key-light (first) layer.
pub const KEY_ALPHA: f32 = 0.3;

/// Opacity of the ambient (second) layer.
pub const AMBIENT_ALPHA: f32 = 0.15;

/// `(key, ambient)` layers of levels 1 to 5 (index 0 is level 1); level 0 has no shadow.
pub const SHADOWS: [[ShadowLayer; 2]; 5] = [
    [
        ShadowLayer {
            y: 1,
            blur: 2,
            spread: 0,
        },
        ShadowLayer {
            y: 1,
            blur: 3,
            spread: 1,
        },
    ],
    [
        ShadowLayer {
            y: 1,
            blur: 2,
            spread: 0,
        },
        ShadowLayer {
            y: 2,
            blur: 6,
            spread: 2,
        },
    ],
    [
        ShadowLayer {
            y: 1,
            blur: 3,
            spread: 0,
        },
        ShadowLayer {
            y: 4,
            blur: 8,
            spread: 3,
        },
    ],
    [
        ShadowLayer {
            y: 2,
            blur: 3,
            spread: 0,
        },
        ShadowLayer {
            y: 6,
            blur: 10,
            spread: 4,
        },
    ],
    [
        ShadowLayer {
            y: 4,
            blur: 4,
            spread: 0,
        },
        ShadowLayer {
            y: 8,
            blur: 12,
            spread: 6,
        },
    ],
];

/// Returns the dp value for the given elevation level (0–5).
///
/// # Panics
///
/// Panics if `level` is greater than 5.
#[must_use]
#[inline]
pub const fn dp(level: usize) -> u8 {
    assert!(level < LEVEL_COUNT, "elevation level must be 0-5");
    LEVELS[level].0
}

/// Returns the CSS `box-shadow` string for the given elevation level (0–5).
///
/// # Panics
///
/// Panics if `level` is greater than 5.
#[must_use]
#[inline]
pub const fn shadow(level: usize) -> &'static str {
    assert!(level < LEVEL_COUNT, "elevation level must be 0-5");
    LEVELS[level].1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_elevation_levels() {
        assert_eq!(LEVELS.len(), LEVEL_COUNT);
    }

    #[test]
    fn level_zero_has_no_shadow() {
        assert_eq!(dp(0), 0);
        assert_eq!(shadow(0), "none");
    }

    #[test]
    fn level_five_is_twelve_dp() {
        assert_eq!(dp(5), 12);
    }

    #[test]
    fn all_shadows_non_empty() {
        for (_, s) in &LEVELS {
            assert!(!s.is_empty());
        }
    }

    #[cfg(feature = "std")]
    #[test]
    fn shadow_table_matches_level_strings() {
        for level in 1..LEVEL_COUNT {
            let [key, ambient] = SHADOWS[level - 1];
            let text = format!(
                "{}, {}",
                key.css(&format!("rgba(0,0,0,{KEY_ALPHA:.2})")),
                ambient.css(&format!("rgba(0,0,0,{AMBIENT_ALPHA:.2})"))
            );
            assert_eq!(text, shadow(level), "level {level}");
        }
    }

    #[test]
    fn dp_values_are_monotonic() {
        let dps: Vec<u8> = LEVELS.iter().map(|(d, _)| *d).collect();
        for window in dps.windows(2) {
            assert!(
                window[0] <= window[1],
                "dp values must be monotonically non-decreasing"
            );
        }
    }
}
