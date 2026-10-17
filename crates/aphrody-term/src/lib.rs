// SPDX-License-Identifier: Apache-2.0
//! # Aphrody Term (`aphrody-term`)
//!
//! Headless terminal engine for agent computer use: a VT/ANSI parser writing into a cell grid,
//! an optional native PTY (`portable-pty`: ConPTY on Windows, Unix PTY elsewhere), plain-text
//! screen scraping and a coalesced background/glyph quad batcher for renderers.
//!
//! Scope today: CSI cursor movement, erase, SGR colors/attributes, DSR/CPR replies, cursor
//! visibility and UTF-8 (width-1 cells). OSC sequences are skipped; there is no wide-cell,
//! BiDi, hyperlink, semantic-zone or Kitty keyboard support, and no GPU backend in this crate.

pub mod cell;
pub mod computer_use;
pub mod grid;
pub mod parser;
pub mod pty;
pub mod render;

pub use cell::{CellFlags, PackedCell};
pub use computer_use::{ComputerAction, ComputerUseController, SemanticBlock};
pub use grid::{CursorShape, CursorState, DirtyTracker, TerminalGrid};
pub use parser::VtParser;
pub use pty::{FairMutex, MAX_LOCKED_READ_BYTES, PtyController};
pub use render::{BgQuad, FrameBatcher, GlyphQuad};

use std::sync::Arc;

/// Configuration for creating an `AphrodyTerm` instance.
#[derive(Debug, Clone)]
pub struct TermConfig {
    pub cols: u16,
    pub rows: u16,
    pub max_scrollback: usize,
}

impl Default for TermConfig {
    fn default() -> Self {
        Self {
            cols: 80,
            rows: 24,
            max_scrollback: 10_000,
        }
    }
}

/// Terminal engine instance: grid, parser, render batcher and computer-use controller.
pub struct AphrodyTerm {
    grid: Arc<FairMutex<TerminalGrid>>,
    parser: VtParser,
    batcher: FrameBatcher,
    computer_use: Arc<ComputerUseController>,
}

impl AphrodyTerm {
    /// Creates a headless terminal engine with no process attached.
    pub fn new(config: TermConfig) -> Self {
        let grid = Arc::new(FairMutex::new(TerminalGrid::new(
            config.cols as usize,
            config.rows as usize,
            config.max_scrollback,
        )));

        Self {
            grid,
            parser: VtParser::new(),
            batcher: FrameBatcher::new(),
            computer_use: Arc::new(ComputerUseController::new(None)),
        }
    }

    /// Spawns a native PTY process and attaches it to this terminal engine.
    pub fn spawn_pty(
        cmd: &str,
        args: &[&str],
        config: TermConfig,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (pty, mut reader) = PtyController::spawn(cmd, args, config.cols, config.rows)?;
        let grid = Arc::new(FairMutex::new(TerminalGrid::new(
            config.cols as usize,
            config.rows as usize,
            config.max_scrollback,
        )));

        let grid_reader = Arc::clone(&grid);
        let reply_writer = pty.writer_handle();

        // Reader thread: feeds PTY output into the grid and answers DSR/CPR queries (ConPTY
        // blocks on its startup cursor query until it gets a reply).
        std::thread::spawn(move || {
            let mut parser = VtParser::new();
            let mut buf = vec![0u8; MAX_LOCKED_READ_BYTES];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        {
                            let mut g = grid_reader.lock();
                            parser.ingest(&mut g, &buf[..n]);
                        }
                        if !parser.replies.is_empty() {
                            let mut w = reply_writer.lock();
                            for reply in parser.replies.drain(..) {
                                if std::io::Write::write_all(&mut **w, reply.as_bytes()).is_err() {
                                    return;
                                }
                            }
                            let _ = std::io::Write::flush(&mut **w);
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            grid,
            parser: VtParser::new(),
            batcher: FrameBatcher::new(),
            computer_use: Arc::new(ComputerUseController::new(Some(pty))),
        })
    }

    /// Applies raw terminal output bytes directly into the state machine.
    pub fn ingest(&mut self, bytes: &[u8]) {
        let mut g = self.grid.lock();
        self.parser.ingest(&mut g, bytes);
    }

    /// Resizes the terminal grid.
    pub fn resize(&mut self, cols: u16, rows: u16) {
        let mut g = self.grid.lock();
        g.resize(cols as usize, rows as usize);
    }

    /// Drains pending replies (such as CPR) produced by `ingest`. PTY-backed terminals answer
    /// them on the reader thread instead.
    pub fn take_replies(&mut self) -> Vec<String> {
        std::mem::take(&mut self.parser.replies)
    }

    /// Captures the visible screen as plain text (trailing blanks trimmed per row).
    pub fn scrape_text(&self) -> String {
        let g = self.grid.lock();
        self.computer_use.snapshot_text(&g)
    }

    /// Builds coalesced background and glyph quad buffers for a renderer.
    pub fn render_frame(&mut self) -> (&[BgQuad], &[GlyphQuad]) {
        let g = self.grid.lock();
        self.batcher.build_frame(&g);
        (&self.batcher.bg_quads, &self.batcher.glyphs)
    }

    /// Returns direct access to the AI Computer-Use controller.
    pub fn computer_use(&self) -> &ComputerUseController {
        &self.computer_use
    }

    /// Returns a shared handle to the controller (for backends that outlive this value).
    pub fn computer_use_handle(&self) -> Arc<ComputerUseController> {
        Arc::clone(&self.computer_use)
    }

    /// Returns the underlying thread-safe grid reference.
    pub fn grid(&self) -> Arc<FairMutex<TerminalGrid>> {
        Arc::clone(&self.grid)
    }

    /// Returns the active cursor coordinates `(col, row, visible)`.
    pub fn cursor(&self) -> (usize, usize, bool) {
        let g = self.grid.lock();
        self.computer_use.cursor_position(&g)
    }

    /// Returns the 64-bit dirty row bitmask.
    pub fn dirty_mask(&self) -> u64 {
        let g = self.grid.lock();
        g.dirty_mask()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terminal_basic_echo_and_scrape() {
        let mut term = AphrodyTerm::new(TermConfig {
            cols: 80,
            rows: 24,
            max_scrollback: 100,
        });

        term.ingest(b"Hello, Aphrody Term!\r\nSecond Line");
        let text = term.scrape_text();
        assert!(text.contains("Hello, Aphrody Term!"));
        assert!(text.contains("Second Line"));
    }

    #[test]
    fn test_ansi_color_and_sgr() {
        let mut term = AphrodyTerm::new(TermConfig::default());
        term.ingest(b"\x1b[1;31mRED BOLD\x1b[0m DEFAULT");

        let grid = term.grid.lock();
        let red_cell = grid.cell(0, 0).unwrap();
        assert_eq!(red_cell.character(), 'R');
        assert!(red_cell.flags.contains(CellFlags::BOLD));
        assert_ne!(red_cell.fg_rgba, 0xFFFFFFFF);

        let def_cell = grid.cell(9, 0).unwrap();
        assert_eq!(def_cell.character(), 'D');
        assert!(!def_cell.flags.contains(CellFlags::BOLD));
    }

    #[test]
    fn test_dual_pass_render_coalescing() {
        let mut term = AphrodyTerm::new(TermConfig::default());
        // Print 5 cells with blue background
        term.ingest(b"\x1b[44mHELLO\x1b[0m WORLD");

        let (bg_quads, glyphs) = term.render_frame();
        // The 5 characters with blue background should be coalesced into a SINGLE BgQuad of width 5!
        assert_eq!(bg_quads.len(), 1);
        assert_eq!(bg_quads[0].width, 5);
        assert_eq!(bg_quads[0].col, 0);

        // 11 non-blank characters total ("HELLO" + " " + "WORLD" -> 10 non-blank glyphs)
        assert_eq!(glyphs.len(), 10);
    }

    #[test]
    fn test_utf8_split_across_ingest_calls() {
        let mut term = AphrodyTerm::new(TermConfig::default());
        let bytes = "héllo €".as_bytes();
        term.ingest(&bytes[..2]);
        term.ingest(&bytes[2..]);
        assert_eq!(term.scrape_text().lines().next(), Some("héllo €"));

        term.ingest(b"\r\n\xFFx");
        assert!(term.scrape_text().contains("\u{FFFD}x"));
    }

    #[test]
    fn test_oversized_csi_parameter_does_not_overflow() {
        let mut term = AphrodyTerm::new(TermConfig::default());
        term.ingest(b"\x1b[99999999999999999999Hok");
        assert!(term.scrape_text().contains("ok"));
    }

    #[test]
    fn test_dispatch_without_pty_is_an_error() {
        let term = AphrodyTerm::new(TermConfig::default());
        let err = term
            .computer_use()
            .dispatch_action(ComputerAction::TypeText("ls".into()))
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotConnected);
    }

    #[test]
    fn test_computer_use_text_scrape() {
        let mut term = AphrodyTerm::new(TermConfig::default());
        term.ingest(b"user@aphrody:~$ cargo check\r\n   Compiling aphrody v1.0\r\n    Finished dev\r\nuser@aphrody:~$ ");

        let snapshot = term.scrape_text();
        assert!(snapshot.contains("user@aphrody:~$ cargo check"));
        assert!(snapshot.contains("Finished dev"));
    }
}
