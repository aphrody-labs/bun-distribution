// SPDX-License-Identifier: Apache-2.0
//! Self-contained line shell that runs entirely inside WebAssembly.
//!
//! It needs no PTY and no backend: bytes typed by the user go in, VT output bytes come out, ready
//! to be fed to a [`aphrody_terminal_core::TerminalState`]. Hosts that have a real backend
//! (native PTY over WebSocket, Tauri IPC) bypass it.

use std::collections::BTreeMap;

const PROMPT: &str = "aphrody> ";

/// Line editor plus a small builtin command set.
#[derive(Debug, Default)]
pub struct LocalShell {
    line: String,
    history: Vec<String>,
    env: BTreeMap<String, String>,
    exited: bool,
}

impl LocalShell {
    /// Creates a shell and returns it with its greeting and first prompt.
    #[must_use]
    pub fn new() -> (Self, Vec<u8>) {
        let greeting = format!("Aphrody shell (wasm {})\r\ntype `help`\r\n{PROMPT}", env!("CARGO_PKG_VERSION"));
        (Self::default(), greeting.into_bytes())
    }

    /// Whether `exit` was run.
    #[must_use]
    pub fn exited(&self) -> bool {
        self.exited
    }

    /// Feeds typed input and returns the bytes to render.
    pub fn input(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut out = String::new();
        for ch in String::from_utf8_lossy(bytes).chars() {
            match ch {
                '\r' | '\n' => {
                    out.push_str("\r\n");
                    let line = std::mem::take(&mut self.line);
                    self.run(line.trim(), &mut out);
                    if !self.exited {
                        out.push_str(PROMPT);
                    }
                }
                '\u{7f}' | '\u{8}' => {
                    if self.line.pop().is_some() {
                        out.push_str("\u{8} \u{8}");
                    }
                }
                '\u{3}' => {
                    self.line.clear();
                    out.push_str("^C\r\n");
                    out.push_str(PROMPT);
                }
                c if !c.is_control() => {
                    self.line.push(c);
                    out.push(c);
                }
                _ => {}
            }
        }
        out.into_bytes()
    }

    fn run(&mut self, line: &str, out: &mut String) {
        if line.is_empty() {
            return;
        }
        self.history.push(line.to_owned());
        let mut words = line.split_whitespace();
        let cmd = words.next().unwrap_or_default();
        let args: Vec<&str> = words.collect();
        match cmd {
            "help" => out.push_str("builtins: help echo clear env set history version exit\r\n"),
            "echo" => {
                out.push_str(&args.join(" "));
                out.push_str("\r\n");
            }
            "clear" => out.push_str("\x1b[2J\x1b[H"),
            "version" => {
                out.push_str(env!("CARGO_PKG_VERSION"));
                out.push_str("\r\n");
            }
            "history" => {
                for (i, entry) in self.history.iter().enumerate() {
                    out.push_str(&format!("{:>4}  {entry}\r\n", i + 1));
                }
            }
            "set" => match args.as_slice() {
                [name, value @ ..] => {
                    self.env.insert((*name).to_owned(), value.join(" "));
                }
                [] => out.push_str("usage: set NAME [VALUE...]\r\n"),
            },
            "env" => {
                for (k, v) in &self.env {
                    out.push_str(&format!("{k}={v}\r\n"));
                }
            }
            "exit" => {
                self.exited = true;
                out.push_str("bye\r\n");
            }
            other => out.push_str(&format!("{other}: command not found (local wasm shell; connect a backend for more)\r\n")),
        }
    }
}

#[cfg(test)]
mod tests {
    use aphrody_terminal_core::TerminalState;

    use super::LocalShell;

    #[test]
    fn echo_set_env_and_exit_render_through_the_vt_core() {
        let (mut shell, greeting) = LocalShell::new();
        let mut term = TerminalState::new(60, 12);
        term.ingest(&greeting);
        term.ingest(&shell.input(b"echo hi there\rset A 1\renv\r"));
        let text = term.snapshot().lines.join("\n");
        assert!(text.contains("hi there"), "{text}");
        assert!(text.contains("A=1"), "{text}");
        assert!(!shell.exited());
        shell.input(b"exit\r");
        assert!(shell.exited());
    }

    #[test]
    fn backspace_edits_the_line_and_unknown_commands_are_reported() {
        let (mut shell, _) = LocalShell::new();
        let out = String::from_utf8(shell.input(b"ecx\x7fho ok\rnope\r")).unwrap();
        assert!(out.contains("ok\r\n"));
        assert!(out.contains("nope: command not found"));
    }
}
