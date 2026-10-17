//! Nintendo DS and 3DS through `aphrody-nds-sdk`: one adapter from the SDK's `Handheld` to this
//! crate's `Machine`. The DS core (Dust), the 3DS core (Zakuro through `aphrody-ctr-emu`), format
//! detection, saves and saved states all live in the SDK.

use std::path::Path;

use aphrody_nds_sdk::{
    Format, Handheld, Input as SdkInput, Options, Platform, ScreenId, Step as SdkStep,
};

use super::{Input, Machine, Screen, Step};

/// A DS or 3DS machine; which one follows the image content.
pub struct HandheldMachine {
    inner: Box<dyn Handheld>,
    fault: Option<String>,
    console: Vec<u8>,
}

fn rgb(machine: &dyn Handheld, id: ScreenId) -> Screen {
    let image = machine.image(id);
    Screen {
        width: image.width as usize,
        height: image.height as usize,
        rgb: image
            .rgba
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect(),
    }
}

impl HandheldMachine {
    /// Boots an image held in memory (browser hosts); the format is detected from the content.
    pub fn from_image(name: &str, image: &[u8]) -> Result<Self, String> {
        let inner =
            aphrody_nds_sdk::boot(name, image, &Options::default()).map_err(|e| e.to_string())?;
        Ok(Self {
            inner,
            fault: None,
            console: Vec::new(),
        })
    }

    /// Boots the image at `path` (DS games keep their backup in `<path>.sav`).
    pub fn from_path(path: &Path) -> Result<Self, String> {
        let inner = aphrody_nds_sdk::open(path, &Options::default()).map_err(|e| e.to_string())?;
        Ok(Self {
            inner,
            fault: None,
            console: Vec::new(),
        })
    }

    /// Whether `image` is a DS or 3DS image the SDK boots.
    pub fn detect(image: &[u8]) -> Option<Format> {
        Format::detect(image)
    }

    pub fn platform(&self) -> Platform {
        self.inner.platform()
    }

    /// The SDK machine, for debugger access (registers, memory).
    pub fn handheld(&mut self) -> &mut dyn Handheld {
        &mut *self.inner
    }
}

impl Machine for HandheldMachine {
    fn name(&self) -> &'static str {
        match self.inner.platform() {
            Platform::Ds => "nintendo-ds",
            Platform::Ctr => "nintendo-3ds",
        }
    }

    fn run_frame(&mut self) -> Step {
        let step = match self.inner.run_frame() {
            SdkStep::Frame => Step::Frame,
            SdkStep::Shutdown => Step::Shutdown,
            SdkStep::Fault(why) => {
                self.fault = Some(why);
                Step::Shutdown
            }
        };
        self.console
            .extend_from_slice(self.inner.take_console().as_bytes());
        step
    }

    fn screens(&self) -> Vec<Screen> {
        vec![
            rgb(&*self.inner, ScreenId::Top),
            rgb(&*self.inner, ScreenId::Bottom),
        ]
    }

    fn set_input(&mut self, input: Input) {
        self.inner.set_input(&SdkInput {
            buttons: input.keys,
            touch: input.touch,
            ..SdkInput::default()
        });
    }

    fn diagnostic(&self) -> Option<String> {
        self.fault.clone()
    }

    fn console(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.console)
    }

    fn refresh_rate(&self) -> f64 {
        self.inner.refresh_rate()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn audio(&mut self, out: &mut Vec<f32>) {
        self.inner.take_audio(out);
    }

    fn save_state(&mut self) -> Option<Vec<u8>> {
        self.inner.save_state().ok()
    }

    fn load_state(&mut self, state: &[u8]) -> Result<(), String> {
        self.inner.load_state(state).map_err(|e| e.to_string())
    }
}
