// SPDX-License-Identifier: BSD-2-Clause
// Absorbed from fec-rs (https://github.com/hgaiser/fec-rs, revision 402f41f970bb8c3ef7c88639821032e3b6460f63),
// Copyright (c) 2026, Hans Gaiser. See crates/bun-engine-core/STREAM-PROVENANCE.md.
// GF(2^8) tables for generating polynomial 29 (0x1D), computed at compile time (the upstream
// crate generates the same tables from build.rs).
const FIELD_SIZE: usize = 256;
const GENERATING_POLYNOMIAL: usize = 29;
const EXP_TABLE_SIZE: usize = FIELD_SIZE * 2 - 2;

const fn gen_log_table() -> [u8; FIELD_SIZE] {
    let mut result = [0u8; FIELD_SIZE];
    let mut b: usize = 1;
    let mut log = 0;
    while log < FIELD_SIZE - 1 {
        result[b] = log as u8;
        b <<= 1;
        if FIELD_SIZE <= b {
            b = (b - FIELD_SIZE) ^ GENERATING_POLYNOMIAL;
        }
        log += 1;
    }
    result
}

const fn gen_exp_table(log_table: &[u8; FIELD_SIZE]) -> [u8; EXP_TABLE_SIZE] {
    let mut result = [0u8; EXP_TABLE_SIZE];
    let mut i = 1;
    while i < FIELD_SIZE {
        let log = log_table[i] as usize;
        result[log] = i as u8;
        result[log + FIELD_SIZE - 1] = i as u8;
        i += 1;
    }
    result
}

const LOG: [u8; FIELD_SIZE] = gen_log_table();
const EXP: [u8; EXP_TABLE_SIZE] = gen_exp_table(&LOG);

const fn table_mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        0
    } else {
        EXP[LOG[a as usize] as usize + LOG[b as usize] as usize]
    }
}

const fn gen_mul_table() -> [[u8; FIELD_SIZE]; FIELD_SIZE] {
    let mut result = [[0u8; FIELD_SIZE]; FIELD_SIZE];
    let mut a = 0;
    while a < FIELD_SIZE {
        let mut b = 0;
        while b < FIELD_SIZE {
            result[a][b] = table_mul(a as u8, b as u8);
            b += 1;
        }
        a += 1;
    }
    result
}

const fn gen_mul_table_half(high: bool) -> [[u8; 16]; FIELD_SIZE] {
    let mut out = [[0u8; 16]; FIELD_SIZE];
    let mut a = 0;
    while a < FIELD_SIZE {
        let mut n = 0;
        while n < 16 {
            let b = if high { n << 4 } else { n };
            out[a][n] = table_mul(a as u8, b as u8);
            n += 1;
        }
        a += 1;
    }
    out
}

/// For each constant `c`, the 8x8 bit matrix that makes `vgf2p8affineqb(x, m, 0)` compute `c * x`
/// (qword byte `7 - i` is the row of output bit `i`).
const fn gen_gfni_table() -> [u64; FIELD_SIZE] {
    let mut result = [0u64; FIELD_SIZE];
    let mut c = 0;
    while c < FIELD_SIZE {
        let mut rows = [0u8; 8];
        let mut j = 0;
        while j < 8 {
            let product = table_mul(c as u8, 1u8 << j);
            let mut i = 0;
            while i < 8 {
                if (product >> i) & 1 == 1 {
                    rows[i] |= 1 << j;
                }
                i += 1;
            }
            j += 1;
        }
        let mut matrix: u64 = 0;
        let mut i = 0;
        while i < 8 {
            matrix |= (rows[i] as u64) << ((7 - i) * 8);
            i += 1;
        }
        result[c] = matrix;
        c += 1;
    }
    result
}

pub static LOG_TABLE: [u8; FIELD_SIZE] = LOG;
pub static EXP_TABLE: [u8; EXP_TABLE_SIZE] = EXP;
pub static MUL_TABLE: [[u8; FIELD_SIZE]; FIELD_SIZE] = gen_mul_table();
pub static MUL_TABLE_LOW: [[u8; 16]; FIELD_SIZE] = gen_mul_table_half(false);
pub static MUL_TABLE_HIGH: [[u8; 16]; FIELD_SIZE] = gen_mul_table_half(true);
pub static GFNI_TABLE: [u64; FIELD_SIZE] = gen_gfni_table();

/// Add two GF(2^8) elements (XOR).
#[inline(always)]
pub fn add(a: u8, b: u8) -> u8 {
    a ^ b
}

/// Multiply two GF(2^8) elements using lookup table.
#[inline(always)]
pub fn mul(a: u8, b: u8) -> u8 {
    MUL_TABLE[a as usize][b as usize]
}

/// Divide a by b in GF(2^8). Panics if b is 0.
#[inline(always)]
pub fn div(a: u8, b: u8) -> u8 {
    if a == 0 {
        return 0;
    }
    assert!(b != 0, "Division by zero in GF(2^8)");
    let log_a = LOG_TABLE[a as usize] as isize;
    let log_b = LOG_TABLE[b as usize] as isize;
    let mut log_result = log_a - log_b;
    if log_result < 0 {
        log_result += 255;
    }
    EXP_TABLE[log_result as usize]
}

/// Compute a^n in GF(2^8).
#[inline(always)]
pub fn exp(a: u8, n: usize) -> u8 {
    if n == 0 {
        return 1;
    }
    if a == 0 {
        return 0;
    }
    let log_a = LOG_TABLE[a as usize] as usize;
    let log_result = log_a * (n % 255) % 255;
    EXP_TABLE[log_result]
}

/// Multiply each element of `input` by `c` and write to `out`.
///
/// Uses SIMD acceleration when available:
/// - GFNI + AVX2 (best: single-instruction GF multiply on 32 bytes)
/// - AVX2 VPSHUFB (split-table nibble lookup on 32 bytes)
/// - GFNI + SSE (single-instruction GF multiply on 16 bytes)
/// - SSSE3 VPSHUFB (split-table nibble lookup on 16 bytes)
/// - Scalar fallback
#[inline]
pub fn mul_slice(c: u8, input: &[u8], out: &mut [u8]) {
    assert_eq!(input.len(), out.len());
    if input.is_empty() || c == 0 {
        out.iter_mut().for_each(|o| *o = 0);
        return;
    }
    if c == 1 {
        out.copy_from_slice(input);
        return;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("gfni") && is_x86_feature_detected!("avx2") {
            unsafe {
                mul_slice_gfni_avx2(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("avx2") {
            unsafe {
                mul_slice_avx2(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("gfni") {
            unsafe {
                mul_slice_gfni_sse(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("ssse3") {
            unsafe {
                mul_slice_ssse3(c, input, out);
            }
            return;
        }
    }

    mul_slice_scalar(c, input, out);
}

/// Multiply each element of `input` by `c` and XOR into `out`.
///
/// Uses SIMD acceleration when available (same priority as `mul_slice`).
#[inline]
pub fn mul_slice_xor(c: u8, input: &[u8], out: &mut [u8]) {
    assert_eq!(input.len(), out.len());
    if input.is_empty() || c == 0 {
        return;
    }
    if c == 1 {
        for (o, i) in out.iter_mut().zip(input.iter()) {
            *o ^= *i;
        }
        return;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("gfni") && is_x86_feature_detected!("avx2") {
            unsafe {
                mul_slice_xor_gfni_avx2(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("avx2") {
            unsafe {
                mul_slice_xor_avx2(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("gfni") {
            unsafe {
                mul_slice_xor_gfni_sse(c, input, out);
            }
            return;
        }
        if is_x86_feature_detected!("ssse3") {
            unsafe {
                mul_slice_xor_ssse3(c, input, out);
            }
            return;
        }
    }

    mul_slice_xor_scalar(c, input, out);
}

/// Function pointer types for bulk GF(2^8) operations.
pub type MulSliceFn = fn(u8, &[u8], &mut [u8]);

/// Pair of (mul_slice, mul_slice_xor) function pointers for the best available SIMD path.
///
/// Unlike `mul_slice`/`mul_slice_xor`, these skip runtime feature detection on every call.
/// The caller checks once and stores the result.
///
/// Note: These raw dispatch functions do NOT handle the c==0 or c==1 special cases.
/// The caller must handle those before calling through the function pointer.
pub fn detect_mul_slice() -> (MulSliceFn, MulSliceFn) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("gfni") && is_x86_feature_detected!("avx2") {
            return (
                wrap_mul_slice_gfni_avx2 as MulSliceFn,
                wrap_mul_slice_xor_gfni_avx2 as MulSliceFn,
            );
        }
        if is_x86_feature_detected!("avx2") {
            return (
                wrap_mul_slice_avx2 as MulSliceFn,
                wrap_mul_slice_xor_avx2 as MulSliceFn,
            );
        }
        if is_x86_feature_detected!("gfni") {
            return (
                wrap_mul_slice_gfni_sse as MulSliceFn,
                wrap_mul_slice_xor_gfni_sse as MulSliceFn,
            );
        }
        if is_x86_feature_detected!("ssse3") {
            return (
                wrap_mul_slice_ssse3 as MulSliceFn,
                wrap_mul_slice_xor_ssse3 as MulSliceFn,
            );
        }
    }
    (
        mul_slice_scalar as MulSliceFn,
        mul_slice_xor_scalar as MulSliceFn,
    )
}

// Safe wrappers for SIMD functions (used as function pointer targets)
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_gfni_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_gfni_avx2(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_xor_gfni_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_xor_gfni_avx2(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_avx2(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_xor_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_xor_avx2(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_gfni_sse(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_gfni_sse(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_xor_gfni_sse(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_xor_gfni_sse(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_ssse3(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_ssse3(c, input, out) }
}
#[cfg(target_arch = "x86_64")]
fn wrap_mul_slice_xor_ssse3(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe { mul_slice_xor_ssse3(c, input, out) }
}

// ── Scalar fallback ──────────────────────────────────────────────────────

fn mul_slice_scalar(c: u8, input: &[u8], out: &mut [u8]) {
    let mt = &MUL_TABLE[c as usize];
    for (o, &i) in out.iter_mut().zip(input.iter()) {
        *o = mt[i as usize];
    }
}

fn mul_slice_xor_scalar(c: u8, input: &[u8], out: &mut [u8]) {
    let mt = &MUL_TABLE[c as usize];
    for (o, &i) in out.iter_mut().zip(input.iter()) {
        *o ^= mt[i as usize];
    }
}

// ── x86_64 SIMD implementations ─────────────────────────────────────────

// ── GFNI + AVX2 (best path: 32 bytes per vgf2p8affineqb) ──────────────

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "gfni,avx2")]
unsafe fn mul_slice_gfni_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let matrix = GFNI_TABLE[c as usize] as i64;
        let mat_vec = _mm256_set1_epi64x(matrix);

        let len = input.len();
        let mut i = 0;

        while i + 32 <= len {
            let data = _mm256_loadu_si256(input.as_ptr().add(i) as *const _);
            let result = _mm256_gf2p8affine_epi64_epi8(data, mat_vec, 0);
            _mm256_storeu_si256(out.as_mut_ptr().add(i) as *mut _, result);
            i += 32;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) = mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "gfni,avx2")]
unsafe fn mul_slice_xor_gfni_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let matrix = GFNI_TABLE[c as usize] as i64;
        let mat_vec = _mm256_set1_epi64x(matrix);

        let len = input.len();
        let mut i = 0;

        while i + 32 <= len {
            let data = _mm256_loadu_si256(input.as_ptr().add(i) as *const _);
            let existing = _mm256_loadu_si256(out.as_ptr().add(i) as *const _);
            let mul_result = _mm256_gf2p8affine_epi64_epi8(data, mat_vec, 0);
            let result = _mm256_xor_si256(mul_result, existing);
            _mm256_storeu_si256(out.as_mut_ptr().add(i) as *mut _, result);
            i += 32;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) ^= mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

// ── GFNI + SSE (16 bytes per vgf2p8affineqb) ──────────────────────────

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "gfni")]
unsafe fn mul_slice_gfni_sse(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let matrix = GFNI_TABLE[c as usize] as i64;
        let mat_vec = _mm_set1_epi64x(matrix);

        let len = input.len();
        let mut i = 0;

        while i + 16 <= len {
            let data = _mm_loadu_si128(input.as_ptr().add(i) as *const _);
            let result = _mm_gf2p8affine_epi64_epi8(data, mat_vec, 0);
            _mm_storeu_si128(out.as_mut_ptr().add(i) as *mut _, result);
            i += 16;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) = mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "gfni")]
unsafe fn mul_slice_xor_gfni_sse(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let matrix = GFNI_TABLE[c as usize] as i64;
        let mat_vec = _mm_set1_epi64x(matrix);

        let len = input.len();
        let mut i = 0;

        while i + 16 <= len {
            let data = _mm_loadu_si128(input.as_ptr().add(i) as *const _);
            let existing = _mm_loadu_si128(out.as_ptr().add(i) as *const _);
            let mul_result = _mm_gf2p8affine_epi64_epi8(data, mat_vec, 0);
            let result = _mm_xor_si128(mul_result, existing);
            _mm_storeu_si128(out.as_mut_ptr().add(i) as *mut _, result);
            i += 16;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) ^= mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

// ── AVX2 VPSHUFB (32 bytes, split-table nibble lookup) ─────────────────

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn mul_slice_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let low = &MUL_TABLE_LOW[c as usize];
        let high = &MUL_TABLE_HIGH[c as usize];

        // Broadcast the 16-byte low/high tables to 256-bit registers by duplicating
        let low_vec = _mm256_broadcastsi128_si256(_mm_loadu_si128(low.as_ptr() as *const _));
        let high_vec = _mm256_broadcastsi128_si256(_mm_loadu_si128(high.as_ptr() as *const _));
        let mask = _mm256_set1_epi8(0x0F);

        let len = input.len();
        let mut i = 0;

        // Process 32 bytes at a time
        while i + 32 <= len {
            let data = _mm256_loadu_si256(input.as_ptr().add(i) as *const _);
            let lo_nibble = _mm256_and_si256(data, mask);
            let hi_nibble = _mm256_and_si256(_mm256_srli_epi64(data, 4), mask);
            let lo_result = _mm256_shuffle_epi8(low_vec, lo_nibble);
            let hi_result = _mm256_shuffle_epi8(high_vec, hi_nibble);
            let result = _mm256_xor_si256(lo_result, hi_result);
            _mm256_storeu_si256(out.as_mut_ptr().add(i) as *mut _, result);
            i += 32;
        }

        // Handle remaining bytes with scalar
        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) = mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn mul_slice_xor_avx2(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let low = &MUL_TABLE_LOW[c as usize];
        let high = &MUL_TABLE_HIGH[c as usize];

        let low_vec = _mm256_broadcastsi128_si256(_mm_loadu_si128(low.as_ptr() as *const _));
        let high_vec = _mm256_broadcastsi128_si256(_mm_loadu_si128(high.as_ptr() as *const _));
        let mask = _mm256_set1_epi8(0x0F);

        let len = input.len();
        let mut i = 0;

        while i + 32 <= len {
            let data = _mm256_loadu_si256(input.as_ptr().add(i) as *const _);
            let existing = _mm256_loadu_si256(out.as_ptr().add(i) as *const _);
            let lo_nibble = _mm256_and_si256(data, mask);
            let hi_nibble = _mm256_and_si256(_mm256_srli_epi64(data, 4), mask);
            let lo_result = _mm256_shuffle_epi8(low_vec, lo_nibble);
            let hi_result = _mm256_shuffle_epi8(high_vec, hi_nibble);
            let result = _mm256_xor_si256(_mm256_xor_si256(lo_result, hi_result), existing);
            _mm256_storeu_si256(out.as_mut_ptr().add(i) as *mut _, result);
            i += 32;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) ^= mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3")]
unsafe fn mul_slice_ssse3(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let low = &MUL_TABLE_LOW[c as usize];
        let high = &MUL_TABLE_HIGH[c as usize];

        let low_vec = _mm_loadu_si128(low.as_ptr() as *const _);
        let high_vec = _mm_loadu_si128(high.as_ptr() as *const _);
        let mask = _mm_set1_epi8(0x0F);

        let len = input.len();
        let mut i = 0;

        while i + 16 <= len {
            let data = _mm_loadu_si128(input.as_ptr().add(i) as *const _);
            let lo_nibble = _mm_and_si128(data, mask);
            let hi_nibble = _mm_and_si128(_mm_srli_epi64(data, 4), mask);
            let lo_result = _mm_shuffle_epi8(low_vec, lo_nibble);
            let hi_result = _mm_shuffle_epi8(high_vec, hi_nibble);
            let result = _mm_xor_si128(lo_result, hi_result);
            _mm_storeu_si128(out.as_mut_ptr().add(i) as *mut _, result);
            i += 16;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) = mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3")]
unsafe fn mul_slice_xor_ssse3(c: u8, input: &[u8], out: &mut [u8]) {
    unsafe {
        use core::arch::x86_64::*;

        let low = &MUL_TABLE_LOW[c as usize];
        let high = &MUL_TABLE_HIGH[c as usize];

        let low_vec = _mm_loadu_si128(low.as_ptr() as *const _);
        let high_vec = _mm_loadu_si128(high.as_ptr() as *const _);
        let mask = _mm_set1_epi8(0x0F);

        let len = input.len();
        let mut i = 0;

        while i + 16 <= len {
            let data = _mm_loadu_si128(input.as_ptr().add(i) as *const _);
            let existing = _mm_loadu_si128(out.as_ptr().add(i) as *const _);
            let lo_nibble = _mm_and_si128(data, mask);
            let hi_nibble = _mm_and_si128(_mm_srli_epi64(data, 4), mask);
            let lo_result = _mm_shuffle_epi8(low_vec, lo_nibble);
            let hi_result = _mm_shuffle_epi8(high_vec, hi_nibble);
            let result = _mm_xor_si128(_mm_xor_si128(lo_result, hi_result), existing);
            _mm_storeu_si128(out.as_mut_ptr().add(i) as *mut _, result);
            i += 16;
        }

        let mt = &MUL_TABLE[c as usize];
        while i < len {
            *out.get_unchecked_mut(i) ^= mt[*input.get_unchecked(i) as usize];
            i += 1;
        }
    }
}
