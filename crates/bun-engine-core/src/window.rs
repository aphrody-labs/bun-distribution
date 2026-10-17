//! The single front end: one winit window, one wgpu surface (through the shared Aphrody GPU
//! backend), one keyboard/pointer mapping onto [`Input`]. Every machine with screens is shown
//! here; screens are stacked into one texture and letterboxed.

use std::{sync::Arc, time::{Duration, Instant}};

use aphrody_gpu_backend::{
    DeviceLimits, DeviceRequest, SurfaceFormat, SurfaceRequest, create_instance, request_adapter,
    request_device, surface_configuration, wgpu,
};
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalPosition},
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

use crate::machine::{Input, Machine, Screen, Step, keys};

const SHADER: &str = r#"
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct V { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    let x = f32((i << 1u) & 2u);
    let y = f32(i & 2u);
    var o: V;
    o.p = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    o.uv = vec2<f32>(x, y);
    return o;
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> { return textureSample(tex, smp, v.uv); }
"#;

struct Gpu {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    texture: wgpu::Texture,
    size: (u32, u32),
}

struct App {
    machine: Box<dyn Machine>,
    title: String,
    gpu: Option<Gpu>,
    input: Input,
    cursor: Option<PhysicalPosition<f64>>,
    mouse_down: bool,
    next_frame: Instant,
    first_height: u32,
    failed: Option<String>,
}

fn key_bit(code: KeyCode) -> u32 {
    match code {
        KeyCode::KeyZ => keys::A,
        KeyCode::KeyX => keys::B,
        KeyCode::KeyA => keys::Y,
        KeyCode::KeyS => keys::X,
        KeyCode::KeyQ => keys::L,
        KeyCode::KeyW => keys::R,
        KeyCode::Enter => keys::START,
        KeyCode::ShiftRight | KeyCode::Backspace => keys::SELECT,
        KeyCode::ArrowUp => keys::UP,
        KeyCode::ArrowDown => keys::DOWN,
        KeyCode::ArrowLeft => keys::LEFT,
        KeyCode::ArrowRight => keys::RIGHT,
        _ => 0,
    }
}

impl Gpu {
    async fn new(window: Arc<Window>, size: (u32, u32)) -> Result<Self, String> {
        let instance = create_instance(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let surface = instance.create_surface(window.clone()).map_err(|e| e.to_string())?;
        let adapter = request_adapter(
            &instance,
            &wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        let gpu = request_device(
            &adapter,
            DeviceRequest::new(Some("bun-engine"), DeviceLimits::DownlevelWithAdapterResolution),
        )
        .await
        .map_err(|e| e.to_string())?;
        let (device, queue) = (gpu.device, gpu.queue);
        let inner = window.inner_size();
        let config = surface_configuration(
            &surface.get_capabilities(&adapter),
            SurfaceRequest {
                width: inner.width,
                height: inner.height,
                format: SurfaceFormat::Linear,
                present_mode: None,
                alpha_mode: None,
                desired_maximum_frame_latency: 2,
            },
        )
        .ok_or("the window has no drawable area")?;
        surface.configure(&device, &config);

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("screens"),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&sampler) },
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(config.format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Ok(Self { window, surface, config, device, queue, pipeline, bind_group, texture, size })
    }

    /// Letterboxed destination rectangle inside the window: (x, y, w, h) in pixels.
    fn viewport(&self) -> (f32, f32, f32, f32) {
        let (w, h) = (self.config.width as f32, self.config.height as f32);
        let scale = (w / self.size.0 as f32).min(h / self.size.1 as f32);
        let (vw, vh) = (self.size.0 as f32 * scale, self.size.1 as f32 * scale);
        ((w - vw) / 2.0, (h - vh) / 2.0, vw, vh)
    }

    fn upload(&self, rgba: &[u8]) {
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.size.0 * 4),
                rows_per_image: Some(self.size.1),
            },
            wgpu::Extent3d { width: self.size.0, height: self.size.1, depth_or_array_layers: 1 },
        );
    }

    fn draw(&self) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            _ => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
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
            let (x, y, w, h) = self.viewport();
            pass.set_viewport(x, y, w, h, 0.0, 1.0);
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        self.window.pre_present_notify();
        self.queue.present(frame);
    }
}

fn compose(screens: &[Screen], size: (u32, u32)) -> Vec<u8> {
    let mut out = vec![255_u8; (size.0 * size.1 * 4) as usize];
    let mut y0 = 0;
    for s in screens {
        for y in 0..s.height {
            for x in 0..s.width {
                let src = (y * s.width + x) * 3;
                let dst = (((y0 + y) as u32 * size.0) as usize + x) * 4;
                out[dst..dst + 3].copy_from_slice(&s.rgb[src..src + 3]);
            }
        }
        y0 += s.height;
    }
    out
}

impl App {
    fn touch(&self) -> Option<(u16, u16)> {
        let (gpu, cursor) = (self.gpu.as_ref()?, self.cursor?);
        if !self.mouse_down {
            return None;
        }
        let (x, y, w, h) = gpu.viewport();
        let u = ((cursor.x as f32 - x) / w * gpu.size.0 as f32).clamp(0.0, gpu.size.0 as f32 - 1.0);
        let v = ((cursor.y as f32 - y) / h * gpu.size.1 as f32).clamp(0.0, gpu.size.1 as f32 - 1.0);
        (v >= self.first_height as f32).then(|| (u as u16, (v as u32 - self.first_height) as u16))
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_some() {
            return;
        }
        let screens = self.machine.screens();
        let width = screens.iter().map(|s| s.width).max().unwrap_or(256) as u32;
        let height = screens.iter().map(|s| s.height).sum::<usize>() as u32;
        self.first_height = screens.first().map_or(0, |s| s.height as u32);
        let attrs = Window::default_attributes()
            .with_title(self.title.clone())
            .with_inner_size(LogicalSize::new(width * 2, height * 2));
        let window = match event_loop.create_window(attrs) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                self.failed = Some(e.to_string());
                return event_loop.exit();
            }
        };
        match pollster::block_on(Gpu::new(window, (width, height))) {
            Ok(gpu) => self.gpu = Some(gpu),
            Err(e) => {
                self.failed = Some(e);
                event_loop.exit();
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    if size.width > 0 && size.height > 0 {
                        gpu.config.width = size.width;
                        gpu.config.height = size.height;
                        gpu.surface.configure(&gpu.device, &gpu.config);
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if let PhysicalKey::Code(code) = event.physical_key {
                    if code == KeyCode::Escape {
                        return event_loop.exit();
                    }
                    let bit = key_bit(code);
                    if event.state == ElementState::Pressed {
                        self.input.keys |= bit;
                    } else {
                        self.input.keys &= !bit;
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => self.cursor = Some(position),
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                self.mouse_down = state == ElementState::Pressed;
            }
            WindowEvent::RedrawRequested => {
                self.input.touch = self.touch();
                self.machine.set_input(self.input);
                if self.machine.run_frame() == Step::Shutdown {
                    return event_loop.exit();
                }
                if let Some(gpu) = self.gpu.as_ref() {
                    gpu.upload(&compose(&self.machine.screens(), gpu.size));
                    gpu.draw();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let now = Instant::now();
        if now >= self.next_frame {
            self.next_frame = now + Duration::from_micros(16_715);
            if let Some(gpu) = self.gpu.as_ref() {
                gpu.window.request_redraw();
            }
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_frame));
    }
}

/// Opens the window and runs `machine` until it shuts down or the window closes.
pub fn run(machine: Box<dyn Machine>, title: &str) -> Result<(), String> {
    let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
    let mut app = App {
        machine,
        title: title.to_string(),
        gpu: None,
        input: Input::default(),
        cursor: None,
        mouse_down: false,
        next_frame: Instant::now(),
        first_height: 0,
        failed: None,
    };
    event_loop.run_app(&mut app).map_err(|e| e.to_string())?;
    app.failed.map_or(Ok(()), Err)
}
