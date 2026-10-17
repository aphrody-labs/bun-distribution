// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Stable, append-only result records for OCR batch outputs.

use std::path::PathBuf;

/// Identifier emitted by every newly produced result record.
pub const RESULT_SCHEMA_V2: &str = "aphrody.ocr.result/v2";

/// A quadrilateral in original image pixel coordinates, clockwise from the
/// top-left corner after normalisation.
pub type Polygon = [[f32; 2]; 4];

/// The semantic outcome of processing one page.
///
/// The states are deliberately more precise than the legacy `none` result:
/// corpus consumers must never treat an unreadable page as a request to erase
/// an existing transcription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OcrStatus {
    /// Text was extracted and can be considered by a consumer after auditing.
    Text,
    /// The backend completed and found no credible text region.
    NoText,
    /// Text likely exists but could not be read with sufficient confidence.
    Unreadable,
    /// A completed result conflicts with a quality rule and needs review.
    NeedsReview,
    /// The input or backend failed before an OCR result could be produced.
    ProcessingError,
}

/// Execution state of a single backend attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttemptStatus {
    /// The backend returned an OCR outcome.
    Completed,
    /// The backend timed out.
    TimedOut,
    /// The backend failed before an outcome was available.
    Failed,
}

/// Identity and diagnostic properties of the input image.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ImageIdentity {
    /// Path recorded for backwards-compatible resume behavior.
    pub path: PathBuf,
    /// Digest of the exact bytes read, when the caller computed one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// Detected media type rather than an extension-derived claim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

impl ImageIdentity {
    /// Build the minimum safe identity from a path.
    #[must_use]
    pub fn from_path(path: PathBuf) -> Self {
        Self {
            path,
            sha256: None,
            media_type: None,
        }
    }
}

/// Provenance needed to reproduce or safely compare an OCR run.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RunProvenance {
    /// Identifier of the selected model catalog entry.
    pub model_id: String,
    /// Backend that performed the attempt, such as `onnx-runtime` or
    /// `llama-cpp`.
    pub backend: String,
    /// Runtime provider that actually executed the model, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Digest of the selected model/configuration set, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_digest: Option<String>,
    /// Digest of a prompt, used only by generative OCR backends.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_digest: Option<String>,
}

/// Aggregate and per-block quality information.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Quality {
    /// Mean recognition confidence in the inclusive range `[0, 1]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_confidence: Option<f32>,
    /// Human- and machine-readable reasons that prevented automatic acceptance.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
}

/// One recognised region in reading order.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OcrBlock {
    /// Text recognised in this region.
    pub text: String,
    /// Region geometry in original-pixel coordinates.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub polygon: Option<Polygon>,
    /// Recognition confidence for this region.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// Optional structural role, e.g. `title`, `table` or `text`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// Evidence from one backend invocation.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Attempt {
    /// Backend provenance for this invocation.
    pub run: RunProvenance,
    /// Whether the invocation completed, timed out or failed.
    pub status: AttemptStatus,
    /// Wall-clock time consumed by the invocation.
    pub elapsed_ms: u128,
    /// Backend result quality, if it completed.
    #[serde(default)]
    pub quality: Quality,
    /// Error retained for a failed attempt without misclassifying it as no text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A schema-versioned OCR page result suitable for JSONL.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OcrResult {
    /// Schema discriminator. New records use [`RESULT_SCHEMA_V2`].
    pub schema: String,
    /// Stable page identity within the caller's batch or corpus.
    pub page_id: String,
    /// Input identity and diagnostic properties.
    pub image: ImageIdentity,
    /// Backend attempts in execution order.
    #[serde(default)]
    pub attempts: Vec<Attempt>,
    /// Final semantic status of the page.
    pub status: OcrStatus,
    /// Markdown produced by a layout-aware backend, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    /// Ordered recognised regions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<OcrBlock>,
    /// Final quality gate and reasons.
    #[serde(default)]
    pub quality: Quality,
    /// Raw model output retained when the caller requested auditability.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

impl OcrResult {
    /// Create a record with no recognised text.
    #[must_use]
    pub fn no_text(page_id: String, image: ImageIdentity) -> Self {
        Self {
            schema: RESULT_SCHEMA_V2.to_owned(),
            page_id,
            image,
            attempts: Vec::new(),
            status: OcrStatus::NoText,
            markdown: None,
            blocks: Vec::new(),
            quality: Quality::default(),
            raw: None,
        }
    }

    /// Return whether the final state may be considered for automatic deposit.
    #[must_use]
    pub const fn is_depositable(&self) -> bool {
        matches!(self.status, OcrStatus::Text)
    }

    /// Whether the recognised blocks hold nothing but page furniture.
    ///
    /// A plate of pure illustration still carries its folio, and a detector
    /// reads it: `["004"]`. Depositing that as the plate's transcription is a
    /// wrong claim — the page says nothing, and a reader shown "004" as its
    /// text learns less than one shown nothing.
    ///
    /// The test is deliberately narrow. Furniture is digits, punctuation and
    /// isolated latin letters; anything carrying a letter in a word, a kana or
    /// an ideograph is text. `84-01 1984年 WJ51号` is a caption, not furniture,
    /// and must survive.
    #[must_use]
    pub fn is_page_furniture(&self) -> bool {
        if self.blocks.is_empty() {
            return false;
        }
        !self.blocks.iter().any(|block| {
            let words = block
                .text
                .split(|c: char| !c.is_alphanumeric())
                .filter(|word| word.chars().any(char::is_alphabetic));
            // A run of two or more letters is a word; a lone `a` beside a page
            // number is noise from the detector.
            words.clone().any(|word| word.chars().count() >= 2)
                || block
                    .text
                    .chars()
                    .any(|c| !c.is_ascii() && c.is_alphabetic())
        })
    }

    /// Drop detector noise, and record how much was dropped.
    ///
    /// A region detector on a printed plate returns, beside the real captions,
    /// short fragments that are not words: a stray `a`, a `®` lifted from a
    /// logo, a `●` bullet. They are noise in the strict sense — they carry no
    /// readable content — and they make a deposited transcription look wrong
    /// in a way a reader cannot repair.
    ///
    /// What is kept is deliberately generous: anything with a CJK character,
    /// anything with three or more alphanumerics, and any digit group of two
    /// or more (a folio, an issue number, a caption code). Only the residue
    /// goes.
    ///
    /// The count of dropped blocks lands in `quality.reasons`, because a
    /// filter that removes candidates without saying how many is how a corpus
    /// loses text nobody can then find.
    pub fn drop_noise_blocks(&mut self) {
        let before = self.blocks.len();
        self.blocks.retain(|block| {
            let text = block.text.trim();
            if text.chars().any(|c| !c.is_ascii() && c.is_alphabetic()) {
                return true;
            }
            let alphanumerics = text.chars().filter(|c| c.is_alphanumeric()).count();
            alphanumerics >= 3
        });
        let dropped = before - self.blocks.len();
        if dropped > 0 {
            self.quality
                .reasons
                .push(format!("dropped-{dropped}-noise-block(s)"));
        }
    }

    /// How much readable content the blocks hold: CJK characters plus latin
    /// words of three letters or more.
    ///
    /// Digits are excluded on purpose. A plate whose blocks are `006` and a
    /// single `公` scores 1, and one whose blocks are two dated captions
    /// scores eight; the number is what separates a caption from a glyph the
    /// detector found in a drawing.
    #[must_use]
    pub fn content_score(&self) -> usize {
        self.blocks
            .iter()
            .map(|block| {
                let cjk = block
                    .text
                    .chars()
                    .filter(|c| !c.is_ascii() && c.is_alphabetic())
                    .count();
                let words = block
                    .text
                    .split(|c: char| !c.is_ascii_alphabetic())
                    .filter(|word| word.len() >= 3)
                    .count();
                cjk + words
            })
            .sum()
    }

    /// Parse one JSONL line, accepting both the v2 contract and the historical
    /// `PageResult` shape written by earlier batches.
    ///
    /// A legacy line carries no provenance — the model and backend that
    /// produced it were never recorded — so the converted record has no
    /// attempt rather than an invented one. What it does carry (the path, the
    /// markdown, and the explicit "no text" verdict) is preserved exactly.
    ///
    /// Returns `None` for a line that is neither shape, so a caller can count
    /// and report what it refused instead of dropping it silently.
    #[must_use]
    pub fn from_jsonl_line(line: &str) -> Option<Self> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        if value.get("schema").is_some() {
            return serde_json::from_value(value).ok();
        }
        let image = value.get("image")?.as_str()?;
        let markdown = value
            .get("text")
            .and_then(|text| text.get("markdown"))
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        let status = if markdown.is_some() {
            OcrStatus::Text
        } else {
            OcrStatus::NoText
        };
        Some(Self {
            schema: RESULT_SCHEMA_V2.to_owned(),
            page_id: image.to_owned(),
            image: ImageIdentity::from_path(PathBuf::from(image)),
            attempts: Vec::new(),
            status,
            markdown,
            blocks: Vec::new(),
            quality: Quality::default(),
            raw: value
                .get("raw")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_text_is_not_depositable() {
        let result = OcrResult::no_text(
            "page-1".into(),
            ImageIdentity::from_path("page-1.jpg".into()),
        );
        assert_eq!(result.schema, RESULT_SCHEMA_V2);
        assert_eq!(result.status, OcrStatus::NoText);
        assert!(!result.is_depositable());
    }

    #[test]
    fn result_round_trips_without_eliding_status() {
        let result = OcrResult {
            schema: RESULT_SCHEMA_V2.into(),
            page_id: "lot-001/1.jpg".into(),
            image: ImageIdentity::from_path("1.jpg".into()),
            attempts: Vec::new(),
            status: OcrStatus::NeedsReview,
            markdown: Some("uncertain".into()),
            blocks: Vec::new(),
            quality: Quality {
                mean_confidence: Some(0.42),
                reasons: vec!["low-confidence".into()],
            },
            raw: None,
        };
        let encoded = serde_json::to_string(&result).unwrap();
        let decoded: OcrResult = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, result);
        assert!(!decoded.is_depositable());
    }

    fn with_blocks(texts: &[&str]) -> OcrResult {
        let mut result = OcrResult::no_text("p".into(), ImageIdentity::from_path("p.jpg".into()));
        result.blocks = texts
            .iter()
            .map(|text| OcrBlock {
                text: (*text).to_owned(),
                polygon: None,
                confidence: Some(0.9),
                role: None,
            })
            .collect();
        result
    }

    #[test]
    fn a_caption_page_scores_far_above_a_glyph_page() {
        // Databook 28, plate 0005: two dated captions.
        let captions = with_blocks(&["1984", "84-011984WJ51号其之会", "84-021984WJ52号真之三"]);
        assert!(
            captions.content_score() >= 4,
            "score {}",
            captions.content_score()
        );

        // Databook 29: a folio and one glyph lifted out of a drawing.
        let glyph = with_blocks(&["006", "公"]);
        assert!(glyph.content_score() < 4, "score {}", glyph.content_score());

        // A lone latin name is not a transcription either.
        let name = with_blocks(&["008", "BULMA"]);
        assert!(name.content_score() < 4, "score {}", name.content_score());

        // But a real title line is.
        let title = with_blocks(&["019", "DRAGONBAL アニメイラスト集　金色の戦士"]);
        assert!(
            title.content_score() >= 4,
            "score {}",
            title.content_score()
        );
    }

    #[test]
    fn noise_goes_and_captions_stay() {
        // The exact blocks PP-OCR returned for databook 28, plate 0005.
        let mut result = with_blocks(&[
            "1984",
            "a",
            "14029",
            "®",
            "●",
            "84-011984WJ51号其之会",
            "84-021984WJ52号真之三",
            "6",
        ]);
        result.drop_noise_blocks();
        let kept: Vec<&str> = result.blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(
            kept,
            [
                "1984",
                "14029",
                "84-011984WJ51号其之会",
                "84-021984WJ52号真之三"
            ]
        );
        assert_eq!(result.quality.reasons, ["dropped-4-noise-block(s)"]);
    }

    #[test]
    fn dropping_nothing_leaves_no_reason_behind() {
        let mut result = with_blocks(&["Dragon Ball", "ブイジャンプ"]);
        result.drop_noise_blocks();
        assert_eq!(result.blocks.len(), 2);
        assert!(result.quality.reasons.is_empty());
    }

    #[test]
    fn a_folio_alone_is_furniture() {
        assert!(with_blocks(&["004"]).is_page_furniture());
        assert!(with_blocks(&["004", "-"]).is_page_furniture());
        assert!(with_blocks(&["6", "®", "a"]).is_page_furniture());
    }

    #[test]
    fn a_caption_beside_a_folio_is_not_furniture() {
        // Measured on databook 28: this is exactly what PP-OCR returns for a
        // plate whose captions must be deposited.
        assert!(!with_blocks(&["1984", "84-011984WJ51号其之会", "6"]).is_page_furniture());
        assert!(!with_blocks(&["Dragon Ball"]).is_page_furniture());
        assert!(!with_blocks(&["ブイジャンプ"]).is_page_furniture());
    }

    #[test]
    fn a_page_with_no_block_is_not_called_furniture() {
        // No block means the detector found nothing; that is `no-text`, a
        // different statement from "it found only a page number".
        assert!(!with_blocks(&[]).is_page_furniture());
    }

    #[test]
    fn legacy_line_keeps_its_text_and_claims_no_provenance() {
        let line = r#"{"image":"lot/1.jpg","text":{"kind":"text","markdown":"hi"},"elapsed_ms":9}"#;
        let result = OcrResult::from_jsonl_line(line).unwrap();
        assert_eq!(result.page_id, "lot/1.jpg");
        assert_eq!(result.markdown.as_deref(), Some("hi"));
        assert_eq!(result.status, OcrStatus::Text);
        assert!(result.attempts.is_empty());
    }

    #[test]
    fn legacy_none_is_no_text_not_empty_text() {
        let line = r#"{"image":"lot/2.jpg","text":{"kind":"none"},"elapsed_ms":4}"#;
        let result = OcrResult::from_jsonl_line(line).unwrap();
        assert_eq!(result.status, OcrStatus::NoText);
        assert!(result.markdown.is_none());
        assert!(!result.is_depositable());
    }

    #[test]
    fn v2_line_round_trips_through_the_reader() {
        let source = OcrResult::no_text("p".into(), ImageIdentity::from_path("p.jpg".into()));
        let line = serde_json::to_string(&source).unwrap();
        assert_eq!(OcrResult::from_jsonl_line(&line).unwrap(), source);
    }

    #[test]
    fn an_unparsable_line_is_refused_rather_than_invented() {
        assert!(OcrResult::from_jsonl_line("{not json").is_none());
        assert!(OcrResult::from_jsonl_line("{\"unrelated\":1}").is_none());
        assert!(OcrResult::from_jsonl_line("   ").is_none());
    }
}
