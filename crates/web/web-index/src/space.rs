//! Vector validation, quantisation and distance spaces.
//!
//! Internally every distance is "lower is better":
//! * cosine: `-dot(a, b)` on L2-normalised vectors,
//! * L2: squared Euclidean distance.
//!
//! Public scores are the negation (similarity, higher is better).

use crate::{
    error::{IndexError, Result},
    kernels,
    params::Metric,
};

/// Validate a raw vector and return the representation that is stored:
/// L2-normalised for cosine, unchanged for L2.
pub fn prepare_vector(v: &[f32], dim: usize, metric: Metric) -> Result<Vec<f32>> {
    if v.len() != dim {
        return Err(IndexError::DimensionMismatch { expected: dim, got: v.len() });
    }
    if v.iter().any(|x| !x.is_finite()) {
        return Err(IndexError::NonFiniteVector);
    }
    let mut out = v.to_vec();
    if metric == Metric::Cosine {
        let norm_sq: f64 = v.iter().map(|&x| f64::from(x) * f64::from(x)).sum();
        if norm_sq.is_nan() || norm_sq <= 0.0 || norm_sq.is_infinite() {
            return Err(IndexError::ZeroVector);
        }
        let inv = (1.0 / norm_sq.sqrt()) as f32;
        for x in &mut out {
            *x *= inv;
        }
        if out.iter().any(|x| !x.is_finite()) {
            return Err(IndexError::NonFiniteVector);
        }
    } else {
        let norm_sq: f64 = v.iter().map(|&x| f64::from(x) * f64::from(x)).sum();
        if !norm_sq.is_finite() || norm_sq > f64::from(f32::MAX) {
            return Err(IndexError::NonFiniteVector);
        }
    }
    Ok(out)
}

/// Symmetric per-vector scalar quantisation: `code = round(x / scale)` with
/// `scale = max|x| / 127`. Returns `(scale, squared norm of the dequantised
/// vector)`.
pub fn quantize(v: &[f32], out: &mut [i8]) -> (f32, f32) {
    let max_abs = v.iter().fold(0f32, |m, &x| m.max(x.abs()));
    if max_abs == 0.0 {
        out.fill(0);
        return (0.0, 0.0);
    }
    let scale = max_abs / 127.0;
    let inv = 127.0 / max_abs;
    let mut sum_sq: i64 = 0;
    for (o, &x) in out.iter_mut().zip(v) {
        let c = (x * inv).round().clamp(-127.0, 127.0) as i8;
        *o = c;
        sum_sq += i64::from(c) * i64::from(c);
    }
    (scale, scale * scale * sum_sq as f32)
}

/// A distance space over stored slots.
pub trait Space: Sync {
    type Query<'q>
    where
        Self: 'q;

    /// Distance from a prepared query to a stored slot.
    fn dist_query(&self, q: &Self::Query<'_>, slot: u32) -> f32;
    /// Query view of a stored slot (used while inserting it).
    fn slot_query(&self, slot: u32) -> Self::Query<'_>;
    /// Distance between two stored slots.
    fn dist_nodes(&self, a: u32, b: u32) -> f32;
    /// Hint the CPU to fetch the slot's vector.
    fn prefetch(&self, slot: u32);
}

/// Int8 codes with per-vector scale.
pub struct I8Space<'a> {
    pub dim: usize,
    pub metric: Metric,
    pub codes: &'a [i8],
    pub scales: &'a [f32],
    /// Squared norms of dequantised vectors (only populated for L2).
    pub norms: &'a [f32],
}

/// Prepared int8 query.
pub struct I8Query<'q> {
    pub codes: &'q [i8],
    pub scale: f32,
    pub norm: f32,
}

impl I8Space<'_> {
    #[inline]
    fn codes_of(&self, slot: u32) -> &[i8] {
        let start = slot as usize * self.dim;
        &self.codes[start..start + self.dim]
    }

    #[inline]
    fn norm_of(&self, slot: u32) -> f32 {
        self.norms.get(slot as usize).copied().unwrap_or(0.0)
    }

    #[inline]
    fn combine(&self, dot: i32, sa: f32, sb: f32, na: f32, nb: f32) -> f32 {
        let d = sa * sb * dot as f32;
        match self.metric {
            Metric::Cosine => -d,
            Metric::L2 => (na + nb - 2.0 * d).max(0.0),
        }
    }
}

impl Space for I8Space<'_> {
    type Query<'q>
        = I8Query<'q>
    where
        Self: 'q;

    #[inline]
    fn dist_query(&self, q: &I8Query<'_>, slot: u32) -> f32 {
        let dot = kernels::dot_i8(q.codes, self.codes_of(slot));
        self.combine(dot, q.scale, self.scales[slot as usize], q.norm, self.norm_of(slot))
    }

    #[inline]
    fn slot_query(&self, slot: u32) -> I8Query<'_> {
        I8Query {
            codes: self.codes_of(slot),
            scale: self.scales[slot as usize],
            norm: self.norm_of(slot),
        }
    }

    #[inline]
    fn dist_nodes(&self, a: u32, b: u32) -> f32 {
        let q = self.slot_query(a);
        self.dist_query(&q, b)
    }

    #[inline]
    fn prefetch(&self, slot: u32) {
        kernels::prefetch(self.codes, slot as usize * self.dim);
    }
}

/// Full-precision f32 vectors.
pub struct F32Space<'a> {
    pub dim: usize,
    pub metric: Metric,
    pub floats: &'a [f32],
}

impl F32Space<'_> {
    #[inline]
    pub fn vec_of(&self, slot: u32) -> &[f32] {
        let start = slot as usize * self.dim;
        &self.floats[start..start + self.dim]
    }

    #[inline]
    pub fn dist_vec(&self, q: &[f32], slot: u32) -> f32 {
        match self.metric {
            Metric::Cosine => -kernels::dot_f32(q, self.vec_of(slot)),
            Metric::L2 => kernels::l2_f32(q, self.vec_of(slot)),
        }
    }
}

impl Space for F32Space<'_> {
    type Query<'q>
        = &'q [f32]
    where
        Self: 'q;

    #[inline]
    fn dist_query(&self, q: &&[f32], slot: u32) -> f32 {
        self.dist_vec(q, slot)
    }

    #[inline]
    fn slot_query(&self, slot: u32) -> &[f32] {
        self.vec_of(slot)
    }

    #[inline]
    fn dist_nodes(&self, a: u32, b: u32) -> f32 {
        self.dist_vec(self.vec_of(a), b)
    }

    #[inline]
    fn prefetch(&self, slot: u32) {
        kernels::prefetch(self.floats, slot as usize * self.dim);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_vectors() {
        assert!(matches!(
            prepare_vector(&[1.0, 2.0], 3, Metric::Cosine),
            Err(IndexError::DimensionMismatch { expected: 3, got: 2 })
        ));
        assert!(matches!(
            prepare_vector(&[1.0, f32::NAN], 2, Metric::Cosine),
            Err(IndexError::NonFiniteVector)
        ));
        assert!(matches!(
            prepare_vector(&[1.0, f32::INFINITY], 2, Metric::L2),
            Err(IndexError::NonFiniteVector)
        ));
        assert!(matches!(
            prepare_vector(&[0.0, 0.0], 2, Metric::Cosine),
            Err(IndexError::ZeroVector)
        ));
        assert!(prepare_vector(&[0.0, 0.0], 2, Metric::L2).is_ok());
        let v = prepare_vector(&[3.0, 4.0], 2, Metric::Cosine).unwrap();
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn quantisation_preserves_dot() {
        let a = prepare_vector(&[0.3, -0.2, 0.9, 0.1], 4, Metric::Cosine).unwrap();
        let b = prepare_vector(&[0.25, -0.1, 0.8, 0.3], 4, Metric::Cosine).unwrap();
        let mut ca = [0i8; 4];
        let mut cb = [0i8; 4];
        let (sa, _) = quantize(&a, &mut ca);
        let (sb, _) = quantize(&b, &mut cb);
        let exact: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
        let approx = sa * sb * kernels::dot_i8(&ca, &cb) as f32;
        assert!((exact - approx).abs() < 0.02, "{exact} vs {approx}");
    }
}
