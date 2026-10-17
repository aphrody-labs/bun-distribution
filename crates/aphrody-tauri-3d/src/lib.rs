// SPDX-License-Identifier: Apache-2.0
//! Native 3D for Tauri v2: the webview keeps the M3 design, the GPU does the 3D.
//!
//! The plugin (`aphrody-3d`) attaches a [`layer::NativeLayer`] to a window: a wgpu surface drawn
//! by the persistent, instanced `aphrody-render` renderer (PBR, shadows, 4x MSAA, pixel parity
//! with the CPU reference). On Windows it is a DirectComposition visual bound *under* the
//! WebView2 child, so a transparent page composites the M3 interface over native 3D with
//! per-pixel alpha, and a transparent frameless window shows the model alone on the desktop.
//! Everything low level (GPU, files, model import) runs natively; the page only sends intents:
//!
//! - `plugin:aphrody-3d|attach` / `detach`: create or drop the calling window's layer;
//! - `plugin:aphrody-3d|set_scene`: an `aphrody_render::scene3d::Scene3d` (JSON);
//! - `plugin:aphrody-3d|load_model`: a `.glb`/`.gltf`/`.obj` model (M3 studio, framed) or a
//!   `Scene3d` `.json` file;
//! - `plugin:aphrody-3d|set_viewport`: the CSS-pixel rect the 3D occupies (a hole in the UI);
//! - `plugin:aphrody-3d|orbit`: pointer/wheel deltas for the turntable camera, `reset: true` to
//!   re-frame;
//! - `plugin:aphrody-3d|info`: adapter, API, swapchain format and alpha mode.
//!
//! Rust hosts use [`attach_window`] and [`load_path`] directly. Register with
//! `tauri::Builder::default().plugin(aphrody_tauri_3d::init())`, grant
//! `"aphrody-3d:default"`, make the webview transparent and the page background transparent.

#[cfg(windows)]
mod dcomp;
pub mod layer;

use std::{collections::HashMap, path::Path, sync::Mutex};

use aphrody_render::{
    model::{self, StudioOptions},
    scene::Paint,
    scene3d::{Material, Scene3d},
};
use serde::Deserialize;
use tauri::{
    AppHandle, Manager, RunEvent, Runtime, State, Window, WindowEvent,
    plugin::{Builder, TauriPlugin},
};

use crate::layer::{LayerInfo, NativeLayer, Orbit};

/// Every attached layer, by window label.
#[derive(Default)]
pub struct Layers(Mutex<HashMap<String, NativeLayer>>);

impl Layers {
    /// Run `f` on the layer of `label` and present a frame.
    ///
    /// # Errors
    /// No layer attached, or the render failure.
    pub fn with<T>(
        &self,
        label: &str,
        f: impl FnOnce(&mut NativeLayer) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut layers = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let layer = layers
            .get_mut(label)
            .ok_or_else(|| format!("no native 3D layer on window `{label}`; call attach first"))?;
        let out = f(layer)?;
        layer.render()?;
        Ok(out)
    }
}

/// Attach a layer to `window` (idempotent) and present a first frame.
///
/// # Errors
/// GPU, handle or surface failures.
pub fn attach_window<R: Runtime>(window: &Window<R>) -> Result<LayerInfo, String> {
    let layers = window.state::<Layers>();
    let label = window.label().to_string();
    {
        let mut map = layers
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !map.contains_key(&label) {
            map.insert(label.clone(), NativeLayer::attach(window)?);
        }
    }
    layers.with(&label, |layer| Ok(layer.info()))
}

/// Options of [`load_path`] and `load_model`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptions {
    /// Clear colour; `None` keeps the layer transparent.
    pub background: Option<Paint>,
    /// Packed `0xAARRGGBB` M3 seed for role colours (default `#6750A4`).
    pub seed_argb: Option<u32>,
    /// Dark scheme.
    pub dark: Option<bool>,
}

fn default_material() -> Material {
    Material {
        base: Paint::Role(aphrody_m3_tokens::facade::color::Role::Primary),
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

/// Load a model (`.glb`/`.gltf`/`.obj`, staged in the M3 studio and framed) or a `Scene3d`
/// `.json` file into the layer of `label`. Orbit state survives reloads of the same content.
///
/// # Errors
/// I/O, parse or render failures.
pub fn load_path<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    path: &Path,
    options: &ModelOptions,
) -> Result<(), String> {
    let is_scene = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let (scene, framing) = if is_scene {
        let scene: Scene3d =
            serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("{}: {e}", path.display()))?;
        let framing = model::bounds(&scene.nodes).map(|(c, r)| Orbit::framing(c, r));
        (scene, framing)
    } else {
        let nodes = model::load_model(path, default_material()).map_err(|e| e.to_string())?;
        let d = StudioOptions::default();
        let studio = StudioOptions {
            seed_argb: options.seed_argb.unwrap_or(d.seed_argb),
            is_dark: options.dark.unwrap_or(d.is_dark),
            background: options.background,
            ..d
        };
        let (center, radius) = model::bounds(&nodes).ok_or("the model has no geometry")?;
        let scene = model::studio_scene(nodes, 1, 1, &studio).map_err(|e| e.to_string())?;
        (scene, Some(Orbit::framing(center, radius)))
    };
    app.state::<Layers>().with(label, |layer| {
        layer.scene = scene;
        // Scene files keep their own camera until the user orbits; models are framed.
        layer.framing = framing;
        if is_scene {
            layer.orbit = layer
                .orbit
                .filter(|o| Some((o.center, o.radius)) == framing.map(|f| (f.center, f.radius)));
        } else if layer
            .orbit
            .is_none_or(|o| Some((o.center, o.radius)) != framing.map(|f| (f.center, f.radius)))
        {
            layer.orbit = framing;
        }
        Ok(())
    })
}

/// Attach (or re-report) the calling window's layer.
#[tauri::command]
fn attach<R: Runtime>(window: Window<R>) -> Result<LayerInfo, String> {
    attach_window(&window)
}

/// Drop the calling window's layer.
#[tauri::command]
fn detach<R: Runtime>(window: Window<R>, layers: State<'_, Layers>) {
    layers
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(window.label());
}

/// Replace the scene (its camera is used until the next `orbit`).
#[tauri::command]
fn set_scene<R: Runtime>(
    window: Window<R>,
    layers: State<'_, Layers>,
    scene: Scene3d,
) -> Result<(), String> {
    layers.with(window.label(), |layer| {
        layer.framing = model::bounds(&scene.nodes).map(|(c, r)| Orbit::framing(c, r));
        layer.scene = scene;
        layer.orbit = None;
        Ok(())
    })
}

/// Load a model or scene file into the calling window's layer.
#[tauri::command]
fn load_model<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    path: std::path::PathBuf,
    options: Option<ModelOptions>,
) -> Result<(), String> {
    load_path(&app, window.label(), &path, &options.unwrap_or_default())
}

/// The CSS-pixel rect `[x, y, width, height]` the 3D occupies; `null` covers the window.
#[tauri::command]
fn set_viewport<R: Runtime>(
    window: Window<R>,
    layers: State<'_, Layers>,
    rect: Option<[f64; 4]>,
) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    layers.with(window.label(), |layer| {
        layer.viewport = rect.map(|[x, y, w, h]| {
            [
                (x * scale).round().max(0.0) as u32,
                (y * scale).round().max(0.0) as u32,
                (w * scale).round().max(1.0) as u32,
                (h * scale).round().max(1.0) as u32,
            ]
        });
        Ok(())
    })
}

/// Turntable camera: `dx`/`dy` drag deltas in CSS pixels, `zoom` a wheel delta; `reset`
/// re-frames the content.
#[tauri::command]
fn orbit<R: Runtime>(
    window: Window<R>,
    layers: State<'_, Layers>,
    dx: f32,
    dy: f32,
    zoom: f32,
    reset: Option<bool>,
) -> Result<(), String> {
    layers.with(window.label(), |layer| {
        if reset.unwrap_or(false) {
            layer.orbit = layer.framing;
        } else {
            // A scene file keeps its own camera until the first interaction.
            if layer.orbit.is_none() {
                layer.orbit = layer.framing;
            }
            if let Some(orbit) = layer.orbit.as_mut() {
                orbit.apply(dx, dy, zoom);
            }
        }
        Ok(())
    })
}

/// Report the calling window's layer.
#[tauri::command]
fn info<R: Runtime>(window: Window<R>, layers: State<'_, Layers>) -> Result<LayerInfo, String> {
    let map = layers
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    map.get(window.label())
        .map(NativeLayer::info)
        .ok_or_else(|| "no native 3D layer".into())
}

/// The plugin.
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("aphrody-3d")
        .invoke_handler(tauri::generate_handler![
            attach,
            detach,
            set_scene,
            load_model,
            set_viewport,
            orbit,
            info
        ])
        .setup(|app, _| {
            app.manage(Layers::default());
            Ok(())
        })
        .on_event(|app, event| {
            let RunEvent::WindowEvent { label, event, .. } = event else {
                return;
            };
            let layers = app.state::<Layers>();
            let resize = |w: u32, h: u32| {
                let _ = layers.with(label, |layer| {
                    layer.resize(w, h);
                    Ok(())
                });
            };
            match event {
                WindowEvent::Resized(size) => resize(size.width, size.height),
                WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                    resize(new_inner_size.width, new_inner_size.height);
                }
                WindowEvent::Destroyed => {
                    layers
                        .0
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .remove(label);
                }
                _ => {}
            }
        })
        .build()
}
