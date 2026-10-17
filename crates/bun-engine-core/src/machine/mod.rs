//! One `Machine` interface over every emulation core owned by Bun Engine.

#[cfg(feature = "arm")]
pub mod arm;
#[cfg(feature = "nds")]
pub mod nds;
#[cfg(feature = "nes")]
pub mod nes;
#[cfg(feature = "gba")]
pub mod gba;
#[cfg(feature = "wii")]
pub mod wii;
#[cfg(all(windows, feature = "x86"))]
pub mod x86;

/// Button bits shared by every machine, in DS/GBA order.
pub mod keys {
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
}

/// The one input model: buttons plus a touch point on the second screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub keys: u32,
    pub touch: Option<(u16, u16)>,
}

/// A 24-bit RGB image, row-major.
pub struct Screen {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}

/// Result of advancing a machine by one video frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Frame,
    Shutdown,
    Stopped,
}

pub trait Machine {
    fn name(&self) -> &'static str;
    fn run_frame(&mut self) -> Step;
    fn screens(&self) -> Vec<Screen>;
    fn set_input(&mut self, _input: Input) {}
    /// Why the machine stopped, when it stopped abnormally.
    fn diagnostic(&self) -> Option<String> {
        None
    }
    /// Serial output produced since the last call.
    fn console(&mut self) -> Vec<u8> {
        Vec::new()
    }
}
