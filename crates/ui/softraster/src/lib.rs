// SPDX-License-Identifier: Apache-2.0
//! Deterministic CPU triangle rasterizer: the GPU-less fallback of the Aphrody 3D stack.
//!
//! Extracted from `nie-render3d` (the `nie` engine's reference renderer) so that headless
//! hosts, CI runners and WebAssembly builds share one z-buffered rasterizer. It has no
//! dependencies and uses scalar `f32` math only (no SIMD, no FMA), so the same input produces
//! the same bytes on every target: `nie` golden images depend on that.
//!
//! The crate works in screen space. Callers project their vertices (any camera model) into
//! [`ScreenVertex`] values `(x_px, y_px, depth)` with `depth > 0` in front of the camera, then
//! call [`fill_triangle`] per triangle over an RGBA8 colour buffer and an `f32` depth buffer.

#![forbid(unsafe_code)]
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]

/// A 3D vector as plain `[x, y, z]`.
pub type V3 = [f32; 3];

/// A projected vertex: pixel `x`, pixel `y` (downwards) and view depth (`> 0`).
pub type ScreenVertex = (f32, f32, f32);

/// Component-wise `a - b`.
#[must_use]
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// Cross product `a x b`.
#[must_use]
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// Dot product.
#[must_use]
pub fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Normalised `a`, or `+Z` for a (near) zero vector.
#[must_use]
pub fn normv(a: V3) -> V3 {
    let l = dot(a, a).sqrt();
    if l > 1e-9 { [a[0] / l, a[1] / l, a[2] / l] } else { [0.0, 0.0, 1.0] }
}

/// Borrowed RGBA8 texture, row-major, `width * height * 4` bytes.
#[derive(Debug, Clone, Copy)]
pub struct TextureView<'a> {
    /// Width in texels.
    pub width: u32,
    /// Height in texels.
    pub height: u32,
    /// Texel bytes.
    pub rgba: &'a [u8],
}

impl TextureView<'_> {
    /// True when `rgba` holds exactly `width * height` texels and neither side is zero.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.width > 0
            && self.height > 0
            && (self.width as usize)
                .checked_mul(self.height as usize)
                .and_then(|n| n.checked_mul(4))
                == Some(self.rgba.len())
    }
}

/// Nearest-texel sample at UV in `[0, 1]` (clamp-to-edge). Returns transparent black for an
/// invalid texture instead of panicking.
#[must_use]
pub fn sample_nearest(t: &TextureView<'_>, u: f32, v: f32) -> [u8; 4] {
    if !t.is_valid() {
        return [0; 4];
    }
    let uu = u.clamp(0.0, 1.0);
    let vv = v.clamp(0.0, 1.0);
    // texel = floor(uv * dim), capped at dim - 1 (uv == 1 lands on the last texel).
    let x = ((uu * t.width as f32) as u32).min(t.width.saturating_sub(1));
    let y = ((vv * t.height as f32) as u32).min(t.height.saturating_sub(1));
    let idx = ((y * t.width + x) * 4) as usize;
    [t.rgba[idx], t.rgba[idx + 1], t.rgba[idx + 2], t.rgba[idx + 3]]
}

/// Texels whose alpha is below this value are discarded (alpha-card cutout).
pub const ALPHA_CUTOUT: u8 = 8;

/// Fill one screen-space triangle with barycentric coverage and a depth test.
///
/// * `px` is RGBA8 `w * h * 4`, `zbuf` is `w * h` depths (initialise to `f32::INFINITY`);
///   calls with mismatched buffer sizes draw nothing.
/// * With `tex`, UVs are interpolated perspective-correctly (weighted by `1 / depth`), sampled
///   nearest and multiplied by `shade`; texels below [`ALPHA_CUTOUT`] are skipped.
/// * Without `tex`, the triangle is filled with `base_rgb * shade`.
///
/// Pixel centres are at `+0.5`; a pixel is covered when all barycentric weights are `>= 0`, so
/// both windings are drawn (cull before calling if needed).
#[allow(clippy::too_many_arguments)]
pub fn fill_triangle(
    px: &mut [u8],
    zbuf: &mut [f32],
    w: u32,
    h: u32,
    a: ScreenVertex,
    b: ScreenVertex,
    c: ScreenVertex,
    uv: [[f32; 2]; 3],
    tex: Option<&TextureView<'_>>,
    shade: f32,
    base_rgb: [f32; 3],
) {
    let pixels = (w as usize).checked_mul(h as usize);
    if w == 0 || h == 0 || pixels != Some(zbuf.len()) || pixels.map(|n| n * 4) != Some(px.len()) {
        return;
    }
    let minx = a.0.min(b.0).min(c.0).floor().max(0.0) as i32;
    let maxx = a.0.max(b.0).max(c.0).ceil().min(w as f32 - 1.0) as i32;
    let miny = a.1.min(b.1).min(c.1).floor().max(0.0) as i32;
    let maxy = a.1.max(b.1).max(c.1).ceil().min(h as f32 - 1.0) as i32;
    let area = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    if area.abs() < 1e-6 {
        return;
    }
    let inv_area = 1.0 / area;
    let flat = [base_rgb[0] * shade, base_rgb[1] * shade, base_rgb[2] * shade];
    for y in miny..=maxy {
        for x in minx..=maxx {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let w0 = ((b.0 - fx) * (c.1 - fy) - (b.1 - fy) * (c.0 - fx)) * inv_area;
            let w1 = ((c.0 - fx) * (a.1 - fy) - (c.1 - fy) * (a.0 - fx)) * inv_area;
            let w2 = 1.0 - w0 - w1;
            if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                continue;
            }
            let depth = 1.0 / (w0 / a.2 + w1 / b.2 + w2 / c.2);
            let zi = (y as u32 * w + x as u32) as usize;
            if depth >= zbuf[zi] {
                continue;
            }
            let col = if let Some(t) = tex {
                let invz = w0 / a.2 + w1 / b.2 + w2 / c.2;
                let u = (w0 * uv[0][0] / a.2 + w1 * uv[1][0] / b.2 + w2 * uv[2][0] / c.2) / invz;
                let v = (w0 * uv[0][1] / a.2 + w1 * uv[1][1] / b.2 + w2 * uv[2][1] / c.2) / invz;
                let s = sample_nearest(t, u, v);
                if s[3] < ALPHA_CUTOUT {
                    continue;
                }
                [
                    (f32::from(s[0]) * shade) as u8,
                    (f32::from(s[1]) * shade) as u8,
                    (f32::from(s[2]) * shade) as u8,
                    255,
                ]
            } else {
                [flat[0] as u8, flat[1] as u8, flat[2] as u8, 255]
            };
            zbuf[zi] = depth;
            let i = zi * 4;
            px[i..i + 4].copy_from_slice(&col);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buffers(w: u32, h: u32) -> (Vec<u8>, Vec<f32>) {
        (vec![0; (w * h * 4) as usize], vec![f32::INFINITY; (w * h) as usize])
    }

    #[test]
    fn vector_helpers() {
        assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
        assert_eq!(dot([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]), 32.0);
        assert_eq!(sub([3.0, 2.0, 1.0], [1.0, 1.0, 1.0]), [2.0, 1.0, 0.0]);
        assert_eq!(normv([0.0, 0.0, 0.0]), [0.0, 0.0, 1.0]);
        assert_eq!(normv([0.0, 3.0, 0.0]), [0.0, 1.0, 0.0]);
    }

    #[test]
    fn flat_fill_covers_triangle_interior() {
        let (w, h) = (16, 16);
        let (mut px, mut z) = buffers(w, h);
        fill_triangle(
            &mut px,
            &mut z,
            w,
            h,
            (0.0, 0.0, 1.0),
            (16.0, 0.0, 1.0),
            (0.0, 16.0, 1.0),
            [[0.0; 2]; 3],
            None,
            0.5,
            [200.0, 100.0, 50.0],
        );
        assert_eq!(&px[0..4], &[100, 50, 25, 255]);
        let far = ((15 * w + 15) * 4) as usize;
        assert_eq!(&px[far..far + 4], &[0, 0, 0, 0], "outside the hypotenuse");
    }

    #[test]
    fn depth_test_keeps_nearest() {
        let (w, h) = (8, 8);
        let (mut px, mut z) = buffers(w, h);
        let tri = |px: &mut [u8], z: &mut [f32], d: f32, rgb: f32| {
            fill_triangle(
                px,
                z,
                w,
                h,
                (0.0, 0.0, d),
                (8.0, 0.0, d),
                (0.0, 8.0, d),
                [[0.0; 2]; 3],
                None,
                1.0,
                [rgb; 3],
            );
        };
        tri(&mut px, &mut z, 1.0, 10.0);
        tri(&mut px, &mut z, 2.0, 200.0);
        assert_eq!(px[0], 10, "farther triangle rejected");
        tri(&mut px, &mut z, 0.5, 90.0);
        assert_eq!(px[0], 90, "nearer triangle wins");
    }

    #[test]
    fn texture_sampling_and_cutout() {
        let rgba = [255, 0, 0, 255, 0, 0, 255, 0];
        let t = TextureView { width: 2, height: 1, rgba: &rgba };
        assert_eq!(sample_nearest(&t, 0.0, 0.0), [255, 0, 0, 255]);
        assert_eq!(sample_nearest(&t, 1.0, 1.0), [0, 0, 255, 0]);
        let (w, h) = (8, 8);
        let (mut px, mut z) = buffers(w, h);
        // Left half samples the opaque red texel, right half the transparent one.
        let uv = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
        fill_triangle(
            &mut px,
            &mut z,
            w,
            h,
            (0.0, 0.0, 1.0),
            (8.0, 0.0, 1.0),
            (0.0, 8.0, 1.0),
            uv,
            Some(&t),
            1.0,
            [0.0; 3],
        );
        assert_eq!(&px[0..4], &[255, 0, 0, 255]);
        let right = ((7 * 4) + 3) as usize;
        assert_eq!(px[right], 0, "cutout texel leaves the pixel untouched");
    }

    #[test]
    fn invalid_inputs_draw_nothing() {
        let bad = TextureView { width: 4, height: 4, rgba: &[0; 3] };
        assert_eq!(sample_nearest(&bad, 0.5, 0.5), [0; 4]);
        let mut px = vec![0u8; 16];
        let mut z = vec![f32::INFINITY; 3]; // wrong size for 2x2
        fill_triangle(
            &mut px,
            &mut z,
            2,
            2,
            (0.0, 0.0, 1.0),
            (2.0, 0.0, 1.0),
            (0.0, 2.0, 1.0),
            [[0.0; 2]; 3],
            None,
            1.0,
            [255.0; 3],
        );
        assert!(px.iter().all(|&b| b == 0));
    }
}
