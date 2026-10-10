// SPDX-License-Identifier: Apache-2.0
//! Dual-pass instanced rendering abstractions (derived from Cosmic-Term and Sugarloaf/WebGPU).
//! Coalesces adjacent cells into continuous quads for maximum GPU draw-call efficiency.

use crate::cell::CellFlags;
use crate::grid::TerminalGrid;

/// Instanced background / decoration quad for GPU shaders.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BgQuad {
    pub col: u16,
    pub row: u16,
    pub width: u16,
    pub height: u16,
    pub bg_rgba: u32,
    pub flags: CellFlags,
}

/// Instanced glyph quad for texture atlas sampling.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlyphQuad {
    pub col: u16,
    pub row: u16,
    pub codepoint: u32,
    pub fg_rgba: u32,
}

/// Pre-allocated frame batcher that produces instanced draw buffers without allocations.
pub struct FrameBatcher {
    pub bg_quads: Vec<BgQuad>,
    pub glyphs: Vec<GlyphQuad>,
}

impl Default for FrameBatcher {
    fn default() -> Self {
        Self {
            bg_quads: Vec::with_capacity(1024),
            glyphs: Vec::with_capacity(4096),
        }
    }
}

impl FrameBatcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Builds coalesced instanced quad buffers from the terminal grid in a single pass.
    pub fn build_frame(&mut self, grid: &TerminalGrid) {
        self.bg_quads.clear();
        self.glyphs.clear();

        let cols = grid.cols();
        let rows = grid.rows();

        for r in 0..rows {
            let mut c = 0;
            while c < cols {
                let cell = match grid.cell(c, r) {
                    Some(cell) => cell,
                    None => break,
                };

                // Pass 2: Glyph quad (if character is non-blank)
                if !cell.is_empty() && cell.width > 0 {
                    self.glyphs.push(GlyphQuad {
                        col: c as u16,
                        row: r as u16,
                        codepoint: cell.codepoint,
                        fg_rgba: cell.fg_rgba,
                    });
                }

                // Pass 1: Coalesced background quads
                // Scan ahead to merge adjacent cells with the exact same background and decoration flags
                let bg = cell.bg_rgba;
                let flags = cell.flags;
                let start_col = c;
                c += 1;

                while c < cols {
                    if let Some(next_cell) = grid.cell(c, r) {
                        if next_cell.bg_rgba == bg && next_cell.flags == flags {
                            // Also emit glyph if present
                            if !next_cell.is_empty() && next_cell.width > 0 {
                                self.glyphs.push(GlyphQuad {
                                    col: c as u16,
                                    row: r as u16,
                                    codepoint: next_cell.codepoint,
                                    fg_rgba: next_cell.fg_rgba,
                                });
                            }
                            c += 1;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                // Only emit a background quad if there is a visible background color or decoration
                if bg != 0 || flags != CellFlags::NONE {
                    self.bg_quads.push(BgQuad {
                        col: start_col as u16,
                        row: r as u16,
                        width: (c - start_col) as u16,
                        height: 1,
                        bg_rgba: bg,
                        flags,
                    });
                }
            }
        }
    }
}
