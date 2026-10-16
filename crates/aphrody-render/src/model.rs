// SPDX-License-Identifier: Apache-2.0
//! 3D model import and export: glTF 2.0 (`.gltf`/`.glb`, through the `gltf`
//! crate) and Wavefront OBJ (through `tobj`) into [`Node3d`] meshes, and
//! [`Node3d`] scenes back out as binary glTF.
//!
//! Import bakes node hierarchies into world-space vertices (normals through
//! the inverse-transpose), so every triangle primitive becomes one
//! [`Geometry::Mesh`] with an identity transform. glTF metallic/roughness,
//! emissive (with `KHR_materials_emissive_strength`), `BLEND` alpha,
//! `doubleSided` and `KHR_materials_unlit` map onto [`Material`]. Texture
//! images are not sampled: the base colour factor is used.

use std::path::Path;

use aphrody_m3_tokens::facade::color::DynamicScheme;
use base64::Engine;
use serde::Serialize;
use serde_json::json;

use crate::{
    math3d::{Mat4, Vec3, linear_to_srgb, mul_normal, srgb_to_linear},
    mesh3d::Geometry,
    scene::{Paint, Rgba8},
    scene3d::{Camera, Material, Node3d, Projection, Transform},
};

/// Why a model could not be imported or exported.
#[derive(Debug)]
pub enum ModelError {
    /// Reading the file (or an external buffer) failed.
    Io(std::io::Error),
    /// The file extension is not `.obj`, `.gltf` or `.glb`.
    UnsupportedFormat(String),
    /// The document is malformed.
    Invalid(String),
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => write!(f, "model I/O error: {err}"),
            Self::UnsupportedFormat(ext) => write!(f, "unsupported model format: {ext:?}"),
            Self::Invalid(why) => write!(f, "invalid model: {why}"),
        }
    }
}

impl std::error::Error for ModelError {}

impl From<std::io::Error> for ModelError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<gltf::Error> for ModelError {
    fn from(err: gltf::Error) -> Self {
        Self::Invalid(format!("glTF: {err}"))
    }
}

fn invalid(why: impl Into<String>) -> ModelError {
    ModelError::Invalid(why.into())
}

/// Load `.obj`, `.gltf` or `.glb`, using `material` for OBJ meshes and for
/// glTF primitives without a material.
///
/// # Errors
/// [`ModelError`] for I/O failures, unknown extensions or malformed files.
pub fn load_model(path: &Path, material: Material) -> Result<Vec<Node3d>, ModelError> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "obj" => parse_obj(&std::fs::read(path)?, material),
        "glb" | "gltf" => parse_gltf(&std::fs::read(path)?, path.parent(), material),
        other => Err(ModelError::UnsupportedFormat(other.to_string())),
    }
}

/// Parse Wavefront OBJ bytes (triangulated, single-indexed by `tobj`).
///
/// # Errors
/// [`ModelError::Invalid`] for malformed OBJ or a file without faces.
pub fn parse_obj(bytes: &[u8], material: Material) -> Result<Vec<Node3d>, ModelError> {
    let options = tobj::LoadOptions { triangulate: true, single_index: true, ..Default::default() };
    let (models, _) = tobj::load_obj_buf(&mut std::io::Cursor::new(bytes), &options, |_| {
        Err(tobj::LoadError::OpenFileFailed)
    })
    .map_err(|e| invalid(format!("OBJ: {e}")))?;
    let nodes: Vec<Node3d> = models
        .into_iter()
        .filter(|m| !m.mesh.indices.is_empty())
        .map(|m| {
            let positions: Vec<[f32; 3]> =
                m.mesh.positions.chunks_exact(3).map(|p| [p[0], p[1], p[2]]).collect();
            let normals = (m.mesh.normals.len() == m.mesh.positions.len())
                .then(|| m.mesh.normals.chunks_exact(3).map(|n| [n[0], n[1], n[2]]).collect());
            Node3d::Mesh {
                transform: Transform::IDENTITY,
                geometry: Geometry::Mesh { positions, normals, indices: m.mesh.indices },
                material,
            }
        })
        .collect();
    if nodes.is_empty() {
        return Err(invalid("OBJ has no faces"));
    }
    Ok(nodes)
}

/// Resolve every buffer of a glTF document: the GLB `BIN` chunk, base64
/// data URIs, or files next to the model (never outside its directory).
fn buffers(gltf: &gltf::Gltf, base_dir: Option<&Path>) -> Result<Vec<Vec<u8>>, ModelError> {
    gltf.document
        .buffers()
        .map(|buffer| match buffer.source() {
            gltf::buffer::Source::Bin => {
                gltf.blob.clone().ok_or_else(|| invalid("GLB buffer without a BIN chunk"))
            },
            gltf::buffer::Source::Uri(uri) if uri.starts_with("data:") => {
                let payload = uri
                    .split_once(";base64,")
                    .map(|(_, p)| p)
                    .ok_or_else(|| invalid("only base64 data URIs are supported"))?;
                base64::engine::general_purpose::STANDARD
                    .decode(payload)
                    .map_err(|e| invalid(format!("buffer base64: {e}")))
            },
            gltf::buffer::Source::Uri(uri) => {
                let dir = base_dir.ok_or_else(|| invalid("external buffer without a directory"))?;
                if uri.contains("..") || Path::new(uri).is_absolute() || uri.contains(':') {
                    return Err(invalid(format!("buffer uri outside the model directory: {uri}")));
                }
                Ok(std::fs::read(dir.join(uri))?)
            },
        })
        .collect()
}

fn gltf_material(material: &gltf::Material<'_>, fallback: Material) -> Material {
    if material.index().is_none() {
        return fallback;
    }
    let pbr = material.pbr_metallic_roughness();
    let [r, g, b, a] = pbr.base_color_factor();
    // glTF factors are linear; `Paint` is sRGB-encoded.
    let enc = |c: f32| (linear_to_srgb(c) * 255.0).round() as u8;
    let [er, eg, eb] = material.emissive_factor();
    Material {
        base: Paint::Fixed(Rgba8 { r: enc(r), g: enc(g), b: enc(b), a: 255 }),
        metallic: pbr.metallic_factor(),
        roughness: pbr.roughness_factor(),
        emissive: (er > 0.0 || eg > 0.0 || eb > 0.0)
            .then(|| Paint::Fixed(Rgba8 { r: enc(er), g: enc(eg), b: enc(eb), a: 255 })),
        emissive_intensity: material.emissive_strength().unwrap_or(1.0),
        opacity: if material.alpha_mode() == gltf::material::AlphaMode::Blend {
            a.clamp(0.0, 1.0)
        } else {
            1.0
        },
        unlit: material.unlit(),
        double_sided: material.double_sided(),
        cast_shadow: true,
    }
}

/// Parse glTF JSON or binary glTF bytes; `base_dir` resolves external
/// buffers.
///
/// # Errors
/// [`ModelError`] for malformed documents or unreadable buffers.
pub fn parse_gltf(
    bytes: &[u8],
    base_dir: Option<&Path>,
    fallback: Material,
) -> Result<Vec<Node3d>, ModelError> {
    let gltf = gltf::Gltf::from_slice(bytes)?;
    let data = buffers(&gltf, base_dir)?;
    let doc = &gltf.document;
    let roots: Vec<gltf::Node<'_>> = match doc.default_scene().or_else(|| doc.scenes().next()) {
        Some(scene) => scene.nodes().collect(),
        None => doc.nodes().collect(),
    };
    let mut out = Vec::new();
    let mut stack: Vec<(gltf::Node<'_>, Mat4, usize)> =
        roots.into_iter().rev().map(|n| (n, Mat4::IDENTITY, 0)).collect();
    while let Some((node, parent, depth)) = stack.pop() {
        if depth > 64 {
            return Err(invalid("glTF node hierarchy deeper than 64"));
        }
        let world = parent.mul(&Mat4 { cols: node.transform().matrix() });
        for child in node.children() {
            stack.push((child, world, depth + 1));
        }
        let Some(mesh) = node.mesh() else { continue };
        let normal_matrix = world.normal_matrix();
        let m = &world.cols;
        let det = m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2])
            - m[1][0] * (m[0][1] * m[2][2] - m[2][1] * m[0][2])
            + m[2][0] * (m[0][1] * m[1][2] - m[1][1] * m[0][2]);
        for primitive in mesh.primitives() {
            if primitive.mode() != gltf::mesh::Mode::Triangles {
                continue; // points, lines and strips are not triangle lists
            }
            let reader = primitive.reader(|buffer| data.get(buffer.index()).map(Vec::as_slice));
            let Some(positions) = reader.read_positions() else { continue };
            let positions: Vec<[f32; 3]> =
                positions.map(|p| world.transform_point(Vec3::from_array(p)).to_array()).collect();
            let normals: Option<Vec<[f32; 3]>> = reader.read_normals().map(|n| {
                n.map(|v| {
                    mul_normal(&normal_matrix, Vec3::from_array(v)).normalize_or(Vec3::Y).to_array()
                })
                .collect()
            });
            let mut indices: Vec<u32> = match reader.read_indices() {
                Some(indices) => indices.into_u32().collect(),
                None => (0..positions.len() as u32).collect(),
            };
            if det < 0.0 {
                // A mirroring transform flips the winding.
                for tri in indices.chunks_exact_mut(3) {
                    tri.swap(1, 2);
                }
            }
            out.push(Node3d::Mesh {
                transform: Transform::IDENTITY,
                geometry: Geometry::Mesh {
                    normals: normals.filter(|n| n.len() == positions.len()),
                    positions,
                    indices,
                },
                material: gltf_material(&primitive.material(), fallback),
            });
        }
    }
    if out.is_empty() {
        return Err(invalid("glTF scene has no triangle meshes"));
    }
    Ok(out)
}

/// Summary of a model file, for agents and tools.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelInfo {
    /// Triangle meshes (one per primitive after import).
    pub meshes: usize,
    /// Vertices across all meshes.
    pub vertices: usize,
    /// Triangles across all meshes.
    pub triangles: usize,
    /// Bounding-box minimum corner.
    pub min: [f32; 3],
    /// Bounding-box maximum corner.
    pub max: [f32; 3],
    /// Bounding-sphere centre.
    pub center: [f32; 3],
    /// Bounding-sphere radius.
    pub radius: f32,
    /// Distinct materials, as resolved factors.
    pub materials: Vec<Material>,
}

/// Inspect imported nodes.
#[must_use]
pub fn inspect(nodes: &[Node3d]) -> ModelInfo {
    let mut info = ModelInfo {
        meshes: 0,
        vertices: 0,
        triangles: 0,
        min: [f32::MAX; 3],
        max: [f32::MIN; 3],
        center: [0.0; 3],
        radius: 0.0,
        materials: Vec::new(),
    };
    walk(nodes, &mut |world, geometry, material| {
        let Ok(mesh) = geometry.tessellate() else { return };
        info.meshes += 1;
        info.vertices += mesh.positions.len();
        info.triangles += mesh.triangle_count();
        for p in &mesh.positions {
            let w = world.transform_point(Vec3::from_array(*p));
            for (axis, v) in [w.x, w.y, w.z].into_iter().enumerate() {
                info.min[axis] = info.min[axis].min(v);
                info.max[axis] = info.max[axis].max(v);
            }
        }
        if !info.materials.contains(material) {
            info.materials.push(*material);
        }
    });
    if let Some((center, radius)) = bounds(nodes) {
        info.center = center.to_array();
        info.radius = radius;
    } else {
        info.min = [0.0; 3];
        info.max = [0.0; 3];
    }
    info
}

fn walk(nodes: &[Node3d], f: &mut dyn FnMut(&Mat4, &Geometry, &Material)) {
    fn visit(node: &Node3d, parent: &Mat4, f: &mut dyn FnMut(&Mat4, &Geometry, &Material)) {
        match node {
            Node3d::Group { transform, children } => {
                let world = parent.mul(&transform.matrix());
                for child in children {
                    visit(child, &world, f);
                }
            },
            Node3d::Mesh { transform, geometry, material } => {
                f(&parent.mul(&transform.matrix()), geometry, material);
            },
        }
    }
    for node in nodes {
        visit(node, &Mat4::IDENTITY, f);
    }
}

/// World-space bounding sphere `(center, radius)` of every mesh vertex under
/// `nodes`, or `None` when empty.
#[must_use]
pub fn bounds(nodes: &[Node3d]) -> Option<(Vec3, f32)> {
    let mut min = Vec3::new(f32::MAX, f32::MAX, f32::MAX);
    let mut max = Vec3::new(f32::MIN, f32::MIN, f32::MIN);
    let mut any = false;
    walk(nodes, &mut |world, geometry, _| {
        if let Ok(mesh) = geometry.tessellate() {
            for p in &mesh.positions {
                let w = world.transform_point(Vec3::from_array(*p));
                any = true;
                min = Vec3::new(min.x.min(w.x), min.y.min(w.y), min.z.min(w.z));
                max = Vec3::new(max.x.max(w.x), max.y.max(w.y), max.z.max(w.z));
            }
        }
    });
    any.then(|| (min.lerp(max, 0.5), max.sub(min).length() * 0.5))
}

/// Export nodes as binary glTF 2.0: every mesh is tessellated and baked to
/// world space, and paints (M3 roles included) are resolved against
/// `scheme` into linear PBR factors.
///
/// # Errors
/// [`ModelError::Invalid`] when a geometry cannot be tessellated or the
/// scene is empty.
pub fn write_glb(nodes: &[Node3d], scheme: &DynamicScheme) -> Result<Vec<u8>, ModelError> {
    let mut bin: Vec<u8> = Vec::new();
    let (mut accessors, mut views, mut meshes, mut materials, mut gnodes) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut material_index: Vec<Material> = Vec::new();
    let mut error = None;
    walk(nodes, &mut |world, geometry, material| {
        if error.is_some() {
            return;
        }
        let mesh = match geometry.tessellate() {
            Ok(mesh) => mesh,
            Err(e) => {
                error = Some(invalid(e.to_string()));
                return;
            },
        };
        let normal_matrix = world.normal_matrix();
        let positions: Vec<[f32; 3]> = mesh
            .positions
            .iter()
            .map(|p| world.transform_point(Vec3::from_array(*p)).to_array())
            .collect();
        let normals: Vec<[f32; 3]> = mesh
            .normals
            .iter()
            .map(|n| {
                mul_normal(&normal_matrix, Vec3::from_array(*n)).normalize_or(Vec3::Y).to_array()
            })
            .collect();
        let mut push_view = |bytes: &[u8], target: u32| -> usize {
            while bin.len() % 4 != 0 {
                bin.push(0);
            }
            let offset = bin.len();
            bin.extend_from_slice(bytes);
            views.push(json!({ "buffer": 0, "byteOffset": offset, "byteLength": bytes.len(), "target": target }));
            views.len() - 1
        };
        let floats = |v: &[[f32; 3]]| -> Vec<u8> {
            v.iter().flatten().flat_map(|f| f.to_le_bytes()).collect()
        };
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for p in &positions {
            for axis in 0..3 {
                lo[axis] = lo[axis].min(p[axis]);
                hi[axis] = hi[axis].max(p[axis]);
            }
        }
        let pos_view = push_view(&floats(&positions), 34962);
        accessors.push(json!({ "bufferView": pos_view, "componentType": 5126, "count": positions.len(), "type": "VEC3", "min": lo, "max": hi }));
        let pos_acc = accessors.len() - 1;
        let nrm_view = push_view(&floats(&normals), 34962);
        accessors.push(json!({ "bufferView": nrm_view, "componentType": 5126, "count": normals.len(), "type": "VEC3" }));
        let nrm_acc = accessors.len() - 1;
        let index_bytes: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
        let idx_view = push_view(&index_bytes, 34963);
        accessors.push(json!({ "bufferView": idx_view, "componentType": 5125, "count": mesh.indices.len(), "type": "SCALAR" }));
        let idx_acc = accessors.len() - 1;

        let mat = match material_index.iter().position(|m| m == material) {
            Some(i) => i,
            None => {
                let base = material.base.resolve(scheme);
                let lin = |c: u8| srgb_to_linear(f32::from(c) / 255.0);
                let alpha = f32::from(base.a) / 255.0 * material.opacity.clamp(0.0, 1.0);
                let mut m = json!({
                    "pbrMetallicRoughness": {
                        "baseColorFactor": [lin(base.r), lin(base.g), lin(base.b), alpha],
                        "metallicFactor": material.metallic.clamp(0.0, 1.0),
                        "roughnessFactor": material.roughness.clamp(0.0, 1.0),
                    },
                    "doubleSided": material.double_sided,
                });
                if alpha < 1.0 {
                    m["alphaMode"] = json!("BLEND");
                }
                if let Some(emissive) = material.emissive {
                    let e = emissive.resolve(scheme);
                    m["emissiveFactor"] = json!([lin(e.r), lin(e.g), lin(e.b)]);
                    if material.emissive_intensity != 1.0 {
                        m["extensions"] = json!({ "KHR_materials_emissive_strength": { "emissiveStrength": material.emissive_intensity } });
                    }
                }
                if material.unlit {
                    let ext = m.get("extensions").cloned().unwrap_or_else(|| json!({}));
                    let mut ext = ext;
                    ext["KHR_materials_unlit"] = json!({});
                    m["extensions"] = ext;
                }
                material_index.push(*material);
                materials.push(m);
                materials.len() - 1
            },
        };
        meshes.push(json!({ "primitives": [{ "attributes": { "POSITION": pos_acc, "NORMAL": nrm_acc }, "indices": idx_acc, "material": mat }] }));
        gnodes.push(json!({ "mesh": meshes.len() - 1 }));
    });
    if let Some(error) = error {
        return Err(error);
    }
    if gnodes.is_empty() {
        return Err(invalid("nothing to export"));
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let mut used = Vec::new();
    for m in &materials {
        if let Some(ext) = m.get("extensions").and_then(|e| e.as_object()) {
            for key in ext.keys() {
                if !used.contains(key) {
                    used.push(key.clone());
                }
            }
        }
    }
    let mut doc = json!({
        "asset": { "version": "2.0", "generator": "aphrody-render" },
        "scene": 0,
        "scenes": [{ "nodes": (0..gnodes.len()).collect::<Vec<_>>() }],
        "nodes": gnodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{ "byteLength": bin.len() }],
    });
    if !used.is_empty() {
        doc["extensionsUsed"] = json!(used);
    }
    let mut json_bytes = serde_json::to_vec(&doc).map_err(|e| invalid(e.to_string()))?;
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let total = 12 + 8 + json_bytes.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2_u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&json_bytes);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend_from_slice(&bin);
    Ok(out)
}

/// Options of [`studio_scene`].
#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize)]
#[serde(default)]
pub struct StudioOptions {
    /// Packed `0xAARRGGBB` M3 seed (role colours, lights).
    pub seed_argb: u32,
    /// Dark scheme.
    pub is_dark: bool,
    /// Clear colour; `None` renders a transparent background.
    pub background: Option<Paint>,
    /// Camera azimuth around +Y, degrees (0 looks from +Z).
    pub yaw_deg: f32,
    /// Camera elevation, degrees.
    pub pitch_deg: f32,
    /// Distance multiplier over the framing distance (1 = framed).
    pub zoom: f32,
    /// Vertical field of view, degrees.
    pub fov_y_deg: f32,
    /// Shadow mapping.
    pub shadows: bool,
}

impl Default for StudioOptions {
    fn default() -> Self {
        Self {
            seed_argb: 0xFF67_50A4,
            is_dark: false,
            background: None,
            yaw_deg: 35.0,
            pitch_deg: 15.0,
            zoom: 1.0,
            fov_y_deg: 35.0,
            shadows: true,
        }
    }
}

/// A turntable camera around a bounding sphere: `yaw`/`pitch` in degrees,
/// `zoom` scales the distance that frames the sphere.
#[must_use]
pub fn orbit_camera(
    center: Vec3,
    radius: f32,
    yaw_deg: f32,
    pitch_deg: f32,
    zoom: f32,
    fov_y_deg: f32,
) -> Camera {
    let radius = radius.max(1e-4);
    let fov = fov_y_deg.clamp(5.0, 150.0);
    let distance = radius * 1.15 / (fov.to_radians() * 0.5).sin() * zoom.clamp(0.05, 100.0);
    let (sy, cy) = yaw_deg.to_radians().sin_cos();
    let (sp, cp) = pitch_deg.clamp(-89.0, 89.0).to_radians().sin_cos();
    let eye = center.add(Vec3::new(cp * sy, sp, cp * cy).scale(distance));
    Camera {
        eye: eye.to_array(),
        target: center.to_array(),
        up: [0.0, 1.0, 0.0],
        projection: Projection::Perspective {
            fov_y_deg: fov,
            near: (distance - radius * 2.0).max(distance * 0.01),
            far: distance + radius * 4.0,
        },
    }
}

/// Stage `nodes` in an M3 "studio": hemisphere light from the surface roles,
/// a shadow-casting key light, a fill light and a framed orbit camera.
///
/// # Errors
/// [`ModelError::Invalid`] when the nodes contain no geometry.
pub fn studio_scene(
    nodes: Vec<Node3d>,
    width: u32,
    height: u32,
    options: &StudioOptions,
) -> Result<crate::scene3d::Scene3d, ModelError> {
    use aphrody_m3_tokens::facade::color::{Role, Variant};

    use crate::scene3d::{Light, Scene3d, ShadowSettings};

    let (center, radius) = bounds(&nodes).ok_or_else(|| invalid("the model has no geometry"))?;
    let white = Paint::Fixed(Rgba8 { r: 255, g: 255, b: 255, a: 255 });
    Ok(Scene3d {
        width,
        height,
        seed_argb: options.seed_argb,
        variant: Variant::TonalSpot,
        is_dark: options.is_dark,
        contrast_level: 0.0,
        background: options.background,
        samples: 4,
        camera: orbit_camera(
            center,
            radius,
            options.yaw_deg,
            options.pitch_deg,
            options.zoom,
            options.fov_y_deg,
        ),
        lights: vec![
            Light::Hemisphere {
                sky: Paint::Role(Role::SurfaceBright),
                ground: Paint::Role(Role::SurfaceContainerHighest),
                intensity: 0.55,
            },
            Light::Directional {
                direction: [-0.5, -1.0, -0.7],
                color: white,
                intensity: 2.8,
                cast_shadow: true,
            },
            Light::Directional {
                direction: [0.8, -0.2, 0.6],
                color: white,
                intensity: 0.8,
                cast_shadow: false,
            },
        ],
        shadows: ShadowSettings { enabled: options.shadows, resolution: 2048 },
        nodes,
    })
}

/// A perspective camera looking at the bounding sphere from `direction`
/// (from the target towards the eye), framing it with `margin` (1 = tight).
#[must_use]
pub fn frame_camera(
    center: Vec3,
    radius: f32,
    direction: Vec3,
    fov_y_deg: f32,
    margin: f32,
) -> Camera {
    let radius = radius.max(1e-4);
    let distance = radius * margin / (fov_y_deg.to_radians() * 0.5).sin();
    let dir = direction.normalize_or(Vec3::new(0.0, 0.0, 1.0));
    Camera {
        eye: center.add(dir.scale(distance)).to_array(),
        target: center.to_array(),
        up: [0.0, 1.0, 0.0],
        projection: Projection::Perspective {
            fov_y_deg,
            near: (distance - radius * 1.5).max(distance * 0.01),
            far: distance + radius * 1.5,
        },
    }
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::facade::color::{Role, Variant};

    use super::*;

    fn fallback() -> Material {
        Material {
            base: Paint::Role(Role::Primary),
            metallic: 0.0,
            roughness: 0.5,
            emissive: None,
            emissive_intensity: 1.0,
            opacity: 1.0,
            unlit: false,
            double_sided: false,
            cast_shadow: true,
        }
    }

    fn scheme() -> DynamicScheme {
        DynamicScheme::from_argb(0xFF67_50A4, Variant::TonalSpot, false, 0.0)
    }

    #[test]
    fn obj_quads_are_triangulated() {
        let obj = b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1 4//1\n";
        let nodes = parse_obj(obj, fallback()).expect("valid OBJ");
        let info = inspect(&nodes);
        assert_eq!((info.meshes, info.vertices, info.triangles), (1, 4, 2));
        assert!(parse_obj(b"v 0 0 0\n", fallback()).is_err());
    }

    #[test]
    fn glb_export_round_trips_through_the_gltf_crate() {
        let scene = crate::fixtures::showcase_scene3d(64, 64);
        let glb = write_glb(&scene.nodes, &scheme()).expect("export");
        assert_eq!(&glb[..4], b"glTF");
        let back = parse_gltf(&glb, None, fallback()).expect("re-import");
        let (a, b) = (inspect(&scene.nodes), inspect(&back));
        assert_eq!((a.meshes, a.vertices, a.triangles), (b.meshes, b.vertices, b.triangles));
        for axis in 0..3 {
            assert!((a.min[axis] - b.min[axis]).abs() < 1e-4);
            assert!((a.max[axis] - b.max[axis]).abs() < 1e-4);
        }
        // Materials survive: a transparent one and a metallic one exist.
        assert!(b.materials.iter().any(|m| m.opacity < 1.0));
        assert!(b.materials.iter().any(|m| m.metallic > 0.5));
    }

    #[test]
    fn glb_base_colour_round_trips_to_the_same_srgb_bytes() {
        let red =
            Material { base: Paint::Fixed(Rgba8 { r: 200, g: 30, b: 60, a: 255 }), ..fallback() };
        let nodes = vec![Node3d::Mesh {
            transform: Transform { translation: [1.0, 2.0, 3.0], ..Transform::IDENTITY },
            geometry: Geometry::Box { size: [1.0; 3] },
            material: red,
        }];
        let back = parse_gltf(&write_glb(&nodes, &scheme()).expect("export"), None, fallback())
            .expect("import");
        let Node3d::Mesh { material, .. } = &back[0] else { panic!("mesh") };
        assert_eq!(material.base, red.base);
        let (center, _) = bounds(&back).expect("bounds");
        assert!((center.x - 1.0).abs() < 1e-5 && (center.z - 3.0).abs() < 1e-5);
    }

    #[test]
    fn framing_puts_the_whole_sphere_in_view() {
        let cam = frame_camera(Vec3::new(1.0, 2.0, 3.0), 2.0, Vec3::new(0.0, 0.0, 1.0), 40.0, 1.1);
        let Projection::Perspective { near, far, .. } = cam.projection else { panic!() };
        let d = Vec3::from_array(cam.eye).sub(Vec3::new(1.0, 2.0, 3.0)).length();
        assert!(near < d - 2.0 && far > d + 2.0);
        assert!(bounds(&[]).is_none());
    }
}
