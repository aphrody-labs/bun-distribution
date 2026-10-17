// SPDX-License-Identifier: Apache-2.0
//! High-performance terminal grid, circular scrollback storage, and dirty row tracking.

use crate::cell::PackedCell;
use serde::{Deserialize, Serialize};

/// Cursor shape matching WezTerm and Rio specifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum CursorShape {
    #[default]
    Block,
    Beam,
    Underline,
    HollowBlock,
    Hidden,
}

/// Active cursor state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CursorState {
    pub col: usize,
    pub row: usize,
    pub shape: CursorShape,
    pub visible: bool,
}

/// Bitmask and tracker for incremental row updates.
/// Allows renderers and AI agents to update ONLY modified rows without scanning the entire screen.
#[derive(Debug, Clone, Default)]
pub struct DirtyTracker {
    /// Bitmask for the first 64 rows (covering standard terminal heights at zero allocation cost).
    pub fast_mask: u64,
    /// Fallback vector for extra large terminal heights (> 64 rows).
    pub extra_mask: Vec<bool>,
}

impl DirtyTracker {
    #[inline(always)]
    pub fn mark_row_dirty(&mut self, row: usize) {
        if row < 64 {
            self.fast_mask |= 1u64 << row;
        } else {
            let idx = row - 64;
            if idx >= self.extra_mask.len() {
                self.extra_mask.resize(idx + 1, false);
            }
            self.extra_mask[idx] = true;
        }
    }

    #[inline(always)]
    pub fn is_row_dirty(&self, row: usize) -> bool {
        if row < 64 {
            (self.fast_mask & (1u64 << row)) != 0
        } else {
            let idx = row - 64;
            self.extra_mask.get(idx).copied().unwrap_or(false)
        }
    }

    #[inline(always)]
    pub fn mark_all_dirty(&mut self, rows: usize) {
        self.fast_mask = u64::MAX;
        if rows > 64 {
            self.extra_mask.resize(rows - 64, true);
            self.extra_mask.fill(true);
        }
    }

    #[inline(always)]
    pub fn clear(&mut self) {
        self.fast_mask = 0;
        self.extra_mask.fill(false);
    }
}

/// Terminal Grid backing both primary screen and alternate screen buffer.
pub struct TerminalGrid {
    cols: usize,
    rows: usize,
    cells: Vec<PackedCell>,
    scrollback: Vec<Vec<PackedCell>>,
    max_scrollback: usize,
    pub cursor: CursorState,
    pub dirty: DirtyTracker,
}

impl TerminalGrid {
    pub fn new(cols: usize, rows: usize, max_scrollback: usize) -> Self {
        let cols = cols.max(1);
        let rows = rows.max(1);
        let total = cols * rows;
        let cells = vec![PackedCell::default(); total];
        let mut dirty = DirtyTracker::default();
        dirty.mark_all_dirty(rows);

        Self {
            cols,
            rows,
            cells,
            scrollback: Vec::with_capacity(max_scrollback.min(1000)),
            max_scrollback,
            cursor: CursorState {
                col: 0,
                row: 0,
                shape: CursorShape::Block,
                visible: true,
            },
            dirty,
        }
    }

    #[inline(always)]
    pub fn cols(&self) -> usize {
        self.cols
    }

    #[inline(always)]
    pub fn rows(&self) -> usize {
        self.rows
    }

    #[inline(always)]
    pub fn dirty_mask(&self) -> u64 {
        self.dirty.fast_mask
    }

    #[inline(always)]
    pub fn cell(&self, col: usize, row: usize) -> Option<&PackedCell> {
        if col < self.cols && row < self.rows {
            Some(&self.cells[row * self.cols + col])
        } else {
            None
        }
    }

    #[inline(always)]
    pub fn cell_mut(&mut self, col: usize, row: usize) -> Option<&mut PackedCell> {
        if col < self.cols && row < self.rows {
            self.dirty.mark_row_dirty(row);
            Some(&mut self.cells[row * self.cols + col])
        } else {
            None
        }
    }

    /// Direct pointer to raw contiguous memory for zero-copy WebGPU / typed array uploads.
    #[inline(always)]
    pub fn as_raw_slice(&self) -> &[PackedCell] {
        &self.cells
    }

    /// Clears the entire visible screen.
    pub fn clear_screen(&mut self) {
        for cell in &mut self.cells {
            *cell = PackedCell::default();
        }
        self.dirty.mark_all_dirty(self.rows);
    }

    /// Scrolls the screen up by `count` lines, archiving evicted rows into scrollback.
    pub fn scroll_up(&mut self, count: usize) {
        let count = count.min(self.rows);
        if count == 0 {
            return;
        }

        // Archive evicted rows to scrollback
        for r in 0..count {
            let start = r * self.cols;
            let end = start + self.cols;
            let row_slice = self.cells[start..end].to_vec();
            if self.scrollback.len() >= self.max_scrollback && !self.scrollback.is_empty() {
                self.scrollback.remove(0);
            }
            self.scrollback.push(row_slice);
        }

        // Shift remaining visible rows up
        let copy_len = (self.rows - count) * self.cols;
        self.cells.copy_within((count * self.cols).., 0);

        // Fill bottom new rows with defaults
        let bottom_start = copy_len;
        for cell in &mut self.cells[bottom_start..] {
            *cell = PackedCell::default();
        }

        self.dirty.mark_all_dirty(self.rows);
    }

    /// Resizes the visible grid dimensions.
    pub fn resize(&mut self, new_cols: usize, new_rows: usize) {
        let new_cols = new_cols.max(1);
        let new_rows = new_rows.max(1);
        if new_cols == self.cols && new_rows == self.rows {
            return;
        }

        let mut new_cells = vec![PackedCell::default(); new_cols * new_rows];
        let min_cols = self.cols.min(new_cols);
        let min_rows = self.rows.min(new_rows);

        for r in 0..min_rows {
            let old_start = r * self.cols;
            let new_start = r * new_cols;
            new_cells[new_start..new_start + min_cols]
                .copy_from_slice(&self.cells[old_start..old_start + min_cols]);
        }

        self.cols = new_cols;
        self.rows = new_rows;
        self.cells = new_cells;
        self.cursor.col = self.cursor.col.min(new_cols - 1);
        self.cursor.row = self.cursor.row.min(new_rows - 1);
        self.dirty.mark_all_dirty(new_rows);
    }

    /// Plain-text scrape of the visible grid for agents (one `String`, trailing blanks trimmed).
    pub fn scrape_text(&self) -> String {
        let mut out = String::with_capacity(self.rows * (self.cols + 1));
        for r in 0..self.rows {
            let start = r * self.cols;
            let end = start + self.cols;
            let row = &self.cells[start..end];
            // Find last non-blank cell to trim trailing whitespace
            let last_non_blank = row
                .iter()
                .rposition(|c| !c.is_empty())
                .map(|idx| idx + 1)
                .unwrap_or(0);
            for c in &row[..last_non_blank] {
                if c.width > 0 {
                    out.push(c.character());
                }
            }
            if r + 1 < self.rows {
                out.push('\n');
            }
        }
        out
    }
}
