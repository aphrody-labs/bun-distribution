//! Browser-worker WebGPU setup and direct presentation of the DS GPU output.

use aphrody_dust_wgpu::{backend, render_2d, render_3d, wgpu};
use std::sync::Arc;
use wasm_bindgen::JsValue;

pub struct Presentation {
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    blitter: wgpu::util::TextureBlitter,
    output: wgpu::TextureView,
    channels: render_2d::threaded::lockstep_scanlines::FrontendChannels,
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

impl Presentation {
    pub async fn new(
        canvas: web_sys::OffscreenCanvas,
    ) -> Result<
        (
            Self,
            render_2d::threaded::lockstep_scanlines::Renderer,
            render_3d::local::Tx,
        ),
        JsValue,
    > {
        let width = canvas.width().max(1);
        let height = canvas.height().max(1);
        let instance = backend::create_instance(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(js_error)?;
        let adapter = backend::request_adapter(
            &instance,
            &wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            },
        )
        .await
        .map_err(js_error)?;
        let gpu = backend::request_device(
            &adapter,
            backend::DeviceRequest::new(
                Some("Dust browser WebGPU"),
                backend::DeviceLimits::Adapter,
            ),
        )
        .await
        .map_err(js_error)?;
        let device = Arc::new(gpu.device);
        let queue = Arc::new(gpu.queue);
        let config = backend::surface_configuration(
            &surface.get_capabilities(&adapter),
            backend::SurfaceRequest {
                width,
                height,
                format: backend::SurfaceFormat::Linear,
                present_mode: None,
                alpha_mode: None,
                desired_maximum_frame_latency: 2,
            },
        )
        .ok_or_else(|| JsValue::from_str("WebGPU canvas has no compatible surface format"))?;
        surface.configure(&device, &config);
        let blitter = wgpu::util::TextureBlitter::new(&device, config.format);
        let (tx, rx, frontend) = render_3d::local::init(Arc::clone(&device), Arc::clone(&queue), 0);
        let color_output_view = frontend.output_view();
        let receiver = render_2d::Renderer3dRx::LocalAccel {
            rx: Box::new(rx),
            color_output_view,
            new_color_output_view: Box::new(move || frontend.output_view()),
        };
        let (renderer, output, channels) = render_2d::threaded::lockstep_scanlines::Renderer::new(
            Arc::clone(&device),
            Arc::clone(&queue),
            0,
            receiver,
        );
        Ok((
            Self {
                device,
                queue,
                surface,
                config,
                blitter,
                output,
                channels,
            },
            renderer,
            tx,
        ))
    }

    pub fn acquire(&mut self) -> Result<Option<wgpu::SurfaceTexture>, JsValue> {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(None);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(None);
            }
            other => {
                return Err(js_error(format!(
                    "WebGPU surface acquisition failed: {other:?}"
                )))
            }
        };
        Ok(Some(frame))
    }

    pub fn present(&mut self, frame: wgpu::SurfaceTexture) {
        if let Some(output) = self.channels.new_color_output_view() {
            self.output = output;
        }
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Dust browser direct GPU presentation"),
            });
        self.blitter
            .copy(&self.device, &mut encoder, &self.output, &view);
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
    }
}
