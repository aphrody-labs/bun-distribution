// SPDX-License-Identifier: Apache-2.0
//! Deterministic CPU 3D rasterizer: the reference backend for [`Scene3d`].
//!
//! It emulates the GPU pipeline of `crate::gpu3d` step by step so both lanes
//! agree within the documented tolerance:
//!
//! - vertices are transformed by the same [`Prepared3d`] matrices, clipped in homogeneous space and
//!   snapped to the 1/256 sub-pixel grid;
//! - coverage uses the standard 4x MSAA sample positions and the top-left fill rule; depth is
//!   tested per sample (`Less`, cleared to `1`);
//! - shading runs once per pixel per triangle at the pixel centre with perspective-correct
//!   interpolation, exactly like non-centroid MSAA;
//! - the Cook-Torrance GGX model of [`shade`] is mirrored line by line in `src/gpu3d.wgsl`; output
//!   is sRGB-encoded, blended in encoded space and box-resolved, like an `Rgba8Unorm` MSAA target.
//!
//! Rows are split into independent bands rendered in parallel (feature
//! `parallel`); each sample is owned by exactly one band and triangles are
//! processed in submission order, so the output is bit-identical with or
//! without threads. Triangles that cannot win any depth test are rejected
//! before shading (early-Z).

use crate::{
    math3d::{Vec3, linear_to_srgb, mul_normal},
    raster::Canvas,
    scene3d::{Instance, Prepared3d, PreparedLight, Scene3d, Scene3dError, ShadowSetup},
};

/// Standard D3D/Vulkan 4x MSAA sample positions, in pixel units.
pub const MSAA4_POSITIONS: [(f32, f32); 4] =
    [(0.375, 0.125), (0.875, 0.375), (0.125, 0.625), (0.625, 0.875)];

const SUBPIXEL: f32 = 256.0;
const BAND_ROWS: u32 = 16;

/// Evaluate the shared M3 PBR shading model in linear light.
///
/// `n` must be unit length and already flipped for back faces; `shadow` is
/// the visibility in `[0, 1]` of the shadow-casting light (see
/// [`shadow_visibility`]), ignored by every other light.
#[must_use]
pub fn shade(
    prepared: &Prepared3d,
    inst: &Instance,
    world: Vec3,
    n: Vec3,
    shadow: f32,
) -> [f32; 3] {
    let base = Vec3::from_array(inst.base);
    if inst.unlit {
        return inst.base;
    }
    let v = prepared.eye.sub(world).normalize_or(n);
    let metallic = inst.metallic;
    let rough = inst.roughness.max(0.045);
    let a = rough * rough;
    let a2 = a * a;
    let f0 = Vec3::new(0.04, 0.04, 0.04).lerp(base, metallic);
    let ndv = n.dot(v).max(1e-4);

    // Ambient: sky/ground irradiance for the diffuse term and the reflected
    // direction for an environment specular term weighted by a
    // roughness-aware Schlick Fresnel, so metals reflect the M3 surroundings
    // instead of turning black.
    let sky = Vec3::from_array(prepared.sky);
    let ground = Vec3::from_array(prepared.ground);
    let irradiance = ground.lerp(sky, n.y * 0.5 + 0.5);
    let r = n.scale(2.0 * n.dot(v)).sub(v);
    let reflected = ground.lerp(sky, r.y * 0.5 + 0.5);
    let env = reflected.lerp(irradiance, rough);
    let xv = 1.0 - ndv;
    let xv5 = xv * xv * xv * xv * xv;
    let f_max =
        Vec3::new((1.0 - rough).max(f0.x), (1.0 - rough).max(f0.y), (1.0 - rough).max(f0.z));
    let f_env = f0.add(f_max.sub(f0).scale(xv5));
    let mut out =
        irradiance.mul(base).mul(Vec3::ONE.sub(f_env)).scale(1.0 - metallic).add(env.mul(f_env));

    let shadow_light = prepared.shadow.map(|s| s.light);
    let k = (rough + 1.0) * (rough + 1.0) / 8.0;
    let gv = ndv / (ndv * (1.0 - k) + k);
    for (index, light) in prepared.lights.iter().enumerate() {
        let (l, mut radiance) = match *light {
            PreparedLight::Directional { to_light, radiance } => {
                (to_light, Vec3::from_array(radiance))
            },
            PreparedLight::Point { position, radiance, range } => {
                let d = position.sub(world);
                let dist2 = d.dot(d).max(1e-8);
                let dist = dist2.sqrt();
                let mut att = 1.0 / dist2.max(1e-4);
                if range > 0.0 {
                    let x = dist / range;
                    let x4 = x * x * x * x;
                    let f = (1.0 - x4).clamp(0.0, 1.0);
                    att *= f * f;
                }
                (d.scale(1.0 / dist), Vec3::from_array(radiance).scale(att))
            },
        };
        if shadow_light == Some(index) {
            radiance = radiance.scale(shadow);
        }
        let ndl = n.dot(l);
        if ndl <= 0.0 {
            continue;
        }
        let h = v.add(l).normalize_or(n);
        let ndh = n.dot(h).max(0.0);
        let vdh = v.dot(h).max(0.0);
        let dd = ndh * ndh * (a2 - 1.0) + 1.0;
        let d_term = a2 / (std::f32::consts::PI * dd * dd);
        let g = gv * (ndl / (ndl * (1.0 - k) + k));
        let x = 1.0 - vdh;
        let x5 = x * x * x * x * x;
        let f = f0.add(Vec3::ONE.sub(f0).scale(x5));
        let spec = f.scale(d_term * g / (4.0 * ndv * ndl + 1e-4));
        let kd = Vec3::ONE.sub(f).scale(1.0 - metallic);
        let diffuse = kd.mul(base).scale(1.0 / std::f32::consts::PI);
        out = out.add(diffuse.add(spec).mul(radiance).scale(ndl));
    }
    out.add(Vec3::from_array(inst.emissive)).to_array()
}

/// A light-space depth map for the shadow-casting light.
#[derive(Clone, Debug, PartialEq)]
pub struct ShadowMap {
    /// Edge length, in texels.
    pub resolution: u32,
    /// Row-major depth, `resolution²` texels, cleared to `1`.
    pub depth: Vec<f32>,
}

/// Visibility of the shadow-casting light at `world` with shading normal
/// `n`: a 3x3 percentage-closer filter over exact texel loads (no hardware
/// filtering, so the GPU `textureLoad` mirror in `gpu3d.wgsl` is identical).
#[must_use]
pub fn shadow_visibility(setup: &ShadowSetup, map: &ShadowMap, world: Vec3, n: Vec3) -> f32 {
    let p = world.add(n.scale(setup.normal_offset));
    let c = setup.view_proj.transform_point4(p);
    let (u, v, z) = (c[0] / c[3] * 0.5 + 0.5, 0.5 - c[1] / c[3] * 0.5, c[2] / c[3]);
    if !(0.0..=1.0).contains(&u) || !(0.0..=1.0).contains(&v) {
        return 1.0;
    }
    // Receivers beyond the casters' far plane are still behind them.
    let reference = z.min(1.0) - setup.depth_bias;
    let res = map.resolution as i32;
    let (tx, ty) = ((u * res as f32).floor() as i32, (v * res as f32).floor() as i32);
    let mut lit = 0_u32;
    for dy in -1..=1 {
        for dx in -1..=1 {
            let x = (tx + dx).clamp(0, res - 1) as usize;
            let y = (ty + dy).clamp(0, res - 1) as usize;
            if reference <= map.depth[y * res as usize + x] {
                lit += 1;
            }
        }
    }
    lit as f32 / 9.0
}

#[derive(Clone, Copy)]
struct ClipVert {
    clip: [f32; 4],
    world: Vec3,
    normal: Vec3,
}

impl ClipVert {
    fn lerp(&self, o: &Self, t: f32) -> Self {
        let mut clip = [0.0; 4];
        for (i, c) in clip.iter_mut().enumerate() {
            *c = self.clip[i] + (o.clip[i] - self.clip[i]) * t;
        }
        Self { clip, world: self.world.lerp(o.world, t), normal: self.normal.lerp(o.normal, t) }
    }
}

/// A screen-space triangle ready for rasterization.
#[derive(Clone, Copy)]
struct Tri {
    /// Snapped screen positions, oriented so the edge functions are positive
    /// inside.
    p: [[f32; 2]; 3],
    z: [f32; 3],
    inv_w: [f32; 3],
    world: [Vec3; 3],
    normal: [Vec3; 3],
    instance: u32,
    front: bool,
    transparent: bool,
    bbox: [i32; 4],
}

/// Signed plane distances for the six wgpu clip planes.
fn plane_dist(c: &[f32; 4], plane: usize) -> f32 {
    match plane {
        0 => c[3] + c[0],
        1 => c[3] - c[0],
        2 => c[3] + c[1],
        3 => c[3] - c[1],
        4 => c[2],
        _ => c[3] - c[2],
    }
}

fn clip_polygon(tri: [ClipVert; 3]) -> Vec<ClipVert> {
    let mut outcode_and = 0b11_1111_u8;
    let mut outcode_or = 0_u8;
    for v in &tri {
        let mut code = 0_u8;
        for plane in 0..6 {
            if plane_dist(&v.clip, plane) < 0.0 {
                code |= 1 << plane;
            }
        }
        outcode_and &= code;
        outcode_or |= code;
    }
    if outcode_and != 0 {
        return Vec::new();
    }
    let mut poly = tri.to_vec();
    if outcode_or == 0 {
        return poly;
    }
    for plane in 0..6 {
        if outcode_or & (1 << plane) == 0 || poly.is_empty() {
            continue;
        }
        let mut next = Vec::with_capacity(poly.len() + 2);
        for i in 0..poly.len() {
            let a = &poly[i];
            let b = &poly[(i + 1) % poly.len()];
            let (da, db) = (plane_dist(&a.clip, plane), plane_dist(&b.clip, plane));
            if da >= 0.0 {
                next.push(*a);
            }
            if (da >= 0.0) != (db >= 0.0) {
                next.push(a.lerp(b, da / (da - db)));
            }
        }
        poly = next;
    }
    poly
}

fn edge(a: [f32; 2], b: [f32; 2], p: [f32; 2]) -> f32 {
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

fn is_top_left(a: [f32; 2], b: [f32; 2]) -> bool {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    (dy == 0.0 && dx > 0.0) || dy < 0.0
}

/// Vertex stage for one instance: transform, clip, project, cull, snap.
fn instance_triangles(
    prepared: &Prepared3d,
    instance_index: u32,
    mesh_index: usize,
    double_sided: bool,
    transparent: bool,
    out: &mut Vec<Tri>,
) {
    let inst = &prepared.instances[instance_index as usize];
    let mesh = &prepared.meshes[mesh_index];
    let mvp = prepared.view_proj.mul(&inst.model);
    let verts: Vec<ClipVert> = mesh
        .positions
        .iter()
        .zip(&mesh.normals)
        .map(|(p, n)| {
            let p = Vec3::from_array(*p);
            ClipVert {
                clip: mvp.transform_point4(p),
                world: inst.model.transform_point(p),
                normal: mul_normal(&inst.normal, Vec3::from_array(*n)),
            }
        })
        .collect();
    let (w, h) = (prepared.width as f32, prepared.height as f32);
    for idx in mesh.indices.chunks_exact(3) {
        let tri = [verts[idx[0] as usize], verts[idx[1] as usize], verts[idx[2] as usize]];
        let poly = clip_polygon(tri);
        if poly.len() < 3 {
            continue;
        }
        let screen: Vec<([f32; 2], f32, f32)> = poly
            .iter()
            .map(|v| {
                let inv_w = 1.0 / v.clip[3];
                let (nx, ny, nz) = (v.clip[0] * inv_w, v.clip[1] * inv_w, v.clip[2] * inv_w);
                let sx = ((nx * 0.5 + 0.5) * w * SUBPIXEL).round() / SUBPIXEL;
                let sy = ((0.5 - ny * 0.5) * h * SUBPIXEL).round() / SUBPIXEL;
                ([sx, sy], nz, inv_w)
            })
            .collect();
        for k in 1..poly.len() - 1 {
            let ids = [0, k, k + 1];
            let (p0, p1, p2) = (screen[0].0, screen[k].0, screen[k + 1].0);
            let area = edge(p0, p1, p2);
            if area == 0.0 {
                continue;
            }
            // Counter-clockwise in NDC (y up) is negative area in y-down
            // screen space: that is the front face, as for wgpu `Ccw`.
            let front = area < 0.0;
            if !front && !double_sided {
                continue;
            }
            // Orient so the edge functions are positive inside.
            let order = if area > 0.0 { ids } else { [ids[0], ids[2], ids[1]] };
            let p = order.map(|i| screen[i].0);
            let min_x = p.iter().map(|q| q[0]).fold(f32::MAX, f32::min);
            let max_x = p.iter().map(|q| q[0]).fold(f32::MIN, f32::max);
            let min_y = p.iter().map(|q| q[1]).fold(f32::MAX, f32::min);
            let max_y = p.iter().map(|q| q[1]).fold(f32::MIN, f32::max);
            let bbox = [
                (min_x.floor() as i32).max(0),
                (min_y.floor() as i32).max(0),
                (max_x.ceil() as i32).min(prepared.width as i32 - 1),
                (max_y.ceil() as i32).min(prepared.height as i32 - 1),
            ];
            if bbox[0] > bbox[2] || bbox[1] > bbox[3] {
                continue;
            }
            out.push(Tri {
                p,
                z: order.map(|i| screen[i].1),
                inv_w: order.map(|i| screen[i].2),
                world: order.map(|i| poly[i].world),
                normal: order.map(|i| poly[i].normal),
                instance: instance_index,
                front,
                transparent,
                bbox,
            });
        }
    }
}

fn vertex_stage(prepared: &Prepared3d) -> Vec<Tri> {
    let jobs: Vec<(u32, usize, bool, bool)> = prepared
        .batches
        .iter()
        .flat_map(|b| {
            (b.first_instance..b.first_instance + b.instance_count)
                .map(move |i| (i, b.mesh, b.double_sided, b.transparent))
        })
        .collect();
    let run = |&(i, mesh, double_sided, transparent): &(u32, usize, bool, bool)| {
        let mut tris = Vec::new();
        instance_triangles(prepared, i, mesh, double_sided, transparent, &mut tris);
        tris
    };
    #[cfg(feature = "parallel")]
    let per_instance: Vec<Vec<Tri>> = {
        use rayon::prelude::*;
        jobs.par_iter().map(run).collect()
    };
    #[cfg(not(feature = "parallel"))]
    let per_instance: Vec<Vec<Tri>> = jobs.iter().map(run).collect();
    per_instance.into_iter().flatten().collect()
}

/// A light-space triangle for the depth-only shadow pass.
#[derive(Clone, Copy)]
struct ShadowTri {
    p: [[f32; 2]; 3],
    z: [f32; 3],
    bbox: [i32; 4],
}

/// Rasterize the opaque shadow casters into the light's depth map, like the
/// GPU depth-only pass: no face culling, texel-centre sampling, top-left rule
/// and `Less` depth test. Returns `None` when the frame has no shadow light.
#[must_use]
pub fn render_shadow_map(prepared: &Prepared3d) -> Option<ShadowMap> {
    let setup = prepared.shadow?;
    let res = setup.resolution;
    let size = res as f32;
    let jobs: Vec<(u32, usize)> = prepared
        .shadow_batches
        .iter()
        .flat_map(|b| {
            (b.first_instance..b.first_instance + b.instance_count).map(move |i| (i, b.mesh))
        })
        .collect();
    let run = |&(i, mesh_index): &(u32, usize)| -> Vec<ShadowTri> {
        let inst = &prepared.instances[i as usize];
        let mesh = &prepared.meshes[mesh_index];
        let mvp = setup.view_proj.mul(&inst.model);
        let verts: Vec<ClipVert> = mesh
            .positions
            .iter()
            .map(|p| ClipVert {
                clip: mvp.transform_point4(Vec3::from_array(*p)),
                world: Vec3::ZERO,
                normal: Vec3::ZERO,
            })
            .collect();
        let mut out = Vec::new();
        for idx in mesh.indices.chunks_exact(3) {
            let poly = clip_polygon([
                verts[idx[0] as usize],
                verts[idx[1] as usize],
                verts[idx[2] as usize],
            ]);
            if poly.len() < 3 {
                continue;
            }
            let screen: Vec<([f32; 2], f32)> = poly
                .iter()
                .map(|v| {
                    let inv_w = 1.0 / v.clip[3];
                    let sx = ((v.clip[0] * inv_w * 0.5 + 0.5) * size * SUBPIXEL).round() / SUBPIXEL;
                    let sy = ((0.5 - v.clip[1] * inv_w * 0.5) * size * SUBPIXEL).round() / SUBPIXEL;
                    ([sx, sy], v.clip[2] * inv_w)
                })
                .collect();
            for k in 1..poly.len() - 1 {
                let area = edge(screen[0].0, screen[k].0, screen[k + 1].0);
                if area == 0.0 {
                    continue;
                }
                let order = if area > 0.0 { [0, k, k + 1] } else { [0, k + 1, k] };
                let p = order.map(|i| screen[i].0);
                let bbox = [
                    (p.iter().map(|q| q[0]).fold(f32::MAX, f32::min).floor() as i32).max(0),
                    (p.iter().map(|q| q[1]).fold(f32::MAX, f32::min).floor() as i32).max(0),
                    (p.iter().map(|q| q[0]).fold(f32::MIN, f32::max).ceil() as i32)
                        .min(res as i32 - 1),
                    (p.iter().map(|q| q[1]).fold(f32::MIN, f32::max).ceil() as i32)
                        .min(res as i32 - 1),
                ];
                if bbox[0] <= bbox[2] && bbox[1] <= bbox[3] {
                    out.push(ShadowTri { p, z: order.map(|i| screen[i].1), bbox });
                }
            }
        }
        out
    };
    #[cfg(feature = "parallel")]
    let tris: Vec<ShadowTri> = {
        use rayon::prelude::*;
        jobs.par_iter().map(run).collect::<Vec<_>>().into_iter().flatten().collect()
    };
    #[cfg(not(feature = "parallel"))]
    let tris: Vec<ShadowTri> = jobs.iter().flat_map(run).collect();

    let band_count = (res as usize).div_ceil(BAND_ROWS as usize);
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); band_count];
    for (i, t) in tris.iter().enumerate() {
        for bin in &mut bins
            [t.bbox[1] as usize / BAND_ROWS as usize..=t.bbox[3] as usize / BAND_ROWS as usize]
        {
            bin.push(i as u32);
        }
    }
    let mut depth = vec![1.0_f32; res as usize * res as usize];
    let work = |(band, rows): (usize, &mut [f32])| {
        let y0 = (band as u32 * BAND_ROWS) as i32;
        let y1 = y0 + (rows.len() / res as usize) as i32 - 1;
        for &ti in &bins[band] {
            let t = &tris[ti as usize];
            let [a, b, c] = t.p;
            let area = edge(a, b, c);
            let tl = [is_top_left(b, c), is_top_left(c, a), is_top_left(a, b)];
            for y in t.bbox[1].max(y0)..=t.bbox[3].min(y1) {
                for x in t.bbox[0]..=t.bbox[2] {
                    let p = [x as f32 + 0.5, y as f32 + 0.5];
                    let (w0, w1, w2) = (edge(b, c, p), edge(c, a, p), edge(a, b, p));
                    if !((w0 > 0.0 || (w0 == 0.0 && tl[0]))
                        && (w1 > 0.0 || (w1 == 0.0 && tl[1]))
                        && (w2 > 0.0 || (w2 == 0.0 && tl[2])))
                    {
                        continue;
                    }
                    let z = (w0 * t.z[0] + w1 * t.z[1] + w2 * t.z[2]) / area;
                    let texel = &mut rows[(y - y0) as usize * res as usize + x as usize];
                    if z < *texel {
                        *texel = z;
                    }
                }
            }
        }
    };
    let band_texels = BAND_ROWS as usize * res as usize;
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        depth.par_chunks_mut(band_texels).enumerate().for_each(work);
    }
    #[cfg(not(feature = "parallel"))]
    depth.chunks_mut(band_texels).enumerate().for_each(work);
    Some(ShadowMap { resolution: res, depth })
}

fn to_unorm8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}

struct BandTarget<'a> {
    y0: u32,
    rows: u32,
    color: &'a mut [u8],
    depth: &'a mut [f32],
}

/// Shade triangle `t` once at the centre of pixel `(x, y)` (non-centroid
/// MSAA), returning sRGB-encoded colour and alpha.
fn shade_pixel(
    prepared: &Prepared3d,
    shadow: Option<(&ShadowSetup, &ShadowMap)>,
    t: &Tri,
    x: i32,
    y: i32,
) -> ([f32; 3], f32) {
    let inst = &prepared.instances[t.instance as usize];
    let [a, b, c] = t.p;
    let area = edge(a, b, c);
    let pc = [x as f32 + 0.5, y as f32 + 0.5];
    let l = [edge(b, c, pc) / area, edge(c, a, pc) / area, edge(a, b, pc) / area];
    let pw = [l[0] * t.inv_w[0], l[1] * t.inv_w[1], l[2] * t.inv_w[2]];
    let sum = pw[0] + pw[1] + pw[2];
    let bw = if sum != 0.0 { pw.map(|v| v / sum) } else { l };
    let world = t.world[0].scale(bw[0]).add(t.world[1].scale(bw[1])).add(t.world[2].scale(bw[2]));
    let mut n = t.normal[0]
        .scale(bw[0])
        .add(t.normal[1].scale(bw[1]))
        .add(t.normal[2].scale(bw[2]))
        .normalize_or(Vec3::Y);
    if !t.front {
        n = n.scale(-1.0);
    }
    let visibility = match shadow {
        Some((setup, map)) if !inst.unlit => shadow_visibility(setup, map, world, n),
        _ => 1.0,
    };
    let rgb = shade(prepared, inst, world, n, visibility);
    ([linear_to_srgb(rgb[0]), linear_to_srgb(rgb[1]), linear_to_srgb(rgb[2])], inst.alpha)
}

/// Coverage of triangle `t` at the samples of pixel `(x, y)`: a bit mask of
/// covered samples and their interpolated depths.
fn coverage(t: &Tri, positions: &[(f32, f32)], x: i32, y: i32) -> (u8, [f32; 4]) {
    let [a, b, c] = t.p;
    let area = edge(a, b, c);
    let tl = [is_top_left(b, c), is_top_left(c, a), is_top_left(a, b)];
    let mut mask = 0_u8;
    let mut z = [0.0_f32; 4];
    for (s, &(ox, oy)) in positions.iter().enumerate() {
        let p = [x as f32 + ox, y as f32 + oy];
        let w0 = edge(b, c, p);
        let w1 = edge(c, a, p);
        let w2 = edge(a, b, p);
        if (w0 > 0.0 || (w0 == 0.0 && tl[0]))
            && (w1 > 0.0 || (w1 == 0.0 && tl[1]))
            && (w2 > 0.0 || (w2 == 0.0 && tl[2]))
        {
            mask |= 1 << s;
            z[s] = (w0 * t.z[0] + w1 * t.z[1] + w2 * t.z[2]) / area;
        }
    }
    (mask, z)
}

/// Rasterize one row band in three phases:
///
/// 1. opaque triangles write only depth and a per-sample triangle id (a visibility buffer), so
///    hidden surfaces are never shaded;
/// 2. every pixel is shaded once per distinct visible triangle, exactly as the forward GPU pipeline
///    shades the surviving fragment;
/// 3. transparent triangles are shaded and blended forward, back to front, against the opaque
///    depth.
///
/// Opaque samples are overwritten wholesale, so the result is identical to
/// shading every depth-passing fragment in submission order.
fn raster_band(
    prepared: &Prepared3d,
    shadow: Option<(&ShadowSetup, &ShadowMap)>,
    tris: &[Tri],
    bin: &[u32],
    band: BandTarget<'_>,
) {
    let width = prepared.width as usize;
    let samples = prepared.samples as usize;
    let positions: &[(f32, f32)] = if samples == 4 { &MSAA4_POSITIONS } else { &[(0.5, 0.5)] };
    let (band_y0, band_y1) = (band.y0 as i32, (band.y0 + band.rows) as i32 - 1);
    // Opaque batches are submitted before transparent ones.
    let split = bin.partition_point(|&ti| !tris[ti as usize].transparent);
    let (opaque, transparent) = bin.split_at(split);

    // Phase 1: visibility.
    let mut ids = vec![u32::MAX; band.depth.len()];
    for &ti in opaque {
        let t = &tris[ti as usize];
        for y in t.bbox[1].max(band_y0)..=t.bbox[3].min(band_y1) {
            let row = (y - band_y0) as usize;
            for x in t.bbox[0]..=t.bbox[2] {
                let (mask, z) = coverage(t, positions, x, y);
                if mask == 0 {
                    continue;
                }
                let base = (row * width + x as usize) * samples;
                for s in 0..samples {
                    if mask & (1 << s) != 0 && z[s] < band.depth[base + s] {
                        band.depth[base + s] = z[s];
                        ids[base + s] = ti;
                    }
                }
            }
        }
    }

    // Phase 2: shade each visible (pixel, triangle) pair once.
    if !opaque.is_empty() {
        for row in 0..band.rows as usize {
            let y = band_y0 + row as i32;
            for x in 0..width {
                let base = (row * width + x) * samples;
                let pixel_ids = &ids[base..base + samples];
                let mut done = [u32::MAX; 4];
                for s in 0..samples {
                    let ti = pixel_ids[s];
                    if ti == u32::MAX || done[..s].contains(&ti) {
                        continue;
                    }
                    done[s] = ti;
                    let (src, alpha) =
                        shade_pixel(prepared, shadow, &tris[ti as usize], x as i32, y);
                    let rgba =
                        [to_unorm8(src[0]), to_unorm8(src[1]), to_unorm8(src[2]), to_unorm8(alpha)];
                    for (k, &id) in pixel_ids.iter().enumerate().skip(s) {
                        if id == ti {
                            band.color[(base + k) * 4..(base + k) * 4 + 4].copy_from_slice(&rgba);
                        }
                    }
                }
            }
        }
    }

    // Phase 3: transparent, forward-shaded and blended.
    for &ti in transparent {
        let t = &tris[ti as usize];
        for y in t.bbox[1].max(band_y0)..=t.bbox[3].min(band_y1) {
            let row = (y - band_y0) as usize;
            for x in t.bbox[0]..=t.bbox[2] {
                let (mut mask, z) = coverage(t, positions, x, y);
                let base = (row * width + x as usize) * samples;
                for s in 0..samples {
                    if mask & (1 << s) != 0 && z[s] >= band.depth[base + s] {
                        mask &= !(1 << s);
                    }
                }
                if mask == 0 {
                    continue;
                }
                let (src, alpha) = shade_pixel(prepared, shadow, t, x, y);
                for s in 0..samples {
                    if mask & (1 << s) == 0 {
                        continue;
                    }
                    let px = &mut band.color[(base + s) * 4..(base + s) * 4 + 4];
                    for ch in 0..3 {
                        let d = f32::from(px[ch]) / 255.0;
                        px[ch] = to_unorm8(src[ch] * alpha + d * (1.0 - alpha));
                    }
                    let da = f32::from(px[3]) / 255.0;
                    px[3] = to_unorm8(alpha + da * (1.0 - alpha));
                }
            }
        }
    }
}

/// Render an already prepared frame on the CPU.
#[must_use]
pub fn render_prepared(prepared: &Prepared3d) -> Canvas {
    let (width, height, samples) =
        (prepared.width as usize, prepared.height as usize, prepared.samples as usize);
    let shadow_map = render_shadow_map(prepared);
    let shadow = prepared.shadow.as_ref().zip(shadow_map.as_ref());
    let tris = vertex_stage(prepared);

    // Bin triangles into row bands, preserving submission order.
    let band_count = height.div_ceil(BAND_ROWS as usize);
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); band_count];
    for (i, t) in tris.iter().enumerate() {
        let first = t.bbox[1] as usize / BAND_ROWS as usize;
        let last = t.bbox[3] as usize / BAND_ROWS as usize;
        for bin in &mut bins[first..=last.min(band_count - 1)] {
            bin.push(i as u32);
        }
    }

    let clear = prepared.clear.map_or([0, 0, 0, 0], |c| [c.r, c.g, c.b, c.a]);
    let sample_count = width * height * samples;
    let mut color: Vec<u8> = clear.repeat(sample_count);
    let mut depth = vec![1.0_f32; sample_count];
    let band_samples = width * BAND_ROWS as usize * samples;

    let work = |(i, (color, depth)): (usize, (&mut [u8], &mut [f32]))| {
        let rows = (depth.len() / (width * samples)) as u32;
        raster_band(
            prepared,
            shadow,
            &tris,
            &bins[i],
            BandTarget { y0: i as u32 * BAND_ROWS, rows, color, depth },
        );
    };
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        color
            .par_chunks_mut(band_samples * 4)
            .zip(depth.par_chunks_mut(band_samples))
            .enumerate()
            .for_each(work);
    }
    #[cfg(not(feature = "parallel"))]
    color
        .chunks_mut(band_samples * 4)
        .zip(depth.chunks_mut(band_samples))
        .enumerate()
        .for_each(work);

    // Box resolve, like an MSAA resolve of an `Rgba8Unorm` target.
    let pixels = if samples == 1 {
        color
    } else {
        let mut out = vec![0_u8; width * height * 4];
        for (dst, src) in out.chunks_exact_mut(4).zip(color.chunks_exact(4 * samples)) {
            for ch in 0..4 {
                let sum: u32 = (0..samples).map(|s| u32::from(src[s * 4 + ch])).sum();
                dst[ch] = ((sum as f32) / samples as f32).round() as u8;
            }
        }
        out
    };
    Canvas { width: prepared.width, height: prepared.height, pixels }
}

/// Prepare and render `scene` on the CPU.
///
/// # Errors
/// Returns the [`Scene3dError`] from [`Scene3d::prepare`].
pub fn render_scene3d(scene: &Scene3d) -> Result<Canvas, Scene3dError> {
    Ok(render_prepared(&scene.prepare()?))
}

/// Errors from [`render_scene3d_png`].
#[derive(Debug)]
pub enum Render3dPngError {
    /// The scene is invalid.
    Scene(Scene3dError),
    /// PNG encoding failed.
    Png(png::EncodingError),
}

impl std::fmt::Display for Render3dPngError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Scene(err) => err.fmt(f),
            Self::Png(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Render3dPngError {}

/// Render `scene` on the CPU and PNG-encode it.
///
/// # Errors
/// Returns [`Render3dPngError`] for an invalid scene or an encoding failure.
pub fn render_scene3d_png(scene: &Scene3d) -> Result<Vec<u8>, Render3dPngError> {
    let canvas = render_scene3d(scene).map_err(Render3dPngError::Scene)?;
    crate::raster::encode_png(canvas.width, canvas.height, &canvas.pixels)
        .map_err(Render3dPngError::Png)
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::facade::color::Role;

    use super::*;
    use crate::{
        fixtures::showcase_scene3d,
        mesh3d::Geometry,
        scene::{Paint, Rgba8},
        scene3d::{Camera, Light, Material, Node3d, Projection, Transform},
    };

    fn unlit_quad(samples: u32) -> Scene3d {
        let mut scene = showcase_scene3d(32, 32);
        scene.samples = samples;
        scene.lights.clear();
        scene.camera = Camera {
            eye: [0.0, 0.0, 5.0],
            target: [0.0; 3],
            up: [0.0, 1.0, 0.0],
            projection: Projection::Orthographic { height: 2.0, near: 0.1, far: 10.0 },
        };
        scene.nodes = vec![Node3d::Mesh {
            transform: Transform::IDENTITY,
            geometry: Geometry::Plane { size: [1.0, 1.0] },
            material: Material {
                base: Paint::Fixed(Rgba8 { r: 255, g: 0, b: 0, a: 255 }),
                metallic: 0.0,
                roughness: 1.0,
                emissive: None,
                emissive_intensity: 1.0,
                opacity: 1.0,
                unlit: true,
                double_sided: false,
                cast_shadow: true,
            },
        }];
        scene
    }

    fn px(c: &Canvas, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * c.width + x) * 4) as usize;
        [c.pixels[i], c.pixels[i + 1], c.pixels[i + 2], c.pixels[i + 3]]
    }

    #[test]
    fn unlit_plane_covers_exactly_its_projected_area() {
        let canvas = render_scene3d(&unlit_quad(1)).expect("valid");
        // Orthographic height 2 over 32 px: the unit plane spans pixels 8..24.
        assert_eq!(px(&canvas, 16, 16), [255, 0, 0, 255]);
        assert_eq!(px(&canvas, 8, 8), [255, 0, 0, 255]);
        assert_eq!(px(&canvas, 23, 23), [255, 0, 0, 255]);
        assert_ne!(px(&canvas, 7, 16), [255, 0, 0, 255]);
        assert_ne!(px(&canvas, 24, 16), [255, 0, 0, 255]);
        let red = canvas.pixels.chunks_exact(4).filter(|p| *p == [255, 0, 0, 255]).count();
        assert_eq!(red, 16 * 16);
    }

    #[test]
    fn back_faces_are_culled_unless_double_sided() {
        let mut scene = unlit_quad(1);
        if let Node3d::Mesh { transform, .. } = &mut scene.nodes[0] {
            transform.rotation_deg = [0.0, 180.0, 0.0];
        }
        let canvas = render_scene3d(&scene).expect("valid");
        assert_ne!(px(&canvas, 16, 16), [255, 0, 0, 255]);
        if let Node3d::Mesh { material, .. } = &mut scene.nodes[0] {
            material.double_sided = true;
        }
        let canvas = render_scene3d(&scene).expect("valid");
        assert_eq!(px(&canvas, 16, 16), [255, 0, 0, 255]);
    }

    #[test]
    fn depth_test_keeps_the_nearest_surface() {
        let mut scene = unlit_quad(1);
        let mut near = scene.nodes[0].clone();
        if let Node3d::Mesh { transform, material, .. } = &mut near {
            transform.translation = [0.0, 0.0, 1.0];
            transform.scale = [0.5, 0.5, 1.0];
            material.base = Paint::Fixed(Rgba8 { r: 0, g: 0, b: 255, a: 255 });
        }
        // Draw the near quad first: the far one must not overwrite it.
        scene.nodes.insert(0, near);
        let canvas = render_scene3d(&scene).expect("valid");
        assert_eq!(px(&canvas, 16, 16), [0, 0, 255, 255]);
        assert_eq!(px(&canvas, 9, 9), [255, 0, 0, 255]);
    }

    #[test]
    fn msaa_produces_partial_edge_coverage() {
        let mut scene = unlit_quad(4);
        if let Node3d::Mesh { transform, .. } = &mut scene.nodes[0] {
            transform.rotation_deg = [0.0, 0.0, 30.0];
        }
        let canvas = render_scene3d(&scene).expect("valid");
        let partial = canvas.pixels.chunks_exact(4).filter(|p| p[0] > 0 && p[0] < 255).count();
        assert!(partial > 0, "4x MSAA must blend edge pixels");
    }

    #[test]
    fn lit_sphere_is_brighter_towards_the_light() {
        let mut scene = unlit_quad(1);
        scene.camera.projection = Projection::Perspective { fov_y_deg: 45.0, near: 0.1, far: 20.0 };
        scene.lights = vec![Light::Directional {
            direction: [1.0, 0.0, 0.0],
            color: Paint::Fixed(Rgba8 { r: 255, g: 255, b: 255, a: 255 }),
            intensity: std::f32::consts::PI,
            cast_shadow: true,
        }];
        scene.nodes = vec![Node3d::Mesh {
            transform: Transform::IDENTITY,
            geometry: Geometry::Sphere { radius: 1.0, width_segments: 32, height_segments: 16 },
            material: Material {
                base: Paint::Role(Role::Primary),
                metallic: 0.0,
                roughness: 0.8,
                emissive: None,
                emissive_intensity: 1.0,
                opacity: 1.0,
                unlit: false,
                double_sided: false,
                cast_shadow: true,
            },
        }];
        let canvas = render_scene3d(&scene).expect("valid");
        let lum = |p: [u8; 4]| u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]);
        // Light travels +X, so the -X hemisphere faces it.
        assert!(lum(px(&canvas, 11, 16)) > lum(px(&canvas, 21, 16)));
    }

    #[test]
    fn rendering_is_deterministic_and_thread_independent() {
        let scene = showcase_scene3d(96, 64);
        let a = render_scene3d(&scene).expect("valid");
        let b = render_scene3d(&scene).expect("valid");
        assert_eq!(a.pixels, b.pixels);
        let png = render_scene3d_png(&scene).expect("encode");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn near_plane_clipping_keeps_geometry_crossing_the_camera() {
        let mut scene = unlit_quad(1);
        scene.camera.projection = Projection::Perspective { fov_y_deg: 60.0, near: 0.5, far: 20.0 };
        if let Node3d::Mesh { transform, material, .. } = &mut scene.nodes[0] {
            // A floor running from behind the camera into the distance.
            transform.translation = [0.0, -1.0, 0.0];
            transform.rotation_deg = [-90.0, 0.0, 0.0];
            transform.scale = [4.0, 40.0, 1.0];
            material.double_sided = true;
        }
        let canvas = render_scene3d(&scene).expect("valid");
        assert_eq!(px(&canvas, 16, 31), [255, 0, 0, 255]);
    }
}
