// SPDX-License-Identifier: Apache-2.0
//! Computer-use controller: screen text capture from the grid and key/text injection into
//! the attached PTY.

use crate::grid::TerminalGrid;
use crate::pty::PtyController;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// High-level action for AI Computer-Use agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComputerAction {
    /// Types raw text into the active session.
    TypeText(String),
    /// Sends a special key (e.g. "Enter", "Tab", "Escape", "Ctrl+C", "Up", "Down").
    PressKey(String),
    /// Simulates pasting a multi-line block using bracketed paste mode.
    PasteText(String),
    /// Resizes the terminal grid to target dimensions.
    Resize { cols: u16, rows: u16 },
}

/// Semantic block identified by Aphrody Kernel's Computer-Use parser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticBlock {
    pub prompt: String,
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
}

/// Computer-use controller; actions need a PTY (`AphrodyTerm::spawn_pty`).
pub struct ComputerUseController {
    pty: Option<Mutex<PtyController>>,
}

impl ComputerUseController {
    pub fn new(pty: Option<PtyController>) -> Self {
        Self { pty: pty.map(Mutex::new) }
    }

    /// Captures the visible screen as plain text.
    pub fn snapshot_text(&self, grid: &TerminalGrid) -> String {
        grid.scrape_text()
    }

    /// Returns the active cursor coordinates for the AI agent.
    pub fn cursor_position(&self, grid: &TerminalGrid) -> (usize, usize, bool) {
        (grid.cursor.col, grid.cursor.row, grid.cursor.visible)
    }

    /// Whether a PTY is attached (otherwise `dispatch_action` fails with `NotConnected`).
    pub fn has_pty(&self) -> bool {
        self.pty.is_some()
    }

    /// Dispatches a programmatic Computer-Use action directly into the PTY.
    pub fn dispatch_action(&self, action: ComputerAction) -> std::io::Result<()> {
        let Some(ref pty_lock) = self.pty else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotConnected,
                "no PTY attached to this terminal (use AphrodyTerm::spawn_pty)",
            ));
        };
        let pty = pty_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);

        match action {
            ComputerAction::TypeText(text) => {
                pty.write_all(text.as_bytes())?;
            }
            ComputerAction::PressKey(key) => {
                let seq: &[u8] = match key.to_lowercase().as_str() {
                    "enter" | "return" => b"\r",
                    "tab" => b"\t",
                    "escape" | "esc" => b"\x1b",
                    "backspace" => b"\x08",
                    "ctrl+c" | "ctrl-c" => b"\x03",
                    "ctrl+d" | "ctrl-d" => b"\x04",
                    "ctrl+z" | "ctrl-z" => b"\x1a",
                    "up" => b"\x1b[A",
                    "down" => b"\x1b[B",
                    "right" => b"\x1b[C",
                    "left" => b"\x1b[D",
                    "home" => b"\x1b[H",
                    "end" => b"\x1b[F",
                    _ => key.as_bytes(),
                };
                pty.write_all(seq)?;
            }
            ComputerAction::PasteText(text) => {
                // Bracketed paste encapsulation to prevent accidental command execution during multi-line paste
                pty.write_all(b"\x1b[200~")?;
                pty.write_all(text.replace("\r\n", "\n").replace('\n', "\r").as_bytes())?;
                pty.write_all(b"\x1b[201~")?;
            }
            ComputerAction::Resize { cols, rows } => {
                pty.resize(cols, rows).map_err(std::io::Error::other)?;
            }
        }

        Ok(())
    }
}
