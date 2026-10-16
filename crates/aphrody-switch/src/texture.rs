// SPDX-FileCopyrightText: 2025 ruzu contributors
// SPDX-License-Identifier: GPL-2.0-or-later
//! Checked Tegra block-linear texture addressing extracted from retained Ruzu.
//! Dimensions refer to elements (pixels or compressed-format blocks), not bits.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidBytesPerElement,
    InvalidBlockShift,
    Overflow,
    CoordinateOutOfBounds,
    BufferTooSmall,
}

/// Immutable validated layout. Block dimensions and stride alignment are log2.
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    width_bytes: usize,
    height: usize,
    depth: usize,
    block_height: usize,
    block_depth: usize,
    block_size: usize,
    slice_size: usize,
    linear_size: usize,
    tiled_size: usize,
    addressed_size: usize,
}

fn align(value: usize, shift: u32) -> Result<usize, Error> {
    let unit = 1usize.checked_shl(shift).ok_or(Error::Overflow)?;
    value
        .checked_add(unit - 1)
        .map(|v| v & !(unit - 1))
        .ok_or(Error::Overflow)
}

impl Layout {
    /// `stride_alignment` aligns the element width before multiplying by BPE.
    pub fn new(
        width: u32,
        height: u32,
        depth: u32,
        bytes_per_element: u32,
        block_height_log2: u32,
        block_depth_log2: u32,
        stride_alignment: u32,
    ) -> Result<Self, Error> {
        if !matches!(bytes_per_element, 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16) {
            return Err(Error::InvalidBytesPerElement);
        }
        // Tegra block dimensions are at most 32 GOBs on each axis.
        if block_height_log2 > 5 || block_depth_log2 > 5 || stride_alignment > 31 {
            return Err(Error::InvalidBlockShift);
        }
        let bpe = bytes_per_element as usize;
        let width_bytes = (width as usize).checked_mul(bpe).ok_or(Error::Overflow)?;
        let stride = align(width as usize, stride_alignment)?
            .checked_mul(bpe)
            .ok_or(Error::Overflow)?;
        let gobs_x = align(stride, 6)? / 64;
        let block_height = 1usize << block_height_log2;
        let block_depth = 1usize << block_depth_log2;
        let block_size = gobs_x
            .checked_mul(512)
            .and_then(|v| v.checked_mul(block_height))
            .and_then(|v| v.checked_mul(block_depth))
            .ok_or(Error::Overflow)?;
        let slice_size = align(height as usize, block_height_log2 + 3)? / (8 * block_height);
        let slice_size = slice_size.checked_mul(block_size).ok_or(Error::Overflow)?;
        let linear_size = width_bytes
            .checked_mul(height as usize)
            .and_then(|v| v.checked_mul(depth as usize))
            .ok_or(Error::Overflow)?;
        let tiled_size = slice_size
            .checked_mul(align(depth as usize, block_depth_log2)? / block_depth)
            .ok_or(Error::Overflow)?;
        let mut layout = Self {
            width_bytes,
            height: height as usize,
            depth: depth as usize,
            block_height,
            block_depth,
            block_size,
            slice_size,
            linear_size,
            tiled_size,
            addressed_size: 0,
        };
        if linear_size != 0 {
            layout.addressed_size =
                layout.offset_unchecked(width_bytes - 1, height as usize - 1, depth as usize - 1)
                    + 1;
        }
        Ok(layout)
    }

    pub const fn linear_size(self) -> usize {
        self.linear_size
    }
    /// Fully padded allocation size, including untouched GOBs.
    pub const fn tiled_size(self) -> usize {
        self.tiled_size
    }
    /// Minimum tiled span actually touched (padding may be omitted).
    pub const fn addressed_size(self) -> usize {
        self.addressed_size
    }

    pub fn byte_offset(self, x_byte: usize, y: usize, z: usize) -> Result<usize, Error> {
        if x_byte >= self.width_bytes || y >= self.height || z >= self.depth {
            return Err(Error::CoordinateOutOfBounds);
        }
        Ok(self.offset_unchecked(x_byte, y, z))
    }

    fn offset_unchecked(self, x: usize, y: usize, z: usize) -> usize {
        let block_y = y / 8;
        let offset_z =
            z / self.block_depth * self.slice_size + z % self.block_depth * 512 * self.block_height;
        let offset_y =
            block_y / self.block_height * self.block_size + block_y % self.block_height * 512;
        let offset_x = x / 64 * 512 * self.block_height * self.block_depth;
        // The retained PDEP masks 0x12f/0xd0 expressed as sector arithmetic.
        offset_z
            + offset_y
            + offset_x
            + (x % 64 / 32) * 256
            + (y % 8 / 2) * 64
            + (x % 32 / 16) * 32
            + (y % 2) * 16
            + x % 16
    }

    pub fn swizzle(self, output: &mut [u8], input: &[u8]) -> Result<(), Error> {
        self.copy(output, input, true)
    }
    pub fn unswizzle(self, output: &mut [u8], input: &[u8]) -> Result<(), Error> {
        self.copy(output, input, false)
    }
    fn copy(self, output: &mut [u8], input: &[u8], to_tiled: bool) -> Result<(), Error> {
        let (dst, src) = if to_tiled {
            (self.addressed_size, self.linear_size)
        } else {
            (self.linear_size, self.addressed_size)
        };
        if output.len() < dst || input.len() < src {
            return Err(Error::BufferTooSmall);
        }
        for z in 0..self.depth {
            for y in 0..self.height {
                for x in 0..self.width_bytes {
                    let linear = (z * self.height + y) * self.width_bytes + x;
                    let tiled = self.offset_unchecked(x, y, z);
                    if to_tiled {
                        output[tiled] = input[linear];
                    } else {
                        output[linear] = input[tiled];
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::vec;

    #[test]
    fn sector_reference_vectors() {
        let layout = Layout::new(64, 8, 1, 1, 0, 0, 0).unwrap();
        for (x, y, expected) in [
            (0, 0, 0),
            (15, 0, 15),
            (16, 0, 32),
            (32, 0, 256),
            (0, 1, 16),
            (0, 2, 64),
            (0, 4, 128),
            (63, 7, 511),
        ] {
            assert_eq!(layout.byte_offset(x, y, 0), Ok(expected));
        }
        assert_eq!(layout.tiled_size(), 512);
    }
    #[test]
    fn roundtrip_all_element_sizes_blocks_and_depths() {
        for bpe in [1, 2, 3, 4, 6, 8, 12, 16] {
            for bh in 0..=3 {
                for bd in 0..=2 {
                    let layout = Layout::new(23, 19, 3, bpe, bh, bd, 2).unwrap();
                    let input = (0..layout.linear_size())
                        .map(|i| (i.wrapping_mul(37) ^ (i >> 8)) as u8)
                        .collect::<std::vec::Vec<_>>();
                    let mut tiled = vec![0xcd; layout.addressed_size()];
                    layout.swizzle(&mut tiled, &input).unwrap();
                    let mut output = vec![0; input.len()];
                    layout.unswizzle(&mut output, &tiled).unwrap();
                    assert_eq!(input, output);
                }
            }
        }
    }
    #[test]
    fn validation_is_atomic() {
        let layout = Layout::new(4, 4, 1, 4, 0, 0, 0).unwrap();
        let mut output = vec![0x55; layout.addressed_size()];
        assert_eq!(
            layout.swizzle(&mut output, &[0; 63]),
            Err(Error::BufferTooSmall)
        );
        assert!(output.iter().all(|&v| v == 0x55));
        assert_eq!(
            Layout::new(1, 1, 1, 5, 0, 0, 0).unwrap_err(),
            Error::InvalidBytesPerElement
        );
        assert_eq!(
            Layout::new(1, 1, 1, 1, 32, 0, 0).unwrap_err(),
            Error::InvalidBlockShift
        );
        assert_eq!(
            Layout::new(u32::MAX, u32::MAX, u32::MAX, 16, 5, 5, 0).unwrap_err(),
            Error::Overflow
        );
        assert_eq!(
            layout.byte_offset(16, 0, 0),
            Err(Error::CoordinateOutOfBounds)
        );
    }
    #[test]
    fn empty_layout_does_not_touch_buffers() {
        for (w, h, d) in [(0, 4, 1), (4, 0, 1), (4, 4, 0)] {
            let layout = Layout::new(w, h, d, 1, 0, 0, 0).unwrap();
            layout.swizzle(&mut [], &[]).unwrap();
        }
    }
}
