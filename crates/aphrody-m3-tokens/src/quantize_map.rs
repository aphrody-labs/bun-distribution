// SPDX-License-Identifier: Apache-2.0
//! Exact port of `quantize/quantizer_map.ts` from [material-color-utilities] 0.4.0
//! (Apache-2.0): quantizes an image into a map of ARGB color to pixel count.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use std::collections::HashMap;

use crate::color_math;

/// Colors in ARGB format to a map of ARGB colors to the number of times the (opaque) color
/// appears. Pixels with alpha `< 255` are dropped, matching the reference.
#[must_use]
pub fn quantize_map(pixels: &[u32]) -> HashMap<u32, u32> {
    let mut count_by_color: HashMap<u32, u32> = HashMap::new();
    for &pixel in pixels {
        if color_math::alpha(pixel) < 255 {
            continue;
        }
        *count_by_color.entry(pixel).or_insert(0) += 1;
    }
    count_by_color
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_opaque_pixels_only() {
        let pixels = [0xFFFF_0000, 0xFFFF_0000, 0x00FF_0000, 0xFF00_FF00];
        let map = quantize_map(&pixels);
        assert_eq!(map.get(&0xFFFF_0000), Some(&2));
        assert_eq!(map.get(&0xFF00_FF00), Some(&1));
        assert_eq!(map.get(&0x00FF_0000), None);
        assert_eq!(map.len(), 2);
    }
}
