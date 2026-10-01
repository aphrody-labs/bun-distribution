// SPDX-License-Identifier: Apache-2.0
//! Float32 RAPTOR arithmetic for UMAP output; no implicit float64 promotion.

use crate::vectors_f64::{dimensions, sum_f32};

/// Mean embedding in input order. An empty batch has no prototype.
pub fn mean(rows: &[Vec<f32>]) -> Result<Vec<f32>, &'static str> {
    let width = dimensions(rows)?.ok_or("mean requires at least one embedding")?;
    if width == 1 {
        return Ok(vec![sum_f32(rows.len(), &|index| rows[index][0]) / rows.len() as f32]);
    }
    let mut result = vec![0.0; width];
    for row in rows {
        for (total, value) in result.iter_mut().zip(row) {
            *total += value;
        }
    }
    for total in &mut result {
        *total /= rows.len() as f32;
    }
    Ok(result)
}

/// Squared Euclidean distances, in row-major row/centroid order.
/// Subtract before squaring (no dot-product expansion or normalization),
/// use NumPy fast-axis reduction order, and propagate NaNs.
pub fn squared_distances(
    rows: &[Vec<f32>],
    centroids: &[Vec<f32>],
) -> Result<Vec<Vec<f32>>, &'static str> {
    let row_width = dimensions(rows)?;
    let centroid_width = dimensions(centroids)?;
    if row_width.is_some() && centroid_width.is_some() && row_width != centroid_width {
        return Err("embedding dimensions do not match");
    }
    rows.len()
        .checked_mul(centroids.len())
        .filter(|size| *size <= isize::MAX as usize / 4)
        .ok_or("distance result shape overflow")?;
    Ok(rows
        .iter()
        .map(|row| {
            centroids
                .iter()
                .map(|centroid| {
                    sum_f32(row.len(), &|index| {
                        let difference = row[index] - centroid[index];
                        difference * difference
                    })
                })
                .collect()
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float32_rounding_preserves_centroid_and_nearest_center_tie() {
        assert_eq!(mean(&[vec![16_777_216.0], vec![16_777_218.0]]).unwrap(), vec![16_777_216.0]);
        let rows = [vec![0.0, 0.0]];
        let centers = [vec![1.0, 1e-4], vec![1.0, 0.0]];
        assert_eq!(squared_distances(&rows, &centers).unwrap(), vec![vec![1.0, 1.0]]);
        let double = crate::vectors_f64::squared_distances(
            &[vec![0.0, 0.0]],
            &[vec![1.0, f64::from(1e-4_f32)], vec![1.0, 0.0]],
        )
        .unwrap();
        assert!(double[0][0] > double[0][1], "promotion changes the nearest-center tie");
    }

    #[test]
    fn fast_axis_reduction_keeps_numpy_block_order_and_nonfinite_values() {
        for (width, expected) in [(8, 100_000_000.0), (129, 100_000_120.0), (257, 100_000_240.0)] {
            let mut row = vec![1.0; width];
            row[0] = 1e4;
            assert_eq!(squared_distances(&[row], &[vec![0.0; width]]).unwrap()[0][0], expected);
        }
        assert!(squared_distances(&[vec![f32::NAN]], &[vec![0.0]]).unwrap()[0][0].is_nan());
        assert!(mean(&[vec![f32::NAN], vec![0.0]]).unwrap()[0].is_nan());
    }

    #[test]
    fn validates_shapes_without_losing_empty_axes() {
        assert!(mean(&[]).is_err());
        assert!(squared_distances(&[vec![1.0]], &[vec![]]).is_err());
        assert!(squared_distances(&[], &[vec![1.0], vec![]]).is_err());
        assert_eq!(squared_distances(&[], &[]).unwrap(), Vec::<Vec<f32>>::new());
        assert_eq!(squared_distances(&[vec![]], &[vec![], vec![]]).unwrap(), vec![vec![0.0, 0.0]]);
    }
}
