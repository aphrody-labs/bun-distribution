//! Distance kernels.
//!
//! Every kernel has a portable scalar implementation written so that LLVM
//! auto-vectorises it (fixed-width chunks with independent accumulators) and,
//! on x86_64, an explicit AVX2 (+FMA for f32) implementation selected at
//! runtime via `is_x86_feature_detected!` (std caches the CPUID probe, so the
//! dispatch costs one predictable branch).

/// Portable i8 dot product.
#[inline]
pub fn dot_i8_scalar(a: &[i8], b: &[i8]) -> i32 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);
    let (ca, ra) = a.as_chunks::<32>();
    let (cb, rb) = b.as_chunks::<32>();
    let mut sum = 0i32;
    for (x, y) in ca.iter().zip(cb) {
        sum += x.iter().zip(y).map(|(&p, &q)| i32::from(i16::from(p) * i16::from(q))).sum::<i32>();
    }
    sum + ra.iter().zip(rb).map(|(&p, &q)| i32::from(p) * i32::from(q)).sum::<i32>()
}

/// Portable f32 dot product (8 independent lanes so it vectorises without
/// fast-math).
#[inline]
pub fn dot_f32_scalar(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);
    let mut acc = [0f32; 8];
    let (ca, ra) = a.as_chunks::<8>();
    let (cb, rb) = b.as_chunks::<8>();
    for (x, y) in ca.iter().zip(cb) {
        for j in 0..8 {
            acc[j] += x[j] * y[j];
        }
    }
    let mut sum: f32 = acc.iter().sum();
    for (p, q) in ra.iter().zip(rb) {
        sum += p * q;
    }
    sum
}

/// Portable squared L2 distance.
#[inline]
pub fn l2_f32_scalar(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);
    let mut acc = [0f32; 8];
    let (ca, ra) = a.as_chunks::<8>();
    let (cb, rb) = b.as_chunks::<8>();
    for (x, y) in ca.iter().zip(cb) {
        for j in 0..8 {
            let d = x[j] - y[j];
            acc[j] += d * d;
        }
    }
    let mut sum: f32 = acc.iter().sum();
    for (p, q) in ra.iter().zip(rb) {
        let d = p - q;
        sum += d * d;
    }
    sum
}

#[cfg(target_arch = "x86_64")]
mod avx2 {
    use std::arch::x86_64::*;

    /// # Safety
    /// Caller must ensure the CPU supports AVX2.
    #[target_feature(enable = "avx2")]
    pub unsafe fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
        // SAFETY: the caller checked AVX2 support. Slice-derived pointers stay
        // in bounds because each load is guarded by `i + width <= n`.
        unsafe {
            let n = a.len().min(b.len());
            let (pa, pb) = (a.as_ptr(), b.as_ptr());
            let mut i = 0usize;
            let mut acc = _mm256_setzero_si256();
            // Sign-extend 16 bytes to 16 i16 lanes, multiply pairwise and add
            // adjacent products into 8 i32 lanes. Per-lane growth is bounded by
            // 2 * 128^2 per 16 input bytes, far below i32::MAX for MAX_DIM.
            while i + 32 <= n {
                let a0 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pa.add(i) as *const __m128i));
                let b0 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pb.add(i) as *const __m128i));
                let a1 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pa.add(i + 16) as *const __m128i));
                let b1 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pb.add(i + 16) as *const __m128i));
                acc = _mm256_add_epi32(acc, _mm256_madd_epi16(a0, b0));
                acc = _mm256_add_epi32(acc, _mm256_madd_epi16(a1, b1));
                i += 32;
            }
            if i + 16 <= n {
                let a0 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pa.add(i) as *const __m128i));
                let b0 = _mm256_cvtepi8_epi16(_mm_loadu_si128(pb.add(i) as *const __m128i));
                acc = _mm256_add_epi32(acc, _mm256_madd_epi16(a0, b0));
                i += 16;
            }
            let mut lanes = [0i32; 8];
            _mm256_storeu_si256(lanes.as_mut_ptr() as *mut __m256i, acc);
            let mut sum: i32 = lanes.iter().sum();
            while i < n {
                sum += i32::from(*pa.add(i)) * i32::from(*pb.add(i));
                i += 1;
            }
            sum
        }
    }

    #[inline(always)]
    unsafe fn hsum_ps(v: __m256) -> f32 {
        // SAFETY: `lanes` has room for one full unaligned AVX register.
        unsafe {
            let mut lanes = [0f32; 8];
            _mm256_storeu_ps(lanes.as_mut_ptr(), v);
            lanes.iter().sum()
        }
    }

    /// # Safety
    /// Caller must ensure the CPU supports AVX2 and FMA.
    #[target_feature(enable = "avx2,fma")]
    pub unsafe fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
        // SAFETY: the caller checked AVX2+FMA support. Slice-derived pointers
        // stay in bounds because each vector load is guarded by its width.
        unsafe {
            let n = a.len().min(b.len());
            let (pa, pb) = (a.as_ptr(), b.as_ptr());
            let mut i = 0usize;
            let mut s0 = _mm256_setzero_ps();
            let mut s1 = _mm256_setzero_ps();
            while i + 16 <= n {
                s0 = _mm256_fmadd_ps(_mm256_loadu_ps(pa.add(i)), _mm256_loadu_ps(pb.add(i)), s0);
                s1 = _mm256_fmadd_ps(
                    _mm256_loadu_ps(pa.add(i + 8)),
                    _mm256_loadu_ps(pb.add(i + 8)),
                    s1,
                );
                i += 16;
            }
            if i + 8 <= n {
                s0 = _mm256_fmadd_ps(_mm256_loadu_ps(pa.add(i)), _mm256_loadu_ps(pb.add(i)), s0);
                i += 8;
            }
            let mut sum = hsum_ps(_mm256_add_ps(s0, s1));
            while i < n {
                sum += *pa.add(i) * *pb.add(i);
                i += 1;
            }
            sum
        }
    }

    /// # Safety
    /// Caller must ensure the CPU supports AVX2 and FMA.
    #[target_feature(enable = "avx2,fma")]
    pub unsafe fn l2_f32(a: &[f32], b: &[f32]) -> f32 {
        // SAFETY: the caller checked AVX2+FMA support. Slice-derived pointers
        // stay in bounds because each vector load is guarded by its width.
        unsafe {
            let n = a.len().min(b.len());
            let (pa, pb) = (a.as_ptr(), b.as_ptr());
            let mut i = 0usize;
            let mut s0 = _mm256_setzero_ps();
            let mut s1 = _mm256_setzero_ps();
            while i + 16 <= n {
                let d0 = _mm256_sub_ps(_mm256_loadu_ps(pa.add(i)), _mm256_loadu_ps(pb.add(i)));
                let d1 =
                    _mm256_sub_ps(_mm256_loadu_ps(pa.add(i + 8)), _mm256_loadu_ps(pb.add(i + 8)));
                s0 = _mm256_fmadd_ps(d0, d0, s0);
                s1 = _mm256_fmadd_ps(d1, d1, s1);
                i += 16;
            }
            if i + 8 <= n {
                let d0 = _mm256_sub_ps(_mm256_loadu_ps(pa.add(i)), _mm256_loadu_ps(pb.add(i)));
                s0 = _mm256_fmadd_ps(d0, d0, s0);
                i += 8;
            }
            let mut sum = hsum_ps(_mm256_add_ps(s0, s1));
            while i < n {
                let d = *pa.add(i) - *pb.add(i);
                sum += d * d;
                i += 1;
            }
            sum
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[inline]
fn has_avx2() -> bool {
    std::is_x86_feature_detected!("avx2")
}

#[cfg(target_arch = "x86_64")]
#[inline]
fn has_avx2_fma() -> bool {
    std::is_x86_feature_detected!("avx2") && std::is_x86_feature_detected!("fma")
}

/// i8 dot product with runtime SIMD dispatch.
#[inline]
pub fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
    #[cfg(target_arch = "x86_64")]
    {
        if has_avx2() {
            // SAFETY: AVX2 support was verified at runtime.
            return unsafe { avx2::dot_i8(a, b) };
        }
    }
    dot_i8_scalar(a, b)
}

/// f32 dot product with runtime SIMD dispatch.
#[inline]
pub fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    #[cfg(target_arch = "x86_64")]
    {
        if has_avx2_fma() {
            // SAFETY: AVX2 and FMA support were verified at runtime.
            return unsafe { avx2::dot_f32(a, b) };
        }
    }
    dot_f32_scalar(a, b)
}

/// Squared L2 distance with runtime SIMD dispatch.
#[inline]
pub fn l2_f32(a: &[f32], b: &[f32]) -> f32 {
    #[cfg(target_arch = "x86_64")]
    {
        if has_avx2_fma() {
            // SAFETY: AVX2 and FMA support were verified at runtime.
            return unsafe { avx2::l2_f32(a, b) };
        }
    }
    l2_f32_scalar(a, b)
}

/// Best-effort cache prefetch of the byte at `ptr` (no-op off x86_64).
#[inline(always)]
pub fn prefetch<T>(slice: &[T], index: usize) {
    #[cfg(target_arch = "x86_64")]
    {
        if index < slice.len() {
            // SAFETY: `_mm_prefetch` never dereferences in a way that can fault;
            // the pointer is in bounds anyway.
            unsafe {
                std::arch::x86_64::_mm_prefetch(
                    slice.as_ptr().add(index) as *const i8,
                    std::arch::x86_64::_MM_HINT_T0,
                );
            }
        }
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        let _ = (slice, index);
    }
}

/// Human-readable name of the kernel set selected on this machine.
pub fn kernel_name() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        if has_avx2_fma() {
            return "avx2+fma";
        }
        if has_avx2() {
            return "avx2 (i8) / scalar (f32)";
        }
    }
    "scalar"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;

    #[test]
    fn simd_matches_scalar() {
        let mut rng = SplitMix64::new(7);
        for dim in [1usize, 7, 15, 16, 17, 31, 32, 33, 64, 100, 384, 1023] {
            let a: Vec<i8> = (0..dim).map(|_| (rng.below(256) as i32 - 128) as i8).collect();
            let b: Vec<i8> = (0..dim).map(|_| (rng.below(256) as i32 - 128) as i8).collect();
            let naive: i32 = a.iter().zip(&b).map(|(&x, &y)| x as i32 * y as i32).sum();
            assert_eq!(dot_i8_scalar(&a, &b), naive, "dim {dim}");
            assert_eq!(dot_i8(&a, &b), naive, "dim {dim}");

            let fa: Vec<f32> = (0..dim).map(|_| rng.gaussian()).collect();
            let fb: Vec<f32> = (0..dim).map(|_| rng.gaussian()).collect();
            let nd: f64 = fa.iter().zip(&fb).map(|(&x, &y)| x as f64 * y as f64).sum();
            let nl: f64 = fa.iter().zip(&fb).map(|(&x, &y)| (x as f64 - y as f64).powi(2)).sum();
            let tol = 1e-3 * (1.0 + nd.abs());
            assert!((dot_f32(&fa, &fb) as f64 - nd).abs() < tol);
            assert!((dot_f32_scalar(&fa, &fb) as f64 - nd).abs() < tol);
            let tol = 1e-3 * (1.0 + nl);
            assert!((l2_f32(&fa, &fb) as f64 - nl).abs() < tol);
            assert!((l2_f32_scalar(&fa, &fb) as f64 - nl).abs() < tol);
        }
    }
}
