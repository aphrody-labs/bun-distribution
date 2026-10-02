// SPDX-License-Identifier: Apache-2.0
//! Headless `wgpu` offscreen backend (feature `gpu`).
//!
//! Renders the same [`Scene`] the CPU rasterizer consumes, evaluating the
//! identical analytic rounded-rect / shadow SDF math in WGSL
//! (`src/gpu.wgsl`), and compositing the same CPU-rasterized text/icon
//! coverage bitmaps as textures. This keeps GPU output within the documented
//! per-pixel tolerance of the CPU reference without duplicating font or path
//! rasterization on the GPU.
//!
//! GPU backends are opt-in: this module only compiles under `--features
//! gpu`, so the default build never links `wgpu`.

use bytemuck::{Pod, Zeroable};

use crate::{
    geometry::{parse_svg_path, rasterize_polylines, shadow_params},
    scene::{Corners, Node, Rect, Rgba8, Scene},
    text::rasterize_line,
};

/// Diagnostic information about the adapter used for a GPU render.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdapterReport {
    /// Adapter name as reported by the driver.
    pub name: String,
    /// Backend the adapter runs on (`"Vulkan"`, `"Dx12"`, `"Metal"`, `"Gl"`, ...).
    pub backend: String,
    /// Whether this is a software (CPU-emulated) fallback adapter.
    pub is_fallback: bool,
}

/// The result of a headless GPU render.
#[derive(Clone, Debug)]
pub struct GpuFrame {
    /// Straight-alpha RGBA8 pixels, `width * height * 4` bytes.
    pub rgba: Vec<u8>,
    /// Width, in pixels.
    pub width: u32,
    /// Height, in pixels.
    pub height: u32,
    /// The adapter that rendered this frame.
    pub adapter: AdapterReport,
}

/// Errors from the headless GPU pipeline.
#[derive(Debug)]
pub enum GpuError {
    /// No compatible adapter was found on this host.
    NoAdapter,
    /// The device could not be created.
    Device(wgpu::RequestDeviceError),
    /// Reading the rendered frame back from the GPU failed.
    Readback(String),
}

impl std::fmt::Display for GpuError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoAdapter => write!(f, "no compatible GPU adapter is available"),
            Self::Device(err) => write!(f, "failed to create GPU device: {err}"),
            Self::Readback(why) => write!(f, "GPU readback failed: {why}"),
        }
    }
}

impl std::error::Error for GpuError {}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GlobalsUniform {
    canvas_size: [f32; 2],
    _pad: [f32; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ShapeUniform {
    center_half_extent: [f32; 4],
    corners: [f32; 4],
    color: [f32; 4],
    params: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct TexParamsUniform {
    dest: [f32; 4],
    tint: [f32; 4],
    mode: [f32; 4],
}

/// The process-wide GPU context shared by every backend and host surface.
///
/// Keeping the [`wgpu::Instance`] and [`wgpu::Adapter`] alongside the device
/// lets hosts (Tauri windows, native layers) create presentation surfaces
/// that the shared device can configure: a surface must come from the same
/// instance as the device that presents to it.
#[derive(Clone, Debug)]
pub struct GpuContext {
    /// The instance the adapter and every host surface come from.
    pub instance: wgpu::Instance,
    /// The selected adapter (for surface capabilities).
    pub adapter: wgpu::Adapter,
    /// The shared device.
    pub device: wgpu::Device,
    /// The device queue.
    pub queue: wgpu::Queue,
    /// Adapter diagnostics.
    pub report: AdapterReport,
}

static SHARED_CONTEXT: std::sync::Mutex<Option<GpuContext>> = std::sync::Mutex::new(None);

/// Return the process-wide GPU context, creating it on first use on the
/// highest-performance adapter.
///
/// Every backend of this crate renders through this one device (and its
/// queue), so 2D snapshots, 3D frames and host-embedded renderers share GPU
/// memory, pipeline caches and driver state instead of opening a device per
/// frame. A lost device is dropped from the cache and recreated on the next
/// call.
///
/// # Errors
/// [`GpuError::NoAdapter`] when no adapter is usable (headless CI, remote
/// desktops); [`GpuError::Device`] when device creation fails.
pub fn shared_context() -> Result<GpuContext, GpuError> {
    let mut guard = SHARED_CONTEXT.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(context) = guard.as_ref() {
        return Ok(context.clone());
    }
    let created = pollster::block_on(create_context())?;
    created.device.set_device_lost_callback(|_, _| {
        if let Ok(mut cached) = SHARED_CONTEXT.try_lock() {
            *cached = None;
        }
    });
    *guard = Some(created.clone());
    Ok(created)
}

/// The shared device, queue and adapter report (see [`shared_context`]).
///
/// # Errors
/// See [`shared_context`].
pub fn shared_device() -> Result<(wgpu::Device, wgpu::Queue, AdapterReport), GpuError> {
    shared_context().map(|c| (c.device, c.queue, c.report))
}

async fn create_context() -> Result<GpuContext, GpuError> {
    // Windows: DX12 first — the native API, and the only one that presents
    // through DirectComposition (per-pixel transparent host windows).
    let preferred: &[wgpu::Backends] = if cfg!(windows) {
        &[wgpu::Backends::DX12, wgpu::Backends::all()]
    } else {
        &[wgpu::Backends::all()]
    };
    let mut selected = None;
    for &backends in preferred {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        if let Ok(adapter) = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
        {
            selected = Some((instance, adapter));
            break;
        }
    }
    let (instance, adapter) = selected.ok_or(GpuError::NoAdapter)?;
    let info = adapter.get_info();
    let report = AdapterReport {
        name: info.name.clone(),
        backend: format!("{:?}", info.backend),
        is_fallback: info.device_type == wgpu::DeviceType::Cpu,
    };
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("aphrody-render"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        })
        .await
        .map_err(GpuError::Device)?;
    Ok(GpuContext { instance, adapter, device, queue, report })
}

/// Render `scene` on the first available GPU adapter and read the result
/// back to an RGBA8 buffer.
///
/// # Errors
/// Returns [`GpuError::NoAdapter`] when no adapter satisfies the request
/// (headless CI, remote desktops without a GPU device) so callers can skip
/// GPU-only tests gracefully instead of panicking.
pub fn render_scene_gpu(scene: &Scene) -> Result<GpuFrame, GpuError> {
    pollster::block_on(render_scene_gpu_async(scene))
}

async fn render_scene_gpu_async(scene: &Scene) -> Result<GpuFrame, GpuError> {
    let (device, queue, adapter_report) = shared_device()?;

    let width = scene.width.max(1);
    let height = scene.height.max(1);
    let format = wgpu::TextureFormat::Rgba8Unorm;

    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("aphrody-render-target"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("aphrody-render-shape"),
        source: wgpu::ShaderSource::Wgsl(include_str!("gpu.wgsl").into()),
    });

    let globals = GlobalsUniform { canvas_size: [width as f32, height as f32], _pad: [0.0; 2] };
    let globals_buf = wgpu::util::DeviceExt::create_buffer_init(
        &device,
        &wgpu::util::BufferInitDescriptor {
            label: Some("globals"),
            contents: bytemuck::bytes_of(&globals),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        },
    );

    let shape_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("shape-bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    });
    let shape_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("shape-pipeline-layout"),
        bind_group_layouts: &[Some(&shape_bgl)],
        immediate_size: 0,
    });
    let blend = wgpu::BlendState {
        color: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::SrcAlpha,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
        alpha: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
            operation: wgpu::BlendOperation::Add,
        },
    };
    let shape_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("shape-pipeline"),
        layout: Some(&shape_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_shape"),
            buffers: &[],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_shape"),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(blend),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    });

    let tex_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("tex-bgl"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
        ],
    });
    let tex_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("tex-pipeline-layout"),
        bind_group_layouts: &[Some(&tex_bgl)],
        immediate_size: 0,
    });
    let tex_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("tex-pipeline"),
        layout: Some(&tex_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_tex"),
            buffers: &[],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_tex"),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(blend),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    });

    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("nearest"),
        mag_filter: wgpu::FilterMode::Nearest,
        min_filter: wgpu::FilterMode::Nearest,
        ..Default::default()
    });

    let scheme = scene.scheme();
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("aphrody-render-encoder"),
    });

    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("aphrody-render-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &target_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(background_clear(scene, &scheme)),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });

        for node in &scene.nodes {
            match node {
                Node::Surface { rect, corners, fill, elevation, outline } => {
                    if *elevation > 0 {
                        draw_shadow(
                            &device,
                            &queue,
                            &mut pass,
                            &shape_pipeline,
                            &shape_bgl,
                            &globals_buf,
                            *rect,
                            *corners,
                            *elevation,
                        );
                    }
                    draw_fill(
                        &device,
                        &queue,
                        &mut pass,
                        &shape_pipeline,
                        &shape_bgl,
                        &globals_buf,
                        *rect,
                        *corners,
                        fill.resolve(&scheme),
                        0.0,
                        0.0,
                    );
                    if let Some(outline) = outline {
                        draw_fill(
                            &device,
                            &queue,
                            &mut pass,
                            &shape_pipeline,
                            &shape_bgl,
                            &globals_buf,
                            *rect,
                            *corners,
                            outline.color.resolve(&scheme),
                            2.0,
                            outline.width,
                        );
                    }
                },
                Node::StateLayer { rect, corners, content, state } => {
                    let tinted = content.resolve(&scheme).with_alpha_factor(state.opacity());
                    draw_fill(
                        &device,
                        &queue,
                        &mut pass,
                        &shape_pipeline,
                        &shape_bgl,
                        &globals_buf,
                        *rect,
                        *corners,
                        tinted,
                        0.0,
                        0.0,
                    );
                },
                Node::Ripple { cx, cy, radius, color, alpha } => {
                    let rect = Rect::new(cx - radius, cy - radius, radius * 2.0, radius * 2.0);
                    let tinted = color.resolve(&scheme).with_alpha_factor(*alpha);
                    draw_fill(
                        &device,
                        &queue,
                        &mut pass,
                        &shape_pipeline,
                        &shape_bgl,
                        &globals_buf,
                        rect,
                        Corners::uniform(*radius),
                        tinted,
                        0.0,
                        0.0,
                    );
                },
                Node::Text { rect, text, style, color } => {
                    let bitmap = rasterize_line(text, *style, 1.0);
                    if bitmap.width > 0 && bitmap.height > 0 {
                        let tex = upload_coverage(
                            &device,
                            &queue,
                            bitmap.width,
                            bitmap.height,
                            &bitmap.coverage,
                        );
                        draw_textured(
                            &device,
                            &queue,
                            &mut pass,
                            &tex_pipeline,
                            &tex_bgl,
                            &globals_buf,
                            &sampler,
                            &tex,
                            *rect,
                            color.resolve(&scheme),
                            true,
                        );
                    }
                },
                Node::Icon { rect, path, color } => {
                    let width = rect.w.round().max(1.0) as u32;
                    let height = rect.h.round().max(1.0) as u32;
                    let subpaths = parse_svg_path(path);
                    let scale_x = width as f32 / 24.0;
                    let scale_y = height as f32 / 24.0;
                    let scaled: Vec<Vec<(f32, f32)>> = subpaths
                        .into_iter()
                        .map(|line| {
                            line.into_iter().map(|(x, y)| (x * scale_x, y * scale_y)).collect()
                        })
                        .collect();
                    let coverage = rasterize_polylines(&scaled, width, height, 4);
                    let tex = upload_coverage(&device, &queue, width, height, &coverage);
                    draw_textured(
                        &device,
                        &queue,
                        &mut pass,
                        &tex_pipeline,
                        &tex_bgl,
                        &globals_buf,
                        &sampler,
                        &tex,
                        *rect,
                        color.resolve(&scheme),
                        true,
                    );
                },
                Node::Image { rect, width, height, rgba } => {
                    let tex = upload_rgba(&device, &queue, *width, *height, rgba);
                    draw_textured(
                        &device,
                        &queue,
                        &mut pass,
                        &tex_pipeline,
                        &tex_bgl,
                        &globals_buf,
                        &sampler,
                        &tex,
                        *rect,
                        Rgba8::BLACK,
                        false,
                    );
                },
            }
        }
    }

    let bytes_per_row = align_bytes_per_row(width * 4);
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: u64::from(bytes_per_row) * u64::from(height),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &target,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit(std::iter::once(encoder.finish()));

    let slice = readback.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result);
    });
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|err| GpuError::Readback(err.to_string()))?;
    rx.recv()
        .map_err(|err| GpuError::Readback(err.to_string()))?
        .map_err(|err| GpuError::Readback(err.to_string()))?;

    let data = slice.get_mapped_range().map_err(|err| GpuError::Readback(err.to_string()))?;
    let mut rgba = vec![0_u8; (width as usize) * (height as usize) * 4];
    for row in 0..height as usize {
        let src = &data
            [row * bytes_per_row as usize..row * bytes_per_row as usize + (width as usize) * 4];
        let dst_start = row * (width as usize) * 4;
        rgba[dst_start..dst_start + (width as usize) * 4].copy_from_slice(src);
    }
    drop(data);
    readback.unmap();

    Ok(GpuFrame { rgba, width, height, adapter: adapter_report })
}

fn align_bytes_per_row(unaligned: u32) -> u32 {
    const ALIGN: u32 = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    unaligned.div_ceil(ALIGN) * ALIGN
}

fn background_clear(
    scene: &Scene,
    scheme: &aphrody_m3_tokens::facade::color::DynamicScheme,
) -> wgpu::Color {
    let Some(bg) = scene.background else {
        return wgpu::Color::TRANSPARENT;
    };
    let rgba = bg.resolve(scheme);
    wgpu::Color {
        r: f64::from(rgba.r) / 255.0,
        g: f64::from(rgba.g) / 255.0,
        b: f64::from(rgba.b) / 255.0,
        a: f64::from(rgba.a) / 255.0,
    }
}

fn rgba_to_color4(color: Rgba8) -> [f32; 4] {
    [
        f32::from(color.r) / 255.0,
        f32::from(color.g) / 255.0,
        f32::from(color.b) / 255.0,
        f32::from(color.a) / 255.0,
    ]
}

#[allow(clippy::too_many_arguments)]
fn draw_fill<'pass>(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pass: &mut wgpu::RenderPass<'pass>,
    pipeline: &'pass wgpu::RenderPipeline,
    bgl: &wgpu::BindGroupLayout,
    globals_buf: &wgpu::Buffer,
    rect: Rect,
    corners: Corners,
    color: Rgba8,
    kind: f32,
    param: f32,
) {
    if rect.is_empty() || color.a == 0 {
        return;
    }
    let corners = corners.clamped(rect.w, rect.h);
    let uniform = ShapeUniform {
        center_half_extent: [
            rect.x + rect.w / 2.0,
            rect.y + rect.h / 2.0,
            rect.w / 2.0,
            rect.h / 2.0,
        ],
        corners: [corners.tl, corners.tr, corners.br, corners.bl],
        color: rgba_to_color4(color),
        params: [kind, param, 0.0, 0.0],
    };
    let buf = wgpu::util::DeviceExt::create_buffer_init(
        device,
        &wgpu::util::BufferInitDescriptor {
            label: Some("shape-instance"),
            contents: bytemuck::bytes_of(&uniform),
            usage: wgpu::BufferUsages::UNIFORM,
        },
    );
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shape-bind-group"),
        layout: bgl,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: globals_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
        ],
    });
    let _ = queue;
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, Some(&bind_group), &[]);
    pass.draw(0..4, 0..1);
}

#[expect(
    clippy::too_many_arguments,
    reason = "GPU draw helper: each argument is a distinct wgpu resource or shadow parameter"
)]
fn draw_shadow<'pass>(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pass: &mut wgpu::RenderPass<'pass>,
    pipeline: &'pass wgpu::RenderPipeline,
    bgl: &wgpu::BindGroupLayout,
    globals_buf: &wgpu::Buffer,
    rect: Rect,
    corners: Corners,
    elevation: u8,
) {
    let (offset_y, sigma) = shadow_params(elevation, 1.0);
    let shadow_color = Rgba8 { r: 0, g: 0, b: 0, a: (0.30 * 255.0) as u8 };
    let pad = sigma * 3.0;
    let padded = Rect::new(rect.x - pad, rect.y - pad, rect.w + pad * 2.0, rect.h + pad * 2.0);
    let padded_corners = Corners::uniform(0.0); // unused for shadow kind; SDF uses `corners` below.
    let _ = padded_corners;
    let corners = corners.clamped(rect.w, rect.h);
    let uniform_rect = padded;
    let uniform = ShapeUniform {
        center_half_extent: [
            rect.x + rect.w / 2.0,
            rect.y + rect.h / 2.0,
            rect.w / 2.0,
            rect.h / 2.0,
        ],
        corners: [corners.tl, corners.tr, corners.br, corners.bl],
        color: rgba_to_color4(shadow_color),
        params: [1.0, sigma, offset_y, 0.0],
    };
    let _ = uniform_rect;
    let buf = wgpu::util::DeviceExt::create_buffer_init(
        device,
        &wgpu::util::BufferInitDescriptor {
            label: Some("shadow-instance"),
            contents: bytemuck::bytes_of(&uniform),
            usage: wgpu::BufferUsages::UNIFORM,
        },
    );
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shadow-bind-group"),
        layout: bgl,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: globals_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: buf.as_entire_binding() },
        ],
    });
    let _ = queue;
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, Some(&bind_group), &[]);
    pass.draw(0..4, 0..1);
}

fn upload_coverage(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    width: u32,
    height: u32,
    coverage: &[u8],
) -> wgpu::Texture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("coverage"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        coverage,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    texture
}

fn upload_rgba(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> wgpu::Texture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("image"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    if width > 0 && height > 0 {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
    }
    texture
}

#[allow(clippy::too_many_arguments)]
fn draw_textured<'pass>(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pass: &mut wgpu::RenderPass<'pass>,
    pipeline: &'pass wgpu::RenderPipeline,
    bgl: &wgpu::BindGroupLayout,
    globals_buf: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    texture: &wgpu::Texture,
    rect: Rect,
    tint: Rgba8,
    coverage_mode: bool,
) {
    if rect.is_empty() {
        return;
    }
    let uniform = TexParamsUniform {
        dest: [rect.x, rect.y, rect.w, rect.h],
        tint: rgba_to_color4(tint),
        mode: [if coverage_mode { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0],
    };
    let buf = wgpu::util::DeviceExt::create_buffer_init(
        device,
        &wgpu::util::BufferInitDescriptor {
            label: Some("tex-instance"),
            contents: bytemuck::bytes_of(&uniform),
            usage: wgpu::BufferUsages::UNIFORM,
        },
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("tex-bind-group"),
        layout: bgl,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: globals_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 2, resource: buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(sampler) },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: wgpu::BindingResource::TextureView(&view),
            },
        ],
    });
    let _ = queue;
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, Some(&bind_group), &[]);
    pass.draw(0..4, 0..1);
}

#[cfg(test)]
mod tests {
    use aphrody_m3_tokens::facade::color::{Role, Variant};

    use super::*;
    use crate::{
        raster::render_scene,
        scene::{Corners, Node, Paint, Rect, Scene},
    };

    fn scene() -> Scene {
        Scene {
            width: 48,
            height: 48,
            seed_argb: 0xFF67_50A4,
            variant: Variant::TonalSpot,
            is_dark: false,
            contrast_level: 0.0,
            background: Some(Paint::Role(Role::Surface)),
            nodes: vec![Node::Surface {
                rect: Rect::new(4.0, 4.0, 40.0, 24.0),
                corners: Corners::uniform(6.0),
                fill: Paint::Role(Role::PrimaryContainer),
                elevation: 1,
                outline: None,
            }],
        }
    }

    /// Skips gracefully (does not fail the suite) when no adapter is
    /// available, per the render-pipeline skill and the task's parity gate.
    #[test]
    fn gpu_matches_cpu_within_tolerance() {
        let Ok(gpu_frame) = render_scene_gpu(&scene()) else {
            eprintln!("skipping gpu_matches_cpu_within_tolerance: no GPU adapter available");
            return;
        };
        println!("adapter: {} ({})", gpu_frame.adapter.name, gpu_frame.adapter.backend);
        let cpu = render_scene(&scene());
        assert_eq!(gpu_frame.width, cpu.width);
        assert_eq!(gpu_frame.height, cpu.height);

        let mut within_tolerance = 0_usize;
        let total = (cpu.width as usize) * (cpu.height as usize);
        for i in 0..total {
            let c = &cpu.pixels[i * 4..i * 4 + 4];
            let g = &gpu_frame.rgba[i * 4..i * 4 + 4];
            let diff = c
                .iter()
                .zip(g)
                .map(|(a, b)| i32::from(*a).abs_diff(i32::from(*b)))
                .max()
                .unwrap_or(0);
            if diff <= 2 {
                within_tolerance += 1;
            }
        }
        let ratio = within_tolerance as f64 / total as f64;
        assert!(ratio >= 0.995, "only {:.4}% of pixels within tolerance", ratio * 100.0);
    }
}
