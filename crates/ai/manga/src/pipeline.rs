// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga page processing through Koharu's headless library.

use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::bubble::SpeechBubble;
#[cfg(feature = "koharu")]
use crate::bubble::{BoundingBox, BubbleKind, Point, sort_manga_reading_order};

pub const PAGE_RESULT_SCHEMA: &str = "aphrody.manga.page-result/v1";

#[derive(Clone, Serialize, Deserialize)]
pub struct MangaPipelineOptions {
    pub target_language: String,
    pub cpu: bool,
    #[cfg(feature = "koharu")]
    #[serde(skip)]
    pub pipeline_config: Option<koharu_library::PipelineConfig>,
    #[cfg(feature = "koharu")]
    #[serde(skip)]
    pub providers_config: Option<koharu_library::ProvidersConfig>,
}

impl Default for MangaPipelineOptions {
    fn default() -> Self {
        Self::new("fr", true)
    }
}

impl MangaPipelineOptions {
    /// Options for one target language and device, with Koharu's own pipeline and provider
    /// configuration. Callers build through this so a `koharu` build adds no field to them.
    #[must_use]
    pub fn new(target_language: impl Into<String>, cpu: bool) -> Self {
        Self {
            target_language: target_language.into(),
            cpu,
            #[cfg(feature = "koharu")]
            pipeline_config: None,
            #[cfg(feature = "koharu")]
            providers_config: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaSource {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_id: Option<String>,
    pub source_sha256: String,
    pub image_sha256: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plate_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaGeneration {
    pub producer: String,
    pub model: Option<String>,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaDetectionLabel {
    pub kind: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaText {
    pub id: String,
    pub reading_order: Option<usize>,
    pub source_text: Option<String>,
    pub source_language: Option<String>,
    pub ocr_confidence: Option<f32>,
    pub ocr_provenance: Option<MangaGeneration>,
    pub translated_text: Option<String>,
    pub target_language: Option<String>,
    pub translation_provenance: Option<MangaGeneration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaRegion {
    /// Stable within this page result; Koharu's in-memory UUID is not exposed.
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
    /// Original image pixel coordinates.
    pub bounds: MangaBounds,
    pub polygon: Vec<MangaPoint>,
    pub reading_order: Option<usize>,
    pub detection_labels: Vec<MangaDetectionLabel>,
    pub detection_confidence: Option<f32>,
    pub source_text: Option<String>,
    pub source_language: Option<String>,
    pub ocr_confidence: Option<f32>,
    pub translated_text: Option<String>,
    pub target_language: Option<String>,
    pub provenance: MangaRegionProvenance,
    pub texts: Vec<MangaText>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaRegionProvenance {
    pub detection: Option<MangaGeneration>,
    pub ocr: Option<MangaGeneration>,
    pub translation: Option<MangaGeneration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaPipelineProvenance {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaArtifacts {
    pub cleanup_overlay_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaPageResult {
    pub schema: String,
    pub source: MangaSource,
    pub width: u32,
    pub height: u32,
    pub regions: Vec<MangaRegion>,
    pub bubbles: Vec<SpeechBubble>,
    pub artifacts: MangaArtifacts,
    pub cleanup_provenance: Option<MangaGeneration>,
    pub pipeline: MangaPipelineProvenance,
    pub target_language: String,
}

pub struct MangaPageOutput {
    pub result: MangaPageResult,
    pub psd_bytes: Option<Vec<u8>>,
    pub png_bytes: Option<Vec<u8>>,
    pub cleanup_overlay_png: Option<Vec<u8>>,
    /// OCR model selected by the Koharu pipeline configuration.
    pub ocr_model_id: String,
    /// Actual processing time for the full Koharu stage run, excluding initialization and export.
    pub pipeline_elapsed_ms: u128,
}

#[derive(Debug, Error)]
pub enum MangaPipelineError {
    #[error("Koharu native manga pipeline is unavailable; build with aphrody-manga/koharu")]
    Unavailable,
    #[error("unsupported target language: {0}")]
    Language(String),
    #[error("manga image format is unsupported: {0}")]
    ImageFormat(String),
    #[error("manga image encoding failed: {0}")]
    ImageEncode(#[from] image::ImageError),
    #[error("Koharu manga pipeline failed: {0}")]
    Koharu(String),
}

pub struct MangaPipeline;

impl MangaPipeline {
    /// Execute detection, OCR, translation, inpainting, and native PNG/PSD export.
    pub async fn process_image_bytes(
        bytes: &[u8],
        options: &MangaPipelineOptions,
    ) -> Result<MangaPageOutput, MangaPipelineError> {
        Self::run_image_bytes(bytes, options, true).await
    }

    /// Execute the real Koharu detector without loading later stage models.
    pub async fn detect_image_bytes(
        bytes: &[u8],
        options: &MangaPipelineOptions,
    ) -> Result<MangaPageOutput, MangaPipelineError> {
        Self::run_image_bytes(bytes, options, false).await
    }

    /// Process a decoded image when its original encoded bytes are unavailable.
    pub async fn process_page(
        image: &RgbaImage,
        options: &MangaPipelineOptions,
    ) -> Result<(MangaPageResult, Vec<u8>), MangaPipelineError> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image.clone()).write_to(&mut cursor, ImageFormat::Png)?;
        let output = Self::process_image_bytes(&cursor.into_inner(), options).await?;
        Ok((
            output.result,
            output.psd_bytes.ok_or_else(|| {
                MangaPipelineError::Koharu("Koharu did not export a PSD".to_owned())
            })?,
        ))
    }

    #[cfg(not(feature = "koharu"))]
    async fn run_image_bytes(
        _bytes: &[u8],
        _options: &MangaPipelineOptions,
        _full: bool,
    ) -> Result<MangaPageOutput, MangaPipelineError> {
        Err(MangaPipelineError::Unavailable)
    }

    #[cfg(feature = "koharu")]
    async fn run_image_bytes(
        bytes: &[u8],
        options: &MangaPipelineOptions,
        full: bool,
    ) -> Result<MangaPageOutput, MangaPipelineError> {
        use koharu_library::{
            Document, Library, Operation, PipelineConfig, ProvidersConfig, Request, Stage,
        };

        let mime = match image::guess_format(bytes)? {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::WebP => "image/webp",
            other => return Err(MangaPipelineError::ImageFormat(format!("{other:?}"))),
        };
        let mut config = if let Some(config) = options.pipeline_config.clone() {
            config
        } else {
            PipelineConfig::load()
                .and_then(|handle| handle.read().map(|value| value.clone()))
                .map_err(|_| {
                    MangaPipelineError::Koharu("pipeline configuration is unavailable".to_owned())
                })?
        };
        config.translation.target_language = options
            .target_language
            .parse()
            .map_err(|_| MangaPipelineError::Language(options.target_language.clone()))?;
        let providers = if let Some(providers) = options.providers_config.clone() {
            providers
        } else {
            ProvidersConfig::load()
                .and_then(|handle| handle.read().map(|value| value.clone()))
                .map_err(|_| {
                    MangaPipelineError::Koharu("provider configuration is unavailable".to_owned())
                })?
        };
        let ocr_model_id = serde_json::to_value(&config.ocr)
            .ok()
            .and_then(|value| value.get("model")?.as_str().map(str::to_owned))
            .ok_or_else(|| {
                MangaPipelineError::Koharu("OCR model identifier is unavailable".to_owned())
            })?;
        let library = Library::initialize(config, providers, options.cpu).await.map_err(|_| {
            MangaPipelineError::Koharu("native runtime initialization failed".to_owned())
        })?;
        let mut document = Document::memory()
            .await
            .map_err(|_| MangaPipelineError::Koharu("scene creation failed".to_owned()))?;
        let page = document
            .import_raster("page", bytes.to_vec())
            .await
            .map_err(|_| MangaPipelineError::Koharu("image import failed".to_owned()))?;
        let request = Request {
            operation: if full {
                Operation::Full
            } else {
                Operation::Only { stage: Stage::Detection }
            },
            ..Request::default()
        };
        let started = std::time::Instant::now();
        library.process(&mut document, request).await.map_err(|error| {
            MangaPipelineError::Koharu(format!("stage {:?} failed ({:?})", error.stage, error.kind))
        })?;
        let pipeline_elapsed_ms = started.elapsed().as_millis();
        let page_data = document
            .page_result(page)
            .await
            .map_err(|_| MangaPipelineError::Koharu("page result extraction failed".to_owned()))?;
        let cleanup_overlay_png = page_data.cleanup_layer_png.clone();
        let result = map_page(page_data, bytes, mime, options);
        let psd_bytes = if full {
            Some(
                library
                    .export_psd(&document, page, &koharu_library::PsdExportOptions::default())
                    .await
                    .map_err(|_| MangaPipelineError::Koharu("PSD export failed".to_owned()))?,
            )
        } else {
            None
        };
        let png_bytes = if full {
            Some(
                library
                    .export_png(&document, page)
                    .await
                    .map_err(|_| MangaPipelineError::Koharu("PNG export failed".to_owned()))?,
            )
        } else {
            None
        };
        Ok(MangaPageOutput {
            result,
            psd_bytes,
            png_bytes,
            cleanup_overlay_png,
            ocr_model_id,
            pipeline_elapsed_ms,
        })
    }
}

#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect::<String>()
}

#[cfg(feature = "koharu")]
fn map_generation(value: koharu_library::GenerationInfo) -> MangaGeneration {
    MangaGeneration { producer: value.producer, model: value.model, confidence: value.confidence }
}

#[cfg(feature = "koharu")]
fn map_page(
    page: koharu_library::PageResult,
    bytes: &[u8],
    mime: &str,
    options: &MangaPipelineOptions,
) -> MangaPageResult {
    let digest = sha256_hex(bytes);
    let cleanup_overlay_sha256 = page.cleanup_layer_png.as_ref().map(|png| sha256_hex(png));
    let cleanup_provenance = page.cleanup_provenance.map(map_generation);
    let mut bubbles = Vec::new();
    let mut source_regions = page.regions;
    source_regions.sort_by(|left, right| {
        left.bounds[1]
            .total_cmp(&right.bounds[1])
            .then_with(|| right.bounds[2].total_cmp(&left.bounds[2]))
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.label.cmp(&right.label))
    });
    let mut regions = Vec::with_capacity(source_regions.len());
    for (index, region) in source_regions.into_iter().enumerate() {
        let id = format!("r{:04}", index + 1);
        let bounds = region.bounds;
        let polygon =
            region.polygon.iter().map(|point| MangaPoint { x: point.x, y: point.y }).collect();
        if region.kind == "dev.koharu.region.bubble" {
            let mut bubble = SpeechBubble::new(
                index + 1,
                BoundingBox::new(
                    bounds[0] as f32,
                    bounds[1] as f32,
                    (bounds[2] - bounds[0]) as f32,
                    (bounds[3] - bounds[1]) as f32,
                ),
                BubbleKind::Unclassified,
                region.confidence.unwrap_or(0.0),
            );
            bubble.contour = region
                .polygon
                .iter()
                .map(|point| Point::new(point.x as f32, point.y as f32))
                .collect();
            bubbles.push(bubble);
        }
        let texts: Vec<MangaText> = region
            .texts
            .into_iter()
            .enumerate()
            .map(|(text_index, text)| MangaText {
                id: format!("{id}-t{:04}", text_index + 1),
                reading_order: text.reading_order.map(|order| order + 1),
                source_text: text.source,
                source_language: text.source_language,
                ocr_confidence: text.ocr_confidence,
                ocr_provenance: text.ocr_provenance.map(map_generation),
                translated_text: text.translation,
                target_language: text.target_language,
                translation_provenance: text.translation_provenance.map(map_generation),
            })
            .collect();
        let first = texts.first();
        regions.push(MangaRegion {
            id: id.clone(),
            kind: region.kind,
            label: region.label,
            bounds: MangaBounds {
                x: bounds[0],
                y: bounds[1],
                width: bounds[2] - bounds[0],
                height: bounds[3] - bounds[1],
            },
            polygon,
            reading_order: first.and_then(|text| text.reading_order),
            detection_labels: region
                .detection_labels
                .into_iter()
                .map(|label| MangaDetectionLabel {
                    kind: label.kind.as_str().to_owned(),
                    confidence: label.confidence,
                })
                .collect(),
            detection_confidence: region.confidence,
            source_text: first.and_then(|text| text.source_text.clone()),
            source_language: first.and_then(|text| text.source_language.clone()),
            ocr_confidence: first.and_then(|text| text.ocr_confidence),
            translated_text: first.and_then(|text| text.translated_text.clone()),
            target_language: first.and_then(|text| text.target_language.clone()),
            provenance: MangaRegionProvenance {
                detection: region.detection_provenance.map(map_generation),
                ocr: first.and_then(|text| text.ocr_provenance.clone()),
                translation: first.and_then(|text| text.translation_provenance.clone()),
            },
            texts,
        });
    }
    sort_manga_reading_order(&mut bubbles);
    MangaPageResult {
        schema: PAGE_RESULT_SCHEMA.to_owned(),
        source: MangaSource {
            kind: "image".to_owned(),
            page_id: None,
            source_sha256: digest.clone(),
            image_sha256: digest,
            mime: mime.to_owned(),
            width: page.width as u32,
            height: page.height as u32,
            entity_id: None,
            plate_number: None,
            url: None,
        },
        width: page.width as u32,
        height: page.height as u32,
        regions,
        bubbles,
        artifacts: MangaArtifacts { cleanup_overlay_sha256 },
        cleanup_provenance,
        pipeline: MangaPipelineProvenance {
            name: "koharu-library".to_owned(),
            version: koharu_library::VERSION.to_owned(),
        },
        target_language: options.target_language.clone(),
    }
}
