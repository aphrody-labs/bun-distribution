//! PICA command float packing, matching libctru's `f32tof*` helpers.
//!
//! These helpers reproduce SDK truncation, rebiasing and saturation, including
//! exponent-zero payloads. They are not IEEE binary16 conversions and do not
//! describe the PICA arithmetic unit's rounding behavior.
//! Reference: `src/iecode-cpp/third_party/3ds/libctru/libctru/source/gpu/gpu.c`.

const fn pack(value: f32, exponent_bits: u32, mantissa_bits: u32) -> u32 {
    let bits = value.to_bits();
    let sign = (bits >> 31) << (exponent_bits + mantissa_bits);
    let max_exponent = (1_u32 << exponent_bits) - 1;
    let bias = (max_exponent / 2) as i32;
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + bias;
    if exponent < 0 {
        return sign;
    }
    if exponent > max_exponent as i32 {
        return sign | (max_exponent << mantissa_bits);
    }
    sign | ((exponent as u32) << mantissa_bits) | ((bits & 0x7f_ffff) >> (23 - mantissa_bits))
}

/// Pack a 1/5/10-bit float using libctru's truncating conversion.
pub const fn f32_to_f16(value: f32) -> u32 {
    pack(value, 5, 10)
}

/// Pack a 1/7/12-bit PICA float.
pub const fn f32_to_f20(value: f32) -> u32 {
    pack(value, 7, 12)
}

/// Pack a 1/7/16-bit PICA float.
pub const fn f32_to_f24(value: f32) -> u32 {
    pack(value, 7, 16)
}

/// Pack a 1/7/23-bit PICA float.
pub const fn f32_to_f31(value: f32) -> u32 {
    pack(value, 7, 23)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_command_values() {
        assert_eq!(f32_to_f16(1.0), 0x3c00);
        assert_eq!(f32_to_f20(1.0), 0x3f000);
        assert_eq!(f32_to_f24(1.0), 0x3f0000);
        assert_eq!(f32_to_f31(1.0), 0x1f800000);
        assert_eq!(f32_to_f24(-2.0), 0xc00000);
        assert_eq!(f32_to_f24(1.5), 0x3f8000);
    }

    #[test]
    fn signed_zero_underflow_and_saturation() {
        assert_eq!(f32_to_f16(-0.0), 0x8000);
        assert_eq!(f32_to_f24(-0.0), 0x800000);
        assert_eq!(f32_to_f24(f32::MIN_POSITIVE), 0);
        assert_eq!(f32_to_f24(f32::MAX), 0x7f0000);
        assert_eq!(f32_to_f24(f32::NEG_INFINITY), 0xff0000);
        // SDK helpers saturate NaNs; this does not preserve an IEEE NaN.
        assert_eq!(f32_to_f24(f32::NAN), 0x7f0000);
    }

    #[test]
    fn sdk_exponent_zero_payload_and_truncation() {
        let exponent_zero = f32::from_bits(64 << 23 | 0x123456);
        assert_eq!(f32_to_f24(exponent_zero), 0x2468);
        assert_eq!(f32_to_f24(f32::from_bits(63 << 23 | 0x7fffff)), 0);
        assert_eq!(f32_to_f16(f32::from_bits(127 << 23 | 0x1fff)), 0x3c00);
        assert_eq!(f32_to_f16(f32::from_bits(127 << 23 | 0x2000)), 0x3c01);
    }
}
