// SPDX-License-Identifier: Apache-2.0
//! Pure Rust implementation of the CRI Middleware CRILAYLA decompression algorithm.
//!
//! CRILAYLA is the standard compressed payload found within CRIWARE CPK files and AWB sound archives.
//! Compression is an LZSS variant processed in reverse bitstream order.

use crate::game::error::{ReError, Result};

pub const CRILAYLA_MAGIC: &[u8; 8] = b"CRILAYLA";

/// Decompresses a CRILAYLA-compressed buffer with standard 16-byte header into raw uncompressed bytes.
pub fn decompress_crilayla(input: &[u8]) -> Result<Vec<u8>> {
    if input.len() < 16 {
        return Err(ReError::BufferTooSmall { required: 16, available: input.len() });
    }

    if &input[0..8] != CRILAYLA_MAGIC {
        return Err(ReError::InvalidMagic {
            expected: CRILAYLA_MAGIC.to_vec(),
            found: input[0..8].to_vec(),
        });
    }

    let uncompressed_size = u32::from_le_bytes(input[8..12].try_into().unwrap()) as usize;
    let uncompressed_header_offset = u32::from_le_bytes(input[12..16].try_into().unwrap()) as usize;

    let total_uncompressed_size = uncompressed_size + 0x100;
    let mut output = vec![0u8; total_uncompressed_size];

    // Copy the uncompressed 0x100 (256-byte) header
    let header_start = 16 + uncompressed_header_offset;
    if header_start + 0x100 <= input.len() {
        output[0..0x100].copy_from_slice(&input[header_start..header_start + 0x100]);
    }

    let mut bit_pool = 0u32;
    let mut bits_left = 0usize;
    let mut src_idx = input.len();
    let mut dst_idx = total_uncompressed_size;

    let get_bits = |bits_needed: usize,
                    src_idx: &mut usize,
                    bit_pool: &mut u32,
                    bits_left: &mut usize|
     -> Result<u32> {
        while *bits_left < bits_needed {
            if *src_idx == 0 {
                return Err(ReError::CrilaylaDecompress("Unexpected end of input stream".into()));
            }
            *src_idx -= 1;
            *bit_pool = (*bit_pool << 8) | (input[*src_idx] as u32);
            *bits_left += 8;
        }
        let shift = *bits_left - bits_needed;
        let res = (*bit_pool >> shift) & ((1 << bits_needed) - 1);
        *bits_left -= bits_needed;
        Ok(res)
    };

    while dst_idx > 0x100 {
        let flag = get_bits(1, &mut src_idx, &mut bit_pool, &mut bits_left)?;
        if flag == 1 {
            // Literal byte
            let byte = get_bits(8, &mut src_idx, &mut bit_pool, &mut bits_left)? as u8;
            dst_idx -= 1;
            output[dst_idx] = byte;
        } else {
            // LZSS Back reference
            let offset = (get_bits(13, &mut src_idx, &mut bit_pool, &mut bits_left)? as usize) + 3;
            let mut count = 3usize;
            loop {
                let extra = get_bits(2, &mut src_idx, &mut bit_pool, &mut bits_left)?;
                count += extra as usize;
                if extra != 3 {
                    break;
                }
            }

            for _ in 0..count {
                if dst_idx <= 0x100 {
                    break;
                }
                let ref_idx = dst_idx + offset;
                if ref_idx >= total_uncompressed_size {
                    return Err(ReError::CrilaylaDecompress(format!(
                        "Reference index {ref_idx} out of bounds (max {total_uncompressed_size})"
                    )));
                }
                let byte = output[ref_idx];
                dst_idx -= 1;
                output[dst_idx] = byte;
            }
        }
    }

    Ok(output)
}

/// Decompresses a headerless CRILAYLA raw LZSS stream into a buffer of `expected_size` bytes.
pub fn decompress_crilayla_raw(input: &[u8], expected_size: usize) -> Result<Vec<u8>> {
    if expected_size == 0 {
        return Err(ReError::CrilaylaDecompress("Expected uncompressed size cannot be 0".into()));
    }

    let mut output = vec![0u8; expected_size];
    let mut bit_pool = 0u32;
    let mut bits_left = 0usize;
    let mut src_idx = input.len();
    let mut dst_idx = expected_size;

    let get_bits = |bits_needed: usize,
                    src_idx: &mut usize,
                    bit_pool: &mut u32,
                    bits_left: &mut usize|
     -> Result<u32> {
        while *bits_left < bits_needed {
            if *src_idx == 0 {
                return Err(ReError::CrilaylaDecompress("Unexpected end of input stream".into()));
            }
            *src_idx -= 1;
            *bit_pool = (*bit_pool << 8) | (input[*src_idx] as u32);
            *bits_left += 8;
        }
        let shift = *bits_left - bits_needed;
        let res = (*bit_pool >> shift) & ((1 << bits_needed) - 1);
        *bits_left -= bits_needed;
        Ok(res)
    };

    while dst_idx > 0 {
        let flag = get_bits(1, &mut src_idx, &mut bit_pool, &mut bits_left)?;
        if flag == 1 {
            let byte = get_bits(8, &mut src_idx, &mut bit_pool, &mut bits_left)? as u8;
            dst_idx -= 1;
            output[dst_idx] = byte;
        } else {
            let offset = (get_bits(13, &mut src_idx, &mut bit_pool, &mut bits_left)? as usize) + 3;
            let mut count = 3usize;
            loop {
                let extra = get_bits(2, &mut src_idx, &mut bit_pool, &mut bits_left)?;
                count += extra as usize;
                if extra != 3 {
                    break;
                }
            }

            for _ in 0..count {
                if dst_idx == 0 {
                    break;
                }
                let ref_idx = dst_idx + offset;
                if ref_idx >= expected_size {
                    return Err(ReError::CrilaylaDecompress(format!(
                        "Reference index {ref_idx} out of bounds (max {expected_size})"
                    )));
                }
                let byte = output[ref_idx];
                dst_idx -= 1;
                output[dst_idx] = byte;
            }
        }
    }

    Ok(output)
}

/// Helper compressor that emits a valid CRILAYLA compressed stream (using literal backwards LZSS).
/// Useful for creating synthetic CRILAYLA payloads for unit tests and WASM verification.
pub fn compress_crilayla_mock(uncompressed: &[u8]) -> Vec<u8> {
    let uncompressed_size = if uncompressed.len() >= 0x100 {
        uncompressed.len() - 0x100
    } else {
        0
    };

    let mut bitstream = Vec::new();
    let mut bit_pool = 0u64;
    let mut bits_in_pool = 0usize;

    // We write from uncompressed.len() down to 0x100
    let payload = if uncompressed.len() > 0x100 {
        &uncompressed[0x100..]
    } else {
        &[]
    };

    // Pack bits backwards: each symbol is flag=1 (1 bit) + byte (8 bits) = 9 bits
    for &byte in payload.iter().rev() {
        // flag = 1
        bit_pool = (bit_pool << 1) | 1;
        bits_in_pool += 1;
        // byte
        bit_pool = (bit_pool << 8) | (byte as u64);
        bits_in_pool += 8;

        while bits_in_pool >= 8 {
            bits_in_pool -= 8;
            let b = ((bit_pool >> bits_in_pool) & 0xFF) as u8;
            bitstream.push(b);
        }
    }

    if bits_in_pool > 0 {
        let b = ((bit_pool << (8 - bits_in_pool)) & 0xFF) as u8;
        bitstream.push(b);
    }

    // CRILAYLA header is 16 bytes:
    // 0..8: "CRILAYLA"
    // 8..12: uncompressed_size (u32 LE)
    // 12..16: header offset (u32 LE) - offset relative to byte 16 where the 0x100 uncompressed header sits
    let mut result = Vec::new();
    result.extend_from_slice(CRILAYLA_MAGIC);
    result.extend_from_slice(&(uncompressed_size as u32).to_le_bytes());
    // Put uncompressed 0x100 header immediately after 16 bytes
    result.extend_from_slice(&0u32.to_le_bytes());

    // 0x100 header bytes
    let mut header_256 = [0u8; 0x100];
    let copy_len = uncompressed.len().min(0x100);
    header_256[..copy_len].copy_from_slice(&uncompressed[..copy_len]);
    result.extend_from_slice(&header_256);

    // Compressed stream is appended backwards because decompressor reads backwards!
    bitstream.reverse();
    result.extend_from_slice(&bitstream);

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_short_or_invalid_magic() {
        assert!(decompress_crilayla(b"SHORT").is_err());
        assert!(decompress_crilayla(b"NOT_A_VALID_MAGIC_").is_err());
    }

    #[test]
    fn test_mock_crilayla_roundtrip() {
        let mut original = vec![0u8; 0x100 + 64];
        for (i, b) in original.iter_mut().enumerate() {
            *b = (i % 256) as u8;
        }

        let compressed = compress_crilayla_mock(&original);
        assert!(compressed.starts_with(CRILAYLA_MAGIC));

        let decompressed = decompress_crilayla(&compressed).expect("Decompression must succeed");
        assert_eq!(decompressed, original);
    }
}
