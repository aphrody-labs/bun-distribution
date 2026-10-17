// SPDX-License-Identifier: Apache-2.0
//! Retained M3 3D scene model and its backend-independent preparation.
//!
//! A [`Scene3d`] is a tree of [`Node3d`] groups and meshes seen through one
//! [`Camera`] and lit by [`Light`]s. Colours are [`Paint`]s, so materials and
//! lights resolve against the same M3 [`DynamicScheme`] as the 2D
//! [`crate::scene::Scene`]: one scene renders correctly in light, dark or
//! any seed/variant without rebuilding the tree.
//!
//! [`Scene3d::prepare`] is the single place where the tree is interpreted.
//! It flattens the hierarchy into world-space instances, resolves colours to
//! linear light, tessellates (deduplicated through [`MeshCache`]), culls
//! instances outside the view frustum, and groups the survivors into
//! instanced draw batches: opaque batches sorted by pipeline and mesh, then
//! transparent instances back to front. Both [`crate::raster3d`] (CPU) and
//! `crate::gpu3d` (feature `gpu`) consume that exact [`Prepared3d`], which
//! is what keeps them in pixel parity.

use std::{collections::HashMap, sync::Arc};

use aphrody_m3_tokens::facade::color::{DynamicScheme, Variant};
use serde::{Deserialize, Serialize};

use crate::{
    math3d::{Mat4, Vec3, srgb_to_linear},
    mesh3d::{Geometry, MeshCache, MeshData, MeshError},
    scene::{Paint, Rgba8, default_variant, deserialize_variant, serialize_variant},
};

/// Maximum number of directional + point lights per scene.
pub const MAX_LIGHTS: usize = 16;
/// Maximum group nesting depth.
pub const MAX_DEPTH: usize = 64;
/// Maximum canvas edge, in pixels.
pub const MAX_EDGE: u32 = 16_384;

/// Local transform: `T * R * S`, rotation as XYZ Euler angles in degrees.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    /// Translation.
    #[serde(default)]
    pub translation: [f32; 3],
    /// Rotation, XYZ Euler angles in degrees (three.js `XYZ` order).
    #[serde(default)]
    pub rotation_deg: [f32; 3],
    /// Scale.
    #[serde(default = "unit3")]
    pub scale: [f32; 3],
}

const fn unit3() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}

impl Default for Transform {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Transform {
    /// The identity transform.
    pub const IDENTITY: Self = Self {
        translation: [0.0; 3],
        rotation_deg: [0.0; 3],
        scale: [1.0; 3],
    };

    /// The local matrix.
    #[must_use]
    pub fn matrix(&self) -> Mat4 {
        Mat4::from_trs(
            Vec3::from_array(self.translation),
            Vec3::from_array(self.rotation_deg),
            Vec3::from_array(self.scale),
        )
    }
}

/// Camera projection.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Projection {
    /// Perspective projection.
    Perspective {
        /// Vertical field of view, in degrees.
        #[serde(default = "default_fov")]
        fov_y_deg: f32,
        /// Near clip distance.
        #[serde(default = "default_near")]
        near: f32,
        /// Far clip distance.
        #[serde(default = "default_far")]
        far: f32,
    },
    /// Orthographic projection.
    Orthographic {
        /// Visible height in world units.
        #[serde(default = "default_ortho_height")]
        height: f32,
        /// Near clip distance.
        #[serde(default = "default_near")]
        near: f32,
        /// Far clip distance.
        #[serde(default = "default_far")]
        far: f32,
    },
}

const fn default_fov() -> f32 {
    50.0
}
const fn default_near() -> f32 {
    0.1
}
const fn default_far() -> f32 {
    100.0
}
const fn default_ortho_height() -> f32 {
    4.0
}

impl Default for Projection {
    fn default() -> Self {
        Self::Perspective {
            fov_y_deg: default_fov(),
            near: default_near(),
            far: default_far(),
        }
    }
}

/// A look-at camera.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    /// Eye position.
    #[serde(default = "default_eye")]
    pub eye: [f32; 3],
    /// Point looked at.
    #[serde(default)]
    pub target: [f32; 3],
    /// Up direction.
    #[serde(default = "default_up")]
    pub up: [f32; 3],
    /// Projection.
    #[serde(default)]
    pub projection: Projection,
}

const fn default_eye() -> [f32; 3] {
    [0.0, 0.0, 5.0]
}
const fn default_up() -> [f32; 3] {
    [0.0, 1.0, 0.0]
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            eye: default_eye(),
            target: [0.0; 3],
            up: default_up(),
            projection: Projection::default(),
        }
    }
}

impl Camera {
    /// `projection * view` for a viewport of the given aspect ratio.
    #[must_use]
    pub fn view_proj(&self, aspect: f32) -> Mat4 {
        let view = Mat4::look_at(
            Vec3::from_array(self.eye),
            Vec3::from_array(self.target),
            Vec3::from_array(self.up),
        );
        let proj = match self.projection {
            Projection::Perspective {
                fov_y_deg,
                near,
                far,
            } => Mat4::perspective(fov_y_deg.to_radians(), aspect, near, far),
            Projection::Orthographic { height, near, far } => {
                Mat4::orthographic(height, aspect, near, far)
            }
        };
        proj.mul(&view)
    }
}

/// A light source. Intensities are linear multipliers of the resolved colour.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "light", rename_all = "snake_case")]
pub enum Light {
    /// Uniform ambient light (diffuse and environment specular).
    Ambient {
        /// Colour.
        color: Paint,
        /// Intensity.
        #[serde(default = "one")]
        intensity: f32,
    },
    /// Sky/ground gradient ambient light (three.js `HemisphereLight`).
    Hemisphere {
        /// Colour seen by upward-facing surfaces.
        sky: Paint,
        /// Colour seen by downward-facing surfaces.
        ground: Paint,
        /// Intensity.
        #[serde(default = "one")]
        intensity: f32,
    },
    /// Infinitely distant light.
    Directional {
        /// Direction the light travels (from the light towards the scene).
        direction: [f32; 3],
        /// Colour.
        color: Paint,
        /// Intensity.
        #[serde(default = "pi")]
        intensity: f32,
        /// Cast shadow-mapped shadows. Only the first casting directional
        /// light is shadowed (see [`ShadowSettings`]).
        #[serde(default = "yes")]
        cast_shadow: bool,
    },
    /// Omnidirectional point light.
    Point {
        /// World position.
        position: [f32; 3],
        /// Colour.
        color: Paint,
        /// Intensity.
        #[serde(default = "pi")]
        intensity: f32,
        /// Distance at which the light fades to zero (`0` = unbounded).
        #[serde(default)]
        range: f32,
    },
}

const fn one() -> f32 {
    1.0
}
const fn pi() -> f32 {
    std::f32::consts::PI
}
const fn yes() -> bool {
    true
}

/// Shadow-map configuration for the shadow-casting directional light.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShadowSettings {
    /// Enable shadows.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Square shadow-map resolution, clamped to `[256, 4096]`.
    #[serde(default = "default_shadow_resolution")]
    pub resolution: u32,
}

const fn default_shadow_resolution() -> u32 {
    2048
}

impl Default for ShadowSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution: default_shadow_resolution(),
        }
    }
}

/// A physically based (metallic/roughness) material.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    /// Base colour; its alpha multiplies `opacity`.
    pub base: Paint,
    /// Metalness in `[0, 1]`.
    #[serde(default)]
    pub metallic: f32,
    /// Perceptual roughness in `[0, 1]`.
    #[serde(default = "default_roughness")]
    pub roughness: f32,
    /// Optional emissive colour.
    #[serde(default)]
    pub emissive: Option<Paint>,
    /// Emissive multiplier.
    #[serde(default = "one")]
    pub emissive_intensity: f32,
    /// Opacity in `[0, 1]`; below `1` the mesh is drawn in the sorted
    /// transparent pass.
    #[serde(default = "one")]
    pub opacity: f32,
    /// Ignore lights and output the base colour exactly (M3 flat tone).
    #[serde(default)]
    pub unlit: bool,
    /// Render back faces too (with flipped normals).
    #[serde(default)]
    pub double_sided: bool,
    /// Cast shadows (every opaque mesh receives them). Disable it for large
    /// receivers such as floors so the shadow map stays tightly fitted.
    #[serde(default = "yes")]
    pub cast_shadow: bool,
}

const fn default_roughness() -> f32 {
    0.5
}

/// A scene-graph node.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum Node3d {
    /// A transform group; children inherit its transform.
    Group {
        /// Local transform.
        #[serde(default)]
        transform: Transform,
        /// Child nodes.
        #[serde(default)]
        children: Vec<Node3d>,
    },
    /// A renderable mesh.
    Mesh {
        /// Local transform.
        #[serde(default)]
        transform: Transform,
        /// Geometry.
        geometry: Geometry,
        /// Material.
        material: Material,
    },
}

/// A retained, backend-independent M3 3D scene.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(bound(deserialize = ""))]
pub struct Scene3d {
    /// Canvas width, in physical pixels.
    pub width: u32,
    /// Canvas height, in physical pixels.
    pub height: u32,
    /// Packed ARGB seed colour (`0xAARRGGBB`) used to derive the scheme.
    pub seed_argb: u32,
    /// Colour scheme variant.
    #[serde(
        default = "default_variant",
        serialize_with = "serialize_variant",
        deserialize_with = "deserialize_variant"
    )]
    pub variant: Variant,
    /// Whether to resolve the dark scheme.
    #[serde(default)]
    pub is_dark: bool,
    /// M3 contrast level in `[-1, 1]`.
    #[serde(default)]
    pub contrast_level: f64,
    /// Clear colour (`None` leaves the canvas transparent).
    #[serde(default)]
    pub background: Option<Paint>,
    /// Multisample count: `1` (aliased) or `4` (4x MSAA, the default).
    #[serde(default = "default_samples")]
    pub samples: u32,
    /// Camera.
    #[serde(default)]
    pub camera: Camera,
    /// Lights.
    #[serde(default)]
    pub lights: Vec<Light>,
    /// Shadow mapping.
    #[serde(default)]
    pub shadows: ShadowSettings,
    /// Root nodes.
    #[serde(default)]
    pub nodes: Vec<Node3d>,
}

const fn default_samples() -> u32 {
    4
}

/// Why a scene could not be prepared.
#[derive(Clone, Debug, PartialEq)]
pub enum Scene3dError {
    /// Zero, oversized or overflowing canvas dimensions.
    InvalidDimensions {
        /// Requested width.
        width: u32,
        /// Requested height.
        height: u32,
    },
    /// `samples` is not 1 or 4.
    InvalidSamples(u32),
    /// The camera is degenerate or non-finite.
    InvalidCamera,
    /// A transform, light or material value is non-finite.
    NonFinite(&'static str),
    /// More than [`MAX_LIGHTS`] directional/point lights.
    TooManyLights(usize),
    /// Groups nested deeper than [`MAX_DEPTH`].
    TooDeep,
    /// A geometry could not be tessellated.
    Mesh(MeshError),
}

impl std::fmt::Display for Scene3dError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDimensions { width, height } => {
                write!(f, "invalid 3D canvas dimensions {width}x{height}")
            }
            Self::InvalidSamples(n) => write!(f, "unsupported sample count {n} (use 1 or 4)"),
            Self::InvalidCamera => write!(f, "degenerate or non-finite camera"),
            Self::NonFinite(what) => write!(f, "non-finite value in {what}"),
            Self::TooManyLights(n) => write!(f, "{n} lights exceeds the {MAX_LIGHTS} limit"),
            Self::TooDeep => write!(f, "scene graph deeper than {MAX_DEPTH} levels"),
            Self::Mesh(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for Scene3dError {}

impl From<MeshError> for Scene3dError {
    fn from(err: MeshError) -> Self {
        Self::Mesh(err)
    }
}

/// A resolved light in linear RGB, colour already multiplied by intensity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PreparedLight {
    /// Directional light; `to_light` points from the surface to the light.
    Directional {
        /// Unit direction towards the light.
        to_light: Vec3,
        /// Linear radiance.
        radiance: [f32; 3],
    },
    /// Point light.
    Point {
        /// World position.
        position: Vec3,
        /// Linear radiance at unit distance.
        radiance: [f32; 3],
        /// Fade-out range (`0` = unbounded).
        range: f32,
    },
}

/// One world-space mesh instance with its resolved material.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Instance {
    /// Local-to-world matrix.
    pub model: Mat4,
    /// Row-major inverse-transpose of the model's 3x3 block.
    pub normal: [[f32; 3]; 3],
    /// Linear base colour.
    pub base: [f32; 3],
    /// Final alpha (`base.a * opacity`).
    pub alpha: f32,
    /// Linear emissive radiance.
    pub emissive: [f32; 3],
    /// Metalness.
    pub metallic: f32,
    /// Perceptual roughness.
    pub roughness: f32,
    /// Unlit material.
    pub unlit: bool,
}

/// A run of instances sharing one mesh and one pipeline state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DrawBatch {
    /// Index into [`Prepared3d::meshes`].
    pub mesh: usize,
    /// First instance in [`Prepared3d::instances`].
    pub first_instance: u32,
    /// Number of instances.
    pub instance_count: u32,
    /// Back faces are drawn (no culling).
    pub double_sided: bool,
    /// Alpha-blended without depth writes.
    pub transparent: bool,
    /// Instances cast shadows.
    pub cast_shadow: bool,
}

/// Light-space projection and bias of the shadow-casting directional light.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowSetup {
    /// Index into [`Prepared3d::lights`] of the shadowed light.
    pub light: usize,
    /// Orthographic light `projection * view`, fitted to the casters.
    pub view_proj: Mat4,
    /// Shadow-map edge, in texels.
    pub resolution: u32,
    /// World-space normal offset applied before the lookup (acne control).
    pub normal_offset: f32,
    /// Constant depth bias, in light NDC depth units.
    pub depth_bias: f32,
}

/// A fully resolved frame, consumed identically by every 3D backend.
#[derive(Clone, Debug)]
pub struct Prepared3d {
    /// Canvas width, in pixels.
    pub width: u32,
    /// Canvas height, in pixels.
    pub height: u32,
    /// Sample count (1 or 4).
    pub samples: u32,
    /// Clear colour (sRGB-encoded straight alpha), if any.
    pub clear: Option<Rgba8>,
    /// `projection * view`.
    pub view_proj: Mat4,
    /// Eye position (for specular).
    pub eye: Vec3,
    /// Linear ambient radiance seen by upward normals (ambient + hemisphere
    /// sky).
    pub sky: [f32; 3],
    /// Linear ambient radiance seen by downward normals (ambient +
    /// hemisphere ground).
    pub ground: [f32; 3],
    /// Directional and point lights.
    pub lights: Vec<PreparedLight>,
    /// Shadow map setup, when a directional light casts shadows.
    pub shadow: Option<ShadowSetup>,
    /// Batches of opaque shadow casters (visible and frustum-culled) for the
    /// shadow pass.
    pub shadow_batches: Vec<DrawBatch>,
    /// Distinct meshes referenced by `batches`.
    pub meshes: Vec<Arc<MeshData>>,
    /// Cache key of each entry of `meshes`.
    pub mesh_keys: Vec<u64>,
    /// Instances, laid out in draw order.
    pub instances: Vec<Instance>,
    /// Draw batches in submission order.
    pub batches: Vec<DrawBatch>,
    /// Instances rejected by frustum culling.
    pub culled: usize,
}

impl Prepared3d {
    /// Total triangles submitted across all batches.
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.batches
            .iter()
            .map(|b| self.meshes[b.mesh].triangle_count() * b.instance_count as usize)
            .sum()
    }
}

fn linear(rgba: Rgba8) -> [f32; 3] {
    [rgba.r, rgba.g, rgba.b].map(|c| srgb_to_linear(f32::from(c) / 255.0))
}

fn finite3(v: [f32; 3], what: &'static str) -> Result<(), Scene3dError> {
    if v.iter().all(|c| c.is_finite()) {
        Ok(())
    } else {
        Err(Scene3dError::NonFinite(what))
    }
}

struct Pending {
    mesh: usize,
    instance: Instance,
    double_sided: bool,
    transparent: bool,
    view_depth: f32,
    world_center: Vec3,
    world_radius: f32,
    cast_shadow: bool,
}

impl Scene3d {
    /// Build the [`DynamicScheme`] this scene resolves colours against.
    #[must_use]
    pub fn scheme(&self) -> DynamicScheme {
        DynamicScheme::from_argb(
            self.seed_argb,
            self.variant,
            self.is_dark,
            self.contrast_level,
        )
    }

    /// Prepare with a throwaway mesh cache.
    ///
    /// # Errors
    /// See [`Scene3d::prepare_with`].
    pub fn prepare(&self) -> Result<Prepared3d, Scene3dError> {
        self.prepare_with(&mut MeshCache::new())
    }

    /// Validate, flatten, resolve, cull and batch the scene, sharing
    /// tessellation through `cache`.
    ///
    /// # Errors
    /// Returns [`Scene3dError`] for invalid dimensions, sample counts,
    /// cameras, non-finite values, too many lights, excessive nesting or
    /// invalid geometry. Nothing is rendered from a scene that fails here.
    pub fn prepare_with(&self, cache: &mut MeshCache) -> Result<Prepared3d, Scene3dError> {
        let (width, height) = (self.width, self.height);
        if width == 0
            || height == 0
            || width > MAX_EDGE
            || height > MAX_EDGE
            || crate::rgba8_len(width, height).is_none()
        {
            return Err(Scene3dError::InvalidDimensions { width, height });
        }
        if self.samples != 1 && self.samples != 4 {
            return Err(Scene3dError::InvalidSamples(self.samples));
        }
        let camera = &self.camera;
        finite3(camera.eye, "camera.eye")?;
        finite3(camera.target, "camera.target")?;
        finite3(camera.up, "camera.up")?;
        let (near, far) = match camera.projection {
            Projection::Perspective {
                fov_y_deg,
                near,
                far,
            } => {
                if !(fov_y_deg.is_finite() && fov_y_deg > 0.0 && fov_y_deg < 180.0) {
                    return Err(Scene3dError::InvalidCamera);
                }
                (near, far)
            }
            Projection::Orthographic { height, near, far } => {
                if !(height.is_finite() && height > 0.0) {
                    return Err(Scene3dError::InvalidCamera);
                }
                (near, far)
            }
        };
        let perspective = matches!(camera.projection, Projection::Perspective { .. });
        if !(near.is_finite() && far.is_finite() && far > near && (!perspective || near > 0.0))
            || Vec3::from_array(camera.eye)
                .sub(Vec3::from_array(camera.target))
                .length()
                < 1e-9
        {
            return Err(Scene3dError::InvalidCamera);
        }
        let view_proj = camera.view_proj(width as f32 / height as f32);
        if !view_proj.is_finite() {
            return Err(Scene3dError::InvalidCamera);
        }

        let scheme = self.scheme();
        let mut sky = [0.0_f32; 3];
        let mut ground = [0.0_f32; 3];
        let mut lights = Vec::new();
        let mut shadow_light: Option<(usize, Vec3)> = None;
        for light in &self.lights {
            match *light {
                Light::Ambient { color, intensity } => {
                    if !intensity.is_finite() {
                        return Err(Scene3dError::NonFinite("light.intensity"));
                    }
                    let c = linear(color.resolve(&scheme));
                    for i in 0..3 {
                        sky[i] += c[i] * intensity;
                        ground[i] += c[i] * intensity;
                    }
                }
                Light::Hemisphere {
                    sky: top,
                    ground: bottom,
                    intensity,
                } => {
                    if !intensity.is_finite() {
                        return Err(Scene3dError::NonFinite("light.intensity"));
                    }
                    let (t, b) = (
                        linear(top.resolve(&scheme)),
                        linear(bottom.resolve(&scheme)),
                    );
                    for i in 0..3 {
                        sky[i] += t[i] * intensity;
                        ground[i] += b[i] * intensity;
                    }
                }
                Light::Directional {
                    direction,
                    color,
                    intensity,
                    cast_shadow,
                } => {
                    finite3(direction, "light.direction")?;
                    if !intensity.is_finite() {
                        return Err(Scene3dError::NonFinite("light.intensity"));
                    }
                    let c = linear(color.resolve(&scheme));
                    let to_light = Vec3::from_array(direction)
                        .scale(-1.0)
                        .normalize_or(Vec3::Y);
                    if cast_shadow && shadow_light.is_none() {
                        shadow_light = Some((lights.len(), to_light));
                    }
                    lights.push(PreparedLight::Directional {
                        to_light,
                        radiance: c.map(|v| v * intensity),
                    });
                }
                Light::Point {
                    position,
                    color,
                    intensity,
                    range,
                } => {
                    finite3(position, "light.position")?;
                    if !(intensity.is_finite() && range.is_finite()) {
                        return Err(Scene3dError::NonFinite("light.intensity"));
                    }
                    let c = linear(color.resolve(&scheme));
                    lights.push(PreparedLight::Point {
                        position: Vec3::from_array(position),
                        radiance: c.map(|v| v * intensity),
                        range: range.max(0.0),
                    });
                }
            }
        }
        if lights.len() > MAX_LIGHTS {
            return Err(Scene3dError::TooManyLights(lights.len()));
        }

        let planes = frustum_planes(&view_proj);
        let mut meshes: Vec<Arc<MeshData>> = Vec::new();
        let mut mesh_keys: Vec<u64> = Vec::new();
        let mut mesh_index: HashMap<u64, usize> = HashMap::new();
        let mut pending: Vec<Pending> = Vec::new();
        let mut casters_only: Vec<Pending> = Vec::new();
        let mut culled = 0_usize;
        let shadows_on = self.shadows.enabled && shadow_light.is_some();
        let mut ctx = Flatten {
            scheme: &scheme,
            cache,
            planes: &planes,
            view_proj: &view_proj,
            meshes: &mut meshes,
            mesh_keys: &mut mesh_keys,
            mesh_index: &mut mesh_index,
            pending: &mut pending,
            casters_only: shadows_on.then_some(&mut casters_only),
            culled: &mut culled,
        };
        for node in &self.nodes {
            ctx.visit(node, &Mat4::IDENTITY, 0)?;
        }

        // Fit an off-centre orthographic light frustum tightly around the
        // opaque casters, in light space.
        let shadow = shadow_light
            .filter(|_| shadows_on)
            .and_then(|(light, to_light)| {
                let casters: Vec<&Pending> = pending
                    .iter()
                    .chain(&casters_only)
                    .filter(|p| !p.transparent && p.cast_shadow)
                    .collect();
                if casters.is_empty() {
                    return None;
                }
                let (mut lo, mut hi) = (
                    Vec3::new(f32::MAX, f32::MAX, f32::MAX),
                    Vec3::new(f32::MIN, f32::MIN, f32::MIN),
                );
                for p in &casters {
                    let (c, r) = (p.world_center, p.world_radius);
                    lo = Vec3::new(lo.x.min(c.x - r), lo.y.min(c.y - r), lo.z.min(c.z - r));
                    hi = Vec3::new(hi.x.max(c.x + r), hi.y.max(c.y + r), hi.z.max(c.z + r));
                }
                let center = lo.lerp(hi, 0.5);
                let reach = hi.sub(lo).length().max(2e-3);
                let view = Mat4::look_at(center.add(to_light.scale(reach)), center, Vec3::Y);
                let (mut min, mut max) = (
                    Vec3::new(f32::MAX, f32::MAX, f32::MAX),
                    Vec3::new(f32::MIN, f32::MIN, f32::MIN),
                );
                for p in &casters {
                    let c = view.transform_point(p.world_center);
                    let r = p.world_radius;
                    min = Vec3::new(min.x.min(c.x - r), min.y.min(c.y - r), min.z.min(c.z - r));
                    max = Vec3::new(max.x.max(c.x + r), max.y.max(c.y + r), max.z.max(c.z + r));
                }
                // View space looks down -Z: depth = -z.
                let (near, far) = ((-max.z).max(1e-4), (-min.z).max(2e-4));
                let extent = (max.x - min.x).max(max.y - min.y).max(1e-3);
                let resolution = self.shadows.resolution.clamp(256, 4096);
                let view_proj =
                    Mat4::orthographic_off_center(min.x, max.x, min.y, max.y, near, far).mul(&view);
                let texel = extent / resolution as f32;
                Some(ShadowSetup {
                    light,
                    view_proj,
                    resolution,
                    normal_offset: texel * 1.5,
                    depth_bias: texel / (far - near),
                })
            });

        // Opaque first, grouped by pipeline state then mesh (stable, so the
        // scene order breaks ties identically on every backend); then
        // transparent back to front.
        let (mut opaque, mut transparent): (Vec<Pending>, Vec<Pending>) =
            pending.into_iter().partition(|p| !p.transparent);
        // Within a batch, front to back: maximises early-Z rejection.
        opaque.sort_by(|a, b| {
            (a.double_sided, a.mesh, !a.cast_shadow)
                .cmp(&(b.double_sided, b.mesh, !b.cast_shadow))
                .then(a.view_depth.total_cmp(&b.view_depth))
        });
        transparent.sort_by(|a, b| b.view_depth.total_cmp(&a.view_depth));

        let mut instances = Vec::with_capacity(opaque.len() + transparent.len());
        let mut batches: Vec<DrawBatch> = Vec::new();
        for p in opaque.into_iter().chain(transparent) {
            let index = instances.len() as u32;
            instances.push(p.instance);
            match batches.last_mut() {
                Some(b)
                    if b.mesh == p.mesh
                        && b.double_sided == p.double_sided
                        && b.transparent == p.transparent
                        && b.cast_shadow == p.cast_shadow =>
                {
                    b.instance_count += 1;
                }
                _ => batches.push(DrawBatch {
                    mesh: p.mesh,
                    first_instance: index,
                    instance_count: 1,
                    double_sided: p.double_sided,
                    transparent: p.transparent,
                    cast_shadow: p.cast_shadow,
                }),
            }
        }

        // Shadow casters: the visible opaque batches, then frustum-culled
        // opaque instances (appended after the visible ones, grouped by mesh).
        let mut shadow_batches = Vec::new();
        if shadow.is_some() {
            shadow_batches.extend(
                batches
                    .iter()
                    .copied()
                    .filter(|b| !b.transparent && b.cast_shadow),
            );
            casters_only.sort_by_key(|p| p.mesh);
            for p in casters_only {
                let index = instances.len() as u32;
                instances.push(p.instance);
                match shadow_batches.last_mut() {
                    Some(b) if b.mesh == p.mesh && b.first_instance + b.instance_count == index => {
                        b.instance_count += 1;
                    }
                    _ => shadow_batches.push(DrawBatch {
                        mesh: p.mesh,
                        first_instance: index,
                        instance_count: 1,
                        double_sided: true,
                        transparent: false,
                        cast_shadow: true,
                    }),
                }
            }
        }

        Ok(Prepared3d {
            width,
            height,
            samples: self.samples,
            clear: self.background.map(|p| p.resolve(&scheme)),
            view_proj,
            eye: Vec3::from_array(camera.eye),
            sky,
            ground,
            lights,
            shadow,
            shadow_batches,
            meshes,
            mesh_keys,
            instances,
            batches,
            culled,
        })
    }
}

struct Flatten<'a> {
    scheme: &'a DynamicScheme,
    cache: &'a mut MeshCache,
    planes: &'a [[f32; 4]; 6],
    view_proj: &'a Mat4,
    meshes: &'a mut Vec<Arc<MeshData>>,
    mesh_keys: &'a mut Vec<u64>,
    mesh_index: &'a mut HashMap<u64, usize>,
    pending: &'a mut Vec<Pending>,
    /// Opaque instances outside the camera frustum that still cast shadows
    /// (`None` when shadows are off).
    casters_only: Option<&'a mut Vec<Pending>>,
    culled: &'a mut usize,
}

impl Flatten<'_> {
    fn visit(&mut self, node: &Node3d, parent: &Mat4, depth: usize) -> Result<(), Scene3dError> {
        if depth >= MAX_DEPTH {
            return Err(Scene3dError::TooDeep);
        }
        match node {
            Node3d::Group {
                transform,
                children,
            } => {
                let world = parent.mul(&transform.matrix());
                if !world.is_finite() {
                    return Err(Scene3dError::NonFinite("group.transform"));
                }
                for child in children {
                    self.visit(child, &world, depth + 1)?;
                }
            }
            Node3d::Mesh {
                transform,
                geometry,
                material,
            } => {
                let model = parent.mul(&transform.matrix());
                if !model.is_finite() {
                    return Err(Scene3dError::NonFinite("mesh.transform"));
                }
                let m = material;
                if ![m.metallic, m.roughness, m.opacity, m.emissive_intensity]
                    .iter()
                    .all(|v| v.is_finite())
                {
                    return Err(Scene3dError::NonFinite("material"));
                }
                let base = m.base.resolve(self.scheme);
                let alpha = (f32::from(base.a) / 255.0) * m.opacity.clamp(0.0, 1.0);
                if alpha <= 0.0 {
                    return Ok(());
                }
                let (key, mesh) = self.cache.get(geometry)?;
                if mesh.indices.is_empty() {
                    return Ok(());
                }
                // Frustum cull against the world-space bounding sphere.
                let center = model.transform_point(Vec3::from_array(mesh.bounds_center));
                let max_scale = (0..3)
                    .map(|c| {
                        Vec3::new(model.cols[c][0], model.cols[c][1], model.cols[c][2]).length()
                    })
                    .fold(0.0_f32, f32::max);
                let radius = mesh.bounds_radius * max_scale;
                let outside = self
                    .planes
                    .iter()
                    .any(|p| p[0] * center.x + p[1] * center.y + p[2] * center.z + p[3] < -radius);
                let transparent = alpha < 1.0;
                if outside {
                    *self.culled += 1;
                    // Invisible, but an opaque mesh may still shadow the view.
                    if transparent || !m.cast_shadow || self.casters_only.is_none() {
                        return Ok(());
                    }
                }
                let mesh_index = *self.mesh_index.entry(key).or_insert_with(|| {
                    self.mesh_keys.push(key);
                    self.meshes.push(mesh);
                    self.meshes.len() - 1
                });
                let emissive = m
                    .emissive
                    .map(|p| {
                        linear(p.resolve(self.scheme)).map(|c| c * m.emissive_intensity.max(0.0))
                    })
                    .unwrap_or([0.0; 3]);
                let clip = self.view_proj.transform_point4(center);
                let entry = Pending {
                    mesh: mesh_index,
                    instance: Instance {
                        model,
                        normal: model.normal_matrix(),
                        base: linear(base),
                        alpha,
                        emissive,
                        metallic: m.metallic.clamp(0.0, 1.0),
                        roughness: m.roughness.clamp(0.0, 1.0),
                        unlit: m.unlit,
                    },
                    double_sided: m.double_sided,
                    transparent,
                    view_depth: clip[3],
                    world_center: center,
                    world_radius: radius,
                    cast_shadow: m.cast_shadow,
                };
                match (outside, self.casters_only.as_deref_mut()) {
                    (true, Some(casters)) => casters.push(entry),
                    _ => self.pending.push(entry),
                }
            }
        }
        Ok(())
    }
}

/// World-space frustum planes `(a, b, c, d)` with inward normals, extracted
/// from a wgpu-convention (`0 <= z <= w`) `view_proj`. Planes are normalised
/// so signed distances are in world units.
#[must_use]
pub fn frustum_planes(view_proj: &Mat4) -> [[f32; 4]; 6] {
    let row = |r: usize| -> [f32; 4] {
        [
            view_proj.cols[0][r],
            view_proj.cols[1][r],
            view_proj.cols[2][r],
            view_proj.cols[3][r],
        ]
    };
    let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
    let add = |a: [f32; 4], b: [f32; 4]| [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
    let sub = |a: [f32; 4], b: [f32; 4]| [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
    let planes = [
        add(r3, r0),
        sub(r3, r0),
        add(r3, r1),
        sub(r3, r1),
        r2,
        sub(r3, r2),
    ];
    planes.map(|p| {
        let len = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
        if len > 0.0 { p.map(|v| v / len) } else { p }
    })
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::facade::color::Role;

    use super::*;

    fn mesh(translation: [f32; 3], opacity: f32, geometry: Geometry) -> Node3d {
        Node3d::Mesh {
            transform: Transform {
                translation,
                ..Transform::IDENTITY
            },
            geometry,
            material: Material {
                base: Paint::Role(Role::Primary),
                metallic: 0.0,
                roughness: 0.5,
                emissive: None,
                emissive_intensity: 1.0,
                opacity,
                unlit: false,
                double_sided: false,
                cast_shadow: true,
            },
        }
    }

    fn scene(nodes: Vec<Node3d>) -> Scene3d {
        Scene3d {
            width: 64,
            height: 48,
            seed_argb: 0xFF67_50A4,
            variant: Variant::TonalSpot,
            is_dark: false,
            contrast_level: 0.0,
            background: Some(Paint::Role(Role::Surface)),
            samples: 4,
            camera: Camera::default(),
            lights: vec![],
            shadows: ShadowSettings::default(),
            nodes,
        }
    }

    #[test]
    fn instances_of_one_mesh_are_batched_together() {
        let sphere = Geometry::Sphere {
            radius: 0.2,
            width_segments: 8,
            height_segments: 6,
        };
        let cube = Geometry::Box { size: [0.3; 3] };
        let prepared = scene(vec![
            mesh([-1.0, 0.0, 0.0], 1.0, sphere.clone()),
            mesh([0.0, 0.0, 0.0], 1.0, cube.clone()),
            mesh([1.0, 0.0, 0.0], 1.0, sphere),
            mesh([0.0, 1.0, 0.0], 1.0, cube),
        ])
        .prepare()
        .expect("valid");
        assert_eq!(prepared.meshes.len(), 2);
        assert_eq!(prepared.batches.len(), 2);
        assert!(prepared.batches.iter().all(|b| b.instance_count == 2));
    }

    #[test]
    fn groups_compose_transforms() {
        let child = mesh([1.0, 0.0, 0.0], 1.0, Geometry::Box { size: [0.1; 3] });
        let prepared = scene(vec![Node3d::Group {
            transform: Transform {
                translation: [0.0, 1.0, 0.0],
                ..Transform::IDENTITY
            },
            children: vec![child],
        }])
        .prepare()
        .expect("valid");
        let origin = prepared.instances[0].model.transform_point(Vec3::ZERO);
        assert!((origin.x - 1.0).abs() < 1e-6 && (origin.y - 1.0).abs() < 1e-6);
    }

    #[test]
    fn transparent_instances_are_sorted_back_to_front_after_opaque() {
        let g = Geometry::Box { size: [0.2; 3] };
        let prepared = scene(vec![
            mesh([0.0, 0.0, 1.0], 0.5, g.clone()),
            mesh([0.0, 0.0, -1.0], 0.5, g.clone()),
            mesh([0.5, 0.0, 0.0], 1.0, g),
        ])
        .prepare()
        .expect("valid");
        assert!(!prepared.batches[0].transparent);
        let t: Vec<f32> = prepared.instances[1..]
            .iter()
            .map(|i| i.model.transform_point(Vec3::ZERO).z)
            .collect();
        assert_eq!(t, vec![-1.0, 1.0]);
    }

    #[test]
    fn frustum_culling_drops_offscreen_instances() {
        let g = Geometry::Sphere {
            radius: 0.5,
            width_segments: 8,
            height_segments: 6,
        };
        let prepared = scene(vec![
            mesh([0.0, 0.0, 0.0], 1.0, g.clone()),
            mesh([100.0, 0.0, 0.0], 1.0, g.clone()),
            mesh([0.0, 0.0, 10.0], 1.0, g),
        ])
        .prepare()
        .expect("valid");
        assert_eq!(prepared.instances.len(), 1);
        assert_eq!(prepared.culled, 2);
    }

    #[test]
    fn invalid_scenes_are_rejected_before_rendering() {
        let mut s = scene(vec![]);
        s.width = 0;
        assert!(matches!(
            s.prepare(),
            Err(Scene3dError::InvalidDimensions { .. })
        ));
        let mut s = scene(vec![]);
        s.samples = 3;
        assert_eq!(s.prepare().err(), Some(Scene3dError::InvalidSamples(3)));
        let mut s = scene(vec![]);
        s.camera.eye = s.camera.target;
        assert_eq!(s.prepare().err(), Some(Scene3dError::InvalidCamera));
        let mut s = scene(vec![]);
        s.lights = vec![
            Light::Directional {
                direction: [0.0, -1.0, 0.0],
                color: Paint::Role(Role::OnSurface),
                intensity: 1.0,
                cast_shadow: true,
            };
            MAX_LIGHTS + 1
        ];
        assert_eq!(
            s.prepare().err(),
            Some(Scene3dError::TooManyLights(MAX_LIGHTS + 1))
        );
        let mut deep = mesh([0.0; 3], 1.0, Geometry::Box { size: [1.0; 3] });
        for _ in 0..MAX_DEPTH {
            deep = Node3d::Group {
                transform: Transform::IDENTITY,
                children: vec![deep],
            };
        }
        assert_eq!(
            scene(vec![deep]).prepare().err(),
            Some(Scene3dError::TooDeep)
        );
    }

    #[test]
    fn scene_round_trips_through_json_with_defaults() {
        let json = r#"{
            "width": 32, "height": 32, "seed_argb": 4284960932,
            "lights": [{ "light": "ambient", "color": { "kind": "role", "value": "on-surface" } }],
            "nodes": [{ "node": "group", "children": [
                { "node": "mesh", "geometry": { "shape": "rounded_box" },
                  "material": { "base": { "kind": "role", "value": "primary-container" } } }
            ] }]
        }"#;
        let s: Scene3d = serde_json::from_str(json).expect("parse");
        assert_eq!(s.samples, 4);
        assert_eq!(s.camera, Camera::default());
        let back: Scene3d =
            serde_json::from_str(&serde_json::to_string(&s).expect("serialize")).expect("parse");
        assert_eq!(s, back);
    }
}
