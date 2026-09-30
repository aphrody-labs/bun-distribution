// SPDX-License-Identifier: Apache-2.0
//! Native 3D for Aphrody agents: the `render3d` kernel subsystem.
//!
//! Agents model, see and exchange 3D through the same engine the desktop uses
//! (`aphrody-render`: GPU with deterministic CPU fallback, PBR, shadows, 4x MSAA):
//!
//! | Tool | Does |
//! | --- | --- |
//! | `render3d_model_inspect` | Read a `.glb`/`.gltf`/`.obj`: meshes, vertices, triangles, bounds, materials. |
//! | `render3d_model_scene` | Stage a model in an M3 studio (lights, framed orbit camera) and return the editable `Scene3d` JSON. |
//! | `render3d_render` | Render a `Scene3d` (authored or edited by the agent) to PNG, so the agent can look at it. |
//! | `render3d_model_render` | Render a model file from a yaw/pitch/zoom view to PNG in one call. |
//! | `render3d_export_glb` | Write a `Scene3d`'s nodes as a binary glTF (the agent's modelling output). |
//! | `render3d_view` | Open or update a live native desktop view of a model or scene file. |
//!
//! Every file written goes to the requested `out` path or to
//! `<temp>/aphrody-render3d/`. PNGs can also be returned inline (`inline: true`).
//!
//! [`softraster`] re-exports the dependency-free, byte-deterministic triangle rasterizer that
//! hosts without any GPU stack (headless CI, WebAssembly, the `nie` engine) share.

/// Deterministic CPU triangle rasterizer (z-buffer, perspective-correct texturing).
pub use aphrody_softraster as softraster;

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use aphrody_render::{
    RenderPolicy,
    model::{self, StudioOptions},
    pipeline3d::{Pipeline3d, RenderedBy},
    scene::Paint,
    scene3d::{Material, Scene3d},
};
use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};

/// Maximum rendered edge accepted from an agent.
const MAX_EDGE: u32 = 8192;

/// The `render3d` subsystem.
pub struct Render3dSubsystem {
    pipeline: Arc<Mutex<Pipeline3d>>,
    out_dir: PathBuf,
}

impl std::fmt::Debug for Render3dSubsystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Render3dSubsystem").field("out_dir", &self.out_dir).finish_non_exhaustive()
    }
}

impl Default for Render3dSubsystem {
    fn default() -> Self {
        Self::new()
    }
}

impl Render3dSubsystem {
    /// GPU when available (the GPU opens lazily on the first frame), CPU otherwise.
    #[must_use]
    pub fn new() -> Self {
        Self::with_policy(RenderPolicy::Auto)
    }

    /// A subsystem with an explicit backend policy (`CpuOnly` for bit-exact output).
    #[must_use]
    pub fn with_policy(policy: RenderPolicy) -> Self {
        Self {
            pipeline: Arc::new(Mutex::new(Pipeline3d::new(policy))),
            out_dir: std::env::temp_dir().join("aphrody-render3d"),
        }
    }
}

fn invalid(why: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::InvalidArguments(why.to_string())
}

fn failed(why: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(why.to_string())
}

fn default_material() -> Material {
    Material {
        base: Paint::Role(aphrody_m3::color::Role::Primary),
        metallic: 0.0,
        roughness: 0.45,
        emissive: None,
        emissive_intensity: 1.0,
        opacity: 1.0,
        unlit: false,
        double_sided: false,
        cast_shadow: true,
    }
}

fn load(path: &Path) -> Result<Vec<aphrody_render::scene3d::Node3d>, SubsystemError> {
    if !path.is_file() {
        return Err(invalid(format!("no such model file: {}", path.display())));
    }
    model::load_model(path, default_material()).map_err(failed)
}

/// Output options shared by the rendering tools.
#[derive(Debug, Default, Deserialize)]
struct OutputArgs {
    out: Option<PathBuf>,
    #[serde(default)]
    inline: bool,
}

#[derive(Debug, Deserialize)]
struct ModelArgs {
    path: PathBuf,
    #[serde(default = "default_edge")]
    width: u32,
    #[serde(default = "default_edge")]
    height: u32,
    #[serde(flatten)]
    studio: StudioArgs,
    #[serde(flatten)]
    output: OutputArgs,
}

fn default_edge() -> u32 {
    768
}

/// Agent-facing studio options (degrees, optional M3 background role).
#[derive(Debug, Default, Deserialize)]
struct StudioArgs {
    yaw_deg: Option<f32>,
    pitch_deg: Option<f32>,
    zoom: Option<f32>,
    fov_y_deg: Option<f32>,
    seed_argb: Option<u32>,
    dark: Option<bool>,
    background: Option<Paint>,
    shadows: Option<bool>,
}

impl StudioArgs {
    fn options(&self) -> StudioOptions {
        let d = StudioOptions::default();
        StudioOptions {
            seed_argb: self.seed_argb.unwrap_or(d.seed_argb),
            is_dark: self.dark.unwrap_or(d.is_dark),
            background: self.background,
            yaw_deg: self.yaw_deg.unwrap_or(d.yaw_deg),
            pitch_deg: self.pitch_deg.unwrap_or(d.pitch_deg),
            zoom: self.zoom.unwrap_or(d.zoom),
            fov_y_deg: self.fov_y_deg.unwrap_or(d.fov_y_deg),
            shadows: self.shadows.unwrap_or(d.shadows),
        }
    }
}

fn check_size(width: u32, height: u32) -> Result<(), SubsystemError> {
    if width == 0 || height == 0 || width > MAX_EDGE || height > MAX_EDGE {
        return Err(invalid(format!("size {width}x{height} outside 1..={MAX_EDGE}")));
    }
    Ok(())
}

impl Render3dSubsystem {
    fn out_path(
        &self,
        requested: Option<PathBuf>,
        stem: &str,
        ext: &str,
    ) -> Result<PathBuf, SubsystemError> {
        let path = match requested {
            Some(path) => path,
            None => {
                let millis =
                    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
                self.out_dir.join(format!("{stem}-{millis}.{ext}"))
            },
        };
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(failed)?;
        }
        Ok(path)
    }

    async fn render_scene(
        &self,
        scene: Scene3d,
        output: OutputArgs,
        stem: &str,
    ) -> Result<Value, SubsystemError> {
        check_size(scene.width, scene.height)?;
        let pipeline = Arc::clone(&self.pipeline);
        let triangles_scene = scene.clone();
        let frame = tokio::task::spawn_blocking(move || {
            let mut pipeline = pipeline.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            pipeline.render(&scene)
        })
        .await
        .map_err(failed)?
        .map_err(|e| invalid(e))?;
        let png = frame.to_png().map_err(failed)?;
        let path = self.out_path(output.out, stem, "png")?;
        std::fs::write(&path, &png).map_err(failed)?;
        let prepared = triangles_scene.prepare().map_err(|e| invalid(e))?;
        let backend = match frame.backend {
            RenderedBy::Cpu => json!({ "kind": "cpu" }),
            RenderedBy::Gpu { adapter, api } => {
                json!({ "kind": "gpu", "adapter": adapter, "api": api })
            },
        };
        let mut result = json!({
            "path": path,
            "width": frame.width,
            "height": frame.height,
            "backend": backend,
            "instances": prepared.instances.len(),
            "triangles": prepared.triangle_count(),
            "drawBatches": prepared.batches.len(),
            "culled": prepared.culled,
        });
        if output.inline {
            result["pngBase64"] = json!(base64::engine::general_purpose::STANDARD.encode(&png));
        }
        Ok(result)
    }
}

fn scene_schema_note() -> &'static str {
    "A Scene3d: {width, height, seed_argb, variant?, is_dark?, background?: Paint, samples?: 1|4, \
     camera?: {eye, target, up, projection: {kind: perspective|orthographic, ...}}, lights?: \
     [{light: ambient|hemisphere|directional|point, ...}], shadows?: {enabled, resolution}, nodes: \
     [{node: group, transform?, children} | {node: mesh, transform?: {translation, rotation_deg, \
     scale}, geometry: {shape: box|rounded_box|sphere|plane|cylinder|torus|mesh, ...}, material: \
     {base: Paint, metallic?, roughness?, emissive?, opacity?, unlit?, double_sided?, \
     cast_shadow?}}]}. Paint = {kind: role, value: <M3 role, e.g. primary-container>} | {kind: \
     fixed, value: {r,g,b,a}}. Use render3d_model_scene to get a complete example."
}

#[async_trait]
impl SystemSubsystem for Render3dSubsystem {
    fn name(&self) -> &'static str {
        "render3d"
    }

    fn description(&self) -> &'static str {
        "Native 3D: read glTF/GLB/OBJ, model M3 scenes, render them on the GPU to PNG, export GLB \
         and open live native views."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        let studio = json!({
            "yaw_deg": { "type": "number", "description": "Camera azimuth, degrees (default 35)." },
            "pitch_deg": { "type": "number", "description": "Camera elevation, degrees (default 15)." },
            "zoom": { "type": "number", "description": "Distance multiplier over the framing distance (default 1)." },
            "fov_y_deg": { "type": "number" },
            "seed_argb": { "type": "integer", "description": "M3 seed 0xAARRGGBB (default 0xFF6750A4)." },
            "dark": { "type": "boolean" },
            "background": { "type": "object", "description": "Paint; omit for a transparent background." },
            "shadows": { "type": "boolean" }
        });
        let output = json!({
            "out": { "type": "string", "description": "Output file; default under the temp dir." },
            "inline": { "type": "boolean", "description": "Also return the PNG as base64." }
        });
        let merge = |base: Value, extra: &[&Value]| {
            let mut map = base.as_object().cloned().unwrap_or_default();
            for e in extra {
                if let Some(o) = e.as_object() {
                    map.extend(o.clone());
                }
            }
            Value::Object(map)
        };
        vec![
            ToolDefinition::new(
                "render3d_model_inspect",
                "Read a .glb/.gltf/.obj model: mesh, vertex and triangle counts, world bounds \
                 (min, max, centre, radius) and its PBR materials.",
                json!({ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }),
            )
            .read_only(),
            ToolDefinition::new(
                "render3d_model_scene",
                "Stage a model in an M3 studio (hemisphere + key + fill lights, framed orbit \
                 camera) and return the complete, editable Scene3d JSON (for render3d_render, \
                 render3d_export_glb or render3d_view).",
                json!({ "type": "object", "required": ["path"], "properties": merge(json!({
                    "path": { "type": "string" },
                    "width": { "type": "integer", "default": 768 },
                    "height": { "type": "integer", "default": 768 }
                }), &[&studio]) }),
            )
            .read_only(),
            ToolDefinition::new(
                "render3d_render",
                format!(
                    "Render a Scene3d to a PNG file (GPU with CPU fallback) and return its path, \
                     backend and triangle count; look at the PNG to see the result. {}",
                    scene_schema_note()
                ),
                json!({ "type": "object", "required": ["scene"], "properties": merge(json!({
                    "scene": { "type": "object" }
                }), &[&output]) }),
            ),
            ToolDefinition::new(
                "render3d_model_render",
                "Render a .glb/.gltf/.obj model from a yaw/pitch/zoom view to a PNG file in one \
                 call (M3 studio lighting, shadows, 4x MSAA).",
                json!({ "type": "object", "required": ["path"], "properties": merge(json!({
                    "path": { "type": "string" },
                    "width": { "type": "integer", "default": 768 },
                    "height": { "type": "integer", "default": 768 }
                }), &[&studio, &output]) }),
            ),
            ToolDefinition::new(
                "render3d_export_glb",
                format!(
                    "Write the nodes of a Scene3d as a binary glTF 2.0 file (meshes baked to \
                     world space, M3 roles resolved to PBR factors). {}",
                    scene_schema_note()
                ),
                json!({ "type": "object", "required": ["scene"], "properties": {
                    "scene": { "type": "object" },
                    "out": { "type": "string" }
                } }),
            ),
            ToolDefinition::new(
                "render3d_view",
                "Open a live native desktop view (frameless, transparent, only the 3D) of a \
                 .glb/.gltf/.obj model or a Scene3d .json file; the view reloads whenever the \
                 file changes, so rewriting the file controls it.",
                json!({ "type": "object", "required": ["path"], "properties": {
                    "path": { "type": "string" },
                    "size": { "type": "integer", "default": 640 }
                } }),
            ),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "render3d_model_inspect" => {
                let path: PathBuf =
                    serde_json::from_value(arguments.get("path").cloned().unwrap_or(Value::Null))
                        .map_err(invalid)?;
                let nodes =
                    tokio::task::spawn_blocking(move || load(&path)).await.map_err(failed)??;
                serde_json::to_value(model::inspect(&nodes)).map_err(failed)
            },
            "render3d_model_scene" => {
                let args: ModelArgs = serde_json::from_value(arguments).map_err(invalid)?;
                check_size(args.width, args.height)?;
                let options = args.studio.options();
                let path = args.path.clone();
                let nodes =
                    tokio::task::spawn_blocking(move || load(&path)).await.map_err(failed)??;
                let scene = model::studio_scene(nodes, args.width, args.height, &options)
                    .map_err(failed)?;
                serde_json::to_value(scene).map_err(failed)
            },
            "render3d_render" => {
                let scene: Scene3d =
                    serde_json::from_value(arguments.get("scene").cloned().unwrap_or(Value::Null))
                        .map_err(invalid)?;
                let output: OutputArgs = serde_json::from_value(arguments).map_err(invalid)?;
                self.render_scene(scene, output, "scene").await
            },
            "render3d_model_render" => {
                let args: ModelArgs = serde_json::from_value(arguments).map_err(invalid)?;
                check_size(args.width, args.height)?;
                let options = args.studio.options();
                let path = args.path.clone();
                let nodes =
                    tokio::task::spawn_blocking(move || load(&path)).await.map_err(failed)??;
                let scene = model::studio_scene(nodes, args.width, args.height, &options)
                    .map_err(failed)?;
                let stem =
                    args.path.file_stem().and_then(|s| s.to_str()).unwrap_or("model").to_string();
                self.render_scene(scene, args.output, &stem).await
            },
            "render3d_export_glb" => {
                let scene: Scene3d =
                    serde_json::from_value(arguments.get("scene").cloned().unwrap_or(Value::Null))
                        .map_err(invalid)?;
                let out = arguments.get("out").and_then(Value::as_str).map(PathBuf::from);
                let glb = model::write_glb(&scene.nodes, &scene.scheme()).map_err(invalid)?;
                let path = self.out_path(out, "scene", "glb")?;
                std::fs::write(&path, &glb).map_err(failed)?;
                let nodes = model::parse_gltf(&glb, None, default_material()).map_err(failed)?;
                Ok(json!({ "path": path, "bytes": glb.len(), "model": model::inspect(&nodes) }))
            },
            "render3d_view" => {
                let path = PathBuf::from(
                    arguments
                        .get("path")
                        .and_then(Value::as_str)
                        .ok_or_else(|| invalid("`path` is required"))?,
                );
                if !path.is_file() {
                    return Err(invalid(format!("no such file: {}", path.display())));
                }
                let size =
                    arguments.get("size").and_then(Value::as_u64).unwrap_or(640).clamp(64, 4096);
                let viewer = viewer_binary().ok_or_else(|| {
                    SubsystemError::Unavailable(
                        "aphrody-model-view is not built (cargo build -p aphrody-model-view)"
                            .into(),
                    )
                })?;
                let child = std::process::Command::new(&viewer)
                    .arg(&path)
                    .arg("--size")
                    .arg(size.to_string())
                    .spawn()
                    .map_err(failed)?;
                Ok(json!({ "viewer": viewer, "pid": child.id(), "path": path, "live": true }))
            },
            other => Err(SubsystemError::UnknownTool(other.to_string())),
        }
    }
}

/// Locate the native viewer next to the running executable, then on `PATH`.
fn viewer_binary() -> Option<PathBuf> {
    let name = if cfg!(windows) { "aphrody-model-view.exe" } else { "aphrody-model-view" };
    let beside = std::env::current_exe().ok()?.parent()?.join(name);
    if beside.is_file() {
        return Some(beside);
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).map(|dir| dir.join(name)).find(|p| p.is_file())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subsystem() -> Render3dSubsystem {
        let mut s = Render3dSubsystem::with_policy(RenderPolicy::CpuOnly);
        s.out_dir =
            std::env::temp_dir().join(format!("aphrody-render3d-test-{}", std::process::id()));
        s
    }

    #[tokio::test]
    async fn agents_can_model_render_and_export_a_scene() {
        let s = subsystem();
        let scene = aphrody_render::fixtures::showcase_scene3d(96, 64);
        let scene_json = serde_json::to_value(&scene).expect("json");
        let rendered = s
            .call("render3d_render", json!({ "scene": scene_json, "inline": true }))
            .await
            .expect("render");
        assert_eq!(rendered["width"], 96);
        assert_eq!(rendered["backend"]["kind"], "cpu");
        let png = std::fs::read(rendered["path"].as_str().expect("path")).expect("png");
        assert_eq!(&png[..4], b"\x89PNG");
        assert!(rendered["pngBase64"].as_str().is_some_and(|b| !b.is_empty()));

        let exported =
            s.call("render3d_export_glb", json!({ "scene": scene_json })).await.expect("glb");
        let glb = PathBuf::from(exported["path"].as_str().expect("path"));
        assert_eq!(exported["model"]["meshes"], 6);

        let info = s.call("render3d_model_inspect", json!({ "path": glb })).await.expect("inspect");
        assert_eq!(info["meshes"], 6);
        assert!(info["triangles"].as_u64().is_some_and(|t| t > 1000));

        let staged = s
            .call(
                "render3d_model_scene",
                json!({ "path": glb, "width": 64, "height": 64, "yaw_deg": 90 }),
            )
            .await
            .expect("stage");
        let view = s
            .call(
                "render3d_model_render",
                json!({ "path": glb, "width": 64, "height": 48, "pitch_deg": 40 }),
            )
            .await
            .expect("model render");
        assert_eq!(view["height"], 48);
        let restaged: Scene3d = serde_json::from_value(staged).expect("a valid Scene3d");
        assert_eq!(restaged.nodes.len(), 6);
        let _ = std::fs::remove_dir_all(&s.out_dir);
    }

    #[tokio::test]
    async fn invalid_requests_are_rejected() {
        let s = subsystem();
        assert!(matches!(
            s.call("render3d_model_inspect", json!({ "path": "definitely-missing.glb" })).await,
            Err(SubsystemError::InvalidArguments(_))
        ));
        let mut scene =
            serde_json::to_value(aphrody_render::fixtures::showcase_scene3d(8, 8)).expect("json");
        scene["width"] = json!(100_000);
        assert!(s.call("render3d_render", json!({ "scene": scene })).await.is_err());
        assert!(matches!(s.call("nope", json!({})).await, Err(SubsystemError::UnknownTool(_))));
        assert_eq!(s.tools().len(), 6);
    }
}
