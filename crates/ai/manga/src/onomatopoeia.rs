// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga onomatopoeia (comic SFX) detection, classification, and transliteration.
//!
//! Manga sound effects (擬音語 giongo / 擬態語 gitaigo) are stylistically distinct
//! from dialogue bubbles: they are hand-drawn directly on top of artwork, dynamic,
//! and often non-enclosed.

use serde::{Deserialize, Serialize};
use crate::bubble::{BoundingBox, Point};

/// Functional category of a comic onomatopoeia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SfxCategory {
    /// Physical impact, explosion, hitting (e.g. バキッ, ドン, ボカッ, ドカッ).
    #[default]
    Impact,
    /// Fast movement, dashing, swoosh, wind (e.g. サッ, シュッ, ビュン).
    Motion,
    /// Tension, menacing aura, hesitation, shock (e.g. ゴゴゴ, ドキドキ, ゾクッ).
    Emotion,
    /// Environmental ambiance: rain, silence, machinery (e.g. ザー, シーン, ガタガタ).
    Ambient,
    /// Vocal sound effect: gasp, cry, laughter (e.g. ハァハァ, ギャー, ククク).
    Voice,
}

/// A detected Japanese manga onomatopoeia on the artwork.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Onomatopoeia {
    /// Identifier.
    pub id: usize,
    /// Bounding box of the sound effect.
    pub bounds: BoundingBox,
    /// Polygon contour of the drawn glyphs.
    pub contour: Vec<Point>,
    /// Extracted Japanese text (e.g. "ドドド", "ゴゴゴ", "ドカーン").
    pub raw_japanese: String,
    /// Romanized pronunciation (Hepburn romaji).
    pub romaji: String,
    /// Literal English/French translation or comic adaptation (e.g. "RUMBLE", "CRASH").
    pub translation: String,
    /// Classification category.
    pub category: SfxCategory,
    /// Detection confidence score in [0.0, 1.0].
    pub confidence: f32,
}

impl Onomatopoeia {
    /// Create a new onomatopoeia detection with automatic transliteration/translation lookup.
    #[must_use]
    pub fn new(id: usize, bounds: BoundingBox, raw_japanese: impl Into<String>, confidence: f32) -> Self {
        let raw = raw_japanese.into();
        let (romaji, translation, category) = lookup_common_sfx(&raw);
        let contour = vec![
            Point::new(bounds.x, bounds.y),
            Point::new(bounds.right(), bounds.y),
            Point::new(bounds.right(), bounds.bottom()),
            Point::new(bounds.x, bounds.bottom()),
        ];
        Self {
            id,
            bounds,
            contour,
            raw_japanese: raw,
            romaji: romaji.to_string(),
            translation: translation.to_string(),
            category,
            confidence,
        }
    }
}

/// Fast lookup table for the most frequent manga and Dragon Ball action SFX.
#[must_use]
pub fn lookup_common_sfx(raw: &str) -> (&'static str, &'static str, SfxCategory) {
    match raw.trim() {
        "ドドド" | "どどど" => ("dododo", "RUMBLE / THUNDERING", SfxCategory::Ambient),
        "ゴゴゴ" | "ごごご" => ("gogogo", "MENACING / OMINOUS AURA", SfxCategory::Emotion),
        "ドン" | "どん" => ("don", "BOOM / THUD", SfxCategory::Impact),
        "ドカーン" | "どかーん" => ("dokaan", "KABOOM / EXPLOSION", SfxCategory::Impact),
        "バキッ" | "ばきっ" => ("baki", "CRACK / SNAP", SfxCategory::Impact),
        "ガッ" | "がっ" => ("ga", "CLASH / STRIKE", SfxCategory::Impact),
        "サッ" | "さっ" => ("sa", "SWIFT / DASH", SfxCategory::Motion),
        "シュッ" | "しゅっ" => ("shu", "SWOOSH / SLICE", SfxCategory::Motion),
        "ビュン" | "びゅん" => ("byun", "WHIZZ / SPEED", SfxCategory::Motion),
        "ハッ" | "はっ" => ("ha", "GASP / SUDDEN AWARENESS", SfxCategory::Voice),
        "シーン" | "しーん" => ("shiin", "DEAD SILENCE", SfxCategory::Ambient),
        "ドキドキ" | "どきどき" => ("dokidoki", "HEART POUNDING", SfxCategory::Emotion),
        "ザー" | "ざー" => ("zaa", "POURING RAIN / WHITE NOISE", SfxCategory::Ambient),
        "ニヤッ" | "にやっ" => ("niya", "SMIRK / GRIN", SfxCategory::Emotion),
        "バッ" | "ばっ" => ("ba", "FLING / SUDDEN LEAP", SfxCategory::Motion),
        "ピッ" | "ぴっ" => ("pi", "BEEP / FLASH", SfxCategory::Ambient),
        _ => ("unknown", "SFX", SfxCategory::Impact),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_common_sfx_lookup() {
        let (romaji, translation, cat) = lookup_common_sfx("ゴゴゴ");
        assert_eq!(romaji, "gogogo");
        assert!(translation.contains("MENACING"));
        assert_eq!(cat, SfxCategory::Emotion);

        let (romaji_don, trans_don, cat_don) = lookup_common_sfx("ドン");
        assert_eq!(romaji_don, "don");
        assert!(trans_don.contains("BOOM"));
        assert_eq!(cat_don, SfxCategory::Impact);
    }
}
