// SPDX-License-Identifier: Apache-2.0
//! Shared WGPU backend ownership for emulator and game-rendering crates.
//!
//! Console-specific renderers own their pipelines and frame semantics. This crate owns the
//! common WGPU instance, adapter, device, queue, and surface-configuration boundary so each host
//! requests the same API resources and applies explicit capability policies.

pub use ::wgpu;

#[cfg(feature = "cuda")]
pub mod cuda;
#[cfg(feature = "hub")]
pub mod cuda_report;
#[cfg(feature = "hub")]
pub mod hub;

/// Create an instance through the shared backend owner.
#[must_use]
pub fn create_instance(descriptor: wgpu::InstanceDescriptor) -> wgpu::Instance {
    wgpu::Instance::new(descriptor)
}

/// Adapter request forwarded through the shared backend package.
pub async fn request_adapter(
    instance: &wgpu::Instance,
    options: &wgpu::RequestAdapterOptions<'_, '_>,
) -> Result<wgpu::Adapter, wgpu::RequestAdapterError> {
    instance.request_adapter(options).await
}

/// Enumerate adapters through the shared backend owner.
pub async fn enumerate_adapters(
    instance: &wgpu::Instance,
    backends: wgpu::Backends,
) -> Vec<wgpu::Adapter> {
    instance.enumerate_adapters(backends).await
}

/// Limits to use when creating a logical device for an adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceLimits {
    /// Request every limit reported by the selected adapter.
    Adapter,
    /// Request wgpu's downlevel baseline with texture resolution raised to the adapter's limit.
    DownlevelWithAdapterResolution,
}

/// Shared device-creation profile. Required features stay empty unless a renderer names and
/// verifies a concrete capability; per-application labels and limit policy remain explicit.
#[derive(Clone, Copy, Debug)]
pub struct DeviceRequest<'a> {
    pub label: Option<&'a str>,
    pub limits: DeviceLimits,
    /// Features the renderer verified against the adapter (for example NV12 video planes).
    pub features: wgpu::Features,
}

impl<'a> DeviceRequest<'a> {
    #[must_use]
    pub const fn new(label: Option<&'a str>, limits: DeviceLimits) -> Self {
        Self {
            label,
            limits,
            features: wgpu::Features::empty(),
        }
    }

    /// Request `features` in addition to the shared defaults. The caller checks
    /// `adapter.features()` first; unsupported features fail device creation.
    #[must_use]
    pub const fn with_features(mut self, features: wgpu::Features) -> Self {
        self.features = features;
        self
    }
}

/// A logical device and its queue, created through the shared request policy.
pub struct GpuDevice {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

/// Request a WGPU device with the shared conservative feature and tracing defaults.
pub async fn request_device(
    adapter: &wgpu::Adapter,
    request: DeviceRequest<'_>,
) -> Result<GpuDevice, wgpu::RequestDeviceError> {
    let required_limits = match request.limits {
        DeviceLimits::Adapter => adapter.limits(),
        DeviceLimits::DownlevelWithAdapterResolution => {
            wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits())
        }
    };

    let descriptor = wgpu::DeviceDescriptor {
        label: request.label,
        required_features: request.features,
        required_limits,
        experimental_features: wgpu::ExperimentalFeatures::disabled(),
        memory_hints: wgpu::MemoryHints::default(),
        trace: wgpu::Trace::Off,
    };
    let (device, queue) = adapter.request_device(&descriptor).await?;
    Ok(GpuDevice { device, queue })
}

/// Select a surface pixel format without duplicating host-specific capability scans.
#[derive(Clone, Copy, Debug)]
pub enum SurfaceFormat<'a> {
    /// Pick the first supported format, which is the WGPU-preferred order.
    Preferred,
    /// Prefer a non-sRGB format and fall back to the first supported format.
    Linear,
    /// Prefer one of these formats; fail if none are supported.
    Require(&'a [wgpu::TextureFormat]),
}

/// Surface settings shared by native windows and browser canvases.
#[derive(Clone, Copy, Debug)]
pub struct SurfaceRequest<'a> {
    pub width: u32,
    pub height: u32,
    pub format: SurfaceFormat<'a>,
    pub present_mode: Option<wgpu::PresentMode>,
    /// Explicit alpha mode is passed through because browser backends can support a mode not
    /// reported in their capability list (notably premultiplied canvas alpha).
    pub alpha_mode: Option<wgpu::CompositeAlphaMode>,
    pub desired_maximum_frame_latency: u32,
}

/// Build a surface configuration from shared capability-selection rules.
pub fn surface_configuration(
    capabilities: &wgpu::SurfaceCapabilities,
    request: SurfaceRequest<'_>,
) -> Option<wgpu::SurfaceConfiguration> {
    // A minimized window can report a zero-sized framebuffer. wgpu rejects such a
    // configuration; callers should skip configure/present until the surface is restored.
    if request.width == 0 || request.height == 0 {
        return None;
    }

    let format = match request.format {
        SurfaceFormat::Preferred => capabilities.formats.first().copied(),
        SurfaceFormat::Linear => capabilities
            .formats
            .iter()
            .copied()
            .find(|format| !format.is_srgb())
            .or_else(|| capabilities.formats.first().copied()),
        SurfaceFormat::Require(preferred) => capabilities
            .formats
            .iter()
            .copied()
            .find(|format| preferred.contains(format)),
    }?;

    let present_mode = request
        .present_mode
        .filter(|mode| capabilities.present_modes.contains(mode))
        .or_else(|| capabilities.present_modes.first().copied())?;
    let alpha_mode = request
        .alpha_mode
        .or_else(|| capabilities.alpha_modes.first().copied())?;

    Some(wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        color_space: wgpu::SurfaceColorSpace::Auto,
        width: request.width,
        height: request.height,
        present_mode,
        desired_maximum_frame_latency: request.desired_maximum_frame_latency,
        alpha_mode,
        view_formats: Vec::new(),
    })
}
