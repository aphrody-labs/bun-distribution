// SPDX-License-Identifier: Apache-2.0
//! VT/ANSI stream parser: printable runs between ESC bytes (located with `memchr`) are printed
//! in one pass; UTF-8 is decoded to width-1 cells (no East Asian wide-cell handling).

use crate::cell::{CellFlags, PackedCell};
use crate::grid::TerminalGrid;
use memchr::memchr;

pub struct VtParser {
    fg: u32,
    bg: u32,
    flags: CellFlags,
    pub replies: Vec<String>,
    utf8_buf: [u8; 4],
    utf8_len: usize,
    utf8_need: usize,
}

impl Default for VtParser {
    fn default() -> Self {
        Self {
            fg: 0xFFFFFFFF, // White
            bg: 0x00000000, // Transparent
            flags: CellFlags::NONE,
            replies: Vec::new(),
            utf8_buf: [0; 4],
            utf8_len: 0,
            utf8_need: 0,
        }
    }
}

impl VtParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Primary ingest method: scans raw bytes using bulk ASCII dispatch and falls back to VT escape handling.
    pub fn ingest(&mut self, grid: &mut TerminalGrid, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            // Find next escape character (0x1B) or control character (< 0x20)
            if let Some(next_esc) = memchr(0x1B, bytes) {
                // Fast-path: process printable ASCII run before escape
                if next_esc > 0 {
                    self.print_bulk_ascii(grid, &bytes[..next_esc]);
                }
                // Advance past processed chunk and handle escape sequence
                bytes = &bytes[next_esc..];
                bytes = self.parse_escape_sequence(grid, bytes);
            } else {
                // No escape sequences in remaining buffer: pure bulk printing
                self.print_bulk_ascii(grid, bytes);
                break;
            }
        }
    }

    /// Fast bulk ASCII printable dispatcher.
    fn print_bulk_ascii(&mut self, grid: &mut TerminalGrid, chunk: &[u8]) {
        for &b in chunk {
            match b {
                b'\r' => {
                    grid.cursor.col = 0;
                }
                b'\n' => {
                    grid.cursor.col = 0;
                    if grid.cursor.row + 1 >= grid.rows() {
                        grid.scroll_up(1);
                    } else {
                        grid.cursor.row += 1;
                    }
                }
                b'\t' => {
                    let next_tab = (grid.cursor.col + 8) & !7;
                    grid.cursor.col = next_tab.min(grid.cols() - 1);
                }
                0x08 => {
                    // Backspace
                    grid.cursor.col = grid.cursor.col.saturating_sub(1);
                }
                0x07 => { // Bell (noop)
                }
                0x20..=0x7E => self.put_char(grid, b as u32),
                0x80..=0xFF => self.push_utf8_byte(grid, b),
                _ => {}
            }
        }
    }

    /// Writes one printable codepoint at the cursor (width 1), wrapping at the right margin.
    fn put_char(&mut self, grid: &mut TerminalGrid, codepoint: u32) {
        if grid.cursor.col >= grid.cols() {
            grid.cursor.col = 0;
            if grid.cursor.row + 1 >= grid.rows() {
                grid.scroll_up(1);
            } else {
                grid.cursor.row += 1;
            }
        }

        let col = grid.cursor.col;
        let row = grid.cursor.row;
        if let Some(cell) = grid.cell_mut(col, row) {
            cell.codepoint = codepoint;
            cell.fg_rgba = self.fg;
            cell.bg_rgba = self.bg;
            cell.flags = self.flags;
            cell.width = 1;
            cell.dirty = 1;
        }
        grid.cursor.col += 1;
    }

    /// Accumulates a UTF-8 sequence byte; sequences may span `ingest` calls. Invalid input prints U+FFFD.
    fn push_utf8_byte(&mut self, grid: &mut TerminalGrid, b: u8) {
        if self.utf8_len == 0 {
            let need = match b {
                0xC2..=0xDF => 2,
                0xE0..=0xEF => 3,
                0xF0..=0xF4 => 4,
                _ => {
                    self.put_char(grid, u32::from(char::REPLACEMENT_CHARACTER));
                    return;
                }
            };
            self.utf8_buf[0] = b;
            self.utf8_len = 1;
            self.utf8_need = need;
            return;
        }
        if b & 0xC0 != 0x80 {
            self.utf8_len = 0;
            self.put_char(grid, u32::from(char::REPLACEMENT_CHARACTER));
            self.push_utf8_byte(grid, b);
            return;
        }
        self.utf8_buf[self.utf8_len] = b;
        self.utf8_len += 1;
        if self.utf8_len == self.utf8_need {
            let len = self.utf8_len;
            self.utf8_len = 0;
            let ch = std::str::from_utf8(&self.utf8_buf[..len])
                .ok()
                .and_then(|s| s.chars().next())
                .unwrap_or(char::REPLACEMENT_CHARACTER);
            self.put_char(grid, u32::from(ch));
        }
    }

    /// Parses CSI / OSC / ANSI escape sequences.
    fn parse_escape_sequence<'a>(&mut self, grid: &mut TerminalGrid, bytes: &'a [u8]) -> &'a [u8] {
        if bytes.len() < 2 || bytes[0] != 0x1B {
            return &bytes[1.min(bytes.len())..];
        }

        match bytes[1] {
            b'[' => {
                // CSI (Control Sequence Introducer)
                self.parse_csi(grid, &bytes[2..])
            }
            b']' => {
                // OSC (Operating System Command)
                self.parse_osc(&bytes[2..])
            }
            b'=' | b'>' => {
                // Keypad modes
                &bytes[2..]
            }
            b'M' => {
                // Reverse Index (scroll down)
                if grid.cursor.row == 0 {
                    // Reverse scroll
                } else {
                    grid.cursor.row -= 1;
                }
                &bytes[2..]
            }
            b'c' => {
                // Reset to initial state (RIS)
                grid.clear_screen();
                grid.cursor.col = 0;
                grid.cursor.row = 0;
                self.fg = 0xFFFFFFFF;
                self.bg = 0x00000000;
                self.flags = CellFlags::NONE;
                &bytes[2..]
            }
            _ => &bytes[2..],
        }
    }

    /// Parses CSI sequences: `\x1b[ ... <final_char>`
    fn parse_csi<'a>(&mut self, grid: &mut TerminalGrid, bytes: &'a [u8]) -> &'a [u8] {
        let mut idx = 0;
        let mut params = Vec::new();
        let mut curr_num: Option<u32> = None;
        let mut private = false;

        if idx < bytes.len() && bytes[idx] == b'?' {
            private = true;
            idx += 1;
        }

        while idx < bytes.len() {
            let b = bytes[idx];
            idx += 1;
            match b {
                b'0'..=b'9' => {
                    let digit = (b - b'0') as u32;
                    curr_num = Some(
                        curr_num
                            .unwrap_or(0)
                            .saturating_mul(10)
                            .saturating_add(digit),
                    );
                }
                b';' => {
                    params.push(curr_num.unwrap_or(0));
                    curr_num = None;
                }
                0x40..=0x7E => {
                    // Final character
                    if let Some(num) = curr_num {
                        params.push(num);
                    }
                    self.execute_csi(grid, private, &params, b);
                    return &bytes[idx..];
                }
                _ => {}
            }
        }

        &bytes[idx..]
    }

    /// Executes a parsed CSI command.
    fn execute_csi(
        &mut self,
        grid: &mut TerminalGrid,
        private: bool,
        params: &[u32],
        final_char: u8,
    ) {
        match final_char {
            b'm' => {
                // SGR (Select Graphic Rendition)
                self.handle_sgr(params);
            }
            b'H' | b'f' => {
                // Cursor Position (1-indexed)
                let r = params.first().copied().unwrap_or(1).max(1) - 1;
                let c = params.get(1).copied().unwrap_or(1).max(1) - 1;
                grid.cursor.row = (r as usize).min(grid.rows() - 1);
                grid.cursor.col = (c as usize).min(grid.cols() - 1);
            }
            b'A' => {
                // Cursor Up
                let n = params.first().copied().unwrap_or(1).max(1) as usize;
                grid.cursor.row = grid.cursor.row.saturating_sub(n);
            }
            b'B' => {
                // Cursor Down
                let n = params.first().copied().unwrap_or(1).max(1) as usize;
                grid.cursor.row = (grid.cursor.row + n).min(grid.rows() - 1);
            }
            b'C' => {
                // Cursor Forward
                let n = params.first().copied().unwrap_or(1).max(1) as usize;
                grid.cursor.col = (grid.cursor.col + n).min(grid.cols() - 1);
            }
            b'D' => {
                // Cursor Backward
                let n = params.first().copied().unwrap_or(1).max(1) as usize;
                grid.cursor.col = grid.cursor.col.saturating_sub(n);
            }
            b'J' => {
                // Erase in Display
                let mode = params.first().copied().unwrap_or(0);
                match mode {
                    2 | 3 => grid.clear_screen(),
                    _ => {}
                }
            }
            b'K' => {
                // Erase in Line
                let mode = params.first().copied().unwrap_or(0);
                let row = grid.cursor.row;
                match mode {
                    0 => {
                        // Clear from cursor to end of line
                        for c in grid.cursor.col..grid.cols() {
                            if let Some(cell) = grid.cell_mut(c, row) {
                                *cell = PackedCell::default();
                            }
                        }
                    }
                    1 => {
                        // Clear from start of line to cursor
                        for c in 0..=grid.cursor.col.min(grid.cols() - 1) {
                            if let Some(cell) = grid.cell_mut(c, row) {
                                *cell = PackedCell::default();
                            }
                        }
                    }
                    2 => {
                        // Clear entire line
                        for c in 0..grid.cols() {
                            if let Some(cell) = grid.cell_mut(c, row) {
                                *cell = PackedCell::default();
                            }
                        }
                    }
                    _ => {}
                }
            }
            b'n' => {
                // Device Status Report (DSR)
                if params.first() == Some(&6) {
                    // Cursor Position Report (CPR): \x1b[{row};{col}R
                    let r = grid.cursor.row + 1;
                    let c = grid.cursor.col + 1;
                    self.replies.push(format!("\x1b[{};{}R", r, c));
                }
            }
            b'h' | b'l' if private => {
                let enabled = final_char == b'h';
                match params.first() {
                    Some(25) => grid.cursor.visible = enabled, // Show/Hide cursor
                    Some(1049) => {
                        // Alternate screen buffer
                        grid.clear_screen();
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// Handles SGR color and styling parameters.
    fn handle_sgr(&mut self, params: &[u32]) {
        if params.is_empty() {
            self.fg = 0xFFFFFFFF;
            self.bg = 0x00000000;
            self.flags = CellFlags::NONE;
            return;
        }

        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => {
                    self.fg = 0xFFFFFFFF;
                    self.bg = 0x00000000;
                    self.flags = CellFlags::NONE;
                }
                1 => self.flags.insert(CellFlags::BOLD),
                2 => self.flags.insert(CellFlags::DIM),
                3 => self.flags.insert(CellFlags::ITALIC),
                4 => self.flags.insert(CellFlags::UNDERLINE),
                7 => self.flags.insert(CellFlags::INVERSE),
                9 => self.flags.insert(CellFlags::STRIKETHROUGH),
                22 => {
                    self.flags.remove(CellFlags::BOLD);
                    self.flags.remove(CellFlags::DIM);
                }
                23 => self.flags.remove(CellFlags::ITALIC),
                24 => self.flags.remove(CellFlags::UNDERLINE),
                27 => self.flags.remove(CellFlags::INVERSE),
                29 => self.flags.remove(CellFlags::STRIKETHROUGH),
                // Standard Foreground (30..=37)
                30..=37 => {
                    self.fg = PackedCell::pack_rgb(
                        ansi_rgb(params[i] - 30).0,
                        ansi_rgb(params[i] - 30).1,
                        ansi_rgb(params[i] - 30).2,
                        255,
                    )
                }
                38 => {
                    // Extended Foreground (256 or TrueColor RGB)
                    if i + 2 < params.len() && params[i + 1] == 5 {
                        // 256 color
                        self.fg = PackedCell::pack_rgb(
                            ansi_256_rgb(params[i + 2]).0,
                            ansi_256_rgb(params[i + 2]).1,
                            ansi_256_rgb(params[i + 2]).2,
                            255,
                        );
                        i += 2;
                    } else if i + 4 < params.len() && params[i + 1] == 2 {
                        // Truecolor: 38;2;R;G;B
                        self.fg = PackedCell::pack_rgb(
                            params[i + 2] as u8,
                            params[i + 3] as u8,
                            params[i + 4] as u8,
                            255,
                        );
                        i += 4;
                    }
                }
                39 => self.fg = 0xFFFFFFFF,
                // Standard Background (40..=47)
                40..=47 => {
                    self.bg = PackedCell::pack_rgb(
                        ansi_rgb(params[i] - 40).0,
                        ansi_rgb(params[i] - 40).1,
                        ansi_rgb(params[i] - 40).2,
                        255,
                    )
                }
                48 => {
                    // Extended Background
                    if i + 2 < params.len() && params[i + 1] == 5 {
                        self.bg = PackedCell::pack_rgb(
                            ansi_256_rgb(params[i + 2]).0,
                            ansi_256_rgb(params[i + 2]).1,
                            ansi_256_rgb(params[i + 2]).2,
                            255,
                        );
                        i += 2;
                    } else if i + 4 < params.len() && params[i + 1] == 2 {
                        self.bg = PackedCell::pack_rgb(
                            params[i + 2] as u8,
                            params[i + 3] as u8,
                            params[i + 4] as u8,
                            255,
                        );
                        i += 4;
                    }
                }
                49 => self.bg = 0x00000000,
                _ => {}
            }
            i += 1;
        }
    }

    /// Skips or handles OSC sequences: `\x1b] ... \x07` or `\x1b] ... \x1b\`
    fn parse_osc<'a>(&mut self, bytes: &'a [u8]) -> &'a [u8] {
        let mut idx = 0;
        while idx < bytes.len() {
            if bytes[idx] == 0x07 {
                return &bytes[idx + 1..];
            }
            if bytes[idx] == 0x1B && idx + 1 < bytes.len() && bytes[idx + 1] == b'\\' {
                return &bytes[idx + 2..];
            }
            idx += 1;
        }
        &bytes[idx..]
    }
}

fn ansi_rgb(idx: u32) -> (u8, u8, u8) {
    match idx {
        0 => (0, 0, 0),       // Black
        1 => (205, 49, 49),   // Red
        2 => (13, 188, 121),  // Green
        3 => (229, 229, 16),  // Yellow
        4 => (36, 114, 200),  // Blue
        5 => (188, 63, 188),  // Magenta
        6 => (17, 168, 205),  // Cyan
        7 => (229, 229, 229), // White
        _ => (255, 255, 255),
    }
}

fn ansi_256_rgb(val: u32) -> (u8, u8, u8) {
    if val < 8 {
        ansi_rgb(val)
    } else if val < 16 {
        let (r, g, b) = ansi_rgb(val - 8);
        (
            r.saturating_add(50),
            g.saturating_add(50),
            b.saturating_add(50),
        )
    } else if val < 232 {
        let val = val - 16;
        let r = ((val / 36) % 6) * 51;
        let g = ((val / 6) % 6) * 51;
        let b = (val % 6) * 51;
        (r as u8, g as u8, b as u8)
    } else {
        let gray = 8 + (val - 232) * 10;
        (gray as u8, gray as u8, gray as u8)
    }
}
