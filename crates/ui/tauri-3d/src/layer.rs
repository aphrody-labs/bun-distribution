// SPDX-License-Identifier: Apache-2.0
//! One native 3D layer: a wgpu surface on a Tauri window, the persistent
//! `aphrody-render` GPU renderer, the scene and its orbit camera.

use aphrody_render::{
    gpu::{GpuContext, shared_context},
    gpu3d::Renderer3d,
    math3d::Vec3,
    scene3d::{Camera, Scene3d},
    wgpu,
};
use serde::Serialize;

/// What a layer runs on, reported to the webview.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    /// Adapter name.
    pub adapter: String,
    /// Graphics API (`Dx12`, `Vulkan`, `Metal`, ...).
    pub backend: String,
    /// Swapchain format.
    pub format: String,
    /// Swapchain alpha mode (`PreMultiplied` means per-pixel transparency).
    pub alpha_mode: String,
    /// Presented through DirectComposition (Windows).
    pub composition: bool,
    /// Surface size in physical pixels.
    pub size: [u32; 2],
}

/// A turntable camera around the framed content (shared math:
/// [`aphrody_render::model::orbit_camera`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Orbit {
    /// Centre of the framed bounding sphere.
    pub center: Vec3,
    /// Radius of the framed bounding sphere.
    pub radius: f32,
    /// Azimuth, degrees.
    pub yaw_deg: f32,
    /// Elevation, degrees.
    pub pitch_deg: f32,
    /// Distance multiplier over the framing distance.
    pub zoom: f32,
    /// Vertical field of view, degrees.
    pub fov_y_deg: f32,
}

impl Orbit {
    /// Frame a bounding sphere from the studio's default three-quarter view.
    #[must_use]
    pub fn framing(center: Vec3, radius: f32) -> Self {
        let d = aphrody_render::model::StudioOptions::default();
        Self {
            center,
            radius,
            yaw_deg: d.yaw_deg,
            pitch_deg: d.pitch_deg,
            zoom: d.zoom,
            fov_y_deg: d.fov_y_deg,
        }
    }

    /// Rotate by drag deltas (CSS pixels) and zoom by a wheel delta.
    pub fn apply(&mut self, dx: f32, dy: f32, zoom: f32) {
        self.yaw_deg -= dx * 0.45;
        self.pitch_deg = (self.pitch_deg + dy * 0.45).clamp(-85.0, 85.0);
        self.zoom = (self.zoom * (zoom * 0.0015).exp()).clamp(0.2, 20.0);
    }

    /// The camera for this orbit.
    #[must_use]
    pub fn camera(&self) -> Camera {
        aphrody_render::model::orbit_camera(
            self.center,
            self.radius,
            self.yaw_deg,
            self.pitch_deg,
            self.zoom,
            self.fov_y_deg,
        )
    }
}

/// A wgpu presentation surface on one window, plus what it shows.
pub struct NativeLayer {
    #[cfg(windows)]
    composition: Option<crate::dcomp::Composition>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    context: GpuContext,
    renderer: Renderer3d,
    /// The scene; `width`/`height` are overwritten by the viewport.
    pub scene: Scene3d,
    /// Viewport in physical pixels `[x, y, w, h]`; `None` covers the window.
    pub viewport: Option<[u32; 4]>,
    /// Orbit camera overriding `scene.camera` when set.
    pub orbit: Option<Orbit>,
    /// The framing of the current content (the `reset` target).
    pub framing: Option<Orbit>,
}

impl std::fmt::Debug for NativeLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeLayer").field("info", &self.info()).finish_non_exhaustive()
    }
}

fn empty_scene() -> Scene3d {
    serde_json::from_value(
        serde_json::json!({ "width": 1, "height": 1, "seed_argb": 0xFF67_50A4_u32 }),
    )
    .expect("the empty scene is valid")
}

impl NativeLayer {
    /// Create a surface on `window` from the process-wide GPU context.
    ///
    /// On Windows with DX12 the surface is a DirectComposition visual under
    /// the webview (per-pixel alpha); elsewhere it is the window itself.
    ///
    /// # Errors
    /// A description of the GPU, handle or surface failure.
    pub fn attach<R: tauri::Runtime>(window: &tauri::Window<R>) -> Result<Self, String> {
        let context = shared_context().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let (surface, composition) = Self::windows_surface(&context, window)?;
        #[cfg(not(windows))]
        let surface = context.instance.create_surface(window.clone()).map_err(|e| e.to_string())?;
        let caps = surface.get_capabilities(&context.adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| {
                matches!(f, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm)
            })
            .or_else(|| caps.formats.first().copied())
            .ok_or("the surface reports no formats")?;
        let alpha_mode =
            [wgpu::CompositeAlphaMode::PreMultiplied, wgpu::CompositeAlphaMode::Opaque]
                .into_iter()
                .find(|m| caps.alpha_modes.contains(m))
                .or_else(|| caps.alpha_modes.first().copied())
                .unwrap_or(wgpu::CompositeAlphaMode::Auto);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: vec![],
        };
        surface.configure(&context.device, &config);
        let renderer = Renderer3d::with_device(
            context.device.clone(),
            context.queue.clone(),
            context.report.clone(),
        );
        Ok(Self {
            #[cfg(windows)]
            composition,
            surface,
            config,
            context,
            renderer,
            scene: empty_scene(),
            viewport: None,
            orbit: None,
            framing: None,
        })
    }

    #[cfg(windows)]
    fn windows_surface<R: tauri::Runtime>(
        context: &GpuContext,
        window: &tauri::Window<R>,
    ) -> Result<(wgpu::Surface<'static>, Option<crate::dcomp::Composition>), String> {
        use aphrody_render::wgpu::rwh::{HasWindowHandle, RawWindowHandle};

        if context.report.backend == "Dx12" {
            let handle = window.window_handle().map_err(|e| e.to_string())?;
            if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                let composition = crate::dcomp::Composition::new(win32.hwnd.get())
                    .map_err(|e| format!("DirectComposition: {e}"))?;
                // SAFETY: the visual is a live `IDCompositionVisual` owned by
                // `composition`, which the layer keeps alive for as long as
                // the surface (wgpu also adds its own reference).
                let surface = unsafe {
                    context.instance.create_surface_unsafe(
                        wgpu::SurfaceTargetUnsafe::CompositionVisual(composition.visual_ptr()),
                    )
                }
                .map_err(|e| e.to_string())?;
                return Ok((surface, Some(composition)));
            }
        }
        let surface = context.instance.create_surface(window.clone()).map_err(|e| e.to_string())?;
        Ok((surface, None))
    }

    /// What this layer runs on.
    #[must_use]
    pub fn info(&self) -> LayerInfo {
        LayerInfo {
            adapter: self.context.report.name.clone(),
            backend: self.context.report.backend.clone(),
            format: format!("{:?}", self.config.format),
            alpha_mode: format!("{:?}", self.config.alpha_mode),
            #[cfg(windows)]
            composition: self.composition.is_some(),
            #[cfg(not(windows))]
            composition: false,
            size: [self.config.width, self.config.height],
        }
    }

    /// Follow a window resize (physical pixels).
    pub fn resize(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        if (width, height) != (self.config.width, self.config.height) {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.context.device, &self.config);
        }
    }

    /// Draw and present one frame.
    ///
    /// # Errors
    /// Scene validation or surface acquisition failures.
    pub fn render(&mut self) -> Result<(), String> {
        let [x, y, w, h] = self.viewport.unwrap_or([0, 0, self.config.width, self.config.height]);
        self.scene.width = w.max(1);
        self.scene.height = h.max(1);
        if let Some(orbit) = &self.orbit {
            self.scene.camera = orbit.camera();
        }
        let prepared = self.renderer.prepare(&self.scene).map_err(|e| e.to_string())?;
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Outdated | wgpu::SurfaceError::Lost) => {
                self.surface.configure(&self.context.device, &self.config);
                self.surface.get_current_texture().map_err(|e| e.to_string())?
            },
            Err(error) => return Err(error.to_string()),
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer.render_to_view(
            &prepared,
            &view,
            self.config.format,
            (self.config.width, self.config.height),
            (x, y),
        );
        frame.present();
        #[cfg(windows)]
        if let Some(composition) = &self.composition {
            composition.commit();
        }
        Ok(())
    }
}
