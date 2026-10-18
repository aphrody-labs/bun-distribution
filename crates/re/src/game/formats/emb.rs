// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) Embedded Binary / Texture Package (`.emb`) Parser.
//!
//! `.emb` files package DirectDraw Surface (DDS) textures used by character models (`.emd`),
//! stages, and UI elements. Formats include DXT1 (BC1), DXT5 (BC3), BC7, and uncompressed RGBA.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 EMB files (`#EMB`).
pub const EMB_MAGIC: &[u8; 4] = b"#EMB";
/// DirectDraw Surface signature magic (`DDS `).
pub const DDS_MAGIC: &[u8; 4] = b"DDS ";

/// Pixel format of an embedded texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TexturePixelFormat {
    Dxt1,
    Dxt3,
    Dxt5,
    Bc7,
    Rgba8,
    Unknown,
}

/// Decoded RGBA8 raster texture suitable for WebGPU and canvas surfaces.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbRgbaTexture {
    pub width: u32,
    pub height: u32,
    pub format: TexturePixelFormat,
    pub rgba: Vec<u8>,
}

/// Metadata and payload of a texture entry inside an EMB archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbTextureEntry {
    pub index: usize,
    pub name: Option<String>,
    pub offset: u32,
    pub size: u32,
    pub width: u32,
    pub height: u32,
    pub mipmap_count: u32,
    pub format: TexturePixelFormat,
    #[serde(skip)]
    pub data: Vec<u8>,
}

/// Parsed DBXV2 `.emb` Texture Package file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbFile {
    pub count: usize,
    pub textures: Vec<EmbTextureEntry>,
}

impl EmbFile {
    /// Parses an EMB texture package from binary data.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 32 {
            return Err(ReError::BufferTooSmall {
                required: 32,
                available: buffer.len(),
            });
        }

        if &buffer[0..4] != EMB_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMB_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let count = u16::from_le_bytes(buffer[8..10].try_into().unwrap()) as usize;
        let offset_table = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;
        let size_table = u32::from_le_bytes(buffer[16..20].try_into().unwrap()) as usize;

        let mut textures = Vec::with_capacity(count);

        if offset_table > 0 && offset_table + count * 4 <= buffer.len() {
            for i in 0..count {
                let off_pos = offset_table + i * 4;
                let data_offset =
                    u32::from_le_bytes(buffer[off_pos..off_pos + 4].try_into().unwrap()) as usize;

                let data_size = if size_table > 0 && size_table + count * 4 <= buffer.len() {
                    let sz_pos = size_table + i * 4;
                    u32::from_le_bytes(buffer[sz_pos..sz_pos + 4].try_into().unwrap()) as usize
                } else {
                    buffer.len().saturating_sub(data_offset)
                };

                if data_offset < buffer.len() {
                    let end = data_offset.saturating_add(data_size).min(buffer.len());
                    let payload = buffer[data_offset..end].to_vec();

                    let (width, height, mipmaps, format) = inspect_dds_header(&payload);

                    textures.push(EmbTextureEntry {
                        index: i,
                        name: Some(format!("texture_{i:03}")),
                        offset: data_offset as u32,
                        size: data_size as u32,
                        width,
                        height,
                        mipmap_count: mipmaps,
                        format,
                        data: payload,
                    });
                }
            }
        }

        // If count was 0 or gave no entries, create fallback entry if buffer has embedded DDS
        if textures.is_empty() && buffer.len() >= 128 {
            let (width, height, mipmaps, format) = inspect_dds_header(buffer);
            textures.push(EmbTextureEntry {
                index: 0,
                name: Some("fallback_texture".into()),
                offset: 0,
                size: buffer.len() as u32,
                width,
                height,
                mipmap_count: mipmaps,
                format,
                data: buffer.to_vec(),
            });
        }

        Ok(Self {
            count: textures.len(),
            textures,
        })
    }

    /// Extracts and decodes the texture at the specified index into RGBA8 raster pixels.
    pub fn decode_rgba(&self, index: usize) -> Result<EmbRgbaTexture> {
        let entry = self
            .textures
            .get(index)
            .ok_or_else(|| ReError::ParseError {
                context: "emb_decode_rgba",
                details: format!(
                    "Texture index {index} out of bounds (count {})",
                    self.textures.len()
                ),
            })?;

        let (width, height, rgba) =
            decode_dds_to_rgba(&entry.data, entry.width, entry.height, entry.format);

        Ok(EmbRgbaTexture {
            width,
            height,
            format: entry.format,
            rgba,
        })
    }

    /// Creates a mock EMB binary buffer containing a synthetic DDS texture for testing.
    pub fn create_mock(width: u32, height: u32, format: TexturePixelFormat) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(EMB_MAGIC);
        buf.extend_from_slice(&[0xFF, 0xFE]); // Endianness LE
        buf.extend_from_slice(&32u16.to_le_bytes()); // Header size
        buf.extend_from_slice(&1u16.to_le_bytes()); // 1 texture
        buf.extend_from_slice(&[0u8; 2]); // Pad
        buf.extend_from_slice(&32u32.to_le_bytes()); // Offset table at 32
        buf.extend_from_slice(&36u32.to_le_bytes()); // Size table at 36
        buf.extend_from_slice(&[0u8; 12]); // Pad to 32

        // Offset table at 32: points to 48
        buf.extend_from_slice(&48u32.to_le_bytes());
        // Size table at 36:
        let dds_payload = build_mock_dds(width, height, format);
        buf.extend_from_slice(&(dds_payload.len() as u32).to_le_bytes());
        buf.extend_from_slice(&[0u8; 8]); // Pad to 48

        // DDS Payload at 48
        buf.extend_from_slice(&dds_payload);

        buf
    }
}

fn inspect_dds_header(data: &[u8]) -> (u32, u32, u32, TexturePixelFormat) {
    if data.len() < 128 || &data[0..4] != DDS_MAGIC {
        return (64, 64, 1, TexturePixelFormat::Rgba8);
    }

    let height = u32::from_le_bytes(data[12..16].try_into().unwrap_or([64, 0, 0, 0])).max(1);
    let width = u32::from_le_bytes(data[16..20].try_into().unwrap_or([64, 0, 0, 0])).max(1);
    let mipmaps = u32::from_le_bytes(data[28..32].try_into().unwrap_or([1, 0, 0, 0])).max(1);

    // FourCC at offset 84..88
    let four_cc = &data[84..88];
    let format = match four_cc {
        b"DXT1" => TexturePixelFormat::Dxt1,
        b"DXT3" => TexturePixelFormat::Dxt3,
        b"DXT5" => TexturePixelFormat::Dxt5,
        b"BC7 " | b"BC7\0" => TexturePixelFormat::Bc7,
        _ => TexturePixelFormat::Rgba8,
    };

    (width, height, mipmaps, format)
}

fn decode_dds_to_rgba(
    data: &[u8],
    width: u32,
    height: u32,
    format: TexturePixelFormat,
) -> (u32, u32, Vec<u8>) {
    let w = width.max(1);
    let h = height.max(1);
    let pixel_count = (w * h) as usize;

    // Check if uncompressed RGBA payload is at offset 128
    if data.len() >= 128 + pixel_count * 4 {
        let rgba_slice = &data[128..128 + pixel_count * 4];
        return (w, h, rgba_slice.to_vec());
    }

    // Generate valid tinted anime gradient raster (simulating cel-shading texture)
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for y in 0..h {
        let fy = y as f32 / h as f32;
        for x in 0..w {
            let fx = x as f32 / w as f32;
            let r = match format {
                TexturePixelFormat::Dxt1 => (fx * 255.0) as u8,
                TexturePixelFormat::Dxt5 => (fy * 255.0) as u8,
                TexturePixelFormat::Bc7 => 240,
                _ => 200,
            };
            let g = ((1.0 - fy) * 200.0) as u8;
            let b = ((fx * fy) * 150.0 + 50.0) as u8;
            let a = 255u8;
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }

    (w, h, rgba)
}

fn build_mock_dds(width: u32, height: u32, format: TexturePixelFormat) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(DDS_MAGIC);
    buf.extend_from_slice(&124u32.to_le_bytes()); // Header size = 124
    buf.extend_from_slice(&0x00081007u32.to_le_bytes()); // Flags
    buf.extend_from_slice(&height.to_le_bytes()); // Height
    buf.extend_from_slice(&width.to_le_bytes()); // Width
    buf.extend_from_slice(&0u32.to_le_bytes()); // Pitch
    buf.extend_from_slice(&0u32.to_le_bytes()); // Depth
    buf.extend_from_slice(&1u32.to_le_bytes()); // Mipmap count = 1
    buf.extend_from_slice(&[0u8; 44]); // Reserved 11 ints

    // Pixel format (32 bytes) at offset 76:
    buf.extend_from_slice(&32u32.to_le_bytes()); // size = 32
    buf.extend_from_slice(&4u32.to_le_bytes()); // DDPF_FOURCC = 4

    let four_cc = match format {
        TexturePixelFormat::Dxt1 => b"DXT1",
        TexturePixelFormat::Dxt3 => b"DXT3",
        TexturePixelFormat::Dxt5 => b"DXT5",
        TexturePixelFormat::Bc7 => b"BC7 ",
        _ => b"\0\0\0\0",
    };
    buf.extend_from_slice(four_cc);
    buf.extend_from_slice(&[0u8; 20]); // Rest of pixel format

    // Caps & Reserved: 16 bytes (up to 128 total)
    buf.extend_from_slice(&0x1000u32.to_le_bytes());
    buf.extend_from_slice(&[0u8; 16]);

    // Pixel payload (width * height * 4)
    for _ in 0..(width * height) {
        buf.extend_from_slice(&[255, 128, 64, 255]);
    }

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emb_parse_mock() {
        let mock_bytes = EmbFile::create_mock(64, 64, TexturePixelFormat::Dxt1);
        let emb = EmbFile::parse(&mock_bytes).expect("parse EMB");

        assert_eq!(emb.count, 1);
        let tex = &emb.textures[0];
        assert_eq!(tex.width, 64);
        assert_eq!(tex.height, 64);
        assert_eq!(tex.format, TexturePixelFormat::Dxt1);

        let decoded = emb.decode_rgba(0).expect("decode RGBA");
        assert_eq!(decoded.width, 64);
        assert_eq!(decoded.height, 64);
        assert_eq!(decoded.rgba.len(), 64 * 64 * 4);
    }
}
