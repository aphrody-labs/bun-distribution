//! AMD FSR1 (EASU + RCAS) as a reusable pass on the Bevy render device.
//!
//! [`Fsr1`] is the raw wgpu core: EASU upsamples a source (NV12 planes or an sRGB RGB texture)
//! from its size to the letterboxed viewport of the target, RCAS sharpens into the target, and an
//! optional premultiplied HUD bitmap is blended on top. The stream client feeds it decoded NV12
//! textures; [`Fsr1Plugin`] runs it as a post-process of the engine camera for any `Image` named by
//! the [`Fsr1Upscale`] resource (machine screens with `bun-engine run ... --fsr`).

const SHADER: &str = include_str!("fsr1.wgsl");

/// The shader with its two switches fixed as `const`s. Pipeline-overridable constants would do the
/// same, but naga 30's override pass rejects the RCAS entry point on the HLSL backend
/// (`ExpressionAlreadyInScope`), so each variant is its own module.
fn variant(device: &wgpu::Device, rgb_source: bool, srgb_target: bool) -> wgpu::ShaderModule {
    let source = SHADER
        .replace(
            "override RGB_SOURCE: bool = false;",
            &format!("const RGB_SOURCE: bool = {rgb_source};"),
        )
        .replace(
            "override SRGB_TARGET: bool = false;",
            &format!("const SRGB_TARGET: bool = {srgb_target};"),
        );
    device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("fsr1"),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    })
}
const UPSCALED_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Letterboxed destination rectangle of a `size` image inside `target`: (x, y, w, h) pixels.
pub fn letterbox(target: (u32, u32), size: (u32, u32)) -> (f32, f32, f32, f32) {
    let (w, h) = (target.0 as f32, target.1 as f32);
    let scale = (w / size.0.max(1) as f32).min(h / size.1.max(1) as f32);
    let (vw, vh) = (size.0 as f32 * scale, size.1 as f32 * scale);
    ((w - vw) / 2.0, (h - vh) / 2.0, vw, vh)
}

/// What EASU reads.
#[derive(Clone, Copy)]
pub enum Fsr1Source<'a> {
    /// A bind group from [`Fsr1::planes_group`].
    Nv12(&'a wgpu::BindGroup),
    /// A bind group from [`Fsr1::rgb_group`].
    Rgb(&'a wgpu::BindGroup),
}

struct Upscaled {
    texture: wgpu::Texture,
    group: wgpu::BindGroup,
    size: (u32, u32),
}

pub struct Fsr1 {
    target_format: wgpu::TextureFormat,
    params: wgpu::Buffer,
    params_group: wgpu::BindGroup,
    planes_layout: wgpu::BindGroupLayout,
    single_layout: wgpu::BindGroupLayout,
    easu_nv12: wgpu::RenderPipeline,
    easu_rgb: wgpu::RenderPipeline,
    rcas: wgpu::RenderPipeline,
    hud: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    upscaled: Option<Upscaled>,
    hud_texture: wgpu::Texture,
    hud_group: wgpu::BindGroup,
    hud_size: (u32, u32),
    /// RCAS sharpness in stops (0 = sharpest).
    pub sharpness_stops: f32,
    /// NV12 sources: full-range instead of studio-range YUV.
    pub full_range: bool,
}

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

impl Fsr1 {
    /// Pipelines for `target_format` (sRGB targets get linear output) and a `hud_size` overlay.
    pub fn new(
        device: &wgpu::Device,
        target_format: wgpu::TextureFormat,
        hud_size: (u32, u32),
    ) -> Self {
        let srgb = target_format.is_srgb();
        let (nv12_module, rgb_module) = (variant(device, false, srgb), variant(device, true, srgb));
        let params_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("fsr params"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let planes_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("fsr source"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let single_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("fsr single texture"),
            entries: &[texture_entry(0)],
        });
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("fsr params"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let params_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("fsr params"),
            layout: &params_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: params.as_entire_binding(),
            }],
        });
        let pipeline = |label: &str,
                        entry: &str,
                        groups: &[Option<&wgpu::BindGroupLayout>],
                        format: wgpu::TextureFormat,
                        blend: Option<wgpu::BlendState>,
                        module: &wgpu::ShaderModule| {
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: groups,
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let easu_groups = [Some(&params_layout), Some(&planes_layout)];
        let easu_nv12 = pipeline(
            "fsr easu nv12",
            "easu",
            &easu_groups,
            UPSCALED_FORMAT,
            None,
            &nv12_module,
        );
        let easu_rgb = pipeline(
            "fsr easu rgb",
            "easu",
            &easu_groups,
            UPSCALED_FORMAT,
            None,
            &rgb_module,
        );
        let rcas = pipeline(
            "fsr rcas",
            "rcas",
            &[Some(&params_layout), None, Some(&single_layout)],
            target_format,
            None,
            &nv12_module,
        );
        let hud = pipeline(
            "fsr hud",
            "hud",
            &[Some(&params_layout), None, None, Some(&single_layout)],
            target_format,
            Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
            &nv12_module,
        );
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("fsr chroma"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let hud_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("fsr hud"),
            size: wgpu::Extent3d {
                width: hud_size.0.max(1),
                height: hud_size.1.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let hud_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("fsr hud"),
            layout: &single_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(
                    &hud_texture.create_view(&Default::default()),
                ),
            }],
        });
        Self {
            target_format,
            params,
            params_group,
            planes_layout,
            single_layout,
            easu_nv12,
            easu_rgb,
            rcas,
            hud,
            sampler,
            upscaled: None,
            hud_texture,
            hud_group,
            hud_size,
            sharpness_stops: 0.25,
            full_range: false,
        }
    }

    pub fn target_format(&self) -> wgpu::TextureFormat {
        self.target_format
    }

    /// Source bind group of NV12 luma (R8) and chroma (RG8) views.
    pub fn planes_group(
        &self,
        device: &wgpu::Device,
        luma: &wgpu::TextureView,
        chroma: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("fsr nv12 planes"),
            layout: &self.planes_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(luma),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(chroma),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    /// Source bind group of one sRGB RGB(A) view.
    pub fn rgb_group(&self, device: &wgpu::Device, rgb: &wgpu::TextureView) -> wgpu::BindGroup {
        self.planes_group(device, rgb, rgb)
    }

    /// Replace the HUD bitmap (premultiplied RGBA8 of the `hud_size` given to [`Fsr1::new`]).
    pub fn upload_hud(&self, queue: &wgpu::Queue, rgba: &[u8]) {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.hud_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.hud_size.0 * 4),
                rows_per_image: Some(self.hud_size.1),
            },
            wgpu::Extent3d {
                width: self.hud_size.0,
                height: self.hud_size.1,
                depth_or_array_layers: 1,
            },
        );
    }

    /// Record EASU (when `source` is set) then RCAS + HUD into `target` (cleared to black).
    /// Returns the output viewport (x, y, w, h).
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        source: Option<(Fsr1Source<'_>, (u32, u32))>,
        target: &wgpu::TextureView,
        target_size: (u32, u32),
        show_hud: bool,
    ) -> Option<(f32, f32, f32, f32)> {
        let mut viewport = None;
        if let Some((source, size)) = source {
            let (x, y, w, h) = letterbox(target_size, size);
            let out = ((w.round() as u32).max(1), (h.round() as u32).max(1));
            let params: [f32; 8] = [
                size.0 as f32,
                size.1 as f32,
                out.0 as f32,
                out.1 as f32,
                x.round(),
                y.round(),
                (-self.sharpness_stops).exp2(),
                if self.full_range { 1.0 } else { 0.0 },
            ];
            let bytes: Vec<u8> = params.iter().flat_map(|v| v.to_le_bytes()).collect();
            queue.write_buffer(&self.params, 0, &bytes);
            if self.upscaled.as_ref().is_none_or(|u| u.size != out) {
                let texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("fsr easu output"),
                    size: wgpu::Extent3d {
                        width: out.0,
                        height: out.1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: UPSCALED_FORMAT,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                });
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("fsr easu output"),
                    layout: &self.single_layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(
                            &texture.create_view(&Default::default()),
                        ),
                    }],
                });
                self.upscaled = Some(Upscaled {
                    texture,
                    group,
                    size: out,
                });
            }
            let upscaled = self.upscaled.as_ref().unwrap();
            let view = upscaled.texture.create_view(&Default::default());
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("fsr easu"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            let (pipeline, group) = match source {
                Fsr1Source::Nv12(group) => (&self.easu_nv12, group),
                Fsr1Source::Rgb(group) => (&self.easu_rgb, group),
            };
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &self.params_group, &[]);
            pass.set_bind_group(1, group, &[]);
            pass.draw(0..3, 0..1);
            viewport = Some((x.round(), y.round(), out.0 as f32, out.1 as f32));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("fsr rcas"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        if let (Some((x, y, w, h)), Some(upscaled)) = (viewport, self.upscaled.as_ref()) {
            pass.set_viewport(
                x,
                y,
                w.min(target_size.0 as f32 - x),
                h.min(target_size.1 as f32 - y),
                0.0,
                1.0,
            );
            pass.set_pipeline(&self.rcas);
            pass.set_bind_group(0, &self.params_group, &[]);
            pass.set_bind_group(2, &upscaled.group, &[]);
            pass.draw(0..3, 0..1);
        }
        if show_hud {
            // Only the HUD rectangle is rasterized.
            let w = (self.hud_size.0 as f32)
                .min(target_size.0 as f32 - 8.0)
                .max(1.0);
            let h = (self.hud_size.1 as f32)
                .min(target_size.1 as f32 - 8.0)
                .max(1.0);
            pass.set_viewport(8.0, 8.0, w, h, 0.0, 1.0);
            pass.set_pipeline(&self.hud);
            pass.set_bind_group(0, &self.params_group, &[]);
            pass.set_bind_group(3, &self.hud_group, &[]);
            pass.draw(0..3, 0..1);
        }
        viewport
    }
}

pub use plugin::{Fsr1Plugin, Fsr1Upscale};

mod plugin {
    //! FSR1 as a post-process: either the engine camera's output (after Bevy's upscaling the output
    //! is cleared and `Fsr1Upscale::image` is drawn letterboxed through EASU + RCAS), or a target
    //! `Image` that UI hosts show in an `ImageNode` under their menus.

    use crate::bevy::{
        app::{App, Plugin},
        asset::{Handle, RenderAssetUsages},
        core_pipeline::{schedule::Core2d, upscaling::upscaling},
        ecs::prelude::*,
        image::Image,
        render::{
            Extract, ExtractSchedule, Render, RenderApp, RenderSystems,
            camera::ExtractedCamera,
            render_asset::RenderAssets,
            render_resource::{
                Extent3d, TextureDimension, TextureFormat, TextureUsages, TextureViewId,
            },
            renderer::{RenderContext, RenderDevice, RenderQueue, ViewQuery},
            texture::GpuImage,
            view::ViewTarget,
        },
    };

    use super::{Fsr1, Fsr1Source};

    /// Upscale `image` with FSR1. With `target: None` it replaces the output of every 2D camera
    /// (and so draws over `bevy_ui`); with a target image (see [`Fsr1Upscale::target_image`]) the
    /// result is rendered there, letterboxed to the target size, and cameras are untouched.
    #[derive(Resource, Clone, Debug)]
    pub struct Fsr1Upscale {
        pub image: Handle<Image>,
        pub sharpness_stops: f32,
        pub target: Option<Handle<Image>>,
    }

    impl Fsr1Upscale {
        /// A render target for FSR1 output of `width` x `height` (RGBA8 sRGB), to add to
        /// `Assets<Image>` and show in an `ImageNode` or a sprite.
        pub fn target_image(width: u32, height: u32) -> Image {
            let mut image = Image::new_fill(
                Extent3d {
                    width: width.max(1),
                    height: height.max(1),
                    depth_or_array_layers: 1,
                },
                TextureDimension::D2,
                &[0, 0, 0, 255],
                TextureFormat::Rgba8UnormSrgb,
                RenderAssetUsages::RENDER_WORLD,
            );
            image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::RENDER_ATTACHMENT;
            image
        }
    }

    pub struct Fsr1Plugin;

    #[derive(Resource, Default)]
    struct State {
        fsr: Option<Fsr1>,
        group: Option<(TextureViewId, wgpu::BindGroup)>,
    }

    impl State {
        /// The FSR core for `format` and the source bind group of `image`.
        fn prepare(
            &mut self,
            device: &wgpu::Device,
            format: wgpu::TextureFormat,
            image: &GpuImage,
            sharpness: f32,
        ) -> (&mut Fsr1, &wgpu::BindGroup) {
            if self
                .fsr
                .as_ref()
                .is_none_or(|f| f.target_format() != format)
            {
                self.fsr = Some(Fsr1::new(device, format, (1, 1)));
                self.group = None;
            }
            let fsr = self.fsr.as_mut().unwrap();
            fsr.sharpness_stops = sharpness;
            let id = image.texture_view.id();
            if self.group.as_ref().is_none_or(|(old, _)| *old != id) {
                self.group = Some((id, fsr.rgb_group(device, &image.texture_view)));
            }
            (fsr, &self.group.as_ref().unwrap().1)
        }
    }

    impl Plugin for Fsr1Plugin {
        fn build(&self, app: &mut App) {
            let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
                return;
            };
            render_app
                .init_resource::<State>()
                .add_systems(ExtractSchedule, extract)
                .add_systems(
                    Render,
                    fsr1_to_image.in_set(RenderSystems::PrepareBindGroups),
                )
                .add_systems(Core2d, fsr1_post_process.after(upscaling));
        }
    }

    fn extract(mut commands: Commands, upscale: Extract<Option<Res<Fsr1Upscale>>>) {
        match upscale.as_ref() {
            Some(u) => commands.insert_resource((**u).clone()),
            None => commands.remove_resource::<Fsr1Upscale>(),
        }
    }

    fn size_of(image: &GpuImage) -> (u32, u32) {
        (
            image.texture_descriptor.size.width,
            image.texture_descriptor.size.height,
        )
    }

    /// Render-to-image mode: one EASU + RCAS pass into the target, submitted before the frame's
    /// camera passes sample it.
    fn fsr1_to_image(
        upscale: Option<Res<Fsr1Upscale>>,
        images: Res<RenderAssets<GpuImage>>,
        device: Res<RenderDevice>,
        queue: Res<RenderQueue>,
        mut state: ResMut<State>,
    ) {
        let Some(upscale) = upscale else { return };
        let Some(target) = upscale.target.as_ref().and_then(|t| images.get(t)) else {
            return;
        };
        let Some(source) = images.get(&upscale.image) else {
            return;
        };
        let device = device.wgpu_device();
        let format = target.texture_descriptor.format;
        let (fsr, group) = state.prepare(device, format, source, upscale.sharpness_stops);
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("fsr1 to image"),
        });
        fsr.encode(
            device,
            &queue,
            &mut encoder,
            Some((Fsr1Source::Rgb(group), size_of(source))),
            &target.texture_view,
            size_of(target),
            false,
        );
        queue.submit([encoder.finish()]);
    }

    fn fsr1_post_process(
        view: ViewQuery<(&ViewTarget, &ExtractedCamera)>,
        upscale: Option<Res<Fsr1Upscale>>,
        images: Res<RenderAssets<GpuImage>>,
        device: Res<RenderDevice>,
        queue: Res<RenderQueue>,
        mut state: ResMut<State>,
        mut ctx: RenderContext,
    ) {
        let Some(upscale) = upscale.filter(|u| u.target.is_none()) else {
            return;
        };
        let Some(source) = images.get(&upscale.image) else {
            return;
        };
        let (target, camera) = view.into_inner();
        let Some(target_size) = camera.physical_target_size else {
            return;
        };
        let (Some(out), Some(format)) = (target.out_texture(), target.out_texture_view_format())
        else {
            return;
        };
        let device = device.wgpu_device();
        let (fsr, group) = state.prepare(device, format, source, upscale.sharpness_stops);
        fsr.encode(
            device,
            &queue,
            ctx.command_encoder(),
            Some((Fsr1Source::Rgb(group), size_of(source))),
            out,
            (target_size.x, target_size.y),
            false,
        );
    }
}
