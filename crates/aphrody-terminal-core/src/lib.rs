// SPDX-License-Identifier: Apache-2.0
//! Portable VT state derived from a terminal byte stream (native, WASM, Tauri).

use std::sync::{Arc, Mutex, PoisonError};

use rio_vt::{
    ansi::CursorShape,
    crosswords::{
        Crosswords, CrosswordsSize,
        pos::{Column, CursorState, Line, Pos},
        square::Wide,
        style::Style,
    },
    event::{EventListener, RioEvent, WindowId},
    performer::handler::Processor,
};

/// Default number of rows retained by the native terminal model.
pub const DEFAULT_SCROLLBACK_LINES: usize = 10_000;

/// A renderer-neutral snapshot of the visible terminal grid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSnapshot {
    /// The terminal width in cells.
    pub columns: usize,
    /// The terminal height in cells.
    pub rows: usize,
    /// One Unicode string per visible row, including ordinary blank cells but not wide-cell
    /// spacers.
    pub lines: Vec<String>,
}

/// A visible cell with its resolved VT style, including styled blank cells.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalCell {
    /// The full grapheme contents, excluding a wide-character spacer.
    pub text: String,
    /// Rio's foreground, background, underline color and SGR attributes.
    pub style: Style,
    /// Number of terminal columns occupied by this cell (zero for a spacer).
    pub width: u8,
}

/// Renderer-facing visible grid, preserving terminal presentation information.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyledTerminalSnapshot {
    /// Number of terminal columns.
    pub columns: usize,
    /// Number of visible terminal rows.
    pub rows: usize,
    /// Cells indexed by visible row and column, including wide-character spacers.
    pub cells: Vec<Vec<TerminalCell>>,
    /// Cursor position and shape; a hidden cursor is represented by Rio's hidden shape.
    pub cursor: CursorState,
}

/// Native VT parser and grid state backed by Rio's embeddable terminal core.
pub struct TerminalState {
    parser: Processor,
    terminal: Crosswords<ReplyListener>,
    replies: Arc<Mutex<Vec<String>>>,
}

#[derive(Clone)]
struct ReplyListener(Arc<Mutex<Vec<String>>>);

impl EventListener for ReplyListener {
    fn send_event(&self, event: RioEvent, _id: WindowId) {
        if let RioEvent::PtyWrite(_, reply) = event {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(reply);
        }
    }
}

impl TerminalState {
    /// Creates a state model with a bounded scrollback buffer.
    #[must_use]
    pub fn new(columns: u16, rows: u16) -> Self {
        let replies = Arc::new(Mutex::new(Vec::new()));
        Self {
            parser: Processor::default(),
            terminal: Crosswords::new(
                size(columns, rows),
                CursorShape::Block,
                ReplyListener(Arc::clone(&replies)),
                WindowId::from(0),
                0,
                DEFAULT_SCROLLBACK_LINES,
            ),
            replies,
        }
    }

    /// Applies raw bytes read from the PTY without decoding or rewriting them.
    pub fn ingest(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.terminal, bytes);
    }

    /// Resizes the visible grid. Zero-size requests retain a one-cell grid.
    pub fn resize(&mut self, columns: u16, rows: u16) {
        self.terminal.resize(size(columns, rows));
    }

    /// Drains VT replies that the owning PTY must receive (for example CPR/DSR).
    #[must_use]
    pub fn take_replies(&mut self) -> Vec<String> {
        std::mem::take(&mut *self.replies.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// Returns the current visible text grid for a native host or test.
    #[must_use]
    pub fn snapshot(&self) -> TerminalSnapshot {
        let columns = self.terminal.columns();
        let rows = self.terminal.screen_lines();
        let display_offset = self.terminal.display_offset() as i32;
        let lines = (0..rows)
            .map(|row| {
                let line = Line(row as i32 - display_offset);
                (0..columns)
                    .filter_map(|column| {
                        let pos = Pos::new(line, Column(column));
                        (!matches!(self.terminal.grid[pos].wide(), Wide::Spacer))
                            .then_some(self.terminal.grid.cell_text(pos))
                    })
                    .flatten()
                    .filter(|character| *character != '\0')
                    .collect()
            })
            .collect();

        TerminalSnapshot {
            columns,
            rows,
            lines,
        }
    }

    /// Returns the styled visible grid for a native terminal renderer.
    #[must_use]
    pub fn styled_snapshot(&self) -> StyledTerminalSnapshot {
        let columns = self.terminal.columns();
        let rows = self.terminal.screen_lines();
        let display_offset = self.terminal.display_offset() as i32;
        let cells = (0..rows)
            .map(|row| {
                let line = Line(row as i32 - display_offset);
                (0..columns)
                    .map(|column| {
                        let pos = Pos::new(line, Column(column));
                        let square = &self.terminal.grid[pos];
                        let width = match square.wide() {
                            Wide::Wide => 2,
                            Wide::Spacer => 0,
                            Wide::Narrow | Wide::LeadingSpacer => 1,
                        };
                        let text = if width == 0 {
                            String::new()
                        } else {
                            self.terminal
                                .grid
                                .cell_text(pos)
                                .filter(|c| *c != '\0')
                                .collect()
                        };
                        TerminalCell {
                            text,
                            style: self.terminal.grid.style_of(square),
                            width,
                        }
                    })
                    .collect()
            })
            .collect();

        StyledTerminalSnapshot {
            columns,
            rows,
            cells,
            cursor: self.terminal.cursor(),
        }
    }
}

fn size(columns: u16, rows: u16) -> CrosswordsSize {
    CrosswordsSize::new(usize::from(columns.max(1)), usize::from(rows.max(1)))
}

#[cfg(test)]
mod tests {
    use rio_vt::{
        config::colors::{AnsiColor, NamedColor},
        crosswords::style::StyleFlags,
    };

    use super::TerminalState;

    #[test]
    fn parses_control_sequences_and_unicode_into_the_native_grid() {
        let mut state = TerminalState::new(12, 2);
        state.ingest(b"\x1b[31mred\x1b[0m ");
        state.ingest("日本".as_bytes());
        state.ingest(b"\x1b[2;1Hnext");

        let snapshot = state.snapshot();
        assert_eq!(snapshot.columns, 12);
        assert_eq!(snapshot.rows, 2);
        assert!(
            snapshot.lines[0].starts_with("red 日本"),
            "first row: {:?}",
            snapshot.lines[0]
        );
        assert!(
            snapshot.lines[0].contains('本'),
            "first row: {:?}",
            snapshot.lines[0]
        );
        assert!(snapshot.lines[1].starts_with("next"));
    }

    #[test]
    fn resize_updates_the_visible_grid() {
        let mut state = TerminalState::new(80, 24);
        state.resize(40, 10);

        let snapshot = state.snapshot();
        assert_eq!((snapshot.columns, snapshot.rows), (40, 10));
        assert_eq!(snapshot.lines.len(), 10);
    }

    #[test]
    fn cursor_position_query_produces_a_pty_reply() {
        let mut state = TerminalState::new(80, 24);
        state.ingest(b"\x1b[6n");
        assert_eq!(state.take_replies(), vec!["\x1b[1;1R"]);
        assert!(state.take_replies().is_empty());
    }

    #[test]
    fn snapshot_preserves_combining_marks_without_wide_cell_padding() {
        let mut state = TerminalState::new(8, 1);
        state.ingest("e\u{301}日x".as_bytes());
        assert!(state.snapshot().lines[0].starts_with("e\u{301}日x"));
    }

    #[test]
    fn styled_snapshot_preserves_color_attributes_wide_cells_and_cursor() {
        let mut state = TerminalState::new(8, 2);
        state.ingest(b"\x1b[1;31mR\x1b[0m");
        state.ingest("日".as_bytes());
        state.ingest(b"\x1b[44m \x1b[0m");

        let snapshot = state.styled_snapshot();
        assert_eq!((snapshot.columns, snapshot.rows), (8, 2));
        assert_eq!(snapshot.cells[0].len(), 8);
        assert_eq!(snapshot.cells[0][0].text, "R");
        assert!(snapshot.cells[0][0].style.flags.contains(StyleFlags::BOLD));
        assert_eq!(
            snapshot.cells[0][0].style.fg,
            AnsiColor::Named(NamedColor::Red)
        );
        assert_eq!(snapshot.cells[0][1].text, "日");
        assert_eq!(snapshot.cells[0][1].width, 2);
        assert_eq!(snapshot.cells[0][2].width, 0);
        assert!(snapshot.cells[0][2].text.is_empty());
        assert_eq!(
            snapshot.cells[0][3].style.bg,
            AnsiColor::Named(NamedColor::Blue)
        );
        assert!(snapshot.cursor.is_visible());
        assert_eq!(snapshot.cursor.pos.col.0, 4);
    }
}
