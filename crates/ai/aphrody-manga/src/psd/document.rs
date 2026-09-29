// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! PSD Document model with layer hierarchies and text metadata.

use image::RgbaImage;
use crate::typeset::{TextJustification, WritingMode};

/// Options controlling multi-layer PSD file export.
#[derive(Debug, Clone)]
pub struct PsdExportOptions {
    /// Include original artwork as bottom background layer.
    pub include_original: bool,
    /// Include inpainting / cleaned artwork layer.
    pub include_cleaned: bool,
    /// Include text removal mask layer.
    pub include_mask: bool,
    /// Make dialogue layers editable Photoshop text layers (`TySh`).
    pub editable_text_layers: bool,
}

impl Default for PsdExportOptions {
    fn default() -> Self {
        Self {
            include_original: true,
            include_cleaned: true,
            include_mask: true,
            editable_text_layers: true,
        }
    }
}

/// Metadata for an editable Photoshop text layer (`TySh`).
#[derive(Debug, Clone)]
pub struct TextMetadata {
    pub index: i32,
    pub text: String,
    pub bounds: [f64; 4],
    pub transform: [f64; 6],
    pub writing_mode: WritingMode,
    pub justification: TextJustification,
    pub font_index: usize,
    pub font_set: Vec<String>,
    pub font_size: f64,
    pub color: [u8; 4],
    pub box_width: f64,
    pub box_height: f64,
}

/// A layer inside the PSD file.
#[derive(Debug, Clone)]
pub struct PsdLayer {
    pub id: i32,
    pub name: String,
    pub left: i32,
    pub top: i32,
    pub pixels: RgbaImage,
    pub hidden: bool,
    pub text: Option<TextMetadata>,
}

impl PsdLayer {
    /// Create a standard image layer.
    #[must_use]
    pub fn new(id: i32, name: impl Into<String>, left: i32, top: i32, pixels: RgbaImage) -> Self {
        Self {
            id,
            name: name.into(),
            left,
            top,
            pixels,
            hidden: false,
            text: None,
        }
    }

    /// Create an editable text layer with raster fallback.
    #[must_use]
    pub fn new_text_layer(
        id: i32,
        name: impl Into<String>,
        left: i32,
        top: i32,
        pixels: RgbaImage,
        text: TextMetadata,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            left,
            top,
            pixels,
            hidden: false,
            text: Some(text),
        }
    }
}

/// A complete multi-layer PSD document ready for serialization.
#[derive(Debug, Clone)]
pub struct PsdDocument {
    pub width: u32,
    pub height: u32,
    pub merged: RgbaImage,
    pub layers: Vec<PsdLayer>,
}

impl PsdDocument {
    /// Create a new document.
    #[must_use]
    pub fn new(width: u32, height: u32, merged: RgbaImage) -> Self {
        Self {
            width,
            height,
            merged,
            layers: Vec::new(),
        }
    }

    /// Add a layer to the document.
    pub fn add_layer(&mut self, layer: PsdLayer) {
        self.layers.push(layer);
    }
}
