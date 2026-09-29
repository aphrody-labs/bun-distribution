//! Compact storage of embedding vectors.

/// Symmetric per-vector int8 quantisation: `v[i] ≈ q[i] as f32 * scale`.
///
/// `scale = max|v| / 127`; the all-zero vector yields `scale = 0`. For L2-normalised
/// 384-d vectors this is a 4x size reduction with cosine agreement typically > 0.9999.
pub fn quantize_i8(v: &[f32]) -> (Vec<i8>, f32) {
    let max = v.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    if max <= 0.0 || !max.is_finite() {
        return (vec![0; v.len()], 0.0);
    }
    let scale = max / 127.0;
    let inv = 1.0 / scale;
    let q = v.iter().map(|x| (x * inv).round().clamp(-127.0, 127.0) as i8).collect();
    (q, scale)
}

/// Inverse of [`quantize_i8`].
pub fn dequantize_i8(q: &[i8], scale: f32) -> Vec<f32> {
    q.iter().map(|&x| x as f32 * scale).collect()
}

/// Dot product of two quantised vectors, rescaled to the f32 domain.
pub fn dot_i8(a: &[i8], a_scale: f32, b: &[i8], b_scale: f32) -> f32 {
    let dot: i64 = a.iter().zip(b).map(|(&x, &y)| x as i64 * y as i64).sum();
    dot as f32 * a_scale * b_scale
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::embedder::{cosine, l2_normalize};

    #[test]
    fn roundtrip_preserves_direction() {
        let mut v: Vec<f32> = (0..384).map(|i| ((i * 37) as f32).sin()).collect();
        l2_normalize(&mut v);
        let (q, scale) = quantize_i8(&v);
        assert_eq!(q.len(), v.len());
        assert!(q.iter().any(|&x| x == 127 || x == -127));
        let back = dequantize_i8(&q, scale);
        assert!(cosine(&v, &back) > 0.9999);
        let self_dot = dot_i8(&q, scale, &q, scale);
        assert!((self_dot - 1.0).abs() < 1e-2, "{self_dot}");
    }

    #[test]
    fn zero_and_empty_vectors() {
        assert_eq!(quantize_i8(&[0.0, 0.0]), (vec![0, 0], 0.0));
        assert_eq!(quantize_i8(&[]), (vec![], 0.0));
        assert_eq!(dequantize_i8(&[5, -5], 0.0), vec![0.0, -0.0]);
    }
}
