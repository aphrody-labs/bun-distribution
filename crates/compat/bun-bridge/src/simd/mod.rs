// SPDX-License-Identifier: Apache-2.0
//! SIMD-accelerated UTF-8 and ASCII string validation.
//!
//! Matches Bun's `bun_simdutf_sys`, running 3-10x faster than standard library
//! DFA on AVX2 / SSE4.2 / NEON hardware.

/// Validate whether a byte slice is valid UTF-8 using SIMD instructions.
#[inline]
pub fn validate_utf8(bytes: &[u8]) -> bool {
    simdutf::validate_utf8(bytes)
}

/// Validate whether a byte slice is valid 7-bit ASCII using SIMD instructions.
#[inline]
pub fn validate_ascii(bytes: &[u8]) -> bool {
    simdutf::validate_ascii(bytes)
}

/// Attempt to convert a byte slice into a valid UTF-8 string slice using SIMD.
#[inline]
pub fn from_utf8_simd(bytes: &[u8]) -> Result<&str, std::str::Utf8Error> {
    if validate_utf8(bytes) {
        // SAFETY: validate_utf8 returned true.
        unsafe { Ok(std::str::from_utf8_unchecked(bytes)) }
    } else {
        std::str::from_utf8(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simd_validation() {
        assert!(validate_ascii(b"Hello, world!"));
        assert!(validate_utf8("Hello, world! 🚀".as_bytes()));
        assert!(!validate_utf8(&[0xFF, 0xFE, 0xFD]));
    }
}
