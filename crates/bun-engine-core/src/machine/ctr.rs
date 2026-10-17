//! Nintendo 3DS on `aphrody-ctr-emu` (Zakuro HLE kernel and services, software PICA renderer).
//!
//! The core boots decrypted CXI/CCI/CIA titles. Homebrew `.3dsx` executables are converted in
//! memory to a NoCrypto CXI by `aphrody_ctr_emu::homebrew`.

use std::path::{Path, PathBuf};

use aphrody_ctr_emu::{AUDIO_SAMPLE_RATE, Buttons, Emu, Frame, Input as CtrInput, REFRESH_RATE};

use super::{Input, Machine, Screen, Step};

pub struct Ctr {
    emu: Emu,
    screens: Vec<Screen>,
    stopped: Option<String>,
    /// DSP output not yet taken by the host (interleaved stereo, bounded to two seconds).
    samples: Vec<f32>,
    console: Vec<u8>,
}

impl Ctr {
    /// Boots an image held in memory (browser hosts): a `.3dsx` (converted to a CXI) or a
    /// CXI/CCI/CIA, without touching the file system.
    pub fn from_image(name: &str, image: &[u8]) -> Result<Self, String> {
        let mut builder = Emu::builder();
        if let Some(dir) = data_dir() {
            builder = builder.data_dir(dir);
        }
        Self::boot(builder.boot_bytes(name, image))
    }

    /// Boots `path`: a `.3dsx` (converted to a CXI) or a CXI, CCI or CIA whose bytes are `image`.
    pub fn from_path(path: &Path, image: &[u8]) -> Result<Self, String> {
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("title");
        Self::from_image(name, image)
    }

    fn boot(emu: Result<Emu, aphrody_ctr_emu::Error>) -> Result<Self, String> {
        let mut machine = Self {
            emu: emu.map_err(|e| e.to_string())?,
            screens: Vec::new(),
            stopped: None,
            samples: Vec::new(),
            console: Vec::new(),
        };
        machine.capture();
        Ok(machine)
    }

    fn capture(&mut self) {
        let video = self.emu.video();
        self.screens = [video.top, video.bottom]
            .into_iter()
            .map(|image| Screen {
                width: image.width as usize,
                height: image.height as usize,
                rgb: image.rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect(),
            })
            .collect();
    }
}

impl Machine for Ctr {
    fn name(&self) -> &'static str {
        "nintendo-3ds"
    }

    fn run_frame(&mut self) -> Step {
        if self.stopped.is_some() {
            return Step::Shutdown;
        }
        let outcome = self.emu.run_frame();
        // Keep the DSP output for the host's sink, bounded when nobody drains it.
        if self.samples.len() > AUDIO_SAMPLE_RATE as usize * 4 {
            self.samples.clear();
        }
        let pcm = self.emu.take_audio();
        self.samples
            .extend(pcm.iter().flat_map(|pair| pair.map(|s| f32::from(s) / 32768.0)));
        self.console.extend_from_slice(self.emu.take_console().as_bytes());
        self.capture();
        match outcome {
            Frame::Completed => Step::Frame,
            Frame::Exited => {
                self.stopped = Some("the title called svcExitProcess".into());
                Step::Shutdown
            }
            Frame::Faulted(fatal) => {
                self.stopped = Some(
                    format!("guest fault (svcBreak or unknown instruction) {fatal}")
                        .trim_end()
                        .to_owned(),
                );
                Step::Shutdown
            }
        }
    }

    fn screens(&self) -> Vec<Screen> {
        self.screens
            .iter()
            .map(|s| Screen { width: s.width, height: s.height, rgb: s.rgb.clone() })
            .collect()
    }

    fn set_input(&mut self, input: Input) {
        self.emu.set_input(CtrInput {
            buttons: Buttons::from_bits_truncate(input.keys & 0xFFF),
            touch: input.touch,
            ..CtrInput::default()
        });
    }

    fn diagnostic(&self) -> Option<String> {
        self.stopped.clone()
    }

    fn refresh_rate(&self) -> f64 {
        REFRESH_RATE
    }

    fn sample_rate(&self) -> u32 {
        AUDIO_SAMPLE_RATE as u32
    }

    fn audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.samples);
    }

    fn console(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.console)
    }
}

/// Saves, SD card and mods: `$BUN_ENGINE_DATA/3ds`, else the user data directory
/// (`%APPDATA%\bun-engine\3ds`, `$XDG_DATA_HOME/bun-engine/3ds` or `~/.local/share/bun-engine/3ds`).
/// Without it the core would write into the working directory.
fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("BUN_ENGINE_DATA") {
        return Some(PathBuf::from(dir).join("3ds"));
    }
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
    };
    base.map(|base| base.join("bun-engine").join("3ds"))
}
