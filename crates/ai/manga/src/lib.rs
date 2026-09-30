// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga processing and export for Aphrody, with an optional Koharu native runtime.
//!
//! # Architecture
//!
//! - [`bubble`]: Speech bubble geometry and Japanese manga reading order (Right-to-Left, Top-to-Bottom).
//! - [`onomatopoeia`]: Japanese manga SFX lookup and transliteration utilities.
//! - [`inpaint`]: Text mask dilation and boundary-weighted background reconstruction (clean plate generation).
//! - [`typeset`]: Dynamic text fitting inside bubble constraints, supporting horizontal and vertical CJK (`tategaki`), with *kinsoku shori* punctuation rules.
//! - [`psd`]: Pure-Rust multi-layer Adobe Photoshop (.psd) export with PackBits RLE compression, channels, and editable `TySh` text layers with EngineData.
//! - [`pipeline`]: Native Koharu page stages and versioned review candidate results.

#![allow(missing_docs)]
#![allow(clippy::module_name_repetitions)]

pub mod bubble;
pub mod catalog;
pub mod inpaint;
pub mod onomatopoeia;
pub mod ocr_projection;
pub mod pipeline;
pub mod psd;
pub mod typeset;

#[cfg(feature = "koharu")]
pub use koharu_library as koharu;

pub use bubble::{
    BoundingBox, BubbleKind, Point, SpeechBubble, sort_manga_reading_order,
};
pub use catalog::{CdnError, MangaCdnClient, PlateRecord};
pub use image;
pub use inpaint::{InpaintOptions, MangaInpainter, TextMask};
pub use onomatopoeia::{Onomatopoeia, SfxCategory, lookup_common_sfx};
pub use ocr_projection::OcrProjectionError;
pub use pipeline::{
    MangaPageOutput, MangaPageResult, MangaPipeline, MangaPipelineError, MangaPipelineOptions,
    MangaSource, PAGE_RESULT_SCHEMA, sha256_hex,
};
pub use psd::{
    PsdDocument, PsdExportError, PsdExportOptions, PsdLayer, TextMetadata, export_psd,
};
pub use typeset::{
    TextJustification, TextStyle, TypesetEngine, TypesetLayout, TypesetLine, WritingMode,
};
