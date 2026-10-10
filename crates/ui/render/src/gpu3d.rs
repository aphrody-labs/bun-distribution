// SPDX-License-Identifier: Apache-2.0
//! Persistent, instanced `wgpu` backend for [`Scene3d`] (feature `gpu`).
//!
//! [`Renderer3d`] owns one device and keeps everything reusable alive across
//! frames, so a continuous render loop pays no per-frame setup:
//!
//! - render pipelines, created once per `(format, samples, double_sided, transparent)`;
//! - one GPU vertex/index buffer pair per distinct geometry, keyed by
//!   [`crate::mesh3d::Geometry::cache_key`] and evicted after [`MESH_TTL_FRAMES`] unused frames
//!   (the CPU [`MeshCache`] is pruned in step);
//! - one geometrically grown instance buffer and one uniform buffer;
//! - MSAA colour and depth attachments per target size and format, plus the offscreen
//!   resolve/readback pair;
//! - host surfaces: [`Renderer3d::render_to_view`] draws into any colour view (sRGB or unorm)
//!   inside a viewport, for native layers under a webview.
//!
//! Each [`crate::scene3d::DrawBatch`] of [`Prepared3d`] becomes a single
//! `draw_indexed` call over its instance range, so draw calls scale with the
//! number of distinct `(mesh, pipeline)` pairs, not with the number of nodes.
//! Shading (`src/gpu3d.wgsl`) mirrors [`crate::raster3d::shade`].

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::{
    gpu::AdapterReport,
    mesh3d::MeshCache,
    scene3d::{MAX_LIGHTS, Prepared3d, PreparedLight, Scene3d, Scene3dError},
};

/// Frames a geometry may stay unused before its GPU buffers are released.
pub const MESH_TTL_FRAMES: u64 = 120;

const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Errors from the 3D GPU backend.
#[derive(Debug)]
pub enum Gpu3dError {
    /// No compatible adapter was found on this host.
    NoAdapter,
    /// The device could not be created.
    Device(wgpu::RequestDeviceError),
    /// The scene failed validation.
    Scene(Scene3dError),
    /// Reading the frame back from the GPU failed.
    Readback(String),
}

impl std::fmt::Display for Gpu3dError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoAdapter => write!(f, "no compatible GPU adapter is available"),
            Self::Device(err) => write!(f, "failed to create GPU device: {err}"),
            Self::Scene(err) => err.fmt(f),
            Self::Readback(why) => write!(f, "GPU readback failed: {why}"),
        }
    }
}

impl std::error::Error for Gpu3dError {}

impl From<Scene3dError> for Gpu3dError {
    fn from(err: Scene3dError) -> Self {
        Self::Scene(err)
    }
}

/// A frame rendered and read back by [`Renderer3d`].
#[derive(Clone, Debug)]
pub struct Frame3d {
    /// Straight-alpha, sRGB-encoded RGBA8 pixels, `width * height * 4` bytes.
    pub rgba: Vec<u8>,
    /// Width, in pixels.
    pub width: u32,
    /// Height, in pixels.
    pub height: u32,
    /// The adapter that rendered this frame.
    pub adapter: AdapterReport,
    /// Draw calls issued (one per batch).
    pub draw_calls: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LightGpu {
    vector_kind: [f32; 4],
    radiance_range: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GlobalsGpu {
    view_proj: [[f32; 4]; 4],
    light_vp: [[f32; 4]; 4],
    eye: [f32; 4],
    sky: [f32; 4],
    ground: [f32; 4],
    shadow: [f32; 4],
    counts: [u32; 4],
    lights: [LightGpu; MAX_LIGHTS],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceGpu {
    model: [[f32; 4]; 4],
    normal: [[f32; 4]; 3],
    base: [f32; 4],
    emissive: [f32; 4],
    params: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct VertexGpu {
    position: [f32; 3],
    normal: [f32; 3],
}

struct GpuMesh {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    last_used: u64,
}

/// Multisample colour and depth attachments for one target size and format.
struct Attachments {
    width: u32,
    height: u32,
    samples: u32,
    format: wgpu::TextureFormat,
    msaa: Option<wgpu::TextureView>,
    depth: wgpu::TextureView,
}

/// The renderer-owned single-sample target and its readback buffer.
struct Offscreen {
    width: u32,
    height: u32,
    resolve: wgpu::Texture,
    resolve_view: wgpu::TextureView,
    readback: wgpu::Buffer,
    bytes_per_row: u32,
}

/// Where a frame is drawn.
enum Output<'a> {
    /// The renderer's own `Rgba8Unorm` texture, copied to the readback buffer.
    Offscreen,
    /// A host-owned view (e.g. a window surface texture), drawn into the
    /// `size`-sized attachment at `origin` with the frame's dimensions.
    View {
        view: &'a wgpu::TextureView,
        format: wgpu::TextureFormat,
        size: (u32, u32),
        origin: (u32, u32),
    },
}

/// A persistent headless 3D renderer bound to one GPU device.
pub struct Renderer3d {
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter: AdapterReport,
    shader: wgpu::ShaderModule,
    layout: wgpu::PipelineLayout,
    bind_group: wgpu::BindGroup,
    globals: wgpu::Buffer,
    pipelines: HashMap<(wgpu::TextureFormat, u32, bool, bool), wgpu::RenderPipeline>,
    shadow_pipeline: wgpu::RenderPipeline,
    shadow_bgl: wgpu::BindGroupLayout,
    /// Shadow map depth view and its fragment bind group, keyed by
    /// resolution (`1` is the unused placeholder).
    shadow: (u32, wgpu::TextureView, wgpu::BindGroup),
    meshes: HashMap<u64, GpuMesh>,
    mesh_cache: MeshCache,
    instances: Option<(wgpu::Buffer, u64)>,
    attachments: Option<Attachments>,
    offscreen: Option<Offscreen>,
    frame: u64,
}

impl std::fmt::Debug for Renderer3d {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer3d")
            .field("adapter", &self.adapter)
            .field("pipelines", &self.pipelines.len())
            .field("meshes", &self.meshes.len())
            .field("frame", &self.frame)
            .finish_non_exhaustive()
    }
}

impl Renderer3d {
    /// Create a renderer on the process-wide shared device
    /// ([`crate::gpu::shared_device`], highest-performance adapter).
    ///
    /// # Errors
    /// [`Gpu3dError::NoAdapter`] on hosts without a usable GPU (headless CI,
    /// remote desktops) so callers can fall back to [`crate::raster3d`];
    /// [`Gpu3dError::Device`] when the device cannot be created.
    pub fn new() -> Result<Self, Gpu3dError> {
        let (device, queue, adapter) = crate::gpu::shared_device().map_err(|err| match err {
            crate::gpu::GpuError::NoAdapter => Gpu3dError::NoAdapter,
            crate::gpu::GpuError::Device(err) => Gpu3dError::Device(err),
            crate::gpu::GpuError::Readback(why) => Gpu3dError::Readback(why),
        })?;
        Ok(Self::with_device(device, queue, adapter))
    }

    /// Build a renderer on a device owned by a host (Tauri/CEF, a windowed
    /// app) so 3D shares its GPU context instead of opening a second one.
    #[must_use]
    pub fn with_device(device: wgpu::Device, queue: wgpu::Queue, adapter: AdapterReport) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("aphrody-render-3d"),
            source: wgpu::ShaderSource::Wgsl(include_str!("gpu3d.wgsl").into()),
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("3d-globals"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: wgpu::BufferSize::new(
                        std::mem::size_of::<GlobalsGpu>() as u64
                    ),
                },
                count: None,
            }],
        });
        let shadow_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("3d-shadow-map"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("3d-layout"),
            bind_group_layouts: &[Some(&bgl), Some(&shadow_bgl)],
            immediate_size: 0,
        });
        let shadow_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("3d-shadow-layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });
        let shadow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("3d-shadow"),
            layout: Some(&shadow_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_shadow"),
                buffers: &vertex_layouts(),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: None,
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let shadow = shadow_target(&device, &shadow_bgl, 1);
        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("3d-globals"),
            size: std::mem::size_of::<GlobalsGpu>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("3d-globals"),
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: globals.as_entire_binding() }],
        });
        Self {
            device,
            queue,
            adapter,
            shader,
            layout,
            bind_group,
            globals,
            pipelines: HashMap::new(),
            shadow_pipeline,
            shadow_bgl,
            shadow,
            meshes: HashMap::new(),
            mesh_cache: MeshCache::new(),
            instances: None,
            attachments: None,
            offscreen: None,
            frame: 0,
        }
    }

    /// The adapter this renderer runs on.
    #[must_use]
    pub fn adapter(&self) -> &AdapterReport {
        &self.adapter
    }

    /// The underlying device, for hosts that composite the output texture.
    #[must_use]
    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    /// The underlying queue.
    #[must_use]
    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// Number of geometries currently resident on the GPU.
    #[must_use]
    pub fn resident_meshes(&self) -> usize {
        self.meshes.len()
    }

    /// Prepare `scene` (sharing the renderer's tessellation cache), render it
    /// and read the frame back.
    ///
    /// # Errors
    /// [`Gpu3dError::Scene`] for an invalid scene, [`Gpu3dError::Readback`]
    /// when mapping the result fails.
    pub fn render(&mut self, scene: &Scene3d) -> Result<Frame3d, Gpu3dError> {
        let prepared = scene.prepare_with(&mut self.mesh_cache)?;
        self.render_prepared(&prepared)
    }

    /// Prepare `scene` with the renderer's tessellation cache (for
    /// [`Renderer3d::render_to_view`] and [`Renderer3d::render_prepared`]).
    ///
    /// # Errors
    /// The scene validation error.
    pub fn prepare(&mut self, scene: &Scene3d) -> Result<Prepared3d, Scene3dError> {
        scene.prepare_with(&mut self.mesh_cache)
    }

    /// Render an already prepared frame and read it back.
    ///
    /// # Errors
    /// [`Gpu3dError::Readback`] when mapping the result fails.
    pub fn render_prepared(&mut self, prepared: &Prepared3d) -> Result<Frame3d, Gpu3dError> {
        let draw_calls = self.draw(prepared, &Output::Offscreen);
        let offscreen = self.offscreen.as_ref().expect("the offscreen target is created by draw");
        let (width, height) = (offscreen.width, offscreen.height);
        let bytes_per_row = offscreen.bytes_per_row;

        let slice = offscreen.readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|err| Gpu3dError::Readback(format!("{err:?}")))?;
        rx.recv()
            .map_err(|err| Gpu3dError::Readback(err.to_string()))?
            .map_err(|err| Gpu3dError::Readback(err.to_string()))?;
        let row_bytes = width as usize * 4;
        let mut rgba = vec![0_u8; row_bytes * height as usize];
        {
            let data =
                slice.get_mapped_range().map_err(|err| Gpu3dError::Readback(err.to_string()))?;
            for (dst, src) in
                rgba.chunks_exact_mut(row_bytes).zip(data.chunks_exact(bytes_per_row as usize))
            {
                dst.copy_from_slice(&src[..row_bytes]);
            }
        }
        offscreen.readback.unmap();
        Ok(Frame3d { rgba, width, height, adapter: self.adapter.clone(), draw_calls })
    }

    /// Render an already prepared frame into the renderer's resolve texture
    /// without reading it back, for hosts that composite on the GPU. The
    /// texture (`Rgba8Unorm`, sRGB-encoded values) stays valid until the next
    /// call that changes the canvas size.
    pub fn render_to_texture(&mut self, prepared: &Prepared3d) -> &wgpu::Texture {
        self.draw(prepared, &Output::Offscreen);
        &self.offscreen.as_ref().expect("the offscreen target is created by draw").resolve
    }

    /// Render an already prepared frame into a host-owned view — typically a
    /// window surface texture — of `target_size` pixels and `format`, inside
    /// the viewport at `origin` sized `prepared.width` x `prepared.height`
    /// (clamped to the target). The whole target is cleared first.
    ///
    /// Any colour format works: sRGB formats get linear output (the hardware
    /// encodes), unorm formats get sRGB-encoded output, so the pixels match
    /// the CPU reference either way. Returns the number of draw calls.
    pub fn render_to_view(
        &mut self,
        prepared: &Prepared3d,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        target_size: (u32, u32),
        origin: (u32, u32),
    ) -> u32 {
        self.draw(prepared, &Output::View { view, format, size: target_size, origin })
    }

    fn pipeline(
        &mut self,
        format: wgpu::TextureFormat,
        samples: u32,
        double_sided: bool,
        transparent: bool,
    ) {
        if self.pipelines.contains_key(&(format, samples, double_sided, transparent)) {
            return;
        }
        let blend = transparent.then_some(wgpu::BlendState {
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
        });
        // sRGB targets encode in hardware: the shader then outputs linear.
        let constants = [("OUTPUT_LINEAR", if format.is_srgb() { 1.0 } else { 0.0 })];
        let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("3d-mesh"),
            layout: Some(&self.layout),
            vertex: wgpu::VertexState {
                module: &self.shader,
                entry_point: Some("vs_main"),
                buffers: &vertex_layouts(),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &self.shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &constants,
                    ..Default::default()
                },
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: if double_sided { None } else { Some(wgpu::Face::Back) },
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(!transparent),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState { count: samples, ..Default::default() },
            multiview_mask: None,
            cache: None,
        });
        self.pipelines.insert((format, samples, double_sided, transparent), pipeline);
    }

    fn texture(
        &self,
        label: &'static str,
        (width, height): (u32, u32),
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
        sample_count: u32,
    ) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
    }

    fn ensure_attachments(&mut self, size: (u32, u32), samples: u32, format: wgpu::TextureFormat) {
        if self.attachments.as_ref().is_some_and(|a| {
            (a.width, a.height) == size && a.samples == samples && a.format == format
        }) {
            return;
        }
        let msaa = (samples > 1).then(|| {
            self.texture("3d-msaa", size, format, wgpu::TextureUsages::RENDER_ATTACHMENT, samples)
                .create_view(&wgpu::TextureViewDescriptor::default())
        });
        let depth = self
            .texture(
                "3d-depth",
                size,
                DEPTH_FORMAT,
                wgpu::TextureUsages::RENDER_ATTACHMENT,
                samples,
            )
            .create_view(&wgpu::TextureViewDescriptor::default());
        self.attachments =
            Some(Attachments { width: size.0, height: size.1, samples, format, msaa, depth });
    }

    fn ensure_offscreen(&mut self, width: u32, height: u32) {
        if self.offscreen.as_ref().is_some_and(|o| o.width == width && o.height == height) {
            return;
        }
        let resolve = self.texture(
            "3d-resolve",
            (width, height),
            COLOR_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            1,
        );
        let resolve_view = resolve.create_view(&wgpu::TextureViewDescriptor::default());
        let bytes_per_row = (width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("3d-readback"),
            size: u64::from(bytes_per_row) * u64::from(height),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        self.offscreen =
            Some(Offscreen { width, height, resolve, resolve_view, readback, bytes_per_row });
    }

    fn upload_meshes(&mut self, prepared: &Prepared3d) {
        for (key, mesh) in prepared.mesh_keys.iter().zip(&prepared.meshes) {
            let frame = self.frame;
            if let Some(resident) = self.meshes.get_mut(key) {
                resident.last_used = frame;
                continue;
            }
            let vertices: Vec<VertexGpu> = mesh
                .positions
                .iter()
                .zip(&mesh.normals)
                .map(|(p, n)| VertexGpu { position: *p, normal: *n })
                .collect();
            let vertices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("3d-vertices"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let indices = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("3d-indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            self.meshes.insert(
                *key,
                GpuMesh {
                    vertices,
                    indices,
                    index_count: mesh.indices.len() as u32,
                    last_used: frame,
                },
            );
        }
        let frame = self.frame;
        self.meshes.retain(|_, m| frame.saturating_sub(m.last_used) <= MESH_TTL_FRAMES);
        let resident: std::collections::HashSet<u64> = self.meshes.keys().copied().collect();
        self.mesh_cache.retain(|k| resident.contains(&k));
    }

    fn upload_instances(&mut self, prepared: &Prepared3d) {
        let data: Vec<InstanceGpu> = prepared
            .instances
            .iter()
            .map(|inst| {
                let n = &inst.normal;
                InstanceGpu {
                    model: inst.model.cols,
                    // WGSL mat3x3 columns from the row-major normal matrix.
                    normal: [
                        [n[0][0], n[1][0], n[2][0], 0.0],
                        [n[0][1], n[1][1], n[2][1], 0.0],
                        [n[0][2], n[1][2], n[2][2], 0.0],
                    ],
                    base: [inst.base[0], inst.base[1], inst.base[2], inst.alpha],
                    emissive: [
                        inst.emissive[0],
                        inst.emissive[1],
                        inst.emissive[2],
                        if inst.unlit { 1.0 } else { 0.0 },
                    ],
                    params: [inst.metallic, inst.roughness, 0.0, 0.0],
                }
            })
            .collect();
        if data.is_empty() {
            return;
        }
        let bytes: &[u8] = bytemuck::cast_slice(&data);
        let needed = bytes.len() as u64;
        if self.instances.as_ref().is_none_or(|(_, cap)| *cap < needed) {
            let capacity = needed.next_power_of_two().max(16 * 1024);
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("3d-instances"),
                size: capacity,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.instances = Some((buffer, capacity));
        }
        if let Some((buffer, _)) = &self.instances {
            self.queue.write_buffer(buffer, 0, bytes);
        }
    }

    fn upload_globals(&self, prepared: &Prepared3d) {
        let mut lights = [LightGpu::zeroed(); MAX_LIGHTS];
        for (dst, light) in lights.iter_mut().zip(&prepared.lights) {
            *dst = match *light {
                PreparedLight::Directional { to_light, radiance } => LightGpu {
                    vector_kind: [to_light.x, to_light.y, to_light.z, 0.0],
                    radiance_range: [radiance[0], radiance[1], radiance[2], 0.0],
                },
                PreparedLight::Point { position, radiance, range } => LightGpu {
                    vector_kind: [position.x, position.y, position.z, 1.0],
                    radiance_range: [radiance[0], radiance[1], radiance[2], range],
                },
            };
        }
        let (s, gr) = (prepared.sky, prepared.ground);
        let (light_vp, shadow, shadow_light) = match &prepared.shadow {
            Some(setup) => (
                setup.view_proj.cols,
                [setup.normal_offset, setup.depth_bias, setup.resolution as f32, 0.0],
                setup.light as u32,
            ),
            None => (crate::math3d::Mat4::IDENTITY.cols, [0.0; 4], u32::MAX),
        };
        let globals = GlobalsGpu {
            view_proj: prepared.view_proj.cols,
            light_vp,
            eye: [prepared.eye.x, prepared.eye.y, prepared.eye.z, 1.0],
            sky: [s[0], s[1], s[2], 0.0],
            ground: [gr[0], gr[1], gr[2], 0.0],
            shadow,
            counts: [prepared.lights.len().min(MAX_LIGHTS) as u32, shadow_light, 0, 0],
            lights,
        };
        self.queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));
    }

    /// Encode and submit one frame to `output` (with the readback copy for
    /// the offscreen target). Returns the number of draw calls.
    fn draw(&mut self, prepared: &Prepared3d, output: &Output<'_>) -> u32 {
        self.frame += 1;
        let samples = prepared.samples;
        let (format, size, origin) = match *output {
            Output::Offscreen => (COLOR_FORMAT, (prepared.width, prepared.height), (0, 0)),
            Output::View { format, size, origin, .. } => (format, size, origin),
        };
        for batch in &prepared.batches {
            self.pipeline(format, samples, batch.double_sided, batch.transparent);
        }
        self.ensure_attachments(size, samples, format);
        if matches!(output, Output::Offscreen) {
            self.ensure_offscreen(prepared.width, prepared.height);
        }
        self.upload_meshes(prepared);
        self.upload_instances(prepared);
        self.upload_globals(prepared);

        if let Some(setup) = &prepared.shadow {
            if self.shadow.0 != setup.resolution {
                self.shadow = shadow_target(&self.device, &self.shadow_bgl, setup.resolution);
            }
        }
        let attachments = self.attachments.as_ref().expect("attachments were just ensured");
        let target_view = match *output {
            Output::Offscreen => {
                &self.offscreen.as_ref().expect("offscreen target was just ensured").resolve_view
            },
            Output::View { view, .. } => view,
        };
        // Viewport clamped to the attachment (WebGPU requires it in bounds).
        let vx = origin.0.min(size.0.saturating_sub(1));
        let vy = origin.1.min(size.1.saturating_sub(1));
        let vw = prepared.width.min(size.0 - vx).max(1);
        let vh = prepared.height.min(size.1 - vy).max(1);
        let clear = prepared.clear.map_or(wgpu::Color::TRANSPARENT, |c| wgpu::Color {
            r: f64::from(c.r) / 255.0,
            g: f64::from(c.g) / 255.0,
            b: f64::from(c.b) / 255.0,
            a: f64::from(c.a) / 255.0,
        });
        let (view, resolve_target) = match &attachments.msaa {
            Some(msaa) => (msaa, Some(target_view)),
            None => (target_view, None),
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("3d-frame") });
        let mut draw_calls = 0_u32;
        if prepared.shadow.is_some() {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("3d-shadow-pass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.shadow.1,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.shadow_pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            if let Some((instances, _)) = &self.instances {
                pass.set_vertex_buffer(1, instances.slice(..));
            }
            for batch in &prepared.shadow_batches {
                let mesh = &self.meshes[&prepared.mesh_keys[batch.mesh]];
                pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(
                    0..mesh.index_count,
                    0,
                    batch.first_instance..batch.first_instance + batch.instance_count,
                );
                draw_calls += 1;
            }
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("3d-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
                        // The multisampled attachment is only needed until
                        // it is resolved.
                        store: if attachments.msaa.is_some() {
                            wgpu::StoreOp::Discard
                        } else {
                            wgpu::StoreOp::Store
                        },
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &attachments.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.set_viewport(vx as f32, vy as f32, vw as f32, vh as f32, 0.0, 1.0);
            pass.set_scissor_rect(vx, vy, vw, vh);
            pass.set_bind_group(1, &self.shadow.2, &[]);
            if let Some((instances, _)) = &self.instances {
                pass.set_vertex_buffer(1, instances.slice(..));
            }
            let mut current: Option<(bool, bool)> = None;
            for batch in &prepared.batches {
                let state = (batch.double_sided, batch.transparent);
                if current != Some(state) {
                    pass.set_pipeline(&self.pipelines[&(format, samples, state.0, state.1)]);
                    current = Some(state);
                }
                let mesh = &self.meshes[&prepared.mesh_keys[batch.mesh]];
                pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(
                    0..mesh.index_count,
                    0,
                    batch.first_instance..batch.first_instance + batch.instance_count,
                );
                draw_calls += 1;
            }
        }
        if let (Output::Offscreen, Some(offscreen)) = (output, &self.offscreen) {
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &offscreen.resolve,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &offscreen.readback,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(offscreen.bytes_per_row),
                        rows_per_image: Some(offscreen.height),
                    },
                },
                wgpu::Extent3d {
                    width: offscreen.width,
                    height: offscreen.height,
                    depth_or_array_layers: 1,
                },
            );
        }
        self.queue.submit(std::iter::once(encoder.finish()));
        draw_calls
    }
}

fn vertex_layouts() -> [Option<wgpu::VertexBufferLayout<'static>>; 2] {
    const MESH: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
    const INSTANCE: [wgpu::VertexAttribute; 10] = wgpu::vertex_attr_array![
        2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Float32x4,
        6 => Float32x4, 7 => Float32x4, 8 => Float32x4,
        9 => Float32x4, 10 => Float32x4, 11 => Float32x4
    ];
    [
        Some(wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<VertexGpu>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &MESH,
        }),
        Some(wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<InstanceGpu>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &INSTANCE,
        }),
    ]
}

/// Create the shadow-map depth texture and its fragment bind group.
fn shadow_target(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    resolution: u32,
) -> (u32, wgpu::TextureView, wgpu::BindGroup) {
    let view = device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("3d-shadow-map"),
            size: wgpu::Extent3d {
                width: resolution,
                height: resolution,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default());
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("3d-shadow-map"),
        layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::TextureView(&view),
        }],
    });
    (resolution, view, bind_group)
}

/// One-shot convenience: create a renderer, render `scene`, drop the device.
/// Prefer a long-lived [`Renderer3d`] for more than one frame.
///
/// # Errors
/// See [`Renderer3d::new`] and [`Renderer3d::render`].
pub fn render_scene3d_gpu(scene: &Scene3d) -> Result<Frame3d, Gpu3dError> {
    Renderer3d::new()?.render(scene)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        fixtures::{instanced_grid_scene3d, showcase_scene3d},
        raster3d::render_scene3d,
    };

    fn parity(scene: &Scene3d, renderer: &mut Renderer3d) -> f64 {
        let gpu = renderer.render(scene).expect("gpu render");
        let cpu = render_scene3d(scene).expect("cpu render");
        assert_eq!((gpu.width, gpu.height), (cpu.width, cpu.height));
        let total = (cpu.width * cpu.height) as usize;
        let within = cpu
            .pixels
            .chunks_exact(4)
            .zip(gpu.rgba.chunks_exact(4))
            .filter(|(c, g)| c.iter().zip(g.iter()).all(|(a, b)| a.abs_diff(*b) <= 3))
            .count();
        within as f64 / total as f64
    }

    /// Skips (does not fail) when no adapter is available, like the 2D
    /// parity test.
    #[test]
    fn gpu3d_matches_cpu_reference() {
        let mut renderer = match Renderer3d::new() {
            Ok(r) => r,
            Err(err) => {
                eprintln!("skipping gpu3d_matches_cpu_reference: {err}");
                return;
            },
        };
        println!("adapter: {} ({})", renderer.adapter().name, renderer.adapter().backend);
        for samples in [1, 4] {
            let mut scene = showcase_scene3d(320, 200);
            scene.samples = samples;
            let ratio = parity(&scene, &mut renderer);
            println!("showcase x{samples}: {:.4}% within 3/255", ratio * 100.0);
            assert!(ratio >= 0.99, "x{samples}: only {:.4}% within tolerance", ratio * 100.0);
        }
        let grid = instanced_grid_scene3d(320, 180, 64);
        let ratio = parity(&grid, &mut renderer);
        println!("grid: {:.4}% within 3/255", ratio * 100.0);
        assert!(ratio >= 0.99);
    }

    #[test]
    fn renderer_batches_instances_and_reuses_gpu_meshes() {
        let Ok(mut renderer) = Renderer3d::new() else {
            eprintln!("skipping renderer_batches_instances_and_reuses_gpu_meshes: no adapter");
            return;
        };
        let scene = instanced_grid_scene3d(160, 90, 256);
        let first = renderer.render(&scene).expect("render");
        // 256 instances of 2 meshes: 2 shadow-pass draws + 2 main-pass draws.
        assert_eq!(first.draw_calls, 4, "instancing must not scale draws with instances");
        assert_eq!(renderer.resident_meshes(), 2);
        let second = renderer.render(&scene).expect("render");
        assert_eq!(first.rgba, second.rgba, "rendering must be stable across frames");
        assert_eq!(renderer.resident_meshes(), 2);
    }
}
