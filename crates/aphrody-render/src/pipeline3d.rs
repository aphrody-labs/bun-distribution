// SPDX-License-Identifier: Apache-2.0
//! The single 3D entry point: one object that honours [`RenderPolicy`],
//! keeps a persistent GPU renderer when one is available and falls back to
//! the deterministic CPU rasterizer otherwise.
//!
//! Hosts (kernel subsystems, Tauri, the Bun FFI) should render through
//! [`Pipeline3d`] instead of choosing a backend themselves.

use crate::{
    Backend, RenderPolicy,
    raster3d::render_prepared,
    scene3d::{Scene3d, Scene3dError},
};

/// Which backend produced a frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RenderedBy {
    /// The deterministic CPU rasterizer.
    Cpu,
    /// A GPU adapter.
    Gpu {
        /// Adapter name reported by the driver.
        adapter: String,
        /// Graphics API (`"Vulkan"`, `"Dx12"`, `"Metal"`, ...).
        api: String,
    },
}

/// A rendered, read-back 3D frame.
#[derive(Clone, Debug)]
pub struct RenderedFrame {
    /// Width, in pixels.
    pub width: u32,
    /// Height, in pixels.
    pub height: u32,
    /// Straight-alpha, sRGB-encoded RGBA8 pixels.
    pub rgba: Vec<u8>,
    /// The backend that rendered the frame.
    pub backend: RenderedBy,
}

impl RenderedFrame {
    /// PNG-encode the frame.
    ///
    /// # Errors
    /// Propagates PNG encoding failures.
    pub fn to_png(&self) -> Result<Vec<u8>, png::EncodingError> {
        crate::raster::encode_png(self.width, self.height, &self.rgba)
    }
}

/// Errors from [`Pipeline3d::render`].
#[derive(Debug)]
pub enum Pipeline3dError {
    /// The scene failed validation.
    Scene(Scene3dError),
    /// [`RenderPolicy::GpuRequired`] could not be satisfied.
    GpuUnavailable(String),
    /// The GPU failed while rendering a frame.
    Gpu(String),
}

impl std::fmt::Display for Pipeline3dError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Scene(err) => err.fmt(f),
            Self::GpuUnavailable(why) => write!(f, "GPU rendering required but unavailable: {why}"),
            Self::Gpu(why) => write!(f, "GPU rendering failed: {why}"),
        }
    }
}

impl std::error::Error for Pipeline3dError {}

impl From<Scene3dError> for Pipeline3dError {
    fn from(err: Scene3dError) -> Self {
        Self::Scene(err)
    }
}

/// Policy-driven 3D renderer with lazy GPU initialisation and CPU fallback.
#[derive(Debug)]
pub struct Pipeline3d {
    policy: RenderPolicy,
    #[cfg(feature = "gpu")]
    gpu: GpuState,
    cpu_cache: crate::mesh3d::MeshCache,
}

#[cfg(feature = "gpu")]
#[derive(Debug)]
enum GpuState {
    Untried,
    Ready(Box<crate::gpu3d::Renderer3d>),
    Unavailable(String),
}

impl Pipeline3d {
    /// Create a pipeline; no device is opened until the first frame.
    #[must_use]
    pub fn new(policy: RenderPolicy) -> Self {
        Self {
            policy,
            #[cfg(feature = "gpu")]
            gpu: GpuState::Untried,
            cpu_cache: crate::mesh3d::MeshCache::new(),
        }
    }

    /// The configured policy.
    #[must_use]
    pub const fn policy(&self) -> RenderPolicy {
        self.policy
    }

    /// The backend the next frame will use, opening the GPU if needed.
    pub fn backend(&mut self) -> Backend {
        #[cfg(feature = "gpu")]
        if self.policy != RenderPolicy::CpuOnly && self.gpu_renderer().is_some() {
            return crate::backend_order()[0];
        }
        Backend::Cpu
    }

    #[cfg(feature = "gpu")]
    fn gpu_renderer(&mut self) -> Option<&mut crate::gpu3d::Renderer3d> {
        if matches!(self.gpu, GpuState::Untried) {
            self.gpu = match crate::gpu3d::Renderer3d::new() {
                Ok(renderer) => GpuState::Ready(Box::new(renderer)),
                Err(err) => GpuState::Unavailable(err.to_string()),
            };
        }
        match &mut self.gpu {
            GpuState::Ready(renderer) => Some(renderer),
            _ => None,
        }
    }

    /// Render `scene` according to the policy.
    ///
    /// # Errors
    /// [`Pipeline3dError::Scene`] for invalid scenes;
    /// [`Pipeline3dError::GpuUnavailable`] under
    /// [`RenderPolicy::GpuRequired`] without a usable GPU;
    /// [`Pipeline3dError::Gpu`] when a required GPU fails mid-frame (under
    /// [`RenderPolicy::Auto`] the frame is re-rendered on the CPU instead).
    pub fn render(&mut self, scene: &Scene3d) -> Result<RenderedFrame, Pipeline3dError> {
        if self.policy != RenderPolicy::CpuOnly {
            #[cfg(feature = "gpu")]
            {
                let policy = self.policy;
                if let Some(renderer) = self.gpu_renderer() {
                    match renderer.render(scene) {
                        Ok(frame) => {
                            return Ok(RenderedFrame {
                                width: frame.width,
                                height: frame.height,
                                rgba: frame.rgba,
                                backend: RenderedBy::Gpu {
                                    adapter: frame.adapter.name,
                                    api: frame.adapter.backend,
                                },
                            });
                        },
                        Err(crate::gpu3d::Gpu3dError::Scene(err)) => return Err(err.into()),
                        Err(err) if policy == RenderPolicy::GpuRequired => {
                            return Err(Pipeline3dError::Gpu(err.to_string()));
                        },
                        Err(_) => {},
                    }
                } else if policy == RenderPolicy::GpuRequired {
                    let why = match &self.gpu {
                        GpuState::Unavailable(why) => why.clone(),
                        _ => "no adapter".into(),
                    };
                    return Err(Pipeline3dError::GpuUnavailable(why));
                }
            }
            #[cfg(not(feature = "gpu"))]
            if self.policy == RenderPolicy::GpuRequired {
                return Err(Pipeline3dError::GpuUnavailable(
                    "aphrody-render was built without the `gpu` feature".into(),
                ));
            }
        }
        let prepared = scene.prepare_with(&mut self.cpu_cache)?;
        let canvas = render_prepared(&prepared);
        Ok(RenderedFrame {
            width: canvas.width,
            height: canvas.height,
            rgba: canvas.pixels,
            backend: RenderedBy::Cpu,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::showcase_scene3d;

    #[test]
    fn cpu_only_policy_is_deterministic_cpu() {
        let mut pipeline = Pipeline3d::new(RenderPolicy::CpuOnly);
        assert_eq!(pipeline.backend(), Backend::Cpu);
        let scene = showcase_scene3d(64, 40);
        let a = pipeline.render(&scene).expect("render");
        let b = pipeline.render(&scene).expect("render");
        assert_eq!(a.backend, RenderedBy::Cpu);
        assert_eq!(a.rgba, b.rgba);
        assert_eq!(&a.to_png().expect("png")[..4], b"\x89PNG");
    }

    #[test]
    fn auto_policy_always_produces_a_frame() {
        let mut pipeline = Pipeline3d::new(RenderPolicy::Auto);
        let frame = pipeline.render(&showcase_scene3d(64, 40)).expect("render");
        assert_eq!(frame.rgba.len(), 64 * 40 * 4);
    }

    #[test]
    fn invalid_scenes_fail_on_every_policy() {
        let mut scene = showcase_scene3d(64, 40);
        scene.samples = 2;
        for policy in [RenderPolicy::CpuOnly, RenderPolicy::Auto] {
            assert!(matches!(
                Pipeline3d::new(policy).render(&scene),
                Err(Pipeline3dError::Scene(Scene3dError::InvalidSamples(2)))
            ));
        }
    }

    #[cfg(not(feature = "gpu"))]
    #[test]
    fn gpu_required_without_gpu_feature_is_an_error() {
        let result = Pipeline3d::new(RenderPolicy::GpuRequired).render(&showcase_scene3d(8, 8));
        assert!(matches!(result, Err(Pipeline3dError::GpuUnavailable(_))));
    }
}
