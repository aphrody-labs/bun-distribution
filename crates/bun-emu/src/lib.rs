//! One `Machine` interface over the emulation cores built into Bun OS.

pub mod arm;
pub mod nds;

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
    /// Serial output produced since the last call.
    fn console(&mut self) -> Vec<u8> {
        Vec::new()
    }
}
