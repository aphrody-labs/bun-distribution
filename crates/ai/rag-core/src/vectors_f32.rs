// SPDX-License-Identifier: Apache-2.0
//! Float32 RAG arithmetic; no implicit float64 promotion.

use crate::vectors_f64::{dimensions, sum_f32};

/// Normalize forensic embeddings, replacing only an exactly zero norm with one.
/// Keep the float32 fast-axis reduction used by NumPy; NaNs propagate.
pub fn normalize(rows: &[Vec<f32>]) -> Result<Vec<Vec<f32>>, &'static str> {
    dimensions(rows)?;
    Ok(rows
        .iter()
        .map(|row| {
            let norm = sum_f32(row.len(), &|index| row[index] * row[index]).sqrt();
            let denominator = if norm == 0.0 { 1.0 } else { norm };
            row.iter().map(|value| value / denominator).collect()
        })
        .collect())
}

/// Contiguous float32 product left * right^T for forensic retrieval scores.
pub fn similarities_flat(
    left: &[f32],
    right: &[f32],
    left_rows: usize,
    right_rows: usize,
    width: usize,
) -> Result<Vec<f32>, &'static str> {
    let left_matrix = ndarray::ArrayView2::from_shape((left_rows, width), left)
        .map_err(|_| "left batch shape mismatch")?;
    let right_matrix = ndarray::ArrayView2::from_shape((right_rows, width), right)
        .map_err(|_| "right batch shape mismatch")?;
    let output_size = left_rows
        .checked_mul(right_rows)
        .filter(|size| *size <= isize::MAX as usize / 4)
        .ok_or("similarity result shape overflow")?;
    if left_rows == 0 || right_rows == 0 || width == 0 {
        return Ok(vec![0.0; output_size]);
    }
    Ok(left_matrix.dot(&right_matrix.t()).into_raw_vec_and_offset().0)
}

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
    fn forensic_normalization_retains_zero_rows_and_float32_scores() {
        let rows = normalize(&[vec![3.0, 4.0], vec![0.0, 0.0], vec![-3.0, 4.0]]).unwrap();
        assert_eq!(rows[0], vec![0.6, 0.8]);
        assert_eq!(rows[1], vec![0.0, 0.0]);
        let flat: Vec<f32> = rows.into_iter().flatten().collect();
        let scores = similarities_flat(&flat, &[0.6, 0.8], 3, 1, 2).unwrap();
        assert!((scores[0] - 1.0).abs() < 1e-6);
        assert_eq!(scores[1], 0.0);
        assert!((scores[2] - 0.28).abs() < 1e-6);
        assert!(normalize(&[vec![f32::NAN]]).unwrap()[0][0].is_nan());
    }

    #[test]
    fn forensic_shapes_preserve_empty_axes_and_reject_invalid_buffers() {
        assert_eq!(normalize(&[]).unwrap(), Vec::<Vec<f32>>::new());
        assert_eq!(normalize(&[vec![]]).unwrap(), vec![Vec::<f32>::new()]);
        assert!(normalize(&[vec![1.0], vec![]]).is_err());
        assert_eq!(similarities_flat(&[], &[], 0, 3, 0).unwrap(), Vec::<f32>::new());
        assert_eq!(similarities_flat(&[], &[], 2, 3, 0).unwrap(), vec![0.0; 6]);
        assert!(similarities_flat(&[1.0], &[1.0], 2, 1, 1).is_err());
        assert!(similarities_flat(&[], &[], usize::MAX, 2, 0).is_err());
    }

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
