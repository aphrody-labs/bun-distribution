use aphrody_ctr_emu::{Image, Video};

use crate::Layout;

/// How the top screen shows stereo 3D frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Stereo {
    /// Left eye only.
    #[default]
    Off,
    /// Red (left eye) and cyan (right eye) anaglyph.
    Anaglyph,
}

const SHADER: &str = r"
struct Params { mode: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var left_eye: texture_2d<f32>;
@group(0) @binding(1) var right_eye: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> params: Params;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o: VOut;
    o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2<f32>(p.x, 1.0 - p.y);
    return o;
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    let l = textureSample(left_eye, samp, in.uv);
    if (params.mode == 1u) {
        let r = textureSample(right_eye, samp, in.uv);
        return vec4<f32>(l.r, r.g, r.b, 1.0);
    }
    return vec4<f32>(l.rgb, 1.0);
}
";

struct ScreenTarget {
    size: (u32, u32),
    left: wgpu::Texture,
    right: wgpu::Texture,
    params: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

/// Draws the two 3DS screens into a window surface.
pub struct Renderer {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    top: Option<ScreenTarget>,
    bottom: Option<ScreenTarget>,
    stereo: Stereo,
}

impl Renderer {
    /// Creates the device for `surface` and configures it at `size`.
    pub async fn new(
        instance: &wgpu::Instance,
        surface: wgpu::Surface<'static>,
        size: (u32, u32),
    ) -> Result<Self, String> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|e| format!("no GPU adapter: {e}"))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| format!("device: {e}"))?;
        let caps = surface.get_capabilities(&adapter);
        // The emulator's pixels are already display-encoded: use a non-sRGB surface.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .or_else(|| caps.formats.first().copied())
            .ok_or("surface has no formats")?;
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.0.max(1),
            height: size.1.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes.first().copied().unwrap_or(wgpu::CompositeAlphaMode::Auto),
            view_formats: Vec::new(),
            color_space: wgpu::SurfaceColorSpace::Auto,
        };
        surface.configure(&device, &config);

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ctr_screens"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let texture_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ctr_screens_bgl"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
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
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ctr_screens_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("ctr_screens_sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Ok(Self {
            surface,
            config,
            device,
            queue,
            pipeline,
            layout,
            sampler,
            top: None,
            bottom: None,
            stereo: Stereo::Off,
        })
    }

    pub fn set_stereo(&mut self, stereo: Stereo) {
        self.stereo = stereo;
    }

    pub fn stereo(&self) -> Stereo {
        self.stereo
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.device, &self.config);
    }

    fn texture(&self, size: (u32, u32)) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ctr_screen"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    fn target(&self, size: (u32, u32)) -> ScreenTarget {
        let left = self.texture(size);
        let right = self.texture(size);
        let params = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ctr_screen_params"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ctr_screen_bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&left.create_view(&Default::default())),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&right.create_view(&Default::default())),
                },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                wgpu::BindGroupEntry { binding: 3, resource: params.as_entire_binding() },
            ],
        });
        ScreenTarget { size, left, right, params, bind_group }
    }

    fn upload(&self, texture: &wgpu::Texture, image: &Image) {
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &image.rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(image.width * 4),
                rows_per_image: Some(image.height),
            },
            wgpu::Extent3d { width: image.width, height: image.height, depth_or_array_layers: 1 },
        );
    }

    fn update(&self, slot: &mut Option<ScreenTarget>, left: &Image, right: Option<&Image>, mode: u32) {
        let size = (left.width, left.height);
        if slot.as_ref().is_none_or(|t| t.size != size) {
            *slot = Some(self.target(size));
        }
        let Some(target) = slot.as_ref() else { return };
        self.upload(&target.left, left);
        self.upload(&target.right, right.unwrap_or(left));
        let mode = if right.is_some() { mode } else { 0 };
        let mut bytes = [0u8; 16];
        bytes[..4].copy_from_slice(&mode.to_le_bytes());
        self.queue.write_buffer(&target.params, 0, &bytes);
    }

    /// Uploads `video` and presents it. Returns false when the surface needs a resize first.
    pub fn render(&mut self, video: &Video) -> bool {
        let mode = u32::from(self.stereo == Stereo::Anaglyph);
        let (mut top, mut bottom) = (self.top.take(), self.bottom.take());
        self.update(&mut top, &video.top, video.top_right.as_ref(), mode);
        self.update(&mut bottom, &video.bottom, None, 0);
        (self.top, self.bottom) = (top, bottom);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => {
                self.surface.configure(&self.device, &self.config);
                return false;
            }
        };
        let view = frame.texture.create_view(&Default::default());
        let layout = Layout::new(self.config.width, self.config.height);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ctr_screens"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            for (target, rect) in [(&self.top, layout.top), (&self.bottom, layout.bottom)] {
                let Some(target) = target else { continue };
                pass.set_viewport(rect.x, rect.y, rect.width, rect.height, 0.0, 1.0);
                pass.set_bind_group(0, &target.bind_group, &[]);
                pass.draw(0..3, 0..1);
            }
        }
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
        true
    }
}
