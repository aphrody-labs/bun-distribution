// SPDX-License-Identifier: Apache-2.0
//! Weighted square means (K-Means) color quantizer: exact port of
//! `quantize/quantizer_wsmeans.ts` and `quantize/lab_point_provider.ts` from
//! [material-color-utilities] 0.4.0 (Apache-2.0).
//!
//! Improves on the speed of a standard K-Means algorithm by deduping identical pixels and using a
//! triangle-inequality rule to reduce the number of comparisons needed to identify which cluster
//! a point should move to (M. Emre Celebi, *Improving the Performance of K-Means for Color
//! Quantization*, 2011, <https://arxiv.org/abs/1101.0395>).
//!
//! ## One documented deviation: seeded randomness
//!
//! The reference calls `Math.random()` to pick the initial cluster each point is assigned to (and,
//! when `starting_clusters` is too short, to fill in extra random L\*a\*b\* clusters).
//! `Math.random` has no fixed seed, so upstream's own output is not reproducible run to run — a
//! property that would make this port untestable and would make `aphrody-m3-reproduce`
//! non-deterministic for callers. This port replaces it with [`Rng`], a `mulberry32` generator
//! seeded explicitly by the caller, producing the exact same float sequence (`u32` state, same bit
//! operations) as the `mcu-image-fixture.ts` script uses when it overrides `Math.random` for
//! fixture generation — see `tests/mcu_image_parity.rs`. The clustering math itself (distances,
//! sums, convergence rule) is unchanged from upstream.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use crate::color_math;

const MAX_ITERATIONS: usize = 10;
const MIN_MOVEMENT_DISTANCE: f64 = 3.0;

/// A `mulberry32` pseudo-random generator, seeded explicitly. Produces `f64` values in `[0, 1)`
/// using the same 32-bit integer operations as the JavaScript reference implementation used by
/// `mcu-image-fixture.ts`, so both sides draw identical sequences from identical seeds.
#[derive(Clone, Copy, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    /// A generator seeded with `seed`.
    #[must_use]
    pub const fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// The next value in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B_79F5);
        let mut z = self.state;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z = z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        f64::from(z ^ (z >> 14)) / 4_294_967_296.0
    }
}

/// L*a*b* conversions for K-Means, exact port of `LabPointProvider`.
struct LabPointProvider;

impl LabPointProvider {
    fn from_int(argb: u32) -> [f64; 3] {
        color_math::lab_from_argb(argb)
    }

    fn to_int(point: [f64; 3]) -> u32 {
        color_math::argb_from_lab(point[0], point[1], point[2])
    }

    /// Squared CIE 1976 delta E (square root is unneeded to compare distances).
    fn distance(from: [f64; 3], to: [f64; 3]) -> f64 {
        let d_l = from[0] - to[0];
        let d_a = from[1] - to[1];
        let d_b = from[2] - to[2];
        d_l * d_l + d_a * d_a + d_b * d_b
    }
}

/// Colors in ARGB format, quantized to at most `max_colors` clusters seeded by
/// `starting_clusters` (pass `&[]` for the reference's "no preference" behavior — a fresh, random
/// initial state derived from `rng`). Returns ARGB colors to the number of pixels in `input_pixels`
/// that ended up in that cluster, in the order clusters were finalized (matching the reference
/// `Map` insertion order, relevant for callers that break ties on iteration order).
#[must_use]
pub fn quantize(
    input_pixels: &[u32],
    starting_clusters: &[u32],
    max_colors: usize,
    rng: &mut Rng,
) -> Vec<(u32, u32)> {
    // Dedup, preserving first-occurrence order (matches `Map` iteration order in the reference).
    let mut pixels: Vec<u32> = Vec::new();
    let mut points: Vec<[f64; 3]> = Vec::new();
    let mut counts: Vec<u32> = Vec::new();
    {
        let mut index_of = std::collections::HashMap::<u32, usize>::new();
        for &pixel in input_pixels {
            if let Some(&idx) = index_of.get(&pixel) {
                counts[idx] += 1;
            } else {
                index_of.insert(pixel, pixels.len());
                pixels.push(pixel);
                points.push(LabPointProvider::from_int(pixel));
                counts.push(1);
            }
        }
    }
    let point_count = pixels.len();

    let mut cluster_count = max_colors.min(point_count);
    if !starting_clusters.is_empty() {
        cluster_count = cluster_count.min(starting_clusters.len());
    }

    let mut clusters: Vec<[f64; 3]> = starting_clusters
        .iter()
        .map(|&argb| LabPointProvider::from_int(argb))
        .collect();

    let additional_clusters_needed = cluster_count as isize - clusters.len() as isize;
    if starting_clusters.is_empty() && additional_clusters_needed > 0 {
        for _ in 0..additional_clusters_needed {
            let l = rng.next_f64() * 100.0;
            let a = rng.next_f64() * (100.0 - (-100.0) + 1.0) + -100.0;
            let b = rng.next_f64() * (100.0 - (-100.0) + 1.0) + -100.0;
            clusters.push([l, a, b]);
        }
    }

    let mut cluster_indices: Vec<usize> = (0..point_count)
        .map(|_| (rng.next_f64() * cluster_count as f64).floor() as usize)
        .collect();

    let mut distance_to_index_matrix = vec![vec![-1.0f64; cluster_count]; cluster_count];
    let mut pixel_count_sums = vec![0u32; cluster_count];

    for iteration in 0..MAX_ITERATIONS {
        for i in 0..cluster_count {
            for j in (i + 1)..cluster_count {
                let distance = LabPointProvider::distance(clusters[i], clusters[j]);
                distance_to_index_matrix[j][i] = distance;
                distance_to_index_matrix[i][j] = distance;
            }
            // The reference calls `distanceToIndexMatrix[i].sort()` here with *no* comparator.
            // `Array.prototype.sort()` without one stringifies elements (`"[object Object]"` for
            // every entry), so every key compares equal and the sort is a stable no-op — a known
            // upstream quirk, not an optimization this port needs to reproduce with an actual
            // sort. `indexMatrix`, built immediately after from the "sorted" order, is never read
            // again, so both the sort and that matrix are dead code omitted here; the important
            // side effect upstream still relies on is `distanceToIndexMatrix[i][j]` holding the
            // distance from cluster `i` to cluster `j` (unsorted, keyed by `j`), which the loop
            // above already establishes.
        }

        let mut points_moved = 0usize;
        for i in 0..point_count {
            let point = points[i];
            let previous_cluster_index = cluster_indices[i];
            let previous_cluster = clusters[previous_cluster_index];
            let previous_distance = LabPointProvider::distance(point, previous_cluster);
            let mut minimum_distance = previous_distance;
            let mut new_cluster_index: Option<usize> = None;

            for j in 0..cluster_count {
                if distance_to_index_matrix[previous_cluster_index][j] >= 4.0 * previous_distance {
                    continue;
                }
                let distance = LabPointProvider::distance(point, clusters[j]);
                if distance < minimum_distance {
                    minimum_distance = distance;
                    new_cluster_index = Some(j);
                }
            }
            if let Some(new_index) = new_cluster_index {
                let distance_change = (minimum_distance.sqrt() - previous_distance.sqrt()).abs();
                if distance_change > MIN_MOVEMENT_DISTANCE {
                    points_moved += 1;
                    cluster_indices[i] = new_index;
                }
            }
        }

        if points_moved == 0 && iteration != 0 {
            break;
        }

        let mut component_a_sums = vec![0.0f64; cluster_count];
        let mut component_b_sums = vec![0.0f64; cluster_count];
        let mut component_c_sums = vec![0.0f64; cluster_count];
        pixel_count_sums.fill(0);
        for i in 0..point_count {
            let cluster_index = cluster_indices[i];
            let point = points[i];
            let count = counts[i];
            pixel_count_sums[cluster_index] += count;
            component_a_sums[cluster_index] += point[0] * f64::from(count);
            component_b_sums[cluster_index] += point[1] * f64::from(count);
            component_c_sums[cluster_index] += point[2] * f64::from(count);
        }
        for i in 0..cluster_count {
            let count = pixel_count_sums[i];
            if count == 0 {
                clusters[i] = [0.0, 0.0, 0.0];
                continue;
            }
            let a = component_a_sums[i] / f64::from(count);
            let b = component_b_sums[i] / f64::from(count);
            let c = component_c_sums[i] / f64::from(count);
            clusters[i] = [a, b, c];
        }
    }

    let mut argb_to_population: Vec<(u32, u32)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for i in 0..cluster_count {
        let count = pixel_count_sums[i];
        if count == 0 {
            continue;
        }
        let possible_new_cluster = LabPointProvider::to_int(clusters[i]);
        if !seen.insert(possible_new_cluster) {
            continue;
        }
        argb_to_population.push((possible_new_cluster, count));
    }
    argb_to_population
}
