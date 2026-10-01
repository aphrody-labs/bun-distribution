// SPDX-License-Identifier: Apache-2.0
//! Batched float64 kernels for RAPTOR. The Python seam keeps tree policy,
//! array shape and ordering; the arithmetic has one owner here.

/// A batch must be rectangular; empty batches are accepted.
fn dimensions(rows: &[Vec<f64>]) -> Result<Option<usize>, &'static str> {
    let width = rows.first().map(Vec::len);
    if rows.iter().any(|row| Some(row.len()) != width) {
        return Err("embedding batch must be rectangular");
    }
    Ok(width)
}

/// L2 normalize each row with the RAPTOR 1e-12 denominator clamp.
/// NaNs propagate, matching the former NumPy maximum rather than f64::max.
pub fn normalize(rows: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, &'static str> {
    dimensions(rows)?;
    Ok(rows
        .iter()
        .map(|row| {
            let norm = row.iter().map(|value| value * value).sum::<f64>().sqrt();
            let denominator = if norm < 1e-12 { 1e-12 } else { norm };
            row.iter().map(|value| value / denominator).collect()
        })
        .collect())
}

/// Row-by-row matrix product left * right^T, without changing row order.
pub fn similarities(left: &[Vec<f64>], right: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, &'static str> {
    let left_width = dimensions(left)?;
    let right_width = dimensions(right)?;
    if left_width.is_some() && right_width.is_some() && left_width != right_width {
        return Err("embedding dimensions do not match");
    }
    if left.is_empty() || right.is_empty() {
        return Ok(vec![vec![]; left.len()]);
    }
    let width = left_width.unwrap_or(0);
    let left_matrix = ndarray::Array2::from_shape_vec(
        (left.len(), width),
        left.iter().flatten().copied().collect(),
    )
    .map_err(|_| "left batch shape overflow")?;
    let right_matrix = ndarray::Array2::from_shape_vec(
        (right.len(), width),
        right.iter().flatten().copied().collect(),
    )
    .map_err(|_| "right batch shape overflow")?;
    let product = left_matrix.dot(&right_matrix.t());
    Ok(product.rows().into_iter().map(|row| row.to_vec()).collect())
}

/// Mean embedding in input order. An empty batch has no prototype.
pub fn mean(rows: &[Vec<f64>]) -> Result<Vec<f64>, &'static str> {
    let width = dimensions(rows)?.ok_or("mean requires at least one embedding")?;
    let mut result = vec![0.0; width];
    for row in rows {
        for (total, value) in result.iter_mut().zip(row) {
            *total += value;
        }
    }
    for total in &mut result {
        *total /= rows.len() as f64;
    }
    Ok(result)
}

/// Recompute normalized cluster means in one batch. Empty clusters retain
/// their previous center, and zero means remain zero (no epsilon clamp here).
pub fn update_centers(
    rows: &[Vec<f64>],
    labels: &[usize],
    centers: &[Vec<f64>],
) -> Result<Vec<Vec<f64>>, &'static str> {
    let width = dimensions(centers)?.ok_or("at least one center is required")?;
    if dimensions(rows)?.is_some_and(|row_width| row_width != width) || labels.len() != rows.len() {
        return Err("rows, labels and centers have incompatible dimensions");
    }
    if labels.iter().any(|label| *label >= centers.len()) {
        return Err("cluster label is outside the centers batch");
    }
    let mut sums = vec![vec![0.0; width]; centers.len()];
    let mut counts = vec![0_usize; centers.len()];
    for (row, label) in rows.iter().zip(labels) {
        counts[*label] += 1;
        for (sum, value) in sums[*label].iter_mut().zip(row) {
            *sum += value;
        }
    }
    for (index, center) in sums.iter_mut().enumerate() {
        if counts[index] == 0 {
            center.clone_from(&centers[index]);
            continue;
        }
        for value in center.iter_mut() {
            *value /= counts[index] as f64;
        }
        let norm = center.iter().map(|value| value * value).sum::<f64>().sqrt();
        if norm > 0.0 {
            for value in center.iter_mut() {
                *value /= norm;
            }
        }
    }
    Ok(sums)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_float64_and_small_zero_rows() {
        assert_eq!(
            normalize(&[vec![3.0, 4.0], vec![0.0, 0.0], vec![1e-14, 0.0]]).unwrap(),
            vec![vec![0.6, 0.8], vec![0.0, 0.0], vec![0.01, 0.0]]
        );
        let precise = 1.0 + 1e-10;
        assert_eq!(similarities(&[vec![precise]], &[vec![1.0]]).unwrap(), vec![vec![precise]]);
        assert!(normalize(&[vec![f64::NAN]]).unwrap()[0][0].is_nan());
    }
    #[test]
    fn batch_product_and_mean_validate_shapes() {
        assert_eq!(
            similarities(&[vec![1.0, 2.0]], &[vec![3.0, 4.0], vec![0.0, 1.0]]).unwrap(),
            vec![vec![11.0, 2.0]]
        );
        assert_eq!(mean(&[vec![1.0, 2.0], vec![3.0, 4.0]]).unwrap(), vec![2.0, 3.0]);
        assert_eq!(normalize(&[]).unwrap(), Vec::<Vec<f64>>::new());
        assert!(normalize(&[vec![1.0], vec![1.0, 2.0]]).is_err());
        assert!(similarities(&[vec![1.0]], &[vec![1.0, 2.0]]).is_err());
        assert!(mean(&[]).is_err());
    }
    #[test]
    fn empty_and_zero_centers_preserve_bucket_semantics() {
        let centers = vec![vec![1.0, 0.0], vec![0.0, 1.0], vec![0.5, 0.5]];
        assert_eq!(
            update_centers(&[vec![1.0, 0.0], vec![-1.0, 0.0]], &[0, 0], &centers).unwrap(),
            vec![vec![0.0, 0.0], vec![0.0, 1.0], vec![0.5, 0.5]]
        );
        assert!(update_centers(&[vec![1.0, 0.0]], &[3], &centers).is_err());
        assert!(update_centers(&[vec![1.0, 0.0]], &[], &centers).is_err());
    }
}
