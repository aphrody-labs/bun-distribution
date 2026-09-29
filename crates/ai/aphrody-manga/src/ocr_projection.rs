// SPDX-License-Identifier: Apache-2.0
//! Project Koharu's completed page run into Aphrody's shared OCR result contract.

use std::path::PathBuf;

use aphrody_ocr_core::{
    Attempt, AttemptStatus, ImageIdentity, OcrBlock, OcrResult, OcrStatus, Quality,
    RESULT_SCHEMA_V2, RunProvenance,
};
use thiserror::Error;

use crate::pipeline::MangaPageOutput;

#[derive(Debug, Error)]
pub enum OcrProjectionError {
    #[error("a detection-only Koharu result has no OCR outcome")]
    DetectionOnly,
    #[error("a stable page ID is required for the OCR result")]
    MissingPageId,
    #[error("the Koharu source image has no valid path or SHA-256 identity")]
    InvalidImageIdentity,
    #[error("Koharu region {0} has invalid original-image bounds")]
    InvalidGeometry(usize),
}

impl MangaPageOutput {
    /// Convert a completed Koharu page run to the shared OCR v2 record.
    ///
    /// `image_path` must be the path actually passed to Koharu. The image SHA
    /// comes from the exact encoded bytes used by that run. The attempt time
    /// covers all pipeline stages, as Koharu's page result has no OCR-only time.
    /// An empty transcription remains `needs-review`; this method does not
    /// infer that a Shenron page contains no text.
    pub fn ocr_result_v2(
        &self,
        page_id: impl Into<String>,
        image_path: PathBuf,
    ) -> Result<OcrResult, OcrProjectionError> {
        if self.psd_bytes.is_none() {
            return Err(OcrProjectionError::DetectionOnly);
        }
        let page_id = page_id.into();
        if page_id.trim().is_empty() {
            return Err(OcrProjectionError::MissingPageId);
        }
        if image_path.as_os_str().is_empty()
            || self.result.source.image_sha256.len() != 64
            || !self
                .result
                .source
                .image_sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(OcrProjectionError::InvalidImageIdentity);
        }
        let mut ordered = Vec::new();
        let mut confidence_sum = 0.0f64;
        let mut confidence_count = 0usize;
        let mut unreadable_regions = 0usize;
        let mut unknown_confidence = 0usize;
        for (region_index, region) in self.result.regions.iter().enumerate() {
            for (text_index, text) in region.texts.iter().enumerate() {
                let Some(source) =
                    text.source_text.as_deref().map(str::trim).filter(|value| !value.is_empty())
                else {
                    unreadable_regions += 1;
                    continue;
                };
                let bounds = &region.bounds;
                if !bounds.x.is_finite()
                    || !bounds.y.is_finite()
                    || !bounds.width.is_finite()
                    || !bounds.height.is_finite()
                    || bounds.x < 0.0
                    || bounds.y < 0.0
                    || bounds.width <= 0.0
                    || bounds.height <= 0.0
                    || bounds.x + bounds.width > f64::from(self.result.width)
                    || bounds.y + bounds.height > f64::from(self.result.height)
                {
                    return Err(OcrProjectionError::InvalidGeometry(region_index));
                }
                let left = bounds.x as f32;
                let top = bounds.y as f32;
                let right = (bounds.x + bounds.width) as f32;
                let bottom = (bounds.y + bounds.height) as f32;
                let confidence = text
                    .ocr_confidence
                    .filter(|value| value.is_finite() && (0.0..=1.0).contains(value));
                if let Some(confidence) = confidence {
                    confidence_sum += f64::from(confidence);
                    confidence_count += 1;
                } else {
                    unknown_confidence += 1;
                }
                ordered.push((
                    text.reading_order.unwrap_or(usize::MAX),
                    region_index,
                    text_index,
                    OcrBlock {
                        text: source.to_owned(),
                        polygon: Some([[left, top], [right, top], [right, bottom], [left, bottom]]),
                        confidence,
                        role: Some(region.kind.clone()),
                    },
                ));
            }
        }
        ordered.sort_by_key(|(order, region, text, _)| (*order, *region, *text));
        let blocks: Vec<_> = ordered.into_iter().map(|(_, _, _, block)| block).collect();
        let mut quality = Quality {
            mean_confidence: (confidence_count > 0)
                .then(|| (confidence_sum / confidence_count as f64) as f32),
            reasons: Vec::new(),
        };
        if blocks.is_empty() {
            quality
                .reasons
                .push("Koharu produced no readable OCR text; visual review required".to_owned());
        }
        if unreadable_regions > 0 {
            quality.reasons.push(format!(
                "{unreadable_regions} Koharu text region(s) have no readable source text"
            ));
        }
        if unknown_confidence > 0 {
            quality
                .reasons
                .push(format!("{unknown_confidence} OCR block(s) have no valid confidence score"));
        }
        quality.reasons.push("attempt duration covers all Koharu processing stages".to_owned());
        let status = if blocks.is_empty() || unreadable_regions > 0 || unknown_confidence > 0 {
            OcrStatus::NeedsReview
        } else {
            OcrStatus::Text
        };
        let markdown = (!blocks.is_empty())
            .then(|| blocks.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join("\n"));
        let attempt = Attempt {
            run: RunProvenance {
                model_id: self.ocr_model_id.clone(),
                backend: "koharu-full-pipeline".to_owned(),
                provider: None,
                model_digest: None,
                prompt_digest: None,
            },
            status: AttemptStatus::Completed,
            elapsed_ms: self.pipeline_elapsed_ms,
            quality: quality.clone(),
            error: None,
        };
        Ok(OcrResult {
            schema: RESULT_SCHEMA_V2.to_owned(),
            page_id,
            image: ImageIdentity {
                path: image_path,
                sha256: Some(self.result.source.image_sha256.clone()),
                media_type: Some(self.result.source.mime.clone()),
            },
            attempts: vec![attempt],
            status,
            markdown,
            blocks,
            quality,
            raw: None,
        })
    }
}
