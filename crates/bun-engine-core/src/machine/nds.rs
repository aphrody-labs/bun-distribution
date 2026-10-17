//! Nintendo DS on the in-tree Dust core: interpreter CPUs, software 2D/3D renderers, HLE BIOS and
//! a built-in default firmware, so direct boot needs no caller-supplied system file.

use std::{cell::RefCell, rc::Rc};

use aphrody_dust_core::{
    Model, SaveContents, audio,
    cpu::interpreter::Interpreter,
    ds_slot,
    emu::{self, Emu, RunOutput, input::Keys},
    flash::Flash,
    gpu::{
        Scanline,
        engine_3d::{Polygon, RendererTx, RenderingState, ScreenVertex, SoftRendererRx},
    },
    rtc,
    spi::firmware,
    utils::{BoxedByteSlice, mem_prelude::*},
};
use aphrody_dust_soft_3d::{Renderer, RenderingData};

use super::{Input, Machine, Screen, Step};

/// DS output: 32.768 kHz, 10-bit unsigned samples around the 0x200 bias.
const SAMPLE_RATE: u32 = 32_768;
/// 33.513982 MHz ARM7 bus / (355 dots * 263 lines * 6 cycles).
const REFRESH_RATE: f64 = 59.826_098_288_598_9;

/// Collects the mixer output for the host's audio sink.
struct Capture(Rc<RefCell<Vec<f32>>>);

impl audio::Backend for Capture {
    fn handle_sample_chunk(&mut self, samples: &mut Vec<[audio::OutputSample; 2]>) {
        let mut out = self.0.borrow_mut();
        // Keep at most one second queued when nobody drains it (headless runs).
        if out.len() > SAMPLE_RATE as usize * 2 {
            out.clear();
        }
        out.extend(samples.drain(..).flat_map(|pair| pair.map(|s| (f32::from(s) - 512.0) / 512.0)));
    }
}

struct Soft3d {
    data: Box<RenderingData>,
    renderer: Renderer,
    output: Box<[Scanline<u32>; 192]>,
}

struct Tx(Rc<RefCell<Soft3d>>);

struct Rx {
    shared: Rc<RefCell<Soft3d>>,
    line: usize,
    output: Scanline<u32>,
}

impl RendererTx for Tx {
    fn set_capture_enabled(&mut self, _: bool) {}

    fn swap_buffers(
        &mut self,
        vertices: &[ScreenVertex],
        polygons: &[Polygon],
        state: &RenderingState,
    ) {
        self.0.borrow_mut().data.prepare(vertices, polygons, state);
    }

    fn repeat_last_frame(&mut self, state: &RenderingState) {
        self.0.borrow_mut().data.repeat_last_frame(state);
    }

    fn start_rendering(
        &mut self,
        texture: &Bytes<0x80000>,
        palette: &Bytes<0x18000>,
        state: &RenderingState,
    ) {
        let mut shared = self.0.borrow_mut();
        let Soft3d { data, renderer, output } = &mut *shared;
        data.copy_vram(texture, palette, state);
        renderer.start_frame(data);
        renderer.render_line(0, data);
        for y in 0..192_u8 {
            if y < 191 {
                renderer.render_line(y + 1, data);
            }
            renderer.postprocess_line(y, &mut output[y as usize], data);
        }
    }

    fn skip_rendering(&mut self) {}
}

impl SoftRendererRx for Rx {
    fn start_frame(&mut self) {
        self.line = 0;
    }

    fn read_scanline(&mut self) -> &Scanline<u32> {
        self.output.0.copy_from_slice(&self.shared.borrow().output[self.line].0);
        self.line += 1;
        &self.output
    }

    fn skip_scanline(&mut self) {
        self.line += 1;
    }
}

pub struct Nds {
    emu: Emu<Interpreter>,
    ended: bool,
    keys: Keys,
    touching: bool,
    samples: Rc<RefCell<Vec<f32>>>,
}

impl Nds {
    /// Boots a cartridge image directly, without BIOS or firmware files.
    pub fn from_rom(rom: &[u8]) -> Result<Self, String> {
        // The renderer buffers are plain integer arrays; zero is a valid state.
        let shared = Rc::new(RefCell::new(Soft3d {
            data: unsafe { Box::new_zeroed().assume_init() },
            renderer: Renderer::new(),
            output: unsafe { Box::new_zeroed().assume_init() },
        }));
        let rx = Rx { shared: shared.clone(), line: 0, output: Scanline([0; 256]) };
        // Cartridge chips are power-of-two sized; dumps and homebrew builds are often trimmed.
        // Pad with 0xFF (erased flash) like a real cartridge reads past the image.
        let size = rom.len().max(0x200).next_power_of_two();
        let mut contents = BoxedByteSlice::new_zeroed(size);
        contents[..rom.len()].copy_from_slice(rom);
        contents[rom.len()..].fill(0xFF);
        let flash = Flash::new(
            SaveContents::Existing(firmware::default(Model::Ds)),
            firmware::id_for_model(Model::Ds),
        )
        .map_err(|e| format!("firmware: {e:?}"))?;
        let samples = Rc::new(RefCell::new(Vec::new()));
        let builder = emu::Builder::new(
            flash,
            Some(Box::new(contents)),
            ds_slot::spi::Empty::new().into(),
            Box::new(Capture(samples.clone())),
            None,
            Box::new(rtc::DummyBackend),
            Box::new(aphrody_dust_soft_2d::sync::Renderer::new(Box::new(rx))),
            Box::new(Tx(shared)),
            None,
        );
        let emu = builder
            .build(Interpreter)
            .map_err(|e| {
                let why = match e {
                    emu::BuildError::MissingRom => "no ROM",
                    emu::BuildError::MissingSysFiles => "BIOS files required",
                    emu::BuildError::RomCreation(_) => "invalid ROM size",
                    emu::BuildError::RomNeedsDecryptionButNoBiosProvided => {
                        "the secure area is encrypted and direct boot has no BIOS to decrypt it"
                    }
                };
                format!("the cartridge image is not bootable: {why}")
            })?;
        Ok(Self { emu, ended: false, keys: Keys::empty(), touching: false, samples })
    }
}

fn expand(px: u32, out: &mut Vec<u8>) {
    // The software renderer hands out RGBA8, red lowest, alpha unused.
    out.extend_from_slice(&[px as u8, (px >> 8) as u8, (px >> 16) as u8]);
}

impl Machine for Nds {
    fn name(&self) -> &'static str {
        "nintendo-ds"
    }

    fn refresh_rate(&self) -> f64 {
        REFRESH_RATE
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.samples.borrow_mut());
    }

    fn run_frame(&mut self) -> Step {
        if self.ended {
            return Step::Shutdown;
        }
        match self.emu.run() {
            RunOutput::FrameFinished => Step::Frame,
            RunOutput::Shutdown => {
                self.ended = true;
                Step::Shutdown
            }
        }
    }

    fn set_input(&mut self, input: Input) {
        let now = Keys::from_bits_truncate(input.keys);
        let (pressed, released) = (now & !self.keys, self.keys & !now);
        if !pressed.is_empty() {
            self.emu.press_keys(pressed);
        }
        if !released.is_empty() {
            self.emu.release_keys(released);
        }
        self.keys = now;
        match input.touch {
            Some((x, y)) => {
                self.emu.set_touch_pos([x, y]);
                self.touching = true;
            }
            None if self.touching => {
                self.emu.end_touch();
                self.touching = false;
            }
            None => {}
        }
    }

    fn screens(&self) -> Vec<Screen> {
        self.emu
            .gpu
            .renderer_2d()
            .framebuffer()
            .iter()
            .map(|fb| {
                let mut rgb = Vec::with_capacity(256 * 192 * 3);
                for px in fb.iter().take(256 * 192) {
                    expand(*px, &mut rgb);
                }
                Screen { width: 256, height: 192, rgb }
            })
            .collect()
    }
}
