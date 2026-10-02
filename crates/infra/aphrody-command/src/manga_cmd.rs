// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! CLI command `aphrody manga`: Koharu page analysis, cleanup, and PSD export.

use std::{io::Write, path::{Path, PathBuf}};
use clap::{Subcommand, ValueEnum};
use miette::{IntoDiagnostic, Result};
use aphrody_manga::{
    MangaCdnClient, MangaPageResult, MangaPipeline, MangaPipelineOptions,
    image,
    inpaint::{InpaintOptions, MangaInpainter, TextMask},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum MangaDevice {
    Cpu,
    Gpu,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum MangaSourceKind {
    Manga,
    Databook,
}

/// Actions under `aphrody manga`.
#[derive(Debug, Subcommand)]
pub(crate) enum MangaAction {
    /// List Koharu's current pipeline and translation model choices.
    #[cfg(feature = "koharu")]
    Models {
        /// Include translation models discovered from configured providers.
        #[arg(long)]
        translation: bool,
    },
    /// Inspect or edit Koharu's persisted processing preferences.
    #[cfg(feature = "koharu")]
    Preferences {
        #[command(subcommand)]
        action: crate::manga_settings_cmd::PreferencesAction,
    },
    /// Detect real Koharu regions, including text, bubbles and panels.
    Detect {
        /// Path to the manga image (PNG, JPEG).
        image: PathBuf,
        /// Output detection results as JSON.
        #[arg(long)]
        json: bool,
        #[arg(long, value_enum, default_value_t = MangaDevice::Cpu)]
        device: MangaDevice,
    },
    /// Export Koharu's cleanup overlay, or apply a supplied mask with the local CPU inpainter.
    Inpaint {
        /// Input manga image path.
        image: PathBuf,
        /// Output clean plate image path.
        #[arg(short, long)]
        output: PathBuf,
        /// Optional binary mask image path.
        #[arg(long)]
        mask: Option<PathBuf>,
    },
    /// Run Koharu page processing and export a layered Photoshop document.
    ExportPsd {
        /// Original artwork path.
        image: PathBuf,
        /// Output .psd file path.
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Run Koharu detection, OCR, translation, inpainting and export.
    Pipeline {
        /// Manga page image path.
        image: PathBuf,
        /// Target language (e.g. "fr", "en").
        #[arg(short, long, default_value = "fr")]
        to: String,
        /// Output .psd or .png file path.
        #[arg(short, long)]
        output: PathBuf,
        /// Emit one versioned candidate JSON record on stdout.
        #[arg(long)]
        json: bool,
        /// Write the same completed run as an Aphrody OCR v2 review record.
        #[arg(long, value_name = "JSON_PATH")]
        ocr_result: Option<PathBuf>,
        /// Canonical Shenron manga page ID; required for a manga candidate.
        #[arg(long)]
        page_id: Option<String>,
        /// SHA-256 of the canonical original scan when input is a derived image.
        #[arg(long)]
        source_sha256: Option<String>,
        /// Assert the SHA-256 of exact image bytes sent to Koharu.
        #[arg(long)]
        image_sha256: Option<String>,
        #[arg(long, value_enum, default_value_t = MangaSourceKind::Manga)]
        kind: MangaSourceKind,
        /// Numeric Shenron databook ID for a normalized review image.
        #[arg(long)]
        entity_id: Option<u64>,
        /// Plate number for a normalized databook review image.
        #[arg(long)]
        plate_number: Option<u32>,
        #[arg(long, value_enum, default_value_t = MangaDevice::Cpu)]
        device: MangaDevice,
    },
    /// Process an image from a CDN URL or relative path with Koharu.
    Cdn {
        /// CDN URL or relative wiki media path (e.g. "assets/wiki/databooks/312/0001.jpg").
        url: String,
        /// Target language (default: "fr").
        #[arg(short, long, default_value = "fr")]
        to: String,
        /// Output .psd file path.
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Stream and scanlate a databook plate directly from the Dragon Ball FR catalog by ID and plate number.
    Databook {
        /// Databook ID (e.g. 312).
        id: u64,
        /// Plate/page number.
        #[arg(short, long)]
        page: u32,
        /// Target language (default: "fr").
        #[arg(short, long, default_value = "fr")]
        to: String,
        /// Output .psd or .png file path.
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        source_sha256: Option<String>,
        #[arg(long)]
        image_sha256: Option<String>,
        #[arg(long, value_enum, default_value_t = MangaDevice::Cpu)]
        device: MangaDevice,
    },
    /// Stream and scanlate a manga chapter plate directly from the Dragon Ball FR catalog.
    Chapter {
        /// Chapter ID.
        id: u64,
        /// Plate number within chapter (1 = first plate).
        #[arg(short, long)]
        page: u32,
        /// Target language (default: "fr").
        #[arg(short, long, default_value = "fr")]
        to: String,
        /// Output .psd or .png file path.
        #[arg(short, long)]
        output: PathBuf,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        page_id: Option<String>,
        #[arg(long)]
        source_sha256: Option<String>,
        #[arg(long)]
        image_sha256: Option<String>,
        #[arg(long, value_enum, default_value_t = MangaDevice::Cpu)]
        device: MangaDevice,
    },
}

/// Executes the `aphrody manga` CLI action.
fn validate_sha256(value: String) -> Result<String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(miette::miette!("SHA-256 must be exactly 64 hexadecimal characters"));
    }
    Ok(value.to_ascii_lowercase())
}

fn require_extension(path: &Path, expected: &str) -> Result<()> {
    if path.extension().and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
    {
        Ok(())
    } else {
        Err(miette::miette!("output must use .{expected} extension"))
    }
}

fn validate_page_id(value: &str) -> Result<()> {
    let parts: Vec<_> = value.split(':').collect();
    let valid = parts.len() == 3
        && matches!(parts[0], "DB" | "DBS")
        && ["vol", "t", "ch"].iter().any(|prefix| {
            parts[1].strip_prefix(prefix).is_some_and(|digits| {
                !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
        && parts[2].bytes().next().is_some_and(|byte| (b'1'..=b'9').contains(&byte))
        && parts[2].bytes().all(|byte| byte.is_ascii_digit());
    if !valid {
        return Err(miette::miette!(
            "page ID must match DB:volN:page or DBS:chN:page"
        ));
    }
    Ok(())
}

fn preflight_candidate(
    json: bool,
    page_id: &Option<String>,
    source_sha256: &Option<String>,
) -> Result<()> {
    if json && (page_id.is_none() || source_sha256.is_none()) {
        return Err(miette::miette!(
            "--json requires --page-id and --source-sha256 for a reviewable manga candidate"
        ));
    }
    if let Some(page_id) = page_id {
        validate_page_id(page_id)?;
    }
    if let Some(digest) = source_sha256 {
        let _ = validate_sha256(digest.clone())?;
    }
    Ok(())
}

fn preflight_databook_candidate(
    json: bool,
    page_id: &Option<String>,
    source_sha256: &Option<String>,
    image_sha256: &Option<String>,
    entity_id: Option<u64>,
    plate_number: Option<u32>,
) -> Result<()> {
    if page_id.is_some() {
        return Err(miette::miette!("databook candidates use numeric ID and plate number, not --page-id"));
    }
    if json && (source_sha256.is_none() || image_sha256.is_none()
        || entity_id.is_none() || plate_number.is_none())
    {
        return Err(miette::miette!(
            "databook --json requires --entity-id, --plate-number, --source-sha256 and --image-sha256"
        ));
    }
    if let Some(digest) = source_sha256 {
        let _ = validate_sha256(digest.clone())?;
    }
    if entity_id == Some(0) || plate_number == Some(0) {
        return Err(miette::miette!("databook ID and plate number must be positive"));
    }
    Ok(())
}

fn assert_image_sha256(actual: &str, expected: Option<String>) -> Result<()> {
    if let Some(expected) = expected {
        let expected = validate_sha256(expected)?;
        if actual != expected {
            return Err(miette::miette!(
                "image SHA-256 mismatch: expected {expected}, got {actual}"
            ));
        }
    }
    Ok(())
}

fn apply_candidate_identity(
    result: &mut MangaPageResult,
    page_id: Option<String>,
    source_sha256: Option<String>,
) -> Result<()> {
    if let Some(page_id) = page_id {
        validate_page_id(&page_id)?;
        result.source.kind = "manga".to_owned();
        result.source.page_id = Some(page_id);
        result.source.source_sha256 = validate_sha256(
            source_sha256.ok_or_else(|| {
                miette::miette!("--source-sha256 is required with --page-id")
            })?,
        )?;
    } else if let Some(digest) = source_sha256 {
        result.source.source_sha256 = validate_sha256(digest)?;
    }
    Ok(())
}

pub(crate) async fn run(action: MangaAction) -> Result<()> {
    match action {
        #[cfg(feature = "koharu")]
        MangaAction::Models { translation } => {
            crate::manga_settings_cmd::models(translation).await?;
        }
        #[cfg(feature = "koharu")]
        MangaAction::Preferences { action } => {
            crate::manga_settings_cmd::preferences(action)?;
        }
        MangaAction::Detect { image, json, device } => {
            let bytes = std::fs::read(&image).into_diagnostic()?;
            let options = MangaPipelineOptions {
                cpu: device == MangaDevice::Cpu,
                ..Default::default()
            };
            let page_result = MangaPipeline::detect_image_bytes(&bytes, &options)
                .await
                .map_err(|e| miette::miette!("Manga detection failed: {e}"))?
                .result;

            if json {
                let serialized = serde_json::to_string(&page_result)
                    .into_diagnostic()?;
                println!("{serialized}");
            } else {
                println!("=== Manga Analysis for {} ===", image.display());
                println!("Dimensions: {}x{} px", page_result.width, page_result.height);
                println!("Detected regions: {}", page_result.regions.len());
                println!("Bubble regions: {}", page_result.bubbles.len());
                for b in &page_result.bubbles {
                    println!(
                        "  [#{}] {:?} at ({:.1}, {:.1}) size {:.1}x{:.1} (conf: {:.2})",
                        b.reading_order, b.kind, b.bounds.x, b.bounds.y, b.bounds.width, b.bounds.height, b.confidence
                    );
                }
            }
        }
        MangaAction::Inpaint { image, output, mask } => {
            if let Some(mask_path) = mask {
                let img = image::open(&image).into_diagnostic()?.to_rgba8();
                let m = image::open(mask_path).into_diagnostic()?.to_luma8();
                let cleaned = MangaInpainter::inpaint(
                    &img,
                    &TextMask { mask: m },
                    &InpaintOptions::default(),
                );
                cleaned.save(&output).into_diagnostic()?;
            } else {
                require_extension(&output, "png")?;
                let bytes = std::fs::read(&image).into_diagnostic()?;
                let run = MangaPipeline::process_image_bytes(&bytes, &MangaPipelineOptions::default())
                    .await
                    .map_err(|e| miette::miette!("Inpaint failed: {e}"))?;
                let png = run.cleanup_overlay_png.ok_or_else(|| {
                    miette::miette!("Koharu produced no cleanup overlay")
                })?;
                std::fs::write(&output, png).into_diagnostic()?;
            }
            println!("Inpainting output saved to {}", output.display());
        }
        MangaAction::ExportPsd { image, output } => {
            require_extension(&output, "psd")?;
            let bytes = std::fs::read(&image).into_diagnostic()?;
            let options = MangaPipelineOptions::default();
            let run = MangaPipeline::process_image_bytes(&bytes, &options).await
                .map_err(|e| miette::miette!("PSD generation failed: {e}"))?;
            let psd_bytes = run.psd_bytes.ok_or_else(|| miette::miette!("Koharu did not export PSD"))?;
            std::fs::write(&output, psd_bytes).into_diagnostic()?;
            println!("Layered Photoshop document saved to {}", output.display());
        }
        MangaAction::Pipeline {
            image, to, output, json, ocr_result, page_id, source_sha256, image_sha256,
            kind, entity_id, plate_number, device,
        } => {
            let review_record = json || ocr_result.is_some();
            match kind {
                MangaSourceKind::Manga => preflight_candidate(review_record, &page_id, &source_sha256)?,
                MangaSourceKind::Databook => preflight_databook_candidate(
                    review_record, &page_id, &source_sha256, &image_sha256, entity_id, plate_number,
                )?,
            }
            if let Some(path) = &ocr_result {
                require_extension(path, "json")?;
                if image_sha256.is_none() {
                    return Err(miette::miette!("--ocr-result requires --image-sha256 from the source manifest"));
                }
            }
            if !output.extension().and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("psd") || value.eq_ignore_ascii_case("png"))
            {
                return Err(miette::miette!("pipeline output must use .psd or .png extension"));
            }
            let bytes = std::fs::read(&image).into_diagnostic()?;
            assert_image_sha256(&aphrody_manga::sha256_hex(&bytes), image_sha256)?;
            let options = MangaPipelineOptions::new(to.clone(), device == MangaDevice::Cpu);

            let run = MangaPipeline::process_image_bytes(&bytes, &options).await
                .map_err(|e| miette::miette!("Pipeline execution failed: {e}"))?;
            let ocr_record = if ocr_result.is_some() {
                let stable_id = match kind {
                    MangaSourceKind::Manga => page_id.clone().expect("candidate identity was checked"),
                    MangaSourceKind::Databook => format!(
                        "databook:{}:{}",
                        entity_id.expect("candidate identity was checked"),
                        plate_number.expect("candidate identity was checked"),
                    ),
                };
                Some(run.ocr_result_v2(stable_id, image.clone())
                    .map_err(|error| miette::miette!("OCR projection failed: {error}"))?)
            } else {
                None
            };
            let mut res = run.result;
            match kind {
                MangaSourceKind::Manga => apply_candidate_identity(&mut res, page_id, source_sha256)?,
                MangaSourceKind::Databook => {
                    res.source.kind = "databook".to_owned();
                    res.source.entity_id = entity_id;
                    res.source.plate_number = plate_number;
                    if let Some(digest) = source_sha256 {
                        res.source.source_sha256 = validate_sha256(digest)?;
                    }
                }
            }

            if output.extension().and_then(|e| e.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("psd"))
            {
                let psd_bytes = run.psd_bytes.ok_or_else(|| miette::miette!("Koharu did not export PSD"))?;
                std::fs::write(&output, psd_bytes).into_diagnostic()?;
                if !json {
                    println!("Full manga scanlation PSD written to {}", output.display());
                }
            } else {
                let png_bytes = run.png_bytes.ok_or_else(|| miette::miette!("Koharu did not export PNG"))?;
                std::fs::write(&output, png_bytes).into_diagnostic()?;
                if !json {
                    println!("Manga scanlation image written to {}", output.display());
                }
            }
            if let (Some(path), Some(record)) = (ocr_result, ocr_record) {
                let bytes = serde_json::to_vec_pretty(&record).into_diagnostic()?;
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .into_diagnostic()?
                    .write_all(&bytes)
                    .into_diagnostic()?;
                eprintln!("wrote Aphrody OCR v2 result to {}", path.display());
            }
            if json {
                println!("{}", serde_json::to_string(&res).into_diagnostic()?);
            } else {
                println!("Processed {} bubbles in reading order for target '{}'", res.bubbles.len(), to);
            }
        }
        MangaAction::Cdn { url, to, output } => {
            require_extension(&output, "psd")?;
            let client = MangaCdnClient::new();
            let options = MangaPipelineOptions {
                target_language: to.clone(),
                ..Default::default()
            };

            println!("Streaming plate from CDN: {url}...");
            let (res, psd_bytes) = client.scanlate_cdn_plate(&url, &options).await
                .map_err(|e| miette::miette!("CDN scanlation failed: {e}"))?;

            std::fs::write(&output, psd_bytes).into_diagnostic()?;
            println!("Processed {} speech bubbles. PSD written to {}", res.bubbles.len(), output.display());
        }
        MangaAction::Databook { id, page, to, output, json, source_sha256, image_sha256, device } => {
            require_extension(&output, "psd")?;
            preflight_databook_candidate(
                json, &None, &source_sha256, &image_sha256, Some(id), Some(page),
            )?;
            if let Some(digest) = &image_sha256 {
                let _ = validate_sha256(digest.clone())?;
            }
            let client = MangaCdnClient::new();
            let options = MangaPipelineOptions::new(to.clone(), device == MangaDevice::Cpu);

            if !json {
                println!("Streaming databook #{id} plate #{page} from catalog...");
            }
            let (mut res, psd_bytes, record) = client.scanlate_databook_plate(id, page, &options).await
                .map_err(|e| miette::miette!("Databook scanlation failed: {e}"))?;
            assert_image_sha256(&res.source.image_sha256, image_sha256)?;
            if let Some(digest) = source_sha256 {
                res.source.source_sha256 = validate_sha256(digest)?;
            }

            std::fs::write(&output, psd_bytes).into_diagnostic()?;
            if json {
                println!("{}", serde_json::to_string(&res).into_diagnostic()?);
            } else {
                println!(
                    "Databook #{id} plate #{page} (CDN: {}) processed ({} bubbles). PSD written to {}",
                    record.cdn_url, res.bubbles.len(), output.display()
                );
            }
        }
        MangaAction::Chapter { id, page, to, output, json, page_id, source_sha256, image_sha256, device } => {
            require_extension(&output, "psd")?;
            preflight_candidate(json, &page_id, &source_sha256)?;
            if let Some(digest) = &image_sha256 {
                let _ = validate_sha256(digest.clone())?;
            }
            let client = MangaCdnClient::new();
            let options = MangaPipelineOptions::new(to.clone(), device == MangaDevice::Cpu);

            if !json {
                println!("Streaming manga chapter #{id} plate #{page} from catalog...");
            }
            let (mut res, psd_bytes, record) = client.scanlate_manga_plate(id, page, &options).await
                .map_err(|e| miette::miette!("Manga chapter scanlation failed: {e}"))?;
            assert_image_sha256(&res.source.image_sha256, image_sha256)?;
            apply_candidate_identity(&mut res, page_id, source_sha256)?;

            std::fs::write(&output, psd_bytes).into_diagnostic()?;
            if json {
                println!("{}", serde_json::to_string(&res).into_diagnostic()?);
            } else {
                println!(
                    "Manga chapter #{id} plate #{page} (CDN: {}) processed ({} bubbles). PSD written to {}",
                    record.cdn_url, res.bubbles.len(), output.display()
                );
            }
        }
    }
    Ok(())
}
