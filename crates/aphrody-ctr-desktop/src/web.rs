//! Browser host: a WebGPU canvas driven from JavaScript.
//!
//! ```js
//! const ctr = await Ctr3ds.start(canvas, "title.3dsx", bytes);
//! requestAnimationFrame(function tick() {
//!   ctr.set_buttons(mask);          // PadState bits: A=1 B=2 Select=4 Start=8 Right=16 ...
//!   ctr.frame();                    // run one refresh and draw it
//!   audio.push(ctr.take_audio());   // interleaved stereo f32 at 32728 Hz
//!   requestAnimationFrame(tick);
//! });
//! ```

use aphrody_ctr_emu::{Buttons, Emu, Frame, Input};
use wasm_bindgen::prelude::*;

use crate::{Layout, Renderer, Stereo};

#[wasm_bindgen]
pub struct Ctr3ds {
    emu: Emu,
    renderer: Renderer,
    input: Input,
    width: u32,
    height: u32,
    stopped: Option<String>,
}

#[wasm_bindgen]
impl Ctr3ds {
    /// Boots `image` (`.3dsx`, `.cxi`, `.cci`/`.3ds` or `.cia`) and attaches a WebGPU renderer to
    /// `canvas`.
    pub async fn start(
        canvas: web_sys::HtmlCanvasElement,
        name: String,
        image: Vec<u8>,
    ) -> Result<Ctr3ds, JsValue> {
        console_error_panic_hook::set_once();
        let emu = Emu::builder()
            .boot_bytes(&name, &image)
            .map_err(|e| JsValue::from_str(&e.0))?;
        let (width, height) = (canvas.width().max(1), canvas.height().max(1));
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let renderer = Renderer::new(&instance, surface, (width, height))
            .await
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(Ctr3ds {
            emu,
            renderer,
            input: Input::default(),
            width,
            height,
            stopped: None,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        (self.width, self.height) = (width.max(1), height.max(1));
        self.renderer.resize(self.width, self.height);
    }

    /// Button bits as the console reports them (A=1, B=2, Select=4, Start=8, Right=16, Left=32,
    /// Up=64, Down=128, R=256, L=512, X=1024, Y=2048).
    pub fn set_buttons(&mut self, mask: u32) {
        self.input.buttons = Buttons::from_bits_truncate(mask);
    }

    pub fn set_circle(&mut self, x: f32, y: f32) {
        self.input.circle = [x.clamp(-1.0, 1.0), y.clamp(-1.0, 1.0)];
    }

    /// Presses the touch screen at a canvas position (pixels); ignored outside the bottom screen.
    pub fn touch(&mut self, x: f32, y: f32) {
        self.input.touch = Layout::new(self.width, self.height).touch(x, y);
    }

    pub fn release(&mut self) {
        self.input.touch = None;
    }

    pub fn set_anaglyph(&mut self, on: bool) {
        self.renderer
            .set_stereo(if on { Stereo::Anaglyph } else { Stereo::Off });
        self.emu.set_slider_3d(if on { 1.0 } else { 0.0 });
    }

    /// Runs one refresh and draws it. Returns false once the title has stopped.
    pub fn frame(&mut self) -> bool {
        if self.stopped.is_some() {
            return false;
        }
        self.emu.set_input(self.input);
        match self.emu.run_frame() {
            Frame::Completed => {}
            Frame::Exited => self.stopped = Some("the title exited".into()),
            Frame::Faulted(why) => self.stopped = Some(format!("guest fault {why}")),
        }
        let video = self.emu.video();
        self.renderer.render(&video);
        self.stopped.is_none()
    }

    /// Why the title stopped, if it did.
    pub fn stopped(&self) -> Option<String> {
        self.stopped.clone()
    }

    /// Debug console text written since the last call.
    pub fn take_console(&mut self) -> String {
        self.emu.take_console()
    }

    /// DSP output since the last call: interleaved stereo f32 at 32728 Hz.
    pub fn take_audio(&mut self) -> Vec<f32> {
        self.emu
            .take_audio()
            .into_iter()
            .flatten()
            .map(|s| f32::from(s) / 32768.0)
            .collect()
    }

    pub fn save_state(&mut self) -> Result<Vec<u8>, JsValue> {
        self.emu.save_state().map_err(|e| JsValue::from_str(&e.0))
    }

    pub fn load_state(&mut self, state: Vec<u8>) -> Result<(), JsValue> {
        self.emu
            .load_state(&state)
            .map_err(|e| JsValue::from_str(&e.0))
    }
}
