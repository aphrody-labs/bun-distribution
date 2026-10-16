//! Rust representations of the stable C homebrew ABI.
//!
//! These types describe data exchanged by console-target code. They do not
//! emulate SDK services or make console libraries available to host programs.

/// ABI version declared by `iecode/homebrew.h`.
pub const ABI_VERSION: u32 = 1;

/// Physical display geometry. Dimensions remain platform-specific.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct HomeScreen {
    pub width: u16,
    pub height: u16,
    pub id: u8,
    pub reserved: [u8; 3],
}

/// Button and lower-screen touch snapshot from one input poll.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct HomeInput {
    pub held: u32,
    pub pressed: u32,
    pub touch_valid: u8,
    pub touch_screen: u8,
    pub reserved: [u8; 2],
    pub touch_x: u16,
    pub touch_y: u16,
}

/// Shared button bit assignments from `iecode/homebrew.h`.
pub mod button {
    pub const A: u32 = 1 << 0;
    pub const B: u32 = 1 << 1;
    pub const X: u32 = 1 << 2;
    pub const Y: u32 = 1 << 3;
    pub const START: u32 = 1 << 4;
    pub const SELECT: u32 = 1 << 5;
    pub const UP: u32 = 1 << 6;
    pub const DOWN: u32 = 1 << 7;
    pub const LEFT: u32 = 1 << 8;
    pub const RIGHT: u32 = 1 << 9;
    pub const L: u32 = 1 << 10;
    pub const R: u32 = 1 << 11;
}
