// SPDX-License-Identifier: Apache-2.0
//! Minimal, dependency-free 3D linear algebra shared by the CPU and GPU 3D
//! backends.
//!
//! Conventions match three.js (so the browser lane can consume the same
//! [`crate::scene3d::Scene3d`] unchanged): right-handed, +Y up, the camera
//! looks down -Z, matrices are column-major (`m[column][row]`), Euler angles
//! use the `XYZ` order (`R = Rx * Ry * Rz`). Projection matrices map view
//! depth to the WebGPU/wgpu clip range `z ∈ [0, w]`.

/// A 3-component `f32` vector.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
    /// Z component.
    pub z: f32,
}

impl Vec3 {
    /// The zero vector.
    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);
    /// `(1, 1, 1)`.
    pub const ONE: Self = Self::new(1.0, 1.0, 1.0);
    /// `+Y`.
    pub const Y: Self = Self::new(0.0, 1.0, 0.0);

    /// Build a vector.
    #[must_use]
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    /// Build a vector from an array.
    #[must_use]
    pub const fn from_array(v: [f32; 3]) -> Self {
        Self::new(v[0], v[1], v[2])
    }

    /// Return the components as an array.
    #[must_use]
    pub const fn to_array(self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }

    /// Component-wise sum.
    #[must_use]
    pub fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }

    /// Component-wise difference.
    #[must_use]
    pub fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }

    /// Scale by `s`.
    #[must_use]
    pub fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }

    /// Component-wise product.
    #[must_use]
    pub fn mul(self, o: Self) -> Self {
        Self::new(self.x * o.x, self.y * o.y, self.z * o.z)
    }

    /// Dot product.
    #[must_use]
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    /// Cross product.
    #[must_use]
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    /// Euclidean length.
    #[must_use]
    pub fn length(self) -> f32 {
        self.dot(self).sqrt()
    }

    /// Unit-length copy, or `fallback` when the vector is (nearly) zero.
    #[must_use]
    pub fn normalize_or(self, fallback: Self) -> Self {
        let len = self.length();
        if len > 1e-12 && len.is_finite() {
            self.scale(1.0 / len)
        } else {
            fallback
        }
    }

    /// Linear interpolation `self + (o - self) * t`.
    #[must_use]
    pub fn lerp(self, o: Self, t: f32) -> Self {
        self.add(o.sub(self).scale(t))
    }

    /// Whether every component is finite.
    #[must_use]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

/// A column-major 4x4 `f32` matrix (`cols[c][r]`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mat4 {
    /// Columns.
    pub cols: [[f32; 4]; 4],
}

impl Default for Mat4 {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Mat4 {
    /// The identity matrix.
    pub const IDENTITY: Self = Self {
        cols: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
    };

    /// Matrix product `self * o`.
    #[must_use]
    pub fn mul(&self, o: &Self) -> Self {
        let mut out = [[0.0_f32; 4]; 4];
        for (c, col) in out.iter_mut().enumerate() {
            for (r, cell) in col.iter_mut().enumerate() {
                *cell = self.cols[0][r] * o.cols[c][0]
                    + self.cols[1][r] * o.cols[c][1]
                    + self.cols[2][r] * o.cols[c][2]
                    + self.cols[3][r] * o.cols[c][3];
            }
        }
        Self { cols: out }
    }

    /// Transform a point (`w = 1`) and return the homogeneous result.
    #[must_use]
    pub fn transform_point4(&self, p: Vec3) -> [f32; 4] {
        let c = &self.cols;
        [
            c[0][0] * p.x + c[1][0] * p.y + c[2][0] * p.z + c[3][0],
            c[0][1] * p.x + c[1][1] * p.y + c[2][1] * p.z + c[3][1],
            c[0][2] * p.x + c[1][2] * p.y + c[2][2] * p.z + c[3][2],
            c[0][3] * p.x + c[1][3] * p.y + c[2][3] * p.z + c[3][3],
        ]
    }

    /// Transform a point (`w = 1`) by an affine matrix.
    #[must_use]
    pub fn transform_point(&self, p: Vec3) -> Vec3 {
        let [x, y, z, _] = self.transform_point4(p);
        Vec3::new(x, y, z)
    }

    /// Transform a direction (`w = 0`) by the upper 3x3 block.
    #[must_use]
    pub fn transform_vector(&self, v: Vec3) -> Vec3 {
        let c = &self.cols;
        Vec3::new(
            c[0][0] * v.x + c[1][0] * v.y + c[2][0] * v.z,
            c[0][1] * v.x + c[1][1] * v.y + c[2][1] * v.z,
            c[0][2] * v.x + c[1][2] * v.y + c[2][2] * v.z,
        )
    }

    /// Translation matrix.
    #[must_use]
    pub const fn translation(t: Vec3) -> Self {
        let mut m = Self::IDENTITY;
        m.cols[3] = [t.x, t.y, t.z, 1.0];
        m
    }

    /// Non-uniform scale matrix.
    #[must_use]
    pub const fn scaling(s: Vec3) -> Self {
        let mut m = Self::IDENTITY;
        m.cols[0][0] = s.x;
        m.cols[1][1] = s.y;
        m.cols[2][2] = s.z;
        m
    }

    /// Rotation from Euler angles in radians, three.js `XYZ` order.
    #[must_use]
    pub fn rotation_xyz(x: f32, y: f32, z: f32) -> Self {
        let (a, b) = (x.cos(), x.sin());
        let (c, d) = (y.cos(), y.sin());
        let (e, f) = (z.cos(), z.sin());
        let (ae, af, be, bf) = (a * e, a * f, b * e, b * f);
        // Same element layout as three.js `Matrix4.makeRotationFromEuler`
        // (row-major te indices transposed into columns here).
        Self {
            cols: [
                [c * e, af + be * d, bf - ae * d, 0.0],
                [-c * f, ae - bf * d, be + af * d, 0.0],
                [d, -b * c, a * c, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
        }
    }

    /// `T * R * S` from a translation, XYZ Euler rotation in degrees and scale.
    #[must_use]
    pub fn from_trs(translation: Vec3, rotation_deg: Vec3, scale: Vec3) -> Self {
        let r = Self::rotation_xyz(
            rotation_deg.x.to_radians(),
            rotation_deg.y.to_radians(),
            rotation_deg.z.to_radians(),
        );
        Self::translation(translation)
            .mul(&r)
            .mul(&Self::scaling(scale))
    }

    /// Right-handed view matrix looking from `eye` towards `target`.
    #[must_use]
    pub fn look_at(eye: Vec3, target: Vec3, up: Vec3) -> Self {
        let f = target.sub(eye).normalize_or(Vec3::new(0.0, 0.0, -1.0));
        let mut s = f.cross(up);
        if s.length() < 1e-6 {
            // `up` is parallel to the view direction: pick any orthogonal axis.
            s = f.cross(if f.y.abs() < 0.99 {
                Vec3::Y
            } else {
                Vec3::new(1.0, 0.0, 0.0)
            });
        }
        let s = s.normalize_or(Vec3::new(1.0, 0.0, 0.0));
        let u = s.cross(f);
        Self {
            cols: [
                [s.x, u.x, -f.x, 0.0],
                [s.y, u.y, -f.y, 0.0],
                [s.z, u.z, -f.z, 0.0],
                [-s.dot(eye), -u.dot(eye), f.dot(eye), 1.0],
            ],
        }
    }

    /// Right-handed perspective projection to the wgpu depth range `[0, 1]`.
    #[must_use]
    pub fn perspective(fov_y_rad: f32, aspect: f32, near: f32, far: f32) -> Self {
        let f = 1.0 / (fov_y_rad * 0.5).tan();
        let range = far / (near - far);
        Self {
            cols: [
                [f / aspect, 0.0, 0.0, 0.0],
                [0.0, f, 0.0, 0.0],
                [0.0, 0.0, range, -1.0],
                [0.0, 0.0, range * near, 0.0],
            ],
        }
    }

    /// Right-handed orthographic projection to the wgpu depth range `[0, 1]`.
    #[must_use]
    pub fn orthographic(height: f32, aspect: f32, near: f32, far: f32) -> Self {
        let half_h = height * 0.5;
        let half_w = half_h * aspect;
        let range = 1.0 / (near - far);
        Self {
            cols: [
                [1.0 / half_w, 0.0, 0.0, 0.0],
                [0.0, 1.0 / half_h, 0.0, 0.0],
                [0.0, 0.0, range, 0.0],
                [0.0, 0.0, range * near, 1.0],
            ],
        }
    }

    /// Right-handed off-centre orthographic projection of the view-space box
    /// `[left, right] x [bottom, top]`, depth `[near, far]` mapped to `[0, 1]`.
    #[must_use]
    pub fn orthographic_off_center(
        left: f32,
        right: f32,
        bottom: f32,
        top: f32,
        near: f32,
        far: f32,
    ) -> Self {
        let (rl, tb) = (1.0 / (right - left), 1.0 / (top - bottom));
        let range = 1.0 / (near - far);
        Self {
            cols: [
                [2.0 * rl, 0.0, 0.0, 0.0],
                [0.0, 2.0 * tb, 0.0, 0.0],
                [0.0, 0.0, range, 0.0],
                [
                    -(right + left) * rl,
                    -(top + bottom) * tb,
                    range * near,
                    1.0,
                ],
            ],
        }
    }

    /// Inverse-transpose of the upper 3x3 block, **row-major** (`n[row][col]`),
    /// used to transform normals under non-uniform scale. Returns the identity
    /// when the block is singular.
    #[must_use]
    pub fn normal_matrix(&self) -> [[f32; 3]; 3] {
        let m = &self.cols;
        let (a, b, c) = (m[0][0], m[1][0], m[2][0]);
        let (d, e, f) = (m[0][1], m[1][1], m[2][1]);
        let (g, h, i) = (m[0][2], m[1][2], m[2][2]);
        let co00 = e * i - f * h;
        let co01 = -(d * i - f * g);
        let co02 = d * h - e * g;
        let det = a * co00 + b * co01 + c * co02;
        if det.abs() < 1e-20 || !det.is_finite() {
            return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        }
        let inv = 1.0 / det;
        // inverse-transpose = cofactor matrix / det (row-major cofactors).
        let co10 = -(b * i - c * h);
        let co11 = a * i - c * g;
        let co12 = -(a * h - b * g);
        let co20 = b * f - c * e;
        let co21 = -(a * f - c * d);
        let co22 = a * e - b * d;
        [
            [co00 * inv, co01 * inv, co02 * inv],
            [co10 * inv, co11 * inv, co12 * inv],
            [co20 * inv, co21 * inv, co22 * inv],
        ]
    }

    /// Whether every element is finite.
    #[must_use]
    pub fn is_finite(&self) -> bool {
        self.cols.iter().flatten().all(|v| v.is_finite())
    }
}

/// Apply a row-major 3x3 normal matrix (see [`Mat4::normal_matrix`]) to `n`.
#[must_use]
pub fn mul_normal(m: &[[f32; 3]; 3], n: Vec3) -> Vec3 {
    Vec3::new(
        m[0][0] * n.x + m[0][1] * n.y + m[0][2] * n.z,
        m[1][0] * n.x + m[1][1] * n.y + m[1][2] * n.z,
        m[2][0] * n.x + m[2][1] * n.y + m[2][2] * n.z,
    )
}

/// sRGB electro-optical transfer: encoded `[0, 1]` to linear light.
#[must_use]
pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Inverse sRGB transfer: linear light to encoded `[0, 1]`.
#[must_use]
pub fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    #[test]
    fn look_at_maps_target_to_negative_z() {
        let view = Mat4::look_at(Vec3::new(0.0, 0.0, 5.0), Vec3::ZERO, Vec3::Y);
        let p = view.transform_point(Vec3::ZERO);
        assert!(approx(p.x, 0.0) && approx(p.y, 0.0) && approx(p.z, -5.0));
    }

    #[test]
    fn perspective_maps_near_and_far_to_unit_depth_range() {
        let proj = Mat4::perspective(60_f32.to_radians(), 1.0, 0.5, 50.0);
        let near = proj.transform_point4(Vec3::new(0.0, 0.0, -0.5));
        let far = proj.transform_point4(Vec3::new(0.0, 0.0, -50.0));
        assert!(approx(near[2] / near[3], 0.0));
        assert!(approx(far[2] / far[3], 1.0));
    }

    #[test]
    fn orthographic_maps_near_and_far_to_unit_depth_range() {
        let proj = Mat4::orthographic(4.0, 1.0, 0.1, 10.0);
        assert!(approx(
            proj.transform_point4(Vec3::new(0.0, 0.0, -0.1))[2],
            0.0
        ));
        assert!(approx(
            proj.transform_point4(Vec3::new(0.0, 0.0, -10.0))[2],
            1.0
        ));
        assert!(approx(
            proj.transform_point4(Vec3::new(0.0, 2.0, -1.0))[1],
            1.0
        ));
    }

    #[test]
    fn off_center_orthographic_maps_its_box_to_ndc() {
        let proj = Mat4::orthographic_off_center(1.0, 3.0, -2.0, 0.0, 1.0, 5.0);
        let lo = proj.transform_point4(Vec3::new(1.0, -2.0, -1.0));
        let hi = proj.transform_point4(Vec3::new(3.0, 0.0, -5.0));
        assert!(approx(lo[0], -1.0) && approx(lo[1], -1.0) && approx(lo[2], 0.0));
        assert!(approx(hi[0], 1.0) && approx(hi[1], 1.0) && approx(hi[2], 1.0));
    }

    #[test]
    fn rotation_matches_three_xyz_order() {
        // 90° about Y sends +X to -Z.
        let r = Mat4::rotation_xyz(0.0, std::f32::consts::FRAC_PI_2, 0.0);
        let v = r.transform_vector(Vec3::new(1.0, 0.0, 0.0));
        assert!(approx(v.x, 0.0) && approx(v.z, -1.0));
        // 90° about X sends +Y to +Z.
        let r = Mat4::rotation_xyz(std::f32::consts::FRAC_PI_2, 0.0, 0.0);
        let v = r.transform_vector(Vec3::Y);
        assert!(approx(v.y, 0.0) && approx(v.z, 1.0));
    }

    #[test]
    fn normal_matrix_keeps_normals_perpendicular_under_non_uniform_scale() {
        let m = Mat4::from_trs(
            Vec3::ZERO,
            Vec3::new(0.0, 0.0, 30.0),
            Vec3::new(3.0, 1.0, 1.0),
        );
        let tangent = m.transform_vector(Vec3::new(1.0, -1.0, 0.0));
        let normal = mul_normal(&m.normal_matrix(), Vec3::new(1.0, 1.0, 0.0));
        assert!(approx(tangent.dot(normal), 0.0));
    }

    #[test]
    fn srgb_round_trips() {
        for i in 0..=255 {
            let c = i as f32 / 255.0;
            assert!(approx(linear_to_srgb(srgb_to_linear(c)), c));
        }
    }
}
