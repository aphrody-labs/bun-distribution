// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! PSD channel extraction and PackBits row encoding.

use crate::psd::PsdExportError;
use image::RgbaImage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelId {
    Red,
    Green,
    Blue,
    Alpha,
}

impl ChannelId {
    #[must_use]
    pub fn psd_id(self) -> i16 {
        match self {
            Self::Red => 0,
            Self::Green => 1,
            Self::Blue => 2,
            Self::Alpha => -1,
        }
    }

    fn rgba_offset(self) -> usize {
        match self {
            Self::Red => 0,
            Self::Green => 1,
            Self::Blue => 2,
            Self::Alpha => 3,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EncodedChannel {
    pub channel_id: i16,
    pub data: Vec<u8>,
}

pub fn encode_image_rle(
    image: &RgbaImage,
    channels: &[ChannelId],
    layer_name: &str,
) -> Result<Vec<EncodedChannel>, PsdExportError> {
    let mut encoded = Vec::with_capacity(channels.len());

    for &channel in channels {
        let mut lengths = Vec::with_capacity(image.height() as usize);
        let mut data = Vec::new();
        let width = image.width() as usize;
        let offset = channel.rgba_offset();

        for y in 0..image.height() {
            let start = data.len();
            let mut row = Vec::with_capacity(width);
            for x in 0..image.width() {
                row.push(image.get_pixel(x, y).0[offset]);
            }
            encode_row(&row, &mut data);
            let row_length = data.len() - start;
            if row_length > u16::MAX as usize {
                return Err(PsdExportError::InvalidChannelEncoding {
                    layer: layer_name.to_string(),
                    row: y as usize,
                    length: row_length,
                });
            }
            lengths.push(row_length as u16);
        }

        let mut out = Vec::with_capacity(lengths.len() * 2 + data.len());
        for length in lengths {
            out.extend_from_slice(&length.to_be_bytes());
        }
        out.extend_from_slice(&data);
        encoded.push(EncodedChannel { channel_id: channel.psd_id(), data: out });
    }

    Ok(encoded)
}

fn encode_row(row: &[u8], out: &mut Vec<u8>) {
    let mut i = 0usize;
    while i < row.len() {
        let run_len = repeated_run_len(row, i);
        if run_len >= 3 {
            let chunk = run_len.min(128);
            out.push((1i16 - chunk as i16) as u8);
            out.push(row[i]);
            i += chunk;
        } else {
            let lit_len = literal_run_len(row, i).min(128);
            out.push((lit_len as i16 - 1) as u8);
            out.extend_from_slice(&row[i..i + lit_len]);
            i += lit_len;
        }
    }
}

fn repeated_run_len(bytes: &[u8], start: usize) -> usize {
    let val = bytes[start];
    bytes[start..].iter().take_while(|&&b| b == val).count()
}

fn literal_run_len(bytes: &[u8], start: usize) -> usize {
    let mut len = 0;
    while start + len < bytes.len() {
        if repeated_run_len(bytes, start + len) >= 3 {
            break;
        }
        len += 1;
    }
    len.max(1)
}
