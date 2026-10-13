// SPDX-License-Identifier: Apache-2.0
//! Given a large set of colors, remove colors unsuitable for a UI theme and rank the rest by
//! suitability. Exact port of `score/score.ts` from [material-color-utilities] 0.4.0
//! (Apache-2.0).
//!
//! Enables using a high cluster count for image quantization — so colors aren't muddied — while
//! curating that high cluster count down to a much smaller number of appropriate choices.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::{color_math, hct::Hct};

const TARGET_CHROMA: f64 = 48.0; // A1 chroma.
const WEIGHT_PROPORTION: f64 = 0.7;
const WEIGHT_CHROMA_ABOVE: f64 = 0.3;
const WEIGHT_CHROMA_BELOW: f64 = 0.1;
const CUTOFF_CHROMA: f64 = 5.0;
const CUTOFF_EXCITED_PROPORTION: f64 = 0.01;

/// [`score`] options, mirroring the reference's `ScoreOptions` (all fields optional there via
/// spread defaults).
#[derive(Clone, Copy, Debug)]
pub struct ScoreOptions {
    /// Desired number of colors, at most. Defaults to `4`.
    pub desired: usize,
    /// Returned when every candidate color is filtered out. Defaults to Google Blue
    /// (`0xFF4285F4`).
    pub fallback_color_argb: u32,
    /// Drop colors with too little chroma or too little hue support. Defaults to `true`.
    pub filter: bool,
}

impl Default for ScoreOptions {
    fn default() -> Self {
        Self {
            desired: 4,
            fallback_color_argb: 0xFF42_85F4,
            filter: true,
        }
    }
}

/// Given a map of ARGB color to how often it appears (usually from image quantization), rank the
/// colors by suitability for a UI theme. The most suitable color is first, least suitable last.
/// Always returns at least one color: the reference's Google Blue fallback if every input color
/// was filtered out.
#[must_use]
pub fn score(colors_to_population: &[(u32, u32)], options: ScoreOptions) -> Vec<u32> {
    let mut colors_hct = Vec::with_capacity(colors_to_population.len());
    let mut hue_population = [0.0f64; 360];
    let mut population_sum = 0.0f64;
    for &(argb, population) in colors_to_population {
        let hct = Hct::from_argb(argb);
        let hue = hct.hue.floor() as i32;
        let hue = hue.rem_euclid(360) as usize;
        hue_population[hue] += f64::from(population);
        population_sum += f64::from(population);
        colors_hct.push(hct);
    }

    // Hues with more usage in the neighboring 30-degree slice get a larger number.
    let mut hue_excited_proportions = [0.0f64; 360];
    for hue in 0..360i32 {
        let proportion = if population_sum == 0.0 {
            0.0
        } else {
            hue_population[hue as usize] / population_sum
        };
        for i in (hue - 14)..(hue + 16) {
            let neighbor_hue = color_math::sanitize_degrees_int(i) as usize;
            hue_excited_proportions[neighbor_hue] += proportion;
        }
    }

    // Score each HCT color by usage and chroma, optionally filtering out values that lack chroma
    // or usage.
    let mut scored_hct: Vec<(Hct, f64)> = Vec::new();
    for hct in colors_hct {
        let hue = color_math::sanitize_degrees_int(color_math::js_round(hct.hue) as i32) as usize;
        let proportion = hue_excited_proportions[hue];
        if options.filter && (hct.chroma < CUTOFF_CHROMA || proportion <= CUTOFF_EXCITED_PROPORTION)
        {
            continue;
        }
        let proportion_score = proportion * 100.0 * WEIGHT_PROPORTION;
        let chroma_weight = if hct.chroma < TARGET_CHROMA {
            WEIGHT_CHROMA_BELOW
        } else {
            WEIGHT_CHROMA_ABOVE
        };
        let chroma_score = (hct.chroma - TARGET_CHROMA) * chroma_weight;
        scored_hct.push((hct, proportion_score + chroma_score));
    }

    // Higher scores first; ties keep their relative (stable) order, matching a JS `Array.sort`
    // comparator that returns `0` on equal scores.
    scored_hct.sort_by(|a, b| b.1.total_cmp(&a.1));

    // Iterate over candidate hue differences from 90 down to 15 degrees, picking the widest
    // distribution of hues possible.
    let mut chosen_colors: Vec<Hct> = Vec::new();
    let mut difference_degrees = 90i32;
    while difference_degrees >= 15 {
        chosen_colors.clear();
        for (hct, _score) in &scored_hct {
            let duplicate_hue = chosen_colors.iter().any(|chosen| {
                color_math::difference_degrees(hct.hue, chosen.hue) < f64::from(difference_degrees)
            });
            if !duplicate_hue {
                chosen_colors.push(*hct);
            }
            if chosen_colors.len() >= options.desired {
                break;
            }
        }
        if chosen_colors.len() >= options.desired {
            break;
        }
        difference_degrees -= 1;
    }

    let mut colors = Vec::new();
    if chosen_colors.is_empty() {
        colors.push(options.fallback_color_argb);
    }
    for chosen in chosen_colors {
        colors.push(chosen.to_argb());
    }
    colors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_returns_fallback() {
        let result = score(&[], ScoreOptions::default());
        assert_eq!(result, vec![0xFF42_85F4]);
    }

    #[test]
    fn single_vivid_color_is_kept() {
        // A saturated red with plenty of population should pass the chroma/proportion cutoffs.
        let result = score(&[(0xFFFF_0000, 1000)], ScoreOptions::default());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], Hct::from_argb(0xFFFF_0000).to_argb());
    }

    #[test]
    fn low_chroma_gray_is_filtered_to_fallback() {
        let result = score(&[(0xFF80_8080, 1000)], ScoreOptions::default());
        assert_eq!(result, vec![0xFF42_85F4]);
    }
}
