//! Nintendo DS ARM9 bindings for Rust homebrew (`no_std`).
//!
//! Two layers, both derived from the libnds headers (`vendor/libnds`, BlocksDS
//! `libs/libnds/include`, zlib licence):
//!
//! * [`hw`]: the memory map and I/O registers as plain addresses with volatile accessors, no
//!   library needed;
//! * the `extern "C"` entry points of libnds that homebrew relies on (interrupts, BIOS waits,
//!   key scanning, touch, the text console). They are resolved at link time against `libnds9`
//!   (BlocksDS or devkitPro), so only the ROM build links them; on the host the crate is
//!   declarations only.
//!
//! Build ROMs with `crates/aphrody-nds-sdk/devkit/build.sh nds-rust` and run them with
//! `nds-sdk run game.nds` (Dust).

#![no_std]

use core::ffi::{c_char, c_int};

/// Memory map and I/O registers (ARM9 view).
pub mod hw {
    use core::ptr::{read_volatile, write_volatile};

    pub const MAIN_RAM: usize = 0x0200_0000;
    pub const PALETTE_MAIN: usize = 0x0500_0000;
    pub const PALETTE_SUB: usize = 0x0500_0400;
    pub const VRAM_BG_MAIN: usize = 0x0600_0000;
    pub const VRAM_BG_SUB: usize = 0x0620_0000;
    pub const VRAM_LCD_A: usize = 0x0680_0000;
    pub const OAM_MAIN: usize = 0x0700_0000;
    pub const OAM_SUB: usize = 0x0700_0400;

    pub const REG_DISPCNT: usize = 0x0400_0000;
    pub const REG_DISPSTAT: usize = 0x0400_0004;
    pub const REG_VCOUNT: usize = 0x0400_0006;
    pub const REG_DISPCNT_SUB: usize = 0x0400_1000;
    pub const REG_KEYINPUT: usize = 0x0400_0130;
    pub const REG_VRAMCNT_A: usize = 0x0400_0240;
    pub const REG_IME: usize = 0x0400_0208;
    pub const REG_IE: usize = 0x0400_0210;
    pub const REG_IF: usize = 0x0400_0214;
    pub const REG_POWCNT1: usize = 0x0400_0304;

    /// `DISPCNT` video mode 0 with BG0 on (2D, text backgrounds).
    pub const MODE_0_2D: u32 = 0x0001_0000;

    /// Volatile 16-bit read.
    ///
    /// # Safety
    /// `address` must be a valid, aligned DS I/O or memory address.
    pub unsafe fn read16(address: usize) -> u16 {
        unsafe { read_volatile(address as *const u16) }
    }

    /// Volatile 16-bit write.
    ///
    /// # Safety
    /// `address` must be a valid, aligned DS I/O or memory address.
    pub unsafe fn write16(address: usize, value: u16) {
        unsafe { write_volatile(address as *mut u16, value) }
    }

    /// Volatile 32-bit write.
    ///
    /// # Safety
    /// `address` must be a valid, aligned DS I/O or memory address.
    pub unsafe fn write32(address: usize, value: u32) {
        unsafe { write_volatile(address as *mut u32, value) }
    }
}

/// Key bits of `keysHeld`, `keysDown` and `keysUp` (`nds/arm9/input.h`).
pub mod key {
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
    pub const TOUCH: u32 = 1 << 12;
    pub const LID: u32 = 1 << 13;
}

/// Interrupt masks (`nds/interrupts.h`).
pub mod irq {
    pub const VBLANK: u32 = 1 << 0;
    pub const HBLANK: u32 = 1 << 1;
    pub const VCOUNT: u32 = 1 << 2;
}

/// Touch screen sample (`touchPosition`).
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct TouchPosition {
    pub raw_x: u16,
    pub raw_y: u16,
    pub px: u16,
    pub py: u16,
    pub z1: u16,
    pub z2: u16,
}

/// Opaque `PrintConsole`.
#[repr(C)]
pub struct PrintConsole {
    _private: [u8; 0],
}

unsafe extern "C" {
    pub fn irqInit();
    pub fn irqEnable(irq: u32);
    pub fn irqSet(irq: u32, handler: Option<unsafe extern "C" fn()>);
    pub fn swiWaitForVBlank();
    pub fn scanKeys();
    pub fn keysHeld() -> u32;
    pub fn keysDown() -> u32;
    pub fn keysUp() -> u32;
    pub fn touchRead(data: *mut TouchPosition);
    /// Initialise the text console on the sub (bottom) screen.
    pub fn consoleDemoInit() -> *mut PrintConsole;
    pub fn printf(format: *const c_char, ...) -> c_int;
}
