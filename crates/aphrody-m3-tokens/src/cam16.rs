// SPDX-License-Identifier: Apache-2.0
//! CAM16 colour appearance model and its viewing conditions.
//!
//! Exact port of `hct/cam16.ts` and `hct/viewing_conditions.ts` from
//! [material-color-utilities] (Apache-2.0). HCT takes hue and chroma from CAM16 and tone from
//! L*; [`crate::hct`] builds on this module.
//!
//! [material-color-utilities]: https://github.com/material-foundation/material-color-utilities

use std::{f64::consts::PI, sync::LazyLock};

use crate::color_math::{argb_from_xyz, lerp, linearized, sanitize_degrees, signum, y_from_lstar};

/// The environment a colour is viewed in; M3 uses [`ViewingConditions::standard`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewingConditions {
    /// Background luminance over white luminance.
    pub n: f64,
    /// Achromatic response of white.
    pub aw: f64,
    /// Brightness induction factor.
    pub nbb: f64,
    /// Chromatic induction factor.
    pub ncb: f64,
    /// Surround exponential nonlinearity.
    pub c: f64,
    /// Chromatic induction.
    pub nc: f64,
    /// Per-channel discounting of the illuminant.
    pub rgb_d: [f64; 3],
    /// Luminance-level adaptation factor.
    pub fl: f64,
    /// `fl^0.25`.
    pub fl_root: f64,
    /// Base exponential nonlinearity.
    pub z: f64,
}

static STANDARD: LazyLock<ViewingConditions> = LazyLock::new(|| {
    ViewingConditions::make(
        crate::color_math::WHITE_POINT_D65,
        200.0 / PI * y_from_lstar(50.0) / 100.0,
        50.0,
        2.0,
        false,
    )
});

impl ViewingConditions {
    /// The reference default: D65 white, 50 L* background, average surround.
    #[must_use]
    pub fn standard() -> &'static Self {
        &STANDARD
    }

    /// Viewing conditions from their physical parameters.
    #[must_use]
    pub fn make(
        white_point: [f64; 3],
        adapting_luminance: f64,
        background_lstar: f64,
        surround: f64,
        discounting_illuminant: bool,
    ) -> Self {
        let xyz = white_point;
        let r_w = xyz[0] * 0.401288 + xyz[1] * 0.650173 + xyz[2] * -0.051461;
        let g_w = xyz[0] * -0.250268 + xyz[1] * 1.204414 + xyz[2] * 0.045854;
        let b_w = xyz[0] * -0.002079 + xyz[1] * 0.048952 + xyz[2] * 0.953127;
        let f = 0.8 + surround / 10.0;
        let c = if f >= 0.9 {
            lerp(0.59, 0.69, (f - 0.9) * 10.0)
        } else {
            lerp(0.525, 0.59, (f - 0.8) * 10.0)
        };
        let d = if discounting_illuminant {
            1.0
        } else {
            f * (1.0 - (1.0 / 3.6) * ((-adapting_luminance - 42.0) / 92.0).exp())
        };
        let d = d.clamp(0.0, 1.0);
        let nc = f;
        let rgb_d = [
            d * (100.0 / r_w) + 1.0 - d,
            d * (100.0 / g_w) + 1.0 - d,
            d * (100.0 / b_w) + 1.0 - d,
        ];
        let k = 1.0 / (5.0 * adapting_luminance + 1.0);
        let k4 = k * k * k * k;
        let k4f = 1.0 - k4;
        let fl = k4 * adapting_luminance + 0.1 * k4f * k4f * (5.0 * adapting_luminance).cbrt();
        let n = y_from_lstar(background_lstar) / white_point[1];
        let z = 1.48 + n.sqrt();
        let nbb = 0.725 / n.powf(0.2);
        let ncb = nbb;
        let factors = [
            (fl * rgb_d[0] * r_w / 100.0).powf(0.42),
            (fl * rgb_d[1] * g_w / 100.0).powf(0.42),
            (fl * rgb_d[2] * b_w / 100.0).powf(0.42),
        ];
        let rgb_a = factors.map(|f| 400.0 * f / (f + 27.13));
        let aw = (2.0 * rgb_a[0] + rgb_a[1] + 0.05 * rgb_a[2]) * nbb;
        Self {
            n,
            aw,
            nbb,
            ncb,
            c,
            nc,
            rgb_d,
            fl,
            fl_root: fl.powf(0.25),
            z,
        }
    }
}

/// A colour in the CAM16 model, with its CAM16-UCS coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cam16 {
    /// Hue angle in degrees, `0..360`.
    pub hue: f64,
    /// Chroma.
    pub chroma: f64,
    /// Lightness.
    pub j: f64,
    /// Brightness.
    pub q: f64,
    /// Colourfulness.
    pub m: f64,
    /// Saturation.
    pub s: f64,
    /// CAM16-UCS J*.
    pub jstar: f64,
    /// CAM16-UCS a*.
    pub astar: f64,
    /// CAM16-UCS b*.
    pub bstar: f64,
}

impl Cam16 {
    /// CAM16 of an ARGB colour in the standard viewing conditions.
    #[must_use]
    pub fn from_argb(argb: u32) -> Self {
        Self::from_argb_in(argb, ViewingConditions::standard())
    }

    /// CAM16 of an ARGB colour in `vc`.
    #[must_use]
    pub fn from_argb_in(argb: u32, vc: &ViewingConditions) -> Self {
        let red_l = linearized(crate::color_math::red(argb));
        let green_l = linearized(crate::color_math::green(argb));
        let blue_l = linearized(crate::color_math::blue(argb));
        let x = 0.41233895 * red_l + 0.35762064 * green_l + 0.18051042 * blue_l;
        let y = 0.2126 * red_l + 0.7152 * green_l + 0.0722 * blue_l;
        let z = 0.01932141 * red_l + 0.11916382 * green_l + 0.95034478 * blue_l;
        Self::from_xyz_in(x, y, z, vc, true)
    }

    /// CAM16 of an XYZ colour in `vc`. `sanitize` selects the hue normalisation of
    /// `fromIntInViewingConditions` (true) or `fromXyzInViewingConditions` (false).
    fn from_xyz_in(x: f64, y: f64, z: f64, vc: &ViewingConditions, sanitize: bool) -> Self {
        let r_c = 0.401288 * x + 0.650173 * y - 0.051461 * z;
        let g_c = -0.250268 * x + 1.204414 * y + 0.045854 * z;
        let b_c = -0.002079 * x + 0.048952 * y + 0.953127 * z;
        let r_d = vc.rgb_d[0] * r_c;
        let g_d = vc.rgb_d[1] * g_c;
        let b_d = vc.rgb_d[2] * b_c;
        let r_af = (vc.fl * r_d.abs() / 100.0).powf(0.42);
        let g_af = (vc.fl * g_d.abs() / 100.0).powf(0.42);
        let b_af = (vc.fl * b_d.abs() / 100.0).powf(0.42);
        let r_a = signum(r_d) * 400.0 * r_af / (r_af + 27.13);
        let g_a = signum(g_d) * 400.0 * g_af / (g_af + 27.13);
        let b_a = signum(b_d) * 400.0 * b_af / (b_af + 27.13);
        let a = (11.0 * r_a + -12.0 * g_a + b_a) / 11.0;
        let b = (r_a + g_a - 2.0 * b_a) / 9.0;
        let u = (20.0 * r_a + 20.0 * g_a + 21.0 * b_a) / 20.0;
        let p2 = (40.0 * r_a + 20.0 * g_a + b_a) / 20.0;
        let atan_degrees = b.atan2(a) * 180.0 / PI;
        let hue = if sanitize {
            sanitize_degrees(atan_degrees)
        } else if atan_degrees < 0.0 {
            atan_degrees + 360.0
        } else if atan_degrees >= 360.0 {
            atan_degrees - 360.0
        } else {
            atan_degrees
        };
        let hue_radians = hue * PI / 180.0;
        let ac = p2 * vc.nbb;
        let j = 100.0 * (ac / vc.aw).powf(vc.c * vc.z);
        let q = (4.0 / vc.c) * (j / 100.0).sqrt() * (vc.aw + 4.0) * vc.fl_root;
        let hue_prime = if hue < 20.14 { hue + 360.0 } else { hue };
        let e_hue = 0.25 * ((hue_prime * PI / 180.0 + 2.0).cos() + 3.8);
        let p1 = 50000.0 / 13.0 * e_hue * vc.nc * vc.ncb;
        let t = p1 * (a * a + b * b).sqrt() / (u + 0.305);
        let alpha = t.powf(0.9) * (1.64 - 0.29_f64.powf(vc.n)).powf(0.73);
        let chroma = alpha * (j / 100.0).sqrt();
        let m = chroma * vc.fl_root;
        let s = 50.0 * (alpha * vc.c / (vc.aw + 4.0)).sqrt();
        let jstar = (1.0 + 100.0 * 0.007) * j / (1.0 + 0.007 * j);
        let mstar = if sanitize {
            (1.0 / 0.0228) * (1.0 + 0.0228 * m).ln()
        } else {
            (1.0 + 0.0228 * m).ln() / 0.0228
        };
        Self {
            hue,
            chroma,
            j,
            q,
            m,
            s,
            jstar,
            astar: mstar * hue_radians.cos(),
            bstar: mstar * hue_radians.sin(),
        }
    }

    /// CAM16 from lightness, chroma and hue in the standard viewing conditions.
    #[must_use]
    pub fn from_jch(j: f64, c: f64, h: f64) -> Self {
        Self::from_jch_in(j, c, h, ViewingConditions::standard())
    }

    /// CAM16 from lightness, chroma and hue in `vc`.
    #[must_use]
    pub fn from_jch_in(j: f64, c: f64, h: f64, vc: &ViewingConditions) -> Self {
        let q = (4.0 / vc.c) * (j / 100.0).sqrt() * (vc.aw + 4.0) * vc.fl_root;
        let m = c * vc.fl_root;
        let alpha = c / (j / 100.0).sqrt();
        let s = 50.0 * (alpha * vc.c / (vc.aw + 4.0)).sqrt();
        let hue_radians = h * PI / 180.0;
        let jstar = (1.0 + 100.0 * 0.007) * j / (1.0 + 0.007 * j);
        let mstar = (1.0 / 0.0228) * (1.0 + 0.0228 * m).ln();
        Self {
            hue: h,
            chroma: c,
            j,
            q,
            m,
            s,
            jstar,
            astar: mstar * hue_radians.cos(),
            bstar: mstar * hue_radians.sin(),
        }
    }

    /// CAM16 from CAM16-UCS coordinates in the standard viewing conditions.
    #[must_use]
    pub fn from_ucs(jstar: f64, astar: f64, bstar: f64) -> Self {
        let m = (astar * astar + bstar * bstar).sqrt();
        let colourfulness = ((m * 0.0228).exp() - 1.0) / 0.0228;
        let vc = ViewingConditions::standard();
        let c = colourfulness / vc.fl_root;
        let mut h = bstar.atan2(astar) * (180.0 / PI);
        if h < 0.0 {
            h += 360.0;
        }
        let j = jstar / (1.0 - (jstar - 100.0) * 0.007);
        Self::from_jch_in(j, c, h, vc)
    }

    /// Perceptual distance in CAM16-UCS.
    #[must_use]
    pub fn distance(&self, other: &Self) -> f64 {
        let d_j = self.jstar - other.jstar;
        let d_a = self.astar - other.astar;
        let d_b = self.bstar - other.bstar;
        1.41 * (d_j * d_j + d_a * d_a + d_b * d_b).sqrt().powf(0.63)
    }

    /// ARGB of this colour viewed in the standard viewing conditions.
    #[must_use]
    pub fn to_argb(&self) -> u32 {
        let [x, y, z] = self.xyz_in(ViewingConditions::standard());
        argb_from_xyz(x, y, z)
    }

    /// XYZ of this colour seen in `vc`.
    #[must_use]
    pub fn xyz_in(&self, vc: &ViewingConditions) -> [f64; 3] {
        let alpha = if self.chroma == 0.0 || self.j == 0.0 {
            0.0
        } else {
            self.chroma / (self.j / 100.0).sqrt()
        };
        let t = (alpha / (1.64 - 0.29_f64.powf(vc.n)).powf(0.73)).powf(1.0 / 0.9);
        let h_rad = self.hue * PI / 180.0;
        let e_hue = 0.25 * ((h_rad + 2.0).cos() + 3.8);
        let ac = vc.aw * (self.j / 100.0).powf(1.0 / vc.c / vc.z);
        let p1 = e_hue * (50000.0 / 13.0) * vc.nc * vc.ncb;
        let p2 = ac / vc.nbb;
        let h_sin = h_rad.sin();
        let h_cos = h_rad.cos();
        let gamma = 23.0 * (p2 + 0.305) * t / (23.0 * p1 + 11.0 * t * h_cos + 108.0 * t * h_sin);
        let a = gamma * h_cos;
        let b = gamma * h_sin;
        let r_a = (460.0 * p2 + 451.0 * a + 288.0 * b) / 1403.0;
        let g_a = (460.0 * p2 - 891.0 * a - 261.0 * b) / 1403.0;
        let b_a = (460.0 * p2 - 220.0 * a - 6300.0 * b) / 1403.0;
        let unadapt = |adapted: f64| {
            let base = (27.13 * adapted.abs() / (400.0 - adapted.abs())).max(0.0);
            signum(adapted) * (100.0 / vc.fl) * base.powf(1.0 / 0.42)
        };
        let r_f = unadapt(r_a) / vc.rgb_d[0];
        let g_f = unadapt(g_a) / vc.rgb_d[1];
        let b_f = unadapt(b_a) / vc.rgb_d[2];
        [
            1.86206786 * r_f - 1.01125463 * g_f + 0.14918677 * b_f,
            0.38752654 * r_f + 0.62144744 * g_f - 0.00897398 * b_f,
            -0.01584150 * r_f - 0.03412294 * g_f + 1.04996444 * b_f,
        ]
    }

    /// CAM16 of an XYZ colour viewed in `vc` (`fromXyzInViewingConditions`).
    #[must_use]
    pub fn from_xyz_in_viewing_conditions(x: f64, y: f64, z: f64, vc: &ViewingConditions) -> Self {
        Self::from_xyz_in(x, y, z, vc, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_cam16() {
        for argb in [
            0xFF67_50A4,
            0xFF00_0000,
            0xFFFF_FFFF,
            0xFF1A_73E8,
            0xFFFF_0000,
        ] {
            assert_eq!(Cam16::from_argb(argb).to_argb(), argb);
        }
    }
}
