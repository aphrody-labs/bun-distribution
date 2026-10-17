//! Nintendo 3DS on `aphrody-ctr-emu` (Zakuro HLE kernel and services, software PICA renderer).
//!
//! The core boots decrypted CXI/CCI/CIA titles. Homebrew `.3dsx` executables are converted in
//! memory to a NoCrypto CXI by `aphrody_ctr_emu::homebrew`. No firmware or key is involved.

use aphrody_ctr_emu::{
    AUDIO_SAMPLE_RATE, BOTTOM_SIZE, Buttons, Emu, Frame, Image as CtrImage, Input as CtrInput,
    REFRESH_RATE, TOP_SIZE,
};

use crate::{
    Options,
    format::Platform,
    handheld::{Error, Handheld, Image, Input, Result, ScreenId, ScreenSpec, Step, err},
};

/// A running Nintendo 3DS.
pub struct Ctr {
    emu: Emu,
    title: String,
    frames: u64,
    top: Image,
    bottom: Image,
    right: Option<Image>,
    /// DSP output not yet taken by the host (interleaved stereo, bounded to four seconds).
    samples: Vec<f32>,
    console: String,
    stopped: bool,
}

fn convert(image: CtrImage) -> Image {
    Image {
        width: image.width,
        height: image.height,
        rgba: image.rgba,
    }
}

impl Ctr {
    /// Boots an image held in memory: `.3dsx`, `.cxi`, `.cci`/`.3ds` or `.cia`.
    pub fn from_image(name: &str, image: &[u8], options: &Options) -> Result<Self> {
        let mut builder = Emu::builder();
        if let Some(dir) = options
            .data_dir
            .clone()
            .or_else(|| crate::default_data_dir("3ds"))
        {
            builder = builder.data_dir(dir);
        }
        let emu = builder
            .boot_bytes(name, image)
            .map_err(|e| Error(e.to_string()))?;
        let mut machine = Self {
            emu,
            title: name.to_owned(),
            frames: 0,
            top: blank(TOP_SIZE),
            bottom: blank(BOTTOM_SIZE),
            right: None,
            samples: Vec::new(),
            console: String::new(),
            stopped: false,
        };
        machine.capture();
        Ok(machine)
    }

    fn capture(&mut self) {
        let video = self.emu.video();
        self.top = convert(video.top);
        self.bottom = convert(video.bottom);
        self.right = video.top_right.map(convert);
    }
}

fn blank((width, height): (u32, u32)) -> Image {
    Image {
        width,
        height,
        rgba: std::sync::Arc::new(vec![0; (width * height * 4) as usize]),
    }
}

impl Handheld for Ctr {
    fn platform(&self) -> Platform {
        Platform::Ctr
    }

    fn title(&self) -> String {
        self.title.clone()
    }

    fn screens(&self) -> [ScreenSpec; 2] {
        [
            ScreenSpec {
                id: ScreenId::Top,
                width: TOP_SIZE.0,
                height: TOP_SIZE.1,
            },
            ScreenSpec {
                id: ScreenId::Bottom,
                width: BOTTOM_SIZE.0,
                height: BOTTOM_SIZE.1,
            },
        ]
    }

    fn refresh_rate(&self) -> f64 {
        REFRESH_RATE
    }

    fn sample_rate(&self) -> u32 {
        AUDIO_SAMPLE_RATE as u32
    }

    fn run_frame(&mut self) -> Step {
        if self.stopped {
            return Step::Shutdown;
        }
        let outcome = self.emu.run_frame();
        self.frames = self.emu.frames();
        if self.samples.len() > AUDIO_SAMPLE_RATE as usize * 8 {
            self.samples.clear();
        }
        let pcm = self.emu.take_audio();
        self.samples.extend(
            pcm.iter()
                .flat_map(|pair| pair.map(|s| f32::from(s) / 32768.0)),
        );
        self.console.push_str(&self.emu.take_console());
        self.capture();
        match outcome {
            Frame::Completed => Step::Frame,
            Frame::Exited => {
                self.stopped = true;
                Step::Shutdown
            }
            Frame::Faulted(fatal) => {
                self.stopped = true;
                Step::Fault(
                    format!("guest fault (svcBreak or unknown instruction) {fatal}")
                        .trim_end()
                        .to_owned(),
                )
            }
        }
    }

    fn frames(&self) -> u64 {
        self.frames
    }

    fn image(&self, screen: ScreenId) -> Image {
        match screen {
            ScreenId::Top => self.top.clone(),
            ScreenId::Bottom => self.bottom.clone(),
        }
    }

    fn image_right_eye(&self) -> Option<Image> {
        self.right.clone()
    }

    fn set_input(&mut self, input: &Input) {
        self.emu.set_input(CtrInput {
            buttons: Buttons::from_bits_truncate(input.buttons & 0xCFFF),
            circle: input.circle,
            c_stick: input.c_stick,
            touch: input.touch,
            ..CtrInput::default()
        });
    }

    fn take_audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.samples);
    }

    fn take_console(&mut self) -> String {
        std::mem::take(&mut self.console)
    }

    fn save_state(&mut self) -> Result<Vec<u8>> {
        self.emu.save_state().map_err(|e| err("save state", e))
    }

    fn load_state(&mut self, state: &[u8]) -> Result<()> {
        self.emu
            .load_state(state)
            .map_err(|e| err("load state", e))?;
        self.capture();
        Ok(())
    }

    /// The core writes save data and the SD card into its data directory as the guest does.
    fn flush_save(&mut self) -> Result<()> {
        Ok(())
    }

    fn registers(&mut self) -> Vec<(String, u32)> {
        let regs = self.emu.debug().registers();
        let mut out: Vec<(String, u32)> = regs
            .r
            .iter()
            .enumerate()
            .map(|(i, v)| (format!("r{i}"), *v))
            .collect();
        out.push(("cpsr".into(), regs.cpsr));
        out.push(("spsr".into(), regs.spsr));
        out
    }

    fn read_memory(&mut self, address: u32, length: usize) -> Vec<u8> {
        self.emu.debug().read_memory(address, length)
    }

    fn status(&mut self) -> String {
        self.emu.debug().status_line()
    }
}
