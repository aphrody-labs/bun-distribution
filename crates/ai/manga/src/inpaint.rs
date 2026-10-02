// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Manga inpainting and clean-plate generation.
//!
//! Provides text erasure, speech-bubble interior cleaning, and texture reconstruction
//! so translated text can be typeset onto clean artwork. Compatible with LaMa manga
//! (`mayocream/lama-manga`) ONNX weights and includes an instant, pure-Rust
//! boundary-weighted diffusion inpainter that runs hermetically on CPU without dependencies.

use crate::bubble::SpeechBubble;
use image::{GrayImage, Luma, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

/// Binary mask indicating pixels to be erased and reconstructed.
#[derive(Debug, Clone)]
pub struct TextMask {
    /// Grayscale mask where 255 = text/erasure target, 0 = keep original artwork.
    pub mask: GrayImage,
}

impl TextMask {
    /// Create a blank mask with given dimensions.
    #[must_use]
    pub fn new(width: u32, height: u32) -> Self {
        Self { mask: GrayImage::from_pixel(width, height, Luma([0])) }
    }

    /// Mark a rectangular bounding box as inpaint region.
    pub fn mark_box(&mut self, x: u32, y: u32, width: u32, height: u32) {
        let max_x = (x + width).min(self.mask.width());
        let max_y = (y + height).min(self.mask.height());
        for cy in y..max_y {
            for cx in x..max_x {
                self.mask.put_pixel(cx, cy, Luma([255]));
            }
        }
    }

    /// Mark a speech bubble interior as inpaint region (with safety inset margin).
    pub fn mark_bubble(&mut self, bubble: &SpeechBubble, inset_px: f32) {
        let min_x = (bubble.bounds.x + inset_px).max(0.0) as u32;
        let min_y = (bubble.bounds.y + inset_px).max(0.0) as u32;
        let max_x = (bubble.bounds.right() - inset_px).min(self.mask.width() as f32) as u32;
        let max_y = (bubble.bounds.bottom() - inset_px).min(self.mask.height() as f32) as u32;

        for y in min_y..max_y {
            for x in min_x..max_x {
                if bubble.contains_point(crate::bubble::Point::new(x as f32, y as f32)) {
                    self.mask.put_pixel(x, y, Luma([255]));
                }
            }
        }
    }

    /// Dilate the mask by `radius` pixels to ensure complete coverage of text stroke anti-aliasing.
    #[must_use]
    pub fn dilate(&self, radius: u32) -> Self {
        if radius == 0 {
            return self.clone();
        }
        let w = self.mask.width();
        let h = self.mask.height();
        let mut dilated = GrayImage::from_pixel(w, h, Luma([0]));
        let r = radius as i32;

        for y in 0..h {
            for x in 0..w {
                if self.mask.get_pixel(x, y).0[0] == 255 {
                    // Spread to neighborhood
                    for dy in -r..=r {
                        for dx in -r..=r {
                            if dx * dx + dy * dy <= r * r {
                                let nx = x as i32 + dx;
                                let ny = y as i32 + dy;
                                if nx >= 0 && nx < w as i32 && ny >= 0 && ny < h as i32 {
                                    dilated.put_pixel(nx as u32, ny as u32, Luma([255]));
                                }
                            }
                        }
                    }
                }
            }
        }
        Self { mask: dilated }
    }
}

/// Inpainting options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InpaintOptions {
    /// Dilation radius in pixels applied to text contours (default: 2).
    pub dilation_radius: u32,
    /// Whether to sample the speech bubble background color (pure white or off-white screentone).
    pub smart_bubble_fill: bool,
}

impl Default for InpaintOptions {
    fn default() -> Self {
        Self { dilation_radius: 2, smart_bubble_fill: true }
    }
}

/// Manga Inpainting Engine: Generates clean plates from artwork and masks.
pub struct MangaInpainter;

impl MangaInpainter {
    /// Cleans speech bubbles and removes Japanese text using boundary-weighted harmonic interpolation.
    ///
    /// Produces a clean RGBA image ready for new typography.
    #[must_use]
    pub fn inpaint(image: &RgbaImage, mask: &TextMask, options: &InpaintOptions) -> RgbaImage {
        let dilated_mask = mask.dilate(options.dilation_radius);
        let mut output = image.clone();
        let w = image.width();
        let h = image.height();

        // Pass 1: Identify connected masked pixels and compute distance-weighted boundary color.
        for y in 0..h {
            for x in 0..w {
                if dilated_mask.mask.get_pixel(x, y).0[0] == 255 {
                    // Sample boundary pixels in 8 directions up to a radius of 16px
                    let mut r_sum = 0.0f32;
                    let mut g_sum = 0.0f32;
                    let mut b_sum = 0.0f32;
                    let mut a_sum = 0.0f32;
                    let mut weight_sum = 0.0f32;

                    let directions =
                        [(0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (1, -1), (-1, 1), (1, 1)];

                    for (dx, dy) in directions {
                        for dist in 1..=24 {
                            let nx = x as i32 + dx * dist;
                            let ny = y as i32 + dy * dist;
                            if nx >= 0 && nx < w as i32 && ny >= 0 && ny < h as i32 {
                                let px = nx as u32;
                                let py = ny as u32;
                                if dilated_mask.mask.get_pixel(px, py).0[0] == 0 {
                                    // Found a non-masked boundary pixel!
                                    let p = image.get_pixel(px, py);
                                    let weight = 1.0 / (dist as f32).powi(2);
                                    r_sum += p[0] as f32 * weight;
                                    g_sum += p[1] as f32 * weight;
                                    b_sum += p[2] as f32 * weight;
                                    a_sum += p[3] as f32 * weight;
                                    weight_sum += weight;
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                    }

                    if weight_sum > 0.0 {
                        let r = (r_sum / weight_sum).round().clamp(0.0, 255.0) as u8;
                        let g = (g_sum / weight_sum).round().clamp(0.0, 255.0) as u8;
                        let b = (b_sum / weight_sum).round().clamp(0.0, 255.0) as u8;
                        let a = (a_sum / weight_sum).round().clamp(0.0, 255.0) as u8;
                        output.put_pixel(x, y, Rgba([r, g, b, a]));
                    } else {
                        // Fallback to pure white if surrounded by mask
                        output.put_pixel(x, y, Rgba([255, 255, 255, 255]));
                    }
                }
            }
        }

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inpaint_replaces_masked_black_box_with_white_surrounding() {
        // Create 20x20 white image with a 4x4 black square in the middle
        let mut img = RgbaImage::from_pixel(20, 20, Rgba([255, 255, 255, 255]));
        for y in 8..12 {
            for x in 8..12 {
                img.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }

        // Mask covers the 4x4 black box
        let mut mask = TextMask::new(20, 20);
        mask.mark_box(8, 8, 4, 4);

        let cleaned = MangaInpainter::inpaint(
            &img,
            &mask,
            &InpaintOptions { dilation_radius: 0, smart_bubble_fill: true },
        );

        // The center pixel was black [0,0,0,255], after inpaint it should be white [255,255,255,255]
        let center = cleaned.get_pixel(10, 10);
        assert_eq!(center[0], 255);
        assert_eq!(center[1], 255);
        assert_eq!(center[2], 255);
    }
}
