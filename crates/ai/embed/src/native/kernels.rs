//! Element-wise CPU kernels for the native BERT encoder.
//!
//! Every kernel is written as branch-free scalar Rust and compiled twice: a portable
//! build and an `avx2,fma` build selected at runtime, so LLVM can auto-vectorise the hot
//! loops without requiring `-C target-cpu=native` for the shipped library.

#![allow(clippy::excessive_precision)]

use std::f32::consts::{FRAC_1_SQRT_2, LN_2};

/// Runtime SIMD capability probe (cached by `std`).
#[inline]
pub(crate) fn has_avx2_fma() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2") && std::arch::is_x86_feature_detected!("fma")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

macro_rules! dispatch {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($arg:ident : $ty:ty),* $(,)?) => $imp:ident;) => {
        $(#[$meta])*
        $vis fn $name($($arg: $ty),*) {
            #[cfg(target_arch = "x86_64")]
            {
                #[target_feature(enable = "avx2,fma")]
                unsafe fn simd($($arg: $ty),*) {
                    $imp($($arg),*)
                }
                if has_avx2_fma() {
                    // SAFETY: the CPU supports the enabled features (checked above).
                    return unsafe { simd($($arg),*) };
                }
            }
            $imp($($arg),*)
        }
    };
}

// Abramowitz & Stegun 7.1.28: erf(x) = 1 - (1 + a1 x + ... + a6 x^6)^-16, |error| <= 3e-7.
const ERF_A1: f32 = 0.070_523_078_4;
const ERF_A2: f32 = 0.042_282_012_3;
const ERF_A3: f32 = 0.009_270_527_2;
const ERF_A4: f32 = 0.000_152_014_3;
const ERF_A5: f32 = 0.000_276_567_2;
const ERF_A6: f32 = 0.000_043_063_8;

/// Branch-free `erf` approximation (max abs error 3e-7), vectorisable.
#[inline(always)]
pub(crate) fn erf(x: f32) -> f32 {
    let a = x.abs();
    let p =
        1.0 + a * (ERF_A1 + a * (ERF_A2 + a * (ERF_A3 + a * (ERF_A4 + a * (ERF_A5 + a * ERF_A6)))));
    // Clamp before powering so large |x| cannot overflow to inf (0/inf is fine, but keep it
    // finite for determinism across SIMD widths).
    let p = p.min(1.0e2);
    let p2 = p * p;
    let p4 = p2 * p2;
    let p8 = p4 * p4;
    let p16 = p8 * p8;
    (1.0 - 1.0 / p16).copysign(x)
}

#[inline(always)]
fn gelu_impl(xs: &mut [f32]) {
    for x in xs.iter_mut() {
        let v = *x;
        *x = 0.5 * v * (1.0 + erf(v * FRAC_1_SQRT_2));
    }
}

dispatch! {
    /// Exact (erf-based) GELU in place.
    pub(crate) fn gelu(xs: &mut [f32]) => gelu_impl;
}

const INV_LN_2: f32 = 1.0 / LN_2;

/// Vectorisable `exp` for x in [-80, 80]: 2^k * taylor7(r); relative error
/// < 1e-6 + 6e-8 * |x| (f32 rounding of `x - k ln2`).
#[inline(always)]
pub(crate) fn exp(x: f32) -> f32 {
    let x = x.clamp(-80.0, 80.0);
    let k = (x * INV_LN_2 + 0.5).floor();
    let r = x - k * LN_2;
    let p = 1.0
        + r * (1.0
            + r * (0.5
                + r * (1.0 / 6.0
                    + r * (1.0 / 24.0
                        + r * (1.0 / 120.0 + r * (1.0 / 720.0 + r * (1.0 / 5040.0)))))));
    let bits = ((k as i32 + 127) as u32) << 23;
    p * f32::from_bits(bits)
}

/// Number of independent accumulators; lets LLVM vectorise strict-FP reductions.
const LANES: usize = 16;

#[inline(always)]
fn sum_lanes(xs: &[f32]) -> f32 {
    let mut acc = [0.0f32; LANES];
    let (chunks, rest) = xs.as_chunks::<LANES>();
    let tail: f32 = rest.iter().sum();
    for c in chunks {
        for i in 0..LANES {
            acc[i] += c[i];
        }
    }
    acc.iter().sum::<f32>() + tail
}

#[inline(always)]
fn sum_sq_lanes(xs: &[f32]) -> f32 {
    let mut acc = [0.0f32; LANES];
    let (chunks, rest) = xs.as_chunks::<LANES>();
    let tail: f32 = rest.iter().map(|x| x * x).sum();
    for c in chunks {
        for i in 0..LANES {
            acc[i] += c[i] * c[i];
        }
    }
    acc.iter().sum::<f32>() + tail
}

#[inline(always)]
fn max_lanes(xs: &[f32]) -> f32 {
    let mut acc = [f32::NEG_INFINITY; LANES];
    let (chunks, rest) = xs.as_chunks::<LANES>();
    let tail = rest.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    for c in chunks {
        for i in 0..LANES {
            acc[i] = if c[i] > acc[i] { c[i] } else { acc[i] };
        }
    }
    acc.iter().copied().fold(tail, f32::max)
}

#[inline(always)]
fn softmax_rows_impl(scores: &mut [f32], cols: usize) {
    for row in scores.chunks_exact_mut(cols) {
        let max = max_lanes(row);
        for v in row.iter_mut() {
            *v = exp(*v - max);
        }
        let inv = 1.0 / sum_lanes(row);
        for v in row.iter_mut() {
            *v *= inv;
        }
    }
}

dispatch! {
    /// Row-wise softmax in place over a `rows x cols` matrix.
    pub(crate) fn softmax_rows(scores: &mut [f32], cols: usize) => softmax_rows_impl;
}

#[inline(always)]
fn normalize_row(row: &mut [f32], gamma: &[f32], beta: &[f32], eps: f32) {
    let dim = row.len() as f32;
    let mean = sum_lanes(row) / dim;
    for x in row.iter_mut() {
        *x -= mean;
    }
    let inv = 1.0 / (sum_sq_lanes(row) / dim + eps).sqrt();
    for ((x, g), b) in row.iter_mut().zip(gamma).zip(beta) {
        *x = *x * inv * *g + *b;
    }
}

#[inline(always)]
fn add_layer_norm_impl(xs: &mut [f32], residual: &[f32], gamma: &[f32], beta: &[f32], eps: f32) {
    let dim = gamma.len();
    for (row, res) in xs.chunks_exact_mut(dim).zip(residual.chunks_exact(dim)) {
        for (x, r) in row.iter_mut().zip(res) {
            *x += *r;
        }
        normalize_row(row, gamma, beta, eps);
    }
}

dispatch! {
    /// `x = LayerNorm(x + residual)` row-wise in place.
    pub(crate) fn add_layer_norm(
        xs: &mut [f32],
        residual: &[f32],
        gamma: &[f32],
        beta: &[f32],
        eps: f32,
    ) => add_layer_norm_impl;
}

#[inline(always)]
fn layer_norm_impl(xs: &mut [f32], gamma: &[f32], beta: &[f32], eps: f32) {
    for row in xs.chunks_exact_mut(gamma.len()) {
        normalize_row(row, gamma, beta, eps);
    }
}

dispatch! {
    /// Row-wise LayerNorm in place.
    pub(crate) fn layer_norm(xs: &mut [f32], gamma: &[f32], beta: &[f32], eps: f32) => layer_norm_impl;
}

/// Fill every `bias.len()`-wide row of `dst` with `bias`.
#[inline]
pub(crate) fn fill_rows(dst: &mut [f32], bias: &[f32]) {
    for row in dst.chunks_exact_mut(bias.len()) {
        row.copy_from_slice(bias);
    }
}

/// `dst = src * W^T + bias` for row-major `src (rows x in)` and `W (out x in)`.
pub(crate) fn linear(
    dst: &mut [f32],
    src: &[f32],
    weight: &[f32],
    bias: &[f32],
    parallelism: gemm::Parallelism,
) {
    let out = bias.len();
    let inp = weight.len() / out;
    let rows = src.len() / inp;
    debug_assert_eq!(dst.len(), rows * out);
    debug_assert_eq!(weight.len(), out * inp);
    fill_rows(dst, bias);
    // SAFETY: all buffers are sized for the declared shapes (asserted above in debug) and
    // gemm only reads `src`/`weight` and writes `dst` within `rows x out`.
    unsafe {
        gemm::gemm(
            rows,
            out,
            inp,
            dst.as_mut_ptr(),
            1,
            out as isize,
            true,
            src.as_ptr(),
            1,
            inp as isize,
            weight.as_ptr(),
            inp as isize,
            1,
            1.0,
            1.0,
            false,
            false,
            false,
            parallelism,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erf_matches_reference_values() {
        // erf reference values (Wolfram Alpha).
        let cases = [
            (0.0f32, 0.0f32),
            (0.1, 0.112_462_916),
            (0.5, 0.520_499_878),
            (1.0, 0.842_700_793),
            (-1.5, -0.966_105_146),
            (2.5, 0.999_593_048),
            (6.0, 1.0),
            (-40.0, -1.0),
        ];
        for (x, want) in cases {
            assert!((erf(x) - want).abs() < 2e-6, "erf({x}) = {} want {want}", erf(x));
        }
    }

    #[test]
    fn exp_matches_std_within_relative_tolerance() {
        let mut x = -60.0f32;
        while x <= 20.0 {
            // f32 rounding in `x - k ln2` grows linearly with |k|; irrelevant for softmax.
            let rel = ((exp(x) - x.exp()) / x.exp()).abs();
            assert!(rel < 1e-6 + 6e-8 * x.abs(), "exp({x}) rel err {rel}");
            x += 0.173;
        }
        assert_eq!(exp(0.0), 1.0);
        assert!(exp(-1.0e9) > 0.0 && exp(-1.0e9).is_normal());
    }

    #[test]
    fn softmax_and_gelu_and_layer_norm_are_correct() {
        let mut s = vec![1.0f32, 2.0, 3.0, -1.0e4, 0.0, 1.0e4];
        softmax_rows(&mut s, 3);
        let e: Vec<f32> = [1.0f32, 2.0, 3.0].iter().map(|v| v.exp()).collect();
        let z: f32 = e.iter().sum();
        for i in 0..3 {
            assert!((s[i] - e[i] / z).abs() < 1e-6);
        }
        assert!((s[5] - 1.0).abs() < 1e-6 && s[3] >= 0.0 && s[3] < 1e-30);

        let mut g = vec![-3.0f32, -0.5, 0.0, 0.7, 4.0];
        let want: Vec<f32> = g
            .iter()
            .map(|&x| 0.5 * x * (1.0 + libm_erf(x as f64 / std::f64::consts::SQRT_2) as f32))
            .collect();
        gelu(&mut g);
        for (a, b) in g.iter().zip(&want) {
            assert!((a - b).abs() < 2e-6, "{a} vs {b}");
        }

        let mut x = vec![1.0f32, 2.0, 3.0, 4.0];
        let r = vec![0.0f32; 4];
        add_layer_norm(&mut x, &r, &[1.0, 1.0, 1.0, 1.0], &[0.0, 0.0, 0.0, 0.0], 1e-12);
        let sum: f32 = x.iter().sum();
        let var: f32 = x.iter().map(|v| v * v).sum::<f32>() / 4.0;
        assert!(sum.abs() < 1e-5 && (var - 1.0).abs() < 1e-5);
    }

    #[test]
    fn linear_matches_naive() {
        let (rows, inp, out) = (5usize, 7usize, 3usize);
        let src: Vec<f32> = (0..rows * inp).map(|i| (i as f32 * 0.37).sin()).collect();
        let w: Vec<f32> = (0..out * inp).map(|i| (i as f32 * 0.11).cos()).collect();
        let b = vec![0.5f32, -1.0, 2.0];
        let mut dst = vec![0.0f32; rows * out];
        linear(&mut dst, &src, &w, &b, gemm::Parallelism::None);
        for r in 0..rows {
            for o in 0..out {
                let want: f32 =
                    (0..inp).map(|i| src[r * inp + i] * w[o * inp + i]).sum::<f32>() + b[o];
                assert!((dst[r * out + o] - want).abs() < 1e-4);
            }
        }
    }

    /// High-precision erf for tests (series / continued fraction, f64).
    fn libm_erf(x: f64) -> f64 {
        let sign = x.signum();
        let x = x.abs();
        if x < 5.0 {
            let mut term = x;
            let mut sum = x;
            let mut n = 0.0;
            while term.abs() > 1e-17 {
                n += 1.0;
                term *= -x * x / n;
                sum += term / (2.0 * n + 1.0);
            }
            sign * sum * 2.0 / std::f64::consts::PI.sqrt()
        } else {
            sign * 1.0
        }
    }
}
