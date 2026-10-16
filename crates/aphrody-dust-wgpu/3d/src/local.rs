//! Same-event-loop 3D renderer for browser workers and native hosts.
//!
//! Geometry is drawn by the retained GPU pipeline. CPU rasterization is used
//! only for the DS display-capture unit, whose pixels must be available to the
//! emulated CPU without awaiting an asynchronous GPU readback.

use super::{FrameData, Renderer};
use aphrody_dust_core::{
    gpu::{
        SCREEN_HEIGHT, Scanline,
        engine_3d::{AccelRendererRx, Polygon, RendererTx, RenderingState, ScreenVertex},
    },
    utils::Bytes,
};
use std::{cell::RefCell, rc::Rc, sync::Arc};

struct Shared {
    renderer: Renderer,
    frame: Box<FrameData>,
    capture_data: Box<aphrody_dust_soft_3d::RenderingData>,
    capture_renderer: aphrody_dust_soft_3d::Renderer,
    capture_lines: Box<[Scanline<u32>; SCREEN_HEIGHT]>,
    capture_enabled: bool,
    submitted_frames: u64,
}

/// Core-side transmitter. All handles must remain on the same event loop.
pub struct Tx(Rc<RefCell<Shared>>);

/// Capture receiver. Each read copies one hardware capture line into local storage.
pub struct Rx {
    shared: Rc<RefCell<Shared>>,
    next_scanline: usize,
    scanline: Scanline<u32>,
}

/// Host-side access to GPU output; no polling or cross-thread rendezvous is needed.
#[derive(Clone)]
pub struct Frontend(Rc<RefCell<Shared>>);

impl Frontend {
    /// Obtain the latest color attachment after the core has run a frame.
    /// Fog may swap attachments, so a host must refresh this view each frame.
    pub fn output_view(&self) -> crate::wgpu::TextureView {
        self.0.borrow().renderer.create_output_view()
    }

    pub fn set_resolution_scale_shift(&self, value: u8) {
        assert!(value <= 4, "DS resolution scale must be between 1x and 16x");
        self.0.borrow_mut().renderer.set_resolution_scale_shift(value);
    }

    pub fn submitted_frames(&self) -> u64 {
        self.0.borrow().submitted_frames
    }
}

impl RendererTx for Tx {
    fn set_capture_enabled(&mut self, enabled: bool) {
        self.0.borrow_mut().capture_enabled = enabled;
    }

    fn swap_buffers(
        &mut self,
        vertices: &[ScreenVertex],
        polygons: &[Polygon],
        state: &RenderingState,
    ) {
        let mut shared = self.0.borrow_mut();
        shared.frame.gx.prepare(vertices, polygons, state);
        shared.frame.rendering.prepare(state);
        shared.capture_data.prepare(vertices, polygons, state);
    }

    fn repeat_last_frame(&mut self, state: &RenderingState) {
        let mut shared = self.0.borrow_mut();
        shared.frame.rendering.prepare(state);
        shared.capture_data.repeat_last_frame(state);
    }

    fn start_rendering(
        &mut self,
        texture: &Bytes<0x8_0000>,
        palette: &Bytes<0x1_8000>,
        state: &RenderingState,
    ) {
        let mut guard = self.0.borrow_mut();
        let shared = &mut *guard;
        shared.frame.rendering.copy_vram(
            texture,
            palette,
            state.texture_dirty,
            state.tex_pal_dirty,
        );
        // Keep capture VRAM current even when capture is disabled: dirty bits
        // may be cleared by the core before capture is enabled next frame.
        shared.capture_data.copy_vram(texture, palette, state);
        let commands = shared.renderer.render_frame(&shared.frame);
        shared.renderer.queue().submit([commands]);
        shared.submitted_frames = shared.submitted_frames.wrapping_add(1);

        if shared.capture_enabled {
            shared.capture_renderer.start_frame(&shared.capture_data);
            shared.capture_renderer.render_line(0, &shared.capture_data);
            for y in 0..SCREEN_HEIGHT {
                if y + 1 < SCREEN_HEIGHT {
                    shared.capture_renderer.render_line((y + 1) as u8, &shared.capture_data);
                }
                shared.capture_renderer.postprocess_line(
                    y as u8,
                    &mut shared.capture_lines[y],
                    &shared.capture_data,
                );
            }
        }
    }

    fn skip_rendering(&mut self) {}
}

impl AccelRendererRx for Rx {
    fn start_frame(&mut self, _capture_enabled: bool) {
        self.next_scanline = 0;
    }

    fn read_capture_scanline(&mut self) -> &Scanline<u32> {
        self.scanline.0.copy_from_slice(&self.shared.borrow().capture_lines[self.next_scanline].0);
        self.next_scanline += 1;
        &self.scanline
    }
}

pub fn init(
    device: Arc<crate::wgpu::Device>,
    queue: Arc<crate::wgpu::Queue>,
    resolution_scale_shift: u8,
) -> (Tx, Rx, Frontend) {
    assert!(resolution_scale_shift <= 4, "DS resolution scale must be between 1x and 16x");
    let shared = Rc::new(RefCell::new(Shared {
        renderer: Renderer::new(device, queue, resolution_scale_shift),
        // The upstream data records consist exclusively of numeric fields,
        // bitfield wrappers, SIMD values and fixed arrays; zero is valid for all.
        frame: unsafe { Box::new_zeroed().assume_init() },
        capture_data: unsafe { Box::new_zeroed().assume_init() },
        capture_renderer: aphrody_dust_soft_3d::Renderer::new(),
        capture_lines: Box::new([Scanline([0; 256]); SCREEN_HEIGHT]),
        capture_enabled: false,
        submitted_frames: 0,
    }));
    (
        Tx(Rc::clone(&shared)),
        Rx { shared: Rc::clone(&shared), next_scanline: 0, scanline: Scanline([0; 256]) },
        Frontend(shared),
    )
}
