// SPDX-License-Identifier: Apache-2.0
//! MPEG-7 ColorLayout descriptor compatible with trace.moe-id 2.0.0.
//!
//! The transform, quantization tables and bit layout follow the MIT-licensed
//! `trace.moe-id` implementation by soruly; see `THIRD_PARTY_NOTICES.md`.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

use crate::error::{FramesError, Result};

pub const VECTOR_LENGTH: usize = 33;
pub const VECTOR_BYTES: usize = 33;
pub const HASH_BYTES: usize = 21;
const Y_COUNT: usize = 21;
const C_COUNT: usize = 6;
const WEIGHTS_Y: [f64; Y_COUNT] = [
    2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    1.0, 1.0,
];
const WEIGHTS_CB: [f64; C_COUNT] = [2.0, 1.0, 1.0, 1.0, 1.0, 1.0];
const WEIGHTS_CR: [f64; C_COUNT] = [4.0, 2.0, 2.0, 1.0, 1.0, 1.0];
const ZIGZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const COS: [[f64; 8]; 8] = [
    [0.3535534, 0.3535534, 0.3535534, 0.3535534, 0.3535534, 0.3535534, 0.3535534, 0.3535534],
    [0.4903926, 0.4157348, 0.2777851, 0.09754516, -0.09754516, -0.2777851, -0.4157348, -0.4903926],
    [0.4619398, 0.1913417, -0.1913417, -0.4619398, -0.4619398, -0.1913417, 0.1913417, 0.4619398],
    [0.4157348, -0.09754516, -0.4903926, -0.2777851, 0.2777851, 0.4903926, 0.09754516, -0.4157348],
    [0.3535534, -0.3535534, -0.3535534, 0.3535534, 0.3535534, -0.3535534, -0.3535534, 0.3535534],
    [0.2777851, -0.4903926, 0.09754516, 0.4157348, -0.4157348, -0.09754516, 0.4903926, -0.2777851],
    [0.1913417, -0.4619398, 0.4619398, -0.1913417, -0.1913417, 0.4619398, -0.4619398, 0.1913417],
    [0.09754516, -0.2777851, 0.4157348, -0.4903926, 0.4903926, -0.4157348, 0.2777851, -0.09754516],
];

/// 33 quantized MPEG-7 coefficients in Y, Cb, Cr order.
pub type ColorLayoutVector = [u8; VECTOR_LENGTH];

/// Extracts the interoperable 33-coefficient descriptor from tightly packed RGB pixels.
pub fn extract_color_layout(width: u32, height: u32, rgb: &[u8]) -> Result<ColorLayoutVector> {
    if width == 0 || height == 0 || width < 8 || height < 8 {
        return Err(FramesError::InvalidRequest(
            "ColorLayout input must be at least 8×8 pixels".into(),
        ));
    }
    let expected = width as usize * height as usize * 3;
    if rgb.len() != expected {
        return Err(FramesError::InvalidRequest(format!(
            "RGB buffer length {}, expected {expected}",
            rgb.len()
        )));
    }

    let mut channels = [[0_i16; 64]; 3];
    let x = std::array::from_fn::<_, 9, _>(|i| (i as u64 * width as u64).div_ceil(8) as usize);
    let y = std::array::from_fn::<_, 9, _>(|i| (i as u64 * height as u64).div_ceil(8) as usize);
    for by in 0..8 {
        for bx in 0..8 {
            let x0 = x[bx];
            let x1 = x[bx + 1];
            let y0 = y[by];
            let y1 = y[by + 1];
            let count = (x1 - x0) * (y1 - y0);
            if count == 0 {
                continue;
            }
            let mut r = 0.0_f32;
            let mut g = 0.0_f32;
            let mut b = 0.0_f32;
            for py in y0..y1 {
                for px in x0..x1 {
                    let offset = (py * width as usize + px) * 3;
                    r += f32::from(rgb[offset]);
                    g += f32::from(rgb[offset + 1]);
                    b += f32::from(rgb[offset + 2]);
                }
            }
            let inv = 1.0 / (count as f64 * 256.0);
            let (r, g, b) = (f64::from(r) * inv, f64::from(g) * inv, f64::from(b) * inv);
            let yy = 0.299 * r + 0.587 * g + 0.114 * b;
            let i = by * 8 + bx;
            channels[0][i] = (219.0 * yy + 16.5).floor() as i16;
            channels[1][i] = (126.336 * (b - yy) + 128.5).floor() as i16;
            channels[2][i] = (159.712 * (r - yy) + 128.5).floor() as i16;
        }
    }
    for channel in &mut channels {
        fdct(channel);
    }

    let mut output = [0_u8; VECTOR_LENGTH];
    output[0] = quant_y_dc(channels[0][0] >> 3) >> 1;
    output[Y_COUNT] = quant_c_dc(channels[1][0] >> 3);
    output[Y_COUNT + C_COUNT] = quant_c_dc(channels[2][0] >> 3);
    for i in 1..64 {
        let z = ZIGZAG[i];
        if i < Y_COUNT {
            output[i] = quant_ac(channels[0][z] >> 1) >> 3;
        }
        if i < C_COUNT {
            output[Y_COUNT + i] = quant_ac(channels[1][z]) >> 3;
        }
        if i < C_COUNT {
            output[Y_COUNT + C_COUNT + i] = quant_ac(channels[2][z]) >> 3;
        }
    }
    Ok(output)
}

/// MPEG-7 weighted Euclidean distance used by the source package.
pub fn color_layout_distance(a: &[u8], b: &[u8]) -> Result<f64> {
    if a.len() != VECTOR_LENGTH || b.len() != VECTOR_LENGTH {
        return Err(FramesError::InvalidVector(format!(
            "both vectors must have {VECTOR_LENGTH} coefficients"
        )));
    }
    let sum = |left: &[u8], right: &[u8], weights: &[f64]| -> f64 {
        left.iter()
            .zip(right)
            .zip(weights)
            .map(|((&x, &y), &w)| {
                let d = f64::from(x) - f64::from(y);
                w * d * d
            })
            .sum::<f64>()
            .sqrt()
    };
    Ok(sum(&a[..Y_COUNT], &b[..Y_COUNT], &WEIGHTS_Y)
        + sum(&a[Y_COUNT..Y_COUNT + C_COUNT], &b[Y_COUNT..Y_COUNT + C_COUNT], &WEIGHTS_CB)
        + sum(&a[Y_COUNT + C_COUNT..], &b[Y_COUNT + C_COUNT..], &WEIGHTS_CR))
}

pub fn similarity_from_distance(distance: f64) -> f64 {
    (1.0 - distance / 100.0).clamp(0.0, 1.0)
}

/// URL-safe, unpadded base64 accepted by trace.moe (`vector` query payload).
pub fn encode_color_layout(vector: &[u8]) -> Result<String> {
    if vector.len() != VECTOR_LENGTH {
        return Err(FramesError::InvalidVector(format!("expected {VECTOR_LENGTH} coefficients")));
    }
    let mut bytes = [0_u8; HASH_BYTES];
    let mut bit = 0;
    for (index, &value) in vector.iter().enumerate() {
        let width =
            if index == 0 || index == Y_COUNT || index == Y_COUNT + C_COUNT { 6 } else { 5 };
        let max = (1_u16 << width) - 1;
        if u16::from(value) > max {
            return Err(FramesError::InvalidVector(format!("coefficient {index} exceeds {max}")));
        }
        for shift in (0..width).rev() {
            if (value >> shift) & 1 != 0 {
                bytes[bit / 8] |= 1 << (7 - (bit % 8));
            }
            bit += 1;
        }
    }
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub fn decode_color_layout(hash: &str) -> Result<ColorLayoutVector> {
    let bytes =
        URL_SAFE_NO_PAD.decode(hash).map_err(|e| FramesError::InvalidVector(e.to_string()))?;
    if bytes.len() != HASH_BYTES {
        return Err(FramesError::InvalidVector(format!("hash must decode to {HASH_BYTES} bytes")));
    }
    let mut vector = [0_u8; VECTOR_LENGTH];
    let mut bit = 0;
    for (index, slot) in vector.iter_mut().enumerate() {
        let width =
            if index == 0 || index == Y_COUNT || index == Y_COUNT + C_COUNT { 6 } else { 5 };
        let mut value = 0;
        for _ in 0..width {
            value = (value << 1) | ((bytes[bit / 8] >> (7 - (bit % 8))) & 1);
            bit += 1;
        }
        *slot = value;
    }
    Ok(vector)
}

fn fdct(values: &mut [i16; 64]) {
    let mut scratch = [0_f32; 64];
    for row in 0..8 {
        for col in 0..8 {
            let mut sum = 0.0;
            for k in 0..8 {
                sum += COS[col][k] * f64::from(values[row * 8 + k]);
            }
            scratch[row * 8 + col] = sum as f32;
        }
    }
    for col in 0..8 {
        for row in 0..8 {
            let mut sum = 0.0;
            for k in 0..8 {
                sum += COS[row][k] * f64::from(scratch[k * 8 + col]);
            }
            // This reproduces the typed-array assignment after Math.floor in trace.moe-id.
            values[row * 8 + col] = (sum + 0.499999).floor() as i16;
        }
    }
}

fn quant_y_dc(i: i16) -> u8 {
    if i > 192 {
        (112 + ((i - 192) >> 2)) as u8
    } else if i > 160 {
        (96 + ((i - 160) >> 1)) as u8
    } else if i > 96 {
        (32 + i - 96) as u8
    } else if i > 64 {
        (16 + ((i - 64) >> 1)) as u8
    } else {
        (i >> 2) as u8
    }
}
fn quant_c_dc(i: i16) -> u8 {
    if i > 191 {
        63
    } else if i > 160 {
        (56 + ((i - 160) >> 2)) as u8
    } else if i > 144 {
        (48 + ((i - 144) >> 1)) as u8
    } else if i > 112 {
        (16 + i - 112) as u8
    } else if i > 96 {
        (8 + ((i - 96) >> 1)) as u8
    } else if i > 64 {
        ((i - 64) >> 2) as u8
    } else {
        0
    }
}
fn quant_ac(i: i16) -> u8 {
    let value = i.clamp(-256, 255);
    let abs = value.unsigned_abs() as i16;
    let encoded = if abs > 127 {
        64 + (abs >> 2)
    } else if abs > 63 {
        32 + (abs >> 1)
    } else {
        abs
    };
    (if value < 0 { -encoded } else { encoded } + 128) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoded_vector_matches_trace_moe_bit_layout() {
        let vector = std::array::from_fn::<_, VECTOR_LENGTH, _>(|index| {
            let width =
                if index == 0 || index == Y_COUNT || index == Y_COUNT + C_COUNT { 6 } else { 5 };
            (index as u8) & ((1 << width) - 1)
        });
        let hash = encode_color_layout(&vector).unwrap();
        assert_eq!(hash.len(), 28);
        assert_eq!(decode_color_layout(&hash).unwrap(), vector);
    }

    #[test]
    fn distance_and_similarity_are_stable() {
        let a = [0_u8; VECTOR_LENGTH];
        let mut b = a;
        b[0] = 10;
        assert_eq!(color_layout_distance(&a, &b).unwrap(), 10.0 * 2.0_f64.sqrt());
        assert_eq!(similarity_from_distance(10.0), 0.9);
    }
}
