// SPDX-License-Identifier: Apache-2.0
//! Colour and math utilities shared by the HCT, palette and dynamic-scheme modules.
//!
//! Exact port of `utils/color_utils.ts` and `utils/math_utils.ts` from
//! [material-color-utilities] (Apache-2.0): same constants, same operation order, so the
//! results match the reference to the last ARGB bit.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

const SRGB_TO_XYZ: [[f64; 3]; 3] = [
    [0.41233895, 0.35762064, 0.18051042],
    [0.2126, 0.7152, 0.0722],
    [0.01932141, 0.11916382, 0.95034478],
];

const XYZ_TO_SRGB: [[f64; 3]; 3] = [
    [
        3.2413774792388685,
        -1.5376652402851851,
        -0.49885366846268053,
    ],
    [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
    [
        0.05562093689691305,
        -0.20395524564742123,
        1.0571799111220335,
    ],
];

/// D65 reference white in XYZ, `Y` normalised to 100.
pub const WHITE_POINT_D65: [f64; 3] = [95.047, 100.0, 108.883];

/// Opaque ARGB from 8-bit channels.
#[must_use]
pub const fn argb_from_rgb(red: u8, green: u8, blue: u8) -> u32 {
    0xFF00_0000 | (red as u32) << 16 | (green as u32) << 8 | blue as u32
}

/// Red channel of an ARGB value.
#[must_use]
pub const fn red(argb: u32) -> u8 {
    (argb >> 16) as u8
}

/// Green channel of an ARGB value.
#[must_use]
pub const fn green(argb: u32) -> u8 {
    (argb >> 8) as u8
}

/// Blue channel of an ARGB value.
#[must_use]
pub const fn blue(argb: u32) -> u8 {
    argb as u8
}

/// Alpha channel of an ARGB value.
#[must_use]
pub const fn alpha(argb: u32) -> u8 {
    (argb >> 24) as u8
}

/// Linear RGB (each channel 0..100) to ARGB.
#[must_use]
pub fn argb_from_linrgb(linrgb: [f64; 3]) -> u32 {
    argb_from_rgb(
        delinearized(linrgb[0]),
        delinearized(linrgb[1]),
        delinearized(linrgb[2]),
    )
}

/// XYZ to ARGB.
#[must_use]
pub fn argb_from_xyz(x: f64, y: f64, z: f64) -> u32 {
    let m = XYZ_TO_SRGB;
    let linear_r = m[0][0] * x + m[0][1] * y + m[0][2] * z;
    let linear_g = m[1][0] * x + m[1][1] * y + m[1][2] * z;
    let linear_b = m[2][0] * x + m[2][1] * y + m[2][2] * z;
    argb_from_rgb(
        delinearized(linear_r),
        delinearized(linear_g),
        delinearized(linear_b),
    )
}

/// ARGB to XYZ.
#[must_use]
pub fn xyz_from_argb(argb: u32) -> [f64; 3] {
    let r = linearized(red(argb));
    let g = linearized(green(argb));
    let b = linearized(blue(argb));
    matrix_multiply([r, g, b], SRGB_TO_XYZ)
}

/// The grey ARGB whose L* is `lstar`.
#[must_use]
pub fn argb_from_lstar(lstar: f64) -> u32 {
    let component = delinearized(y_from_lstar(lstar));
    argb_from_rgb(component, component, component)
}

/// L* (CIE lightness, 0..100) of an ARGB value: the HCT tone.
#[must_use]
pub fn lstar_from_argb(argb: u32) -> f64 {
    let y = xyz_from_argb(argb)[1];
    116.0 * lab_f(y / 100.0) - 16.0
}

/// Relative luminance `Y` (0..100) from L*.
#[must_use]
pub fn y_from_lstar(lstar: f64) -> f64 {
    100.0 * lab_invf((lstar + 16.0) / 116.0)
}

/// L* from relative luminance `Y` (0..100).
#[must_use]
pub fn lstar_from_y(y: f64) -> f64 {
    lab_f(y / 100.0) * 116.0 - 16.0
}

/// An 8-bit sRGB channel to linear RGB (0..100).
#[must_use]
pub fn linearized(component: u8) -> f64 {
    let normalized = f64::from(component) / 255.0;
    if normalized <= 0.040449936 {
        normalized / 12.92 * 100.0
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4) * 100.0
    }
}

/// A linear RGB channel (0..100) to 8-bit sRGB, rounded and clamped.
#[must_use]
pub fn delinearized(component: f64) -> u8 {
    let normalized = component / 100.0;
    let delinearized = if normalized <= 0.0031308 {
        normalized * 12.92
    } else {
        1.055 * normalized.powf(1.0 / 2.4) - 0.055
    };
    // Clamped to 0..=255, so the cast is exact.
    js_round(delinearized * 255.0).clamp(0.0, 255.0) as u8
}

/// L*a*b* (CIE 1976) from ARGB, exact port of `utils/color_utils.ts` `labFromArgb`.
#[must_use]
pub fn lab_from_argb(argb: u32) -> [f64; 3] {
    let linear_r = linearized(red(argb));
    let linear_g = linearized(green(argb));
    let linear_b = linearized(blue(argb));
    let [x, y, z] = matrix_multiply([linear_r, linear_g, linear_b], SRGB_TO_XYZ);
    let white = WHITE_POINT_D65;
    let fx = lab_f(x / white[0]);
    let fy = lab_f(y / white[1]);
    let fz = lab_f(z / white[2]);
    let l = 116.0 * fy - 16.0;
    let a = 500.0 * (fx - fy);
    let b = 200.0 * (fy - fz);
    [l, a, b]
}

/// ARGB from L*a*b* (CIE 1976), exact port of `utils/color_utils.ts` `argbFromLab`.
#[must_use]
pub fn argb_from_lab(l: f64, a: f64, b: f64) -> u32 {
    let white = WHITE_POINT_D65;
    let fy = (l + 16.0) / 116.0;
    let fx = a / 500.0 + fy;
    let fz = fy - b / 200.0;
    let x = lab_invf(fx) * white[0];
    let y = lab_invf(fy) * white[1];
    let z = lab_invf(fz) * white[2];
    argb_from_xyz(x, y, z)
}

fn lab_f(t: f64) -> f64 {
    let e = 216.0 / 24389.0;
    let kappa = 24389.0 / 27.0;
    if t > e {
        t.powf(1.0 / 3.0)
    } else {
        (kappa * t + 16.0) / 116.0
    }
}

fn lab_invf(ft: f64) -> f64 {
    let e = 216.0 / 24389.0;
    let kappa = 24389.0 / 27.0;
    let ft3 = ft * ft * ft;
    if ft3 > e {
        ft3
    } else {
        (116.0 * ft - 16.0) / kappa
    }
}

/// `#rrggbb` (lower case, alpha dropped), the format CSS sheets use.
#[must_use]
pub fn hex_from_argb(argb: u32) -> String {
    format!("#{:06x}", argb & 0x00FF_FFFF)
}

/// Parse `#rgb`, `#rrggbb` or `rrggbb` into opaque ARGB.
#[must_use]
pub fn argb_from_hex(hex: &str) -> Option<u32> {
    let digits = hex.trim().trim_start_matches('#');
    let expanded: String = match digits.len() {
        3 => digits.chars().flat_map(|c| [c, c]).collect(),
        6 => digits.to_owned(),
        _ => return None,
    };
    u32::from_str_radix(&expanded, 16)
        .ok()
        .map(|rgb| 0xFF00_0000 | rgb)
}

// ── math_utils ──────────────────────────────────────────────────────────────

/// JavaScript `Math.round`: halves round towards positive infinity.
#[must_use]
pub fn js_round(x: f64) -> f64 {
    // `f64::round` sends halves away from zero, which differs only for negative halves.
    if x < 0.0 && x.fract() == -0.5 {
        x.ceil()
    } else {
        x.round()
    }
}

/// -1, 0 or 1.
#[must_use]
pub fn signum(x: f64) -> f64 {
    if x < 0.0 {
        -1.0
    } else if x == 0.0 {
        0.0
    } else {
        1.0
    }
}

/// Linear interpolation.
#[must_use]
pub fn lerp(start: f64, stop: f64, amount: f64) -> f64 {
    (1.0 - amount) * start + amount * stop
}

/// Clamp `input` to `min..=max` (reference argument order).
#[must_use]
pub fn clamp_double(min: f64, max: f64, input: f64) -> f64 {
    if input < min {
        min
    } else if input > max {
        max
    } else {
        input
    }
}

/// Degrees normalised to `0..360`.
#[must_use]
pub fn sanitize_degrees(degrees: f64) -> f64 {
    let degrees = degrees % 360.0;
    if degrees < 0.0 {
        degrees + 360.0
    } else {
        degrees
    }
}

/// Integer degrees normalised to `0..360`, exact port of `math_utils.ts` `sanitizeDegreesInt`.
#[must_use]
pub const fn sanitize_degrees_int(degrees: i32) -> i32 {
    let degrees = degrees % 360;
    if degrees < 0 { degrees + 360 } else { degrees }
}

/// `1.0` when the shortest rotation from `from` to `to` increases the angle, else `-1.0`.
#[must_use]
pub fn rotation_direction(from: f64, to: f64) -> f64 {
    if sanitize_degrees(to - from) <= 180.0 {
        1.0
    } else {
        -1.0
    }
}

/// Angular distance between two hues, `0..=180`.
#[must_use]
pub fn difference_degrees(a: f64, b: f64) -> f64 {
    180.0 - ((a - b).abs() - 180.0).abs()
}

/// `matrix * row` for a 3x3 matrix.
#[must_use]
pub fn matrix_multiply(row: [f64; 3], matrix: [[f64; 3]; 3]) -> [f64; 3] {
    [
        row[0] * matrix[0][0] + row[1] * matrix[0][1] + row[2] * matrix[0][2],
        row[0] * matrix[1][0] + row[1] * matrix[1][1] + row[2] * matrix[1][2],
        row[0] * matrix[2][0] + row[1] * matrix[2][1] + row[2] * matrix[2][2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lstar_and_y_round_trip() {
        for lstar in [0.0, 10.0, 49.6, 50.0, 99.0, 100.0] {
            assert!((lstar_from_y(y_from_lstar(lstar)) - lstar).abs() < 1e-9);
        }
        assert_eq!(argb_from_lstar(0.0), 0xFF00_0000);
        assert_eq!(argb_from_lstar(100.0), 0xFFFF_FFFF);
    }

    #[test]
    fn hex_round_trip() {
        assert_eq!(hex_from_argb(0xFF67_50A4), "#6750a4");
        assert_eq!(argb_from_hex("#6750A4"), Some(0xFF67_50A4));
        assert_eq!(argb_from_hex("fff"), Some(0xFFFF_FFFF));
        assert_eq!(argb_from_hex("#12"), None);
    }

    #[test]
    fn js_round_matches_math_round() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(0.49), 0.0);
    }

    #[test]
    fn degrees() {
        assert_eq!(sanitize_degrees(-30.0), 330.0);
        assert_eq!(sanitize_degrees(725.0), 5.0);
        assert_eq!(difference_degrees(350.0, 10.0), 20.0);
        assert_eq!(rotation_direction(350.0, 10.0), 1.0);
        assert_eq!(rotation_direction(10.0, 350.0), -1.0);
    }
}
