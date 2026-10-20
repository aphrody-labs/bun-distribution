//! The one machine interface over the DS and the 3DS.

use std::{fmt, sync::Arc};

use crate::format::Platform;

/// Button bits shared by both consoles, in the order the hardware reports them.
pub mod button {
    pub const A: u32 = 1 << 0;
    pub const B: u32 = 1 << 1;
    pub const SELECT: u32 = 1 << 2;
    pub const START: u32 = 1 << 3;
    pub const RIGHT: u32 = 1 << 4;
    pub const LEFT: u32 = 1 << 5;
    pub const UP: u32 = 1 << 6;
    pub const DOWN: u32 = 1 << 7;
    pub const R: u32 = 1 << 8;
    pub const L: u32 = 1 << 9;
    pub const X: u32 = 1 << 10;
    pub const Y: u32 = 1 << 11;
    /// New 3DS shoulder buttons; ignored by the DS.
    pub const ZL: u32 = 1 << 14;
    pub const ZR: u32 = 1 << 15;
}

/// Input for one frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Input {
    /// Held buttons, see [`button`].
    pub buttons: u32,
    /// Touch point in bottom-screen pixels (DS 256x192, 3DS 320x240).
    pub touch: Option<(u16, u16)>,
    /// Circle pad, -1.0..=1.0 per axis (3DS only).
    pub circle: [f32; 2],
    /// C-stick, -1.0..=1.0 per axis (New 3DS only).
    pub c_stick: [f32; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ScreenId {
    Top,
    Bottom,
}

/// Geometry of one screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScreenSpec {
    pub id: ScreenId,
    pub width: u32,
    pub height: u32,
}

/// One screen, RGBA8, row-major, top-left origin. Cloning shares the pixels.
#[derive(Clone, Debug)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<Vec<u8>>,
}

/// A host-device texture containing the DS screens stacked vertically, top screen first.
/// It belongs to the device supplied at boot; no CPU readback or second GPU is introduced.
#[cfg(feature = "nds-gpu")]
#[derive(Clone)]
pub struct GpuFrame {
    pub texture: aphrody_dust_wgpu::wgpu::Texture,
    pub view: aphrody_dust_wgpu::wgpu::TextureView,
    pub width: u32,
    pub height: u32,
    /// Actual 2D plus 3D command submissions, independent from presentation refreshes.
    pub submitted_frames: u64,
    pub gpu2d_submitted_frames: u64,
    pub gpu3d_submitted_frames: u64,
}

/// How a frame ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Frame,
    /// The guest powered off or exited.
    Shutdown,
    /// The guest crashed; the text says how.
    Fault(String),
}

/// SDK failure.
#[derive(Clone, Debug)]
pub struct Error(pub String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn err(context: &str, error: impl fmt::Display) -> Error {
    Error(format!("{context}: {error}"))
}

/// A running DS or 3DS. Implemented by [`crate::nds::Nds`] and [`crate::ctr::Ctr`].
pub trait Handheld {
    fn platform(&self) -> Platform;
    /// Title from the image header, when it has one.
    fn title(&self) -> String;
    /// Top screen first.
    fn screens(&self) -> [ScreenSpec; 2];
    /// Frames per second of the emulated display.
    fn refresh_rate(&self) -> f64;
    /// Rate of the stereo audio produced by [`Handheld::take_audio`].
    fn sample_rate(&self) -> u32;

    /// Advance one display refresh.
    fn run_frame(&mut self) -> Step;
    /// Frames completed since boot.
    fn frames(&self) -> u64;
    /// CPU picture of `screen` as of the last frame. GPU hosts use `gpu_frame`
    /// when `gpu_rendering` is true; this adapter does not perform GPU readback.
    fn image(&self, screen: ScreenId) -> Image;
    /// GPU presentation replaces CPU image upload when available. Refresh once per emulated frame.
    #[cfg(feature = "nds-gpu")]
    fn gpu_frame(&mut self) -> Option<GpuFrame> {
        None
    }
    /// Whether presentation must use the host texture instead of the CPU image adapter.
    #[cfg(feature = "nds-gpu")]
    fn gpu_rendering(&self) -> bool {
        false
    }
    /// 3DS right-eye picture while the title renders in stereo.
    fn image_right_eye(&self) -> Option<Image> {
        None
    }
    fn set_input(&mut self, input: &Input);
    /// Append interleaved stereo samples (-1.0..=1.0) produced since the last call.
    fn take_audio(&mut self, out: &mut Vec<f32>);
    /// Debug text the guest printed since the last call.
    fn take_console(&mut self) -> String {
        String::new()
    }

    /// Serialize the whole machine.
    fn save_state(&mut self) -> Result<Vec<u8>>;
    /// Restore a state produced by [`Handheld::save_state`] for the same image.
    fn load_state(&mut self, state: &[u8]) -> Result<()>;
    /// Write modified persistent save data (cartridge backup, SD card) to disk.
    fn flush_save(&mut self) -> Result<()>;

    /// Main CPU registers: ARM9 on the DS, ARM11 core 0 on the 3DS.
    fn registers(&mut self) -> Vec<(String, u32)>;
    /// Read guest memory through the main CPU's view; unmapped bytes read as zero.
    fn read_memory(&mut self, address: u32, length: usize) -> Vec<u8>;
    /// One line describing the machine state for logs.
    fn status(&mut self) -> String;
}

/// 64-bit FNV-1a over the pixels of both screens, for reproducible frame checks.
pub fn frame_hash(machine: &dyn Handheld) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for id in [ScreenId::Top, ScreenId::Bottom] {
        for byte in machine.image(id).rgba.iter() {
            hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}
