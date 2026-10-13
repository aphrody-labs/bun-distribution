// SPDX-License-Identifier: Apache-2.0
//! Image color quantization: exact port of `quantize/quantizer_celebi.ts` from
//! [material-color-utilities] 0.4.0 (Apache-2.0), plus its building blocks.
//!
//! [`celebi_quantize`] runs [`crate::quantize_wu`] to get a well-separated initial state, then
//! refines it with [`crate::quantize_wsmeans`] (K-Means in L\*a\*b\*). See
//! [`crate::quantize_wsmeans`] for the one documented deviation from upstream (seeded RNG instead
//! of `Math.random`).
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{quantize_wsmeans, quantize_wsmeans::Rng, quantize_wu::QuantizerWu};

/// The reference's default seed. `sourceColorFromImage`-equivalent helpers use this so repeated
/// calls on the same image are reproducible; pass an explicit [`Rng`] to
/// [`celebi_quantize_seeded`] to control it.
pub const DEFAULT_SEED: u32 = 0x6750_A4B1;

/// Colors in ARGB format, quantized to at most `max_colors` clusters (a lower number of colors
/// may be returned). Deterministic: seeded by [`DEFAULT_SEED`].
///
/// Equivalent of `QuantizerCelebi.quantize(pixels, maxColors)`.
#[must_use]
pub fn celebi_quantize(pixels: &[u32], max_colors: usize) -> Vec<(u32, u32)> {
    let mut rng = Rng::new(DEFAULT_SEED);
    celebi_quantize_seeded(pixels, max_colors, &mut rng)
}

/// As [`celebi_quantize`], with an explicit random generator (see
/// [`crate::quantize_wsmeans::Rng`]).
#[must_use]
pub fn celebi_quantize_seeded(pixels: &[u32], max_colors: usize, rng: &mut Rng) -> Vec<(u32, u32)> {
    let wu_result = QuantizerWu::new().quantize(pixels, max_colors);
    quantize_wsmeans::quantize(pixels, &wu_result, max_colors, rng)
}
