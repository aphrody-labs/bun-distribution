// SPDX-License-Identifier: Apache-2.0
//! Procedural geometry tessellation and the shared mesh cache.
//!
//! Every [`Geometry`] is tessellated once into an indexed triangle list with
//! smooth per-vertex normals ([`MeshData`]). Vertex layouts and winding
//! follow the matching three.js geometries (`BoxGeometry`, `SphereGeometry`,
//! `PlaneGeometry`, `CylinderGeometry`, `TorusGeometry`, `RoundedBoxGeometry`)
//! so the browser lane renders the same shapes from the same scene JSON.
//! Front faces are counter-clockwise.
//!
//! [`MeshCache`] deduplicates tessellation across nodes and, for the
//! persistent GPU renderer, across frames: identical geometry descriptions
//! share one `Arc<MeshData>` and one GPU vertex/index buffer pair.

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use crate::math3d::Vec3;

/// Upper bound for any segment count, keeping hostile scenes bounded.
pub const MAX_SEGMENTS: u32 = 512;
/// Upper bound for the vertex count of a single custom mesh.
pub const MAX_CUSTOM_VERTICES: usize = 4 * 1024 * 1024;

/// A procedural or explicit triangle geometry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum Geometry {
    /// Axis-aligned box centred on the origin.
    Box {
        /// Full extents along X, Y, Z.
        #[serde(default = "unit3")]
        size: [f32; 3],
    },
    /// Box with rounded edges and corners (M3 shape tokens map to `radius`).
    RoundedBox {
        /// Full extents along X, Y, Z.
        #[serde(default = "unit3")]
        size: [f32; 3],
        /// Edge radius, clamped to half the smallest extent.
        #[serde(default = "default_round_radius")]
        radius: f32,
        /// Arc subdivisions per rounded edge.
        #[serde(default = "default_round_segments")]
        segments: u32,
    },
    /// UV sphere centred on the origin.
    Sphere {
        /// Radius.
        #[serde(default = "half")]
        radius: f32,
        /// Longitudinal segments.
        #[serde(default = "default_width_segments")]
        width_segments: u32,
        /// Latitudinal segments.
        #[serde(default = "default_height_segments")]
        height_segments: u32,
    },
    /// Rectangle in the XY plane facing +Z.
    Plane {
        /// Width and height.
        #[serde(default = "unit2")]
        size: [f32; 2],
    },
    /// Cylinder or cone along the Y axis.
    Cylinder {
        /// Top radius (`0` makes a cone).
        #[serde(default = "half")]
        radius_top: f32,
        /// Bottom radius.
        #[serde(default = "half")]
        radius_bottom: f32,
        /// Height along Y.
        #[serde(default = "one")]
        height: f32,
        /// Segments around the axis.
        #[serde(default = "default_width_segments")]
        radial_segments: u32,
        /// Omit the end caps.
        #[serde(default)]
        open_ended: bool,
    },
    /// Torus in the XY plane around the Z axis.
    Torus {
        /// Distance from the centre to the tube centre.
        #[serde(default = "half")]
        radius: f32,
        /// Tube radius.
        #[serde(default = "default_tube")]
        tube: f32,
        /// Segments around the tube.
        #[serde(default = "default_torus_radial")]
        radial_segments: u32,
        /// Segments around the ring.
        #[serde(default = "default_width_segments")]
        tubular_segments: u32,
    },
    /// An explicit indexed triangle mesh.
    Mesh {
        /// Vertex positions.
        positions: Vec<[f32; 3]>,
        /// Optional per-vertex normals; computed (area-weighted smooth) when
        /// absent.
        #[serde(default)]
        normals: Option<Vec<[f32; 3]>>,
        /// Triangle list indices, three per triangle, counter-clockwise.
        indices: Vec<u32>,
    },
}

const fn unit3() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}
const fn unit2() -> [f32; 2] {
    [1.0, 1.0]
}
const fn half() -> f32 {
    0.5
}
const fn one() -> f32 {
    1.0
}
const fn default_round_radius() -> f32 {
    0.1
}
const fn default_round_segments() -> u32 {
    4
}
const fn default_width_segments() -> u32 {
    32
}
const fn default_height_segments() -> u32 {
    16
}
const fn default_tube() -> f32 {
    0.2
}
const fn default_torus_radial() -> u32 {
    16
}

/// Why a geometry could not be tessellated.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MeshError {
    /// A dimension or radius is negative, NaN or infinite.
    InvalidDimension(&'static str),
    /// A custom mesh is malformed (index out of range, bad counts, ...).
    InvalidMesh(String),
}

impl std::fmt::Display for MeshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDimension(what) => write!(f, "invalid geometry dimension: {what}"),
            Self::InvalidMesh(why) => write!(f, "invalid mesh: {why}"),
        }
    }
}

impl std::error::Error for MeshError {}

/// An indexed triangle mesh with smooth normals and a bounding sphere.
#[derive(Clone, Debug, PartialEq)]
pub struct MeshData {
    /// Vertex positions.
    pub positions: Vec<[f32; 3]>,
    /// Unit vertex normals, one per position.
    pub normals: Vec<[f32; 3]>,
    /// Triangle list indices.
    pub indices: Vec<u32>,
    /// Local-space bounding sphere centre.
    pub bounds_center: [f32; 3],
    /// Local-space bounding sphere radius.
    pub bounds_radius: f32,
}

impl MeshData {
    /// Number of triangles.
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    fn finish(positions: Vec<[f32; 3]>, normals: Vec<[f32; 3]>, indices: Vec<u32>) -> Self {
        let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
        for p in &positions {
            for axis in 0..3 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis]);
            }
        }
        let center = if positions.is_empty() {
            [0.0; 3]
        } else {
            [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5]
        };
        let c = Vec3::from_array(center);
        let radius =
            positions.iter().map(|p| Vec3::from_array(*p).sub(c).length()).fold(0.0_f32, f32::max);
        Self { positions, normals, indices, bounds_center: center, bounds_radius: radius }
    }
}

fn check_len(value: f32, what: &'static str) -> Result<f32, MeshError> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(MeshError::InvalidDimension(what))
    }
}

fn clamp_segments(value: u32, min: u32) -> u32 {
    value.clamp(min, MAX_SEGMENTS)
}

impl Geometry {
    /// A stable 64-bit key identifying this geometry description, used to
    /// share tessellation and GPU buffers.
    #[must_use]
    pub fn cache_key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        let floats = |h: &mut std::collections::hash_map::DefaultHasher, values: &[f32]| {
            for v in values {
                v.to_bits().hash(h);
            }
        };
        match self {
            Self::Box { size } => {
                0_u8.hash(&mut h);
                floats(&mut h, size);
            },
            Self::RoundedBox { size, radius, segments } => {
                1_u8.hash(&mut h);
                floats(&mut h, size);
                floats(&mut h, &[*radius]);
                segments.hash(&mut h);
            },
            Self::Sphere { radius, width_segments, height_segments } => {
                2_u8.hash(&mut h);
                floats(&mut h, &[*radius]);
                (width_segments, height_segments).hash(&mut h);
            },
            Self::Plane { size } => {
                3_u8.hash(&mut h);
                floats(&mut h, size);
            },
            Self::Cylinder { radius_top, radius_bottom, height, radial_segments, open_ended } => {
                4_u8.hash(&mut h);
                floats(&mut h, &[*radius_top, *radius_bottom, *height]);
                (radial_segments, open_ended).hash(&mut h);
            },
            Self::Torus { radius, tube, radial_segments, tubular_segments } => {
                5_u8.hash(&mut h);
                floats(&mut h, &[*radius, *tube]);
                (radial_segments, tubular_segments).hash(&mut h);
            },
            Self::Mesh { positions, normals, indices } => {
                6_u8.hash(&mut h);
                positions.len().hash(&mut h);
                for p in positions {
                    floats(&mut h, p);
                }
                normals.is_some().hash(&mut h);
                for n in normals.iter().flatten() {
                    floats(&mut h, n);
                }
                indices.hash(&mut h);
            },
        }
        h.finish()
    }

    /// Tessellate into an indexed triangle mesh.
    ///
    /// # Errors
    /// Returns [`MeshError`] for non-finite or negative dimensions and for
    /// malformed custom meshes. Segment counts are clamped to
    /// `[min, MAX_SEGMENTS]` rather than rejected.
    pub fn tessellate(&self) -> Result<MeshData, MeshError> {
        match self {
            Self::Box { size } => {
                let s = [
                    check_len(size[0], "box.size")?,
                    check_len(size[1], "box.size")?,
                    check_len(size[2], "box.size")?,
                ];
                Ok(box_mesh(s))
            },
            Self::RoundedBox { size, radius, segments } => {
                let s = [
                    check_len(size[0], "rounded_box.size")?,
                    check_len(size[1], "rounded_box.size")?,
                    check_len(size[2], "rounded_box.size")?,
                ];
                let r = check_len(*radius, "rounded_box.radius")?;
                Ok(rounded_box_mesh(s, r, clamp_segments(*segments, 1).min(64)))
            },
            Self::Sphere { radius, width_segments, height_segments } => Ok(sphere_mesh(
                check_len(*radius, "sphere.radius")?,
                clamp_segments(*width_segments, 3),
                clamp_segments(*height_segments, 2),
            )),
            Self::Plane { size } => {
                Ok(plane_mesh(check_len(size[0], "plane.size")?, check_len(size[1], "plane.size")?))
            },
            Self::Cylinder { radius_top, radius_bottom, height, radial_segments, open_ended } => {
                Ok(cylinder_mesh(
                    check_len(*radius_top, "cylinder.radius_top")?,
                    check_len(*radius_bottom, "cylinder.radius_bottom")?,
                    check_len(*height, "cylinder.height")?,
                    clamp_segments(*radial_segments, 3),
                    *open_ended,
                ))
            },
            Self::Torus { radius, tube, radial_segments, tubular_segments } => Ok(torus_mesh(
                check_len(*radius, "torus.radius")?,
                check_len(*tube, "torus.tube")?,
                clamp_segments(*radial_segments, 2),
                clamp_segments(*tubular_segments, 3),
            )),
            Self::Mesh { positions, normals, indices } => {
                custom_mesh(positions, normals.as_deref(), indices)
            },
        }
    }
}

fn box_mesh(size: [f32; 3]) -> MeshData {
    let h = Vec3::new(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5);
    // (normal, u) per face; v = n x u keeps triangles counter-clockwise.
    let faces = [
        (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 0.0, -1.0)),
        (Vec3::new(-1.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 1.0)),
        (Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, -1.0, 0.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, 0.0, 1.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, 0.0, -1.0), Vec3::new(-1.0, 0.0, 0.0)),
    ];
    let mut positions = Vec::with_capacity(24);
    let mut normals = Vec::with_capacity(24);
    let mut indices = Vec::with_capacity(36);
    for (n, u) in faces {
        let v = n.cross(u);
        let base = positions.len() as u32;
        for (su, sv) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let p = n.add(u.scale(su)).add(v.scale(sv)).mul(h);
            positions.push(p.to_array());
            normals.push(n.to_array());
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    MeshData::finish(positions, normals, indices)
}

fn rounded_box_mesh(size: [f32; 3], radius: f32, segments: u32) -> MeshData {
    let h = Vec3::new(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5);
    let r = radius.min(h.x).min(h.y).min(h.z);
    let inner = Vec3::new(h.x - r, h.y - r, h.z - r);
    // Tangent coordinates: a tan-spaced ramp over each rounded edge (uniform
    // arc angles up to the 45° seam shared with the neighbouring face), with
    // a single flat span in between.
    let coords = |inner: f32| -> Vec<f32> {
        let mut out = Vec::with_capacity(2 * segments as usize + 2);
        for i in (0..=segments).rev() {
            let phi = std::f32::consts::FRAC_PI_4 * i as f32 / segments as f32;
            out.push(-inner - r * phi.tan());
        }
        for i in 0..=segments {
            let phi = std::f32::consts::FRAC_PI_4 * i as f32 / segments as f32;
            out.push(inner + r * phi.tan());
        }
        out
    };
    let faces = [
        (Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 0.0, -1.0)),
        (Vec3::new(-1.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 1.0)),
        (Vec3::new(0.0, 1.0, 0.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, -1.0, 0.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, 0.0, 1.0), Vec3::new(1.0, 0.0, 0.0)),
        (Vec3::new(0.0, 0.0, -1.0), Vec3::new(-1.0, 0.0, 0.0)),
    ];
    let comp = |v: Vec3| [v.x, v.y, v.z];
    let is = comp(inner);
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    for (n, u) in faces {
        let v = n.cross(u);
        let axis_of = |d: Vec3| -> usize {
            if d.x.abs() > 0.5 {
                0
            } else if d.y.abs() > 0.5 {
                1
            } else {
                2
            }
        };
        let (ua, va) = (axis_of(u), axis_of(v));
        let us = coords(is[ua]);
        let vs = coords(is[va]);
        let base = positions.len() as u32;
        let cols = us.len() as u32;
        for &tv in &vs {
            for &tu in &us {
                // Point on the sharp box surface of this face.
                let p = n.mul(h).add(u.scale(tu)).add(v.scale(tv));
                let q = Vec3::new(
                    p.x.clamp(-inner.x, inner.x),
                    p.y.clamp(-inner.y, inner.y),
                    p.z.clamp(-inner.z, inner.z),
                );
                let normal = p.sub(q).normalize_or(n);
                positions.push(q.add(normal.scale(r)).to_array());
                normals.push(normal.to_array());
            }
        }
        let rows = vs.len() as u32;
        for j in 0..rows - 1 {
            for i in 0..cols - 1 {
                let a = base + j * cols + i;
                let b = a + 1;
                let c = a + cols + 1;
                let d = a + cols;
                indices.extend_from_slice(&[a, b, c, a, c, d]);
            }
        }
    }
    MeshData::finish(positions, normals, indices)
}

fn sphere_mesh(radius: f32, width_segments: u32, height_segments: u32) -> MeshData {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut grid = Vec::with_capacity(height_segments as usize + 1);
    for iy in 0..=height_segments {
        let v = iy as f32 / height_segments as f32;
        let mut row = Vec::with_capacity(width_segments as usize + 1);
        for ix in 0..=width_segments {
            let u = ix as f32 / width_segments as f32;
            let (phi, theta) = (u * std::f32::consts::TAU, v * std::f32::consts::PI);
            let n = Vec3::new(-phi.cos() * theta.sin(), theta.cos(), phi.sin() * theta.sin());
            row.push(positions.len() as u32);
            positions.push(n.scale(radius).to_array());
            normals.push(n.normalize_or(Vec3::Y).to_array());
        }
        grid.push(row);
    }
    let mut indices = Vec::new();
    for iy in 0..height_segments as usize {
        for ix in 0..width_segments as usize {
            let a = grid[iy][ix + 1];
            let b = grid[iy][ix];
            let c = grid[iy + 1][ix];
            let d = grid[iy + 1][ix + 1];
            if iy != 0 {
                indices.extend_from_slice(&[a, b, d]);
            }
            if iy != height_segments as usize - 1 {
                indices.extend_from_slice(&[b, c, d]);
            }
        }
    }
    MeshData::finish(positions, normals, indices)
}

fn plane_mesh(w: f32, h: f32) -> MeshData {
    let (hw, hh) = (w * 0.5, h * 0.5);
    MeshData::finish(
        vec![[-hw, -hh, 0.0], [hw, -hh, 0.0], [hw, hh, 0.0], [-hw, hh, 0.0]],
        vec![[0.0, 0.0, 1.0]; 4],
        vec![0, 1, 2, 0, 2, 3],
    )
}

fn cylinder_mesh(
    radius_top: f32,
    radius_bottom: f32,
    height: f32,
    radial: u32,
    open_ended: bool,
) -> MeshData {
    let half_h = height * 0.5;
    let slope = if height > 0.0 { (radius_bottom - radius_top) / height } else { 0.0 };
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();
    let mut rows = [Vec::new(), Vec::new()];
    for (y, row) in rows.iter_mut().enumerate() {
        let v = y as f32;
        let r = v * (radius_bottom - radius_top) + radius_top;
        for x in 0..=radial {
            let theta = x as f32 / radial as f32 * std::f32::consts::TAU;
            let (s, c) = theta.sin_cos();
            row.push(positions.len() as u32);
            positions.push([r * s, -v * height + half_h, r * c]);
            normals.push(Vec3::new(s, slope, c).normalize_or(Vec3::Y).to_array());
        }
    }
    for x in 0..radial as usize {
        let a = rows[0][x];
        let b = rows[1][x];
        let c = rows[1][x + 1];
        let d = rows[0][x + 1];
        if radius_top > 0.0 {
            indices.extend_from_slice(&[a, b, d]);
        }
        if radius_bottom > 0.0 {
            indices.extend_from_slice(&[b, c, d]);
        }
    }
    if !open_ended {
        for (top, r) in [(true, radius_top), (false, radius_bottom)] {
            if r <= 0.0 {
                continue;
            }
            let y = if top { half_h } else { -half_h };
            let n = if top { [0.0, 1.0, 0.0] } else { [0.0, -1.0, 0.0] };
            let center = positions.len() as u32;
            positions.push([0.0, y, 0.0]);
            normals.push(n);
            let ring = positions.len() as u32;
            for x in 0..=radial {
                let theta = x as f32 / radial as f32 * std::f32::consts::TAU;
                let (s, c) = theta.sin_cos();
                positions.push([r * s, y, r * c]);
                normals.push(n);
            }
            for x in 0..radial {
                if top {
                    indices.extend_from_slice(&[center, ring + x, ring + x + 1]);
                } else {
                    indices.extend_from_slice(&[center, ring + x + 1, ring + x]);
                }
            }
        }
    }
    MeshData::finish(positions, normals, indices)
}

fn torus_mesh(radius: f32, tube: f32, radial: u32, tubular: u32) -> MeshData {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    for j in 0..=radial {
        for i in 0..=tubular {
            let u = i as f32 / tubular as f32 * std::f32::consts::TAU;
            let v = j as f32 / radial as f32 * std::f32::consts::TAU;
            let p = Vec3::new(
                (radius + tube * v.cos()) * u.cos(),
                (radius + tube * v.cos()) * u.sin(),
                tube * v.sin(),
            );
            let center = Vec3::new(radius * u.cos(), radius * u.sin(), 0.0);
            positions.push(p.to_array());
            normals.push(p.sub(center).normalize_or(Vec3::new(0.0, 0.0, 1.0)).to_array());
        }
    }
    let mut indices = Vec::new();
    for j in 1..=radial {
        for i in 1..=tubular {
            let a = (tubular + 1) * j + i - 1;
            let b = (tubular + 1) * (j - 1) + i - 1;
            let c = (tubular + 1) * (j - 1) + i;
            let d = (tubular + 1) * j + i;
            indices.extend_from_slice(&[a, b, d, b, c, d]);
        }
    }
    MeshData::finish(positions, normals, indices)
}

fn custom_mesh(
    positions: &[[f32; 3]],
    normals: Option<&[[f32; 3]]>,
    indices: &[u32],
) -> Result<MeshData, MeshError> {
    if positions.len() > MAX_CUSTOM_VERTICES {
        return Err(MeshError::InvalidMesh(format!(
            "{} vertices exceeds the {MAX_CUSTOM_VERTICES} limit",
            positions.len()
        )));
    }
    if indices.len() % 3 != 0 {
        return Err(MeshError::InvalidMesh("index count is not a multiple of 3".into()));
    }
    if positions.iter().flatten().any(|v| !v.is_finite()) {
        return Err(MeshError::InvalidMesh("non-finite vertex position".into()));
    }
    if let Some(&bad) = indices.iter().find(|&&i| i as usize >= positions.len()) {
        return Err(MeshError::InvalidMesh(format!("index {bad} out of range")));
    }
    let normals = match normals {
        Some(n) if n.len() == positions.len() => {
            if n.iter().flatten().any(|v| !v.is_finite()) {
                return Err(MeshError::InvalidMesh("non-finite vertex normal".into()));
            }
            n.iter().map(|v| Vec3::from_array(*v).normalize_or(Vec3::Y).to_array()).collect()
        },
        Some(_) => {
            return Err(MeshError::InvalidMesh("normal count differs from position count".into()));
        },
        None => {
            let mut acc = vec![Vec3::ZERO; positions.len()];
            for tri in indices.chunks_exact(3) {
                let [a, b, c] =
                    [tri[0], tri[1], tri[2]].map(|i| Vec3::from_array(positions[i as usize]));
                // Unnormalised cross product: area weighting for free.
                let n = b.sub(a).cross(c.sub(a));
                for &i in tri {
                    acc[i as usize] = acc[i as usize].add(n);
                }
            }
            acc.into_iter().map(|n| n.normalize_or(Vec3::Y).to_array()).collect()
        },
    };
    Ok(MeshData::finish(positions.to_vec(), normals, indices.to_vec()))
}

/// Deduplicating tessellation cache keyed by [`Geometry::cache_key`].
#[derive(Debug, Default)]
pub struct MeshCache {
    entries: HashMap<u64, Arc<MeshData>>,
}

impl MeshCache {
    /// An empty cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the cached mesh for `geometry`, tessellating it on first use,
    /// together with its cache key.
    ///
    /// # Errors
    /// Propagates [`Geometry::tessellate`] errors; failures are not cached.
    pub fn get(&mut self, geometry: &Geometry) -> Result<(u64, Arc<MeshData>), MeshError> {
        let key = geometry.cache_key();
        if let Some(mesh) = self.entries.get(&key) {
            return Ok((key, Arc::clone(mesh)));
        }
        let mesh = Arc::new(geometry.tessellate()?);
        self.entries.insert(key, Arc::clone(&mesh));
        Ok((key, mesh))
    }

    /// Number of distinct cached meshes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Keep only the entries whose keys satisfy `keep` (frame-to-frame
    /// eviction for long-lived renderers).
    pub fn retain(&mut self, mut keep: impl FnMut(u64) -> bool) {
        self.entries.retain(|k, _| keep(*k));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every triangle's geometric normal agrees with its vertex normals, i.e.
    /// the winding is counter-clockwise seen from outside.
    fn assert_outward_ccw(mesh: &MeshData) {
        let mut agree = 0_usize;
        let mut total = 0_usize;
        for tri in mesh.indices.chunks_exact(3) {
            let [a, b, c] =
                [tri[0], tri[1], tri[2]].map(|i| Vec3::from_array(mesh.positions[i as usize]));
            let face = b.sub(a).cross(c.sub(a));
            if face.length() < 1e-9 {
                continue;
            }
            let n = tri
                .iter()
                .fold(Vec3::ZERO, |acc, &i| acc.add(Vec3::from_array(mesh.normals[i as usize])));
            total += 1;
            if face.dot(n) > 0.0 {
                agree += 1;
            }
        }
        assert!(total > 0);
        assert_eq!(agree, total, "{} of {total} triangles wound inward", total - agree);
    }

    #[test]
    fn primitives_are_wound_counter_clockwise() {
        for g in [
            Geometry::Box { size: [1.0, 2.0, 3.0] },
            Geometry::RoundedBox { size: [2.0, 1.0, 0.2], radius: 0.08, segments: 4 },
            Geometry::Sphere { radius: 1.0, width_segments: 16, height_segments: 8 },
            Geometry::Plane { size: [2.0, 1.0] },
            Geometry::Cylinder {
                radius_top: 0.5,
                radius_bottom: 1.0,
                height: 2.0,
                radial_segments: 12,
                open_ended: false,
            },
            Geometry::Cylinder {
                radius_top: 0.0,
                radius_bottom: 1.0,
                height: 2.0,
                radial_segments: 12,
                open_ended: false,
            },
            Geometry::Torus { radius: 1.0, tube: 0.3, radial_segments: 8, tubular_segments: 24 },
        ] {
            let mesh = g.tessellate().expect("valid geometry");
            assert_eq!(mesh.positions.len(), mesh.normals.len());
            assert_outward_ccw(&mesh);
        }
    }

    #[test]
    fn rounded_box_stays_inside_its_extents() {
        let mesh = Geometry::RoundedBox { size: [2.0, 1.0, 0.5], radius: 0.2, segments: 6 }
            .tessellate()
            .expect("valid");
        for p in &mesh.positions {
            assert!(
                p[0].abs() <= 1.0 + 1e-5 && p[1].abs() <= 0.5 + 1e-5 && p[2].abs() <= 0.25 + 1e-5
            );
        }
    }

    #[test]
    fn custom_mesh_is_validated_and_gets_normals() {
        let ok = Geometry::Mesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            normals: None,
            indices: vec![0, 1, 2],
        }
        .tessellate()
        .expect("valid");
        assert_eq!(ok.normals[0], [0.0, 0.0, 1.0]);
        let bad =
            Geometry::Mesh { positions: vec![[0.0; 3]], normals: None, indices: vec![0, 1, 2] };
        assert!(bad.tessellate().is_err());
        let nan = Geometry::Sphere { radius: f32::NAN, width_segments: 8, height_segments: 8 };
        assert!(nan.tessellate().is_err());
    }

    #[test]
    fn cache_deduplicates_identical_geometry() {
        let mut cache = MeshCache::new();
        let g = Geometry::Sphere { radius: 1.0, width_segments: 8, height_segments: 6 };
        let (k1, a) = cache.get(&g).expect("valid");
        let (k2, b) = cache.get(&g.clone()).expect("valid");
        assert_eq!(k1, k2);
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn segment_counts_are_bounded() {
        let mesh = Geometry::Sphere { radius: 1.0, width_segments: u32::MAX, height_segments: 0 }
            .tessellate()
            .expect("clamped");
        assert!(mesh.positions.len() <= ((MAX_SEGMENTS + 1) * 3) as usize);
    }
}
