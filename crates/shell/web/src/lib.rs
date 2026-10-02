// SPDX-License-Identifier: Apache-2.0
//! Aphrody shell for WebAssembly.
//!
//! One `wasm-bindgen` surface serves every web-shaped host: a plain browser page, a bundler
//! (Bun/Vite) app and a Tauri webview. The transport is the host's job: a `WebSocket` to
//! `aphrody-terminal-backend::serve`, Tauri `invoke`/events to a native PTY, or no transport at
//! all, in which case [`WebShell`] runs the in-process [`local::LocalShell`].

pub mod local;
mod syntax;
pub mod wire;

use aphrody_terminal_core::TerminalState;
use wasm_bindgen::prelude::*;

/// VT parser and grid, fed with bytes from any transport.
#[wasm_bindgen]
pub struct WebTerminal {
    state: TerminalState,
}

#[wasm_bindgen]
impl WebTerminal {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(cols: u16, rows: u16) -> Self {
        Self { state: TerminalState::new(cols, rows) }
    }

    /// Applies output bytes from the shell.
    pub fn ingest(&mut self, bytes: &[u8]) {
        self.state.ingest(bytes);
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.state.resize(cols, rows);
    }

    /// VT replies (CPR/DSR) the host must send back to the shell.
    pub fn take_replies(&mut self) -> Vec<String> {
        self.state.take_replies()
    }

    /// Visible rows as plain text.
    #[must_use]
    pub fn lines(&self) -> Vec<String> {
        self.state.snapshot().lines
    }

    /// `{columns, rows, lines, cursor:{row,col,visible}}` for a renderer.
    #[must_use]
    pub fn snapshot_json(&self) -> String {
        let snap = self.state.styled_snapshot();
        let lines = self.state.snapshot().lines;
        serde_json::json!({
            "columns": snap.columns,
            "rows": snap.rows,
            "lines": lines,
            "cursor": {
                "row": snap.cursor.pos.row.0,
                "col": snap.cursor.pos.col.0,
                "visible": snap.cursor.is_visible(),
            },
        })
        .to_string()
    }
}

/// Backend-less shell: the local line shell wired to a [`WebTerminal`].
#[wasm_bindgen]
pub struct WebShell {
    shell: local::LocalShell,
    terminal: WebTerminal,
}

#[wasm_bindgen]
impl WebShell {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(cols: u16, rows: u16) -> Self {
        let (shell, greeting) = local::LocalShell::new();
        let mut terminal = WebTerminal::new(cols, rows);
        terminal.ingest(&greeting);
        Self { shell, terminal }
    }

    /// Feeds typed bytes; returns the rendered output bytes (also applied to the terminal).
    pub fn input(&mut self, bytes: &[u8]) -> Vec<u8> {
        let out = self.shell.input(bytes);
        self.terminal.ingest(&out);
        out
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.terminal.resize(cols, rows);
    }

    #[must_use]
    pub fn exited(&self) -> bool {
        self.shell.exited()
    }

    #[must_use]
    pub fn snapshot_json(&self) -> String {
        self.terminal.snapshot_json()
    }
}

/// JSON text frame asking a remote PTY to resize.
#[wasm_bindgen]
#[must_use]
pub fn resize_frame(cols: u16, rows: u16) -> String {
    wire::resize_frame(cols, rows)
}

/// JSON text frame carrying input bytes.
#[wasm_bindgen]
#[must_use]
pub fn data_frame(bytes: &[u8]) -> String {
    wire::data_frame(bytes)
}
