// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Pure-Rust Adobe Photoshop (.psd) multi-layer document exporter.
//!
//! Generates valid Photoshop files with background, cleaned inpaint plate,
//! masks, and fully editable text layers (`TySh`) + PackBits RLE compression.

pub mod descriptor;
pub mod document;
pub mod engine_data;
pub mod packbits;
pub mod writer;

use image::RgbaImage;
use thiserror::Error;

pub use document::{PsdDocument, PsdExportOptions, PsdLayer, TextMetadata};
use descriptor::{DescriptorObject, DescriptorValue, bounds_descriptor, write_versioned_descriptor};
use engine_data::{TextEngineSpec, encode_engine_data};
use packbits::{ChannelId, encode_image_rle};
use writer::PsdWriter;
use crate::typeset::WritingMode;

#[derive(Debug, Error)]
pub enum PsdExportError {
    #[error("classic PSD only supports dimensions up to 30000x30000, got {width}x{height}")]
    UnsupportedDimensions { width: u32, height: u32 },
    #[error("PSD layer count exceeds limit: {0}")]
    TooManyLayers(usize),
    #[error("invalid layer bounds for {layer}: {width}x{height}")]
    InvalidLayerBounds {
        layer: String,
        width: i32,
        height: i32,
    },
    #[error("RLE row {row} for {layer} exceeded PSD limits ({length} bytes)")]
    InvalidChannelEncoding {
        layer: String,
        row: usize,
        length: usize,
    },
    #[error("invalid descriptor data: {0}")]
    InvalidDescriptor(String),
}

/// Serializes a `PsdDocument` into raw PSD file bytes.
pub fn export_psd(document: &PsdDocument) -> Result<Vec<u8>, PsdExportError> {
    if document.width == 0 || document.height == 0 || document.width > 30_000 || document.height > 30_000 {
        return Err(PsdExportError::UnsupportedDimensions {
            width: document.width,
            height: document.height,
        });
    }

    let merged_has_alpha = has_transparency(&document.merged);
    let mut psd = PsdWriter::new();

    // 1. Header (26 bytes)
    write_header(&mut psd, document.width, document.height, merged_has_alpha);

    // 2. Color mode data (empty for RGB)
    psd.write_u32(0);

    // 3. Image resources (empty)
    psd.write_u32(0);

    // 4. Layer and mask section
    let layer_mask_info = build_layer_and_mask_info(&document.layers, merged_has_alpha)?;
    psd.write_u32(layer_mask_info.len() as u32);
    psd.write_bytes(&layer_mask_info);

    // 5. Merged image data (composite)
    let mut merged = document.merged.clone();
    if merged_has_alpha {
        apply_photoshop_white_matte(&mut merged);
    }
    write_image_data(&mut psd, &merged, merged_has_alpha, "Merged Composite")?;

    Ok(psd.into_inner())
}

fn write_header(writer: &mut PsdWriter, width: u32, height: u32, has_alpha: bool) {
    writer.write_signature("8BPS");
    writer.write_u16(1); // Version 1 (standard PSD)
    writer.write_zeroes(6);
    writer.write_u16(if has_alpha { 4 } else { 3 }); // Channels: RGB or RGBA
    writer.write_u32(height);
    writer.write_u32(width);
    writer.write_u16(8); // 8 bits per channel
    writer.write_u16(3); // Color mode 3 = RGB
}

fn build_layer_and_mask_info(
    layers: &[PsdLayer],
    merged_has_alpha: bool,
) -> Result<Vec<u8>, PsdExportError> {
    let mut layer_info = PsdWriter::new();
    let count = i16::try_from(layers.len()).map_err(|_| PsdExportError::TooManyLayers(layers.len()))?;
    layer_info.write_i16(if merged_has_alpha { -count } else { count });

    let mut encoded_layers = Vec::with_capacity(layers.len());
    let mut extra_data = Vec::with_capacity(layers.len());

    for layer in layers {
        // GIMP/Photoshop: Alpha first for layer channel data, followed by RGB
        let channels = encode_image_rle(
            &layer.pixels,
            &[
                ChannelId::Alpha,
                ChannelId::Red,
                ChannelId::Green,
                ChannelId::Blue,
            ],
            &layer.name,
        )?;
        encoded_layers.push(channels);
        extra_data.push(build_extra_data(layer)?);
    }

    for ((layer, channels), extra) in layers.iter().zip(&encoded_layers).zip(&extra_data) {
        let width = layer.pixels.width() as i32;
        let height = layer.pixels.height() as i32;
        let right = layer.left + width;
        let bottom = layer.top + height;

        layer_info.write_i32(layer.top);
        layer_info.write_i32(layer.left);
        layer_info.write_i32(bottom);
        layer_info.write_i32(right);
        layer_info.write_u16(channels.len() as u16);

        for channel in channels {
            layer_info.write_i16(channel.channel_id);
            layer_info.write_u32((channel.data.len() + 2) as u32); // RLE compression marker (2 bytes) + data
        }

        layer_info.write_signature("8BIM");
        layer_info.write_signature("norm"); // Blend mode normal
        layer_info.write_u8(255); // Opacity 100%
        layer_info.write_u8(0);   // Clipping
        layer_info.write_u8(if layer.hidden { 2 } else { 0 }); // Flags: 2 = hidden, 0 = visible
        layer_info.write_u8(0);   // Filler

        layer_info.write_u32(extra.len() as u32);
        layer_info.write_bytes(extra);
    }

    // Write pixel channel data for each layer
    for channels in encoded_layers {
        for channel in channels {
            layer_info.write_u16(1); // RLE compression tag
            layer_info.write_bytes(&channel.data);
        }
    }

    let mut out = PsdWriter::new();
    let body = layer_info.into_inner();
    out.write_u32(body.len() as u32);
    out.write_bytes(&body);
    Ok(out.into_inner())
}

fn build_extra_data(layer: &PsdLayer) -> Result<Vec<u8>, PsdExportError> {
    let mut extra = PsdWriter::new();
    extra.write_u32(0); // Mask data size
    extra.write_u32(0); // Blending ranges size
    extra.write_pascal_string(&layer.name, 4);

    // Layer ID tag (`lyid`)
    write_additional_info_block(&mut extra, "lyid", &layer.id.to_be_bytes(), 4);

    // Unicode layer name tag (`luni`)
    let luni = luni_body(&layer.name);
    write_additional_info_block(&mut extra, "luni", &luni, 4);

    // Editable text layer resource (`TySh`)
    if let Some(text) = &layer.text {
        let tysh = build_tysh_body(text)?;
        write_additional_info_block(&mut extra, "TySh", &tysh, 4);
    }

    Ok(extra.into_inner())
}

fn luni_body(name: &str) -> Vec<u8> {
    let mut writer = PsdWriter::new();
    writer.write_unicode_string_with_padding(name);
    writer.into_inner()
}

fn build_tysh_body(text: &TextMetadata) -> Result<Vec<u8>, PsdExportError> {
    let engine_data = encode_engine_data(&TextEngineSpec {
        text: text.text.clone(),
        font_index: text.font_index,
        font_set: text.font_set.clone(),
        font_size: text.font_size,
        color: text.color,
        faux_bold: false,
        faux_italic: false,
        writing_mode: text.writing_mode,
        justification: text.justification,
        box_width: text.box_width,
        box_height: text.box_height,
    });

    let text_descriptor = DescriptorObject::new("", "TxLr")
        .with_item("Txt ", DescriptorValue::Text(text.text.clone()))
        .with_item("TextIndex", DescriptorValue::Integer(text.index))
        .with_item("EngineData", DescriptorValue::Raw(engine_data));

    let warp_descriptor = DescriptorObject::new("", "warp")
        .with_item(
            "warpStyle",
            DescriptorValue::Enum {
                type_id: "warpStyle".to_owned(),
                value: "warpNone".to_owned(),
            },
        )
        .with_item("warpValue", DescriptorValue::Double(0.0))
        .with_item("warpPerspective", DescriptorValue::Double(0.0))
        .with_item("warpPerspectiveOther", DescriptorValue::Double(0.0))
        .with_item(
            "warpRotate",
            DescriptorValue::Enum {
                type_id: "Ornt".to_owned(),
                value: match text.writing_mode {
                    WritingMode::Horizontal => "Hrzn".to_owned(),
                    WritingMode::VerticalRl => "Vrtc".to_owned(),
                },
            },
        )
        .with_item(
            "bounds",
            DescriptorValue::Object(bounds_descriptor(
                "bounds",
                text.bounds[0],
                text.bounds[1],
                text.bounds[2],
                text.bounds[3],
            )),
        );

    let mut body = PsdWriter::new();
    body.write_i16(1); // Version
    for val in text.transform {
        body.write_f64(val);
    }
    body.write_i16(50); // Text descriptor version
    write_versioned_descriptor(&mut body, &text_descriptor)?;
    body.write_i16(1); // Warp descriptor version
    write_versioned_descriptor(&mut body, &warp_descriptor)?;

    body.write_i32(text.bounds[1].round() as i32); // Top
    body.write_i32(text.bounds[0].round() as i32); // Left
    body.write_i32(text.bounds[3].round() as i32); // Bottom
    body.write_i32(text.bounds[2].round() as i32); // Right
    body.pad_to_multiple(4);

    Ok(body.into_inner())
}

fn write_additional_info_block(writer: &mut PsdWriter, key: &str, body: &[u8], alignment: usize) {
    let padding = (alignment - (body.len() % alignment)) % alignment;
    writer.write_signature("8BIM");
    writer.write_signature(key);
    writer.write_u32((body.len() + padding) as u32);
    writer.write_bytes(body);
    writer.write_zeroes(padding);
}

fn write_image_data(
    writer: &mut PsdWriter,
    image: &RgbaImage,
    has_alpha: bool,
    name: &str,
) -> Result<(), PsdExportError> {
    writer.write_u16(1); // RLE compression
    let mut channel_ids = vec![ChannelId::Red, ChannelId::Green, ChannelId::Blue];
    if has_alpha {
        channel_ids.push(ChannelId::Alpha);
    }
    let channels = encode_image_rle(image, &channel_ids, name)?;
    let row_lengths_len = image.height() as usize * 2;
    for channel in &channels {
        writer.write_bytes(&channel.data[..row_lengths_len]);
    }
    for channel in &channels {
        writer.write_bytes(&channel.data[row_lengths_len..]);
    }
    Ok(())
}

fn has_transparency(image: &RgbaImage) -> bool {
    image.pixels().any(|pixel| pixel[3] < 255)
}

fn apply_photoshop_white_matte(image: &mut RgbaImage) {
    for pixel in image.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        if alpha == 255 {
            continue;
        }
        for channel in &mut pixel.0[..3] {
            *channel = ((u32::from(*channel) * alpha + 128) / 255 + 255 - alpha) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};
    use super::*;

    #[test]
    fn test_export_basic_psd_produces_valid_header_and_signature() {
        let width = 64;
        let height = 64;
        let background = RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]));

        let mut doc = PsdDocument::new(width, height, background.clone());
        doc.add_layer(PsdLayer::new(1, "Background", 0, 0, background));

        let psd_bytes = export_psd(&doc).expect("PSD export should succeed");

        assert!(psd_bytes.len() > 100);
        assert_eq!(&psd_bytes[0..4], b"8BPS"); // Magic signature
        assert_eq!(&psd_bytes[4..6], &[0, 1]); // Version 1
    }

    #[test]
    fn test_export_psd_with_editable_text_layer() {
        let width = 100;
        let height = 100;
        let background = RgbaImage::from_pixel(width, height, Rgba([255, 255, 255, 255]));

        let mut doc = PsdDocument::new(width, height, background.clone());
        doc.add_layer(PsdLayer::new(1, "Artwork", 0, 0, background));

        let text_layer = PsdLayer::new_text_layer(
            2,
            "Dialogue",
            10,
            10,
            RgbaImage::from_pixel(80, 40, Rgba([0, 0, 0, 0])),
            TextMetadata {
                index: 1,
                text: "Kamehameha !".to_string(),
                bounds: [10.0, 10.0, 90.0, 50.0],
                transform: [1.0, 0.0, 0.0, 1.0, 10.0, 10.0],
                writing_mode: WritingMode::Horizontal,
                justification: crate::typeset::TextJustification::Center,
                font_index: 0,
                font_set: vec!["ArialMT".to_string()],
                font_size: 14.0,
                color: [0, 0, 0, 255],
                box_width: 80.0,
                box_height: 40.0,
            },
        );
        doc.add_layer(text_layer);

        let psd_bytes = export_psd(&doc).expect("PSD with text should succeed");
        assert!(psd_bytes.windows(4).any(|w| w == b"TySh"));
        assert!(psd_bytes.windows(4).any(|w| w == b"lyid"));
        assert!(psd_bytes.windows(10).any(|w| w == b"EngineData"));
    }
}
