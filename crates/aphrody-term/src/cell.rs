// SPDX-License-Identifier: Apache-2.0
//! Packed cell representation and style flags for Aphrody Term.
//! Designed for zero-copy memory layout, L1-cache locality, and direct GPU buffer uploads.

use serde::{Deserialize, Serialize};

/// Cell style flags matching WezTerm, Rio, and Cosmic-Term specifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct CellFlags(pub u16);

impl CellFlags {
    pub const NONE: Self = Self(0);
    pub const BOLD: Self = Self(1 << 0);
    pub const DIM: Self = Self(1 << 1);
    pub const ITALIC: Self = Self(1 << 2);
    pub const UNDERLINE: Self = Self(1 << 3);
    pub const DOUBLE_UNDERLINE: Self = Self(1 << 4);
    pub const UNDERCURL: Self = Self(1 << 5);
    pub const DOTTED_UNDERLINE: Self = Self(1 << 6);
    pub const DASHED_UNDERLINE: Self = Self(1 << 7);
    pub const BLINK: Self = Self(1 << 8);
    pub const INVERSE: Self = Self(1 << 9);
    pub const INVISIBLE: Self = Self(1 << 10);
    pub const STRIKETHROUGH: Self = Self(1 << 11);
    pub const WIDE_CHAR: Self = Self(1 << 12);
    pub const WIDE_CHAR_SPACER: Self = Self(1 << 13);
    pub const HYPERLINK: Self = Self(1 << 14);

    #[inline(always)]
    pub fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }

    #[inline(always)]
    pub fn insert(&mut self, other: Self) {
        self.0 |= other.0;
    }

    #[inline(always)]
    pub fn remove(&mut self, other: Self) {
        self.0 &= !other.0;
    }
}

/// 16-byte packed terminal cell structure.
/// Designed for zero-copy direct upload to WebGPU / OpenGL vertex buffers and L1 cache fit.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackedCell {
    /// Unicode codepoint (4 bytes).
    pub codepoint: u32,
    /// Packed RGBA foreground color (4 bytes).
    pub fg_rgba: u32,
    /// Packed RGBA background color (4 bytes).
    pub bg_rgba: u32,
    /// Style attributes (2 bytes).
    pub flags: CellFlags,
    /// Display width in terminal columns (1 byte: 0 for spacer, 1 for narrow, 2 for wide).
    pub width: u8,
    /// Dirty flag for incremental rendering (1 byte: 1 if modified since last render).
    pub dirty: u8,
}

impl Default for PackedCell {
    fn default() -> Self {
        Self {
            codepoint: ' ' as u32,
            fg_rgba: 0xFFFFFFFF, // Opaque White
            bg_rgba: 0x00000000, // Transparent / Default Background
            flags: CellFlags::NONE,
            width: 1,
            dirty: 1,
        }
    }
}

impl PackedCell {
    /// Creates a new cell with the given character and default styling.
    #[inline(always)]
    pub fn new(c: char) -> Self {
        Self {
            codepoint: c as u32,
            ..Default::default()
        }
    }

    /// Creates a blank spacer cell for wide Unicode characters.
    #[inline(always)]
    pub fn spacer() -> Self {
        Self {
            codepoint: 0,
            flags: CellFlags::WIDE_CHAR_SPACER,
            width: 0,
            dirty: 1,
            ..Default::default()
        }
    }

    #[inline(always)]
    pub fn character(&self) -> char {
        char::from_u32(self.codepoint).unwrap_or(' ')
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.codepoint == 0 || self.codepoint == (' ' as u32)
    }

    #[inline(always)]
    pub fn pack_rgb(r: u8, g: u8, b: u8, a: u8) -> u32 {
        ((r as u32) << 24) | ((g as u32) << 16) | ((b as u32) << 8) | (a as u32)
    }

    #[inline(always)]
    pub fn unpack_rgba(packed: u32) -> (u8, u8, u8, u8) {
        (
            ((packed >> 24) & 0xFF) as u8,
            ((packed >> 16) & 0xFF) as u8,
            ((packed >> 8) & 0xFF) as u8,
            (packed & 0xFF) as u8,
        )
    }
}
