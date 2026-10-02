// SPDX-License-Identifier: Apache-2.0
//! Self-contained line shell that runs entirely inside WebAssembly.
//!
//! It needs no PTY and no backend: bytes typed by the user go in, VT output bytes come out, ready
//! to be fed to a [`aphrody_terminal_core::TerminalState`]. Hosts that have a real backend
//! (native PTY over WebSocket, Tauri IPC) bypass it.

use aphrody_shell_session::{SessionError, ShellEngine, ShellSession, SpawnSpec, check_size};
use aphrody_shell_vfs::{FileKind, MemVfs, Vfs, path};
use std::collections::BTreeMap;

const PROMPT: &str = "aphrody> ";

/// Factory for isolated local sessions backed by `MemVfs`.
#[derive(Default)]
pub struct LocalEngine;

impl ShellEngine for LocalEngine {
    fn name(&self) -> &str {
        "local"
    }

    fn spawn(&self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, SessionError> {
        check_size(spec.columns, spec.rows)?;
        let (mut shell, greeting) = LocalShell::new();
        if let Some(cwd) = &spec.cwd {
            shell.vfs.mkdir_all(cwd.as_bytes()).map_err(|e| SessionError::Engine(e.to_string()))?;
            shell.cwd =
                path::normalize(cwd.as_bytes()).map_err(|e| SessionError::Engine(e.to_string()))?;
        }
        shell.env.extend(spec.env.iter().cloned());
        shell.output = greeting;
        shell.size = (spec.columns, spec.rows);
        Ok(Box::new(shell))
    }
}

/// Line editor plus a small builtin command set.
pub struct LocalShell {
    line: String,
    history: Vec<String>,
    env: BTreeMap<String, String>,
    cwd: Vec<u8>,
    vfs: Box<dyn Vfs>,
    output: Vec<u8>,
    size: (u16, u16),
    exited: bool,
}

impl LocalShell {
    /// Creates a shell and returns it with its greeting and first prompt.
    #[must_use]
    pub fn new() -> (Self, Vec<u8>) {
        Self::with_vfs(Box::new(MemVfs::new()))
    }

    /// Creates a shell with a caller-provided filesystem.
    #[must_use]
    pub fn with_vfs(vfs: Box<dyn Vfs>) -> (Self, Vec<u8>) {
        let greeting = format!(
            "Aphrody shell (wasm {})\r\ntype `help`\r\n{PROMPT}",
            env!("CARGO_PKG_VERSION")
        );
        (
            Self {
                line: String::new(),
                history: Vec::new(),
                env: BTreeMap::new(),
                cwd: b"/".to_vec(),
                vfs,
                output: Vec::new(),
                size: (80, 24),
                exited: false,
            },
            greeting.into_bytes(),
        )
    }

    /// Whether `exit` was run.
    #[must_use]
    pub fn exited(&self) -> bool {
        self.exited
    }

    /// Feeds typed input and returns the bytes to render.
    pub fn input(&mut self, bytes: &[u8]) -> Vec<u8> {
        if self.exited {
            return Vec::new();
        }
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
                },
                '\u{7f}' | '\u{8}' => {
                    if self.line.pop().is_some() {
                        out.push_str("\u{8} \u{8}");
                    }
                },
                '\u{3}' => {
                    self.line.clear();
                    out.push_str("^C\r\n");
                    out.push_str(PROMPT);
                },
                c if !c.is_control() => {
                    self.line.push(c);
                    out.push(c);
                },
                _ => {},
            }
        }
        out.into_bytes()
    }

    fn run(&mut self, line: &str, out: &mut String) {
        if line.is_empty() {
            return;
        }
        self.history.push(line.to_owned());
        let words = match tokenize(line, &self.env) {
            Ok(words) => words,
            Err(error) => {
                out.push_str(&format!("{error}\r\n"));
                return;
            },
        };
        let cmd = words.first().map_or("", String::as_str);
        let args: Vec<&str> = words.iter().skip(1).map(String::as_str).collect();
        match cmd {
            "help" => out.push_str("builtins: help echo clear env set history version exit cd pwd ls cat mkdir rm cp mv touch\r\n"),
            "echo" => {
                out.push_str(&args.join(" "));
                out.push_str("\r\n");
            },
            "clear" => out.push_str("\x1b[2J\x1b[H"),
            "version" => {
                out.push_str(env!("CARGO_PKG_VERSION"));
                out.push_str("\r\n");
            },
            "history" => {
                for (i, entry) in self.history.iter().enumerate() {
                    out.push_str(&format!("{:>4}  {entry}\r\n", i + 1));
                }
            },
            "set" => match args.as_slice() {
                [name, value @ ..] => {
                    self.env.insert((*name).to_owned(), value.join(" "));
                },
                [] => out.push_str("usage: set NAME [VALUE...]\r\n"),
            },
            "env" => {
                for (k, v) in &self.env {
                    out.push_str(&format!("{k}={v}\r\n"));
                }
            },
            "pwd" => out.push_str(&format!("{}\r\n", String::from_utf8_lossy(&self.cwd))),
            "cd" => {
                let target = args.first().copied().unwrap_or("/");
                match self.resolve(target).and_then(|p| {
                    self.vfs.stat(&p).map_err(|e| e.to_string()).and_then(|stat| {
                        if stat.kind == FileKind::Dir { Ok(p) } else { Err("not a directory".into()) }
                    })
                }) {
                    Ok(p) => self.cwd = p,
                    Err(e) => out.push_str(&format!("cd: {target}: {e}\r\n")),
                }
            },
            "ls" => {
                let target = args.first().copied().unwrap_or(".");
                let result = self.resolve(target).and_then(|p| {
                    let stat = self.vfs.stat(&p).map_err(|e| e.to_string())?;
                    if stat.kind == FileKind::File { return Ok(format!("{target}\r\n")); }
                    let entries = self.vfs.read_dir(&p).map_err(|e| e.to_string())?;
                    Ok(entries.iter().map(|e| format!("{}\r\n", String::from_utf8_lossy(&e.name))).collect())
                });
                match result { Ok(s) => out.push_str(&s), Err(e) => out.push_str(&format!("ls: {target}: {e}\r\n")) }
            },
            "cat" | "mkdir" | "rm" | "touch" | "cp" | "mv" => {
                match self.file_command(cmd, &args) {
                    Ok(bytes) => out.push_str(&String::from_utf8_lossy(&bytes).replace('\n', "\r\n")),
                    Err(e) => out.push_str(&format!("{cmd}: {e}\r\n")),
                }
            },
            "exit" => {
                self.exited = true;
                out.push_str("bye\r\n");
            },
            other => out.push_str(&format!(
                "{other}: command not found (local wasm shell; connect a backend for more)\r\n"
            )),
        }
    }

    fn resolve(&self, name: &str) -> Result<Vec<u8>, String> {
        path::resolve(&self.cwd, name.as_bytes()).map_err(|e| e.to_string())
    }

    fn file_command(&mut self, cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
        if args.is_empty() {
            return Err("missing path".into());
        }
        if matches!(cmd, "cp" | "mv") {
            if args.len() != 2 {
                return Err("expected SOURCE TARGET".into());
            }
            let source = self.resolve(args[0])?;
            let target = self.resolve(args[1])?;
            if cmd == "cp" {
                let data = self.vfs.read(&source).map_err(|e| e.to_string())?;
                self.vfs.write(&target, &data).map_err(|e| e.to_string())?;
            } else {
                self.vfs.rename(&source, &target).map_err(|e| e.to_string())?;
            }
            return Ok(Vec::new());
        }
        let mut output = Vec::new();
        for arg in args {
            let p = self.resolve(arg)?;
            match cmd {
                "cat" => output.extend(self.vfs.read(&p).map_err(|e| format!("{arg}: {e}"))?),
                "mkdir" => self.vfs.mkdir(&p).map_err(|e| format!("{arg}: {e}"))?,
                "rm" => self.vfs.remove(&p).map_err(|e| format!("{arg}: {e}"))?,
                "touch" => {
                    if !self.vfs.exists(&p) {
                        self.vfs.write(&p, b"").map_err(|e| format!("{arg}: {e}"))?;
                    }
                },
                _ => unreachable!(),
            }
        }
        Ok(output)
    }
}

impl ShellSession for LocalShell {
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError> {
        if self.exited {
            return Err(SessionError::Exited);
        }
        let output = self.input(bytes);
        self.output.extend(output);
        Ok(())
    }
    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError> {
        if self.exited {
            return Err(SessionError::Exited);
        }
        check_size(columns, rows)?;
        self.size = (columns, rows);
        Ok(())
    }
    fn size(&self) -> (u16, u16) {
        self.size
    }
    fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.output)
    }
    fn exit_status(&self) -> Option<i32> {
        self.exited.then_some(0)
    }
    fn kill(&mut self) {
        self.exited = true;
    }
}

fn tokenize(line: &str, env: &BTreeMap<String, String>) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' if quote != Some('\'') => {
                word.push(chars.next().ok_or("trailing escape")?);
                started = true;
            },
            '\'' | '"' if quote == Some(ch) => quote = None,
            '\'' | '"' if quote.is_none() => {
                quote = Some(ch);
                started = true;
            },
            '$' if quote != Some('\'') => {
                let mut name = String::new();
                while let Some(&c) = chars.peek() {
                    if !(c.is_ascii_alphanumeric() || c == '_') {
                        break;
                    }
                    name.push(c);
                    chars.next();
                }
                if name.is_empty() {
                    word.push('$');
                } else {
                    word.push_str(env.get(&name).map_or("", String::as_str));
                }
                started = true;
            },
            c if c.is_whitespace() && quote.is_none() => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            },
            _ => {
                word.push(ch);
                started = true;
            },
        }
    }
    if quote.is_some() {
        return Err("unterminated quote".into());
    }
    if started {
        words.push(word);
    }
    Ok(words)
}

#[cfg(test)]
mod tests {
    use aphrody_shell_session::{ShellEngine, ShellSession, SpawnSpec};
    use aphrody_terminal_core::TerminalState;

    use super::{LocalEngine, LocalShell};

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

    #[test]
    fn filesystem_and_cwd_survive_multiple_inputs() {
        let (mut shell, _) = LocalShell::new();
        shell.input(b"mkdir work\rcd work\rtouch a\recho ready\r");
        let output = String::from_utf8(shell.input(b"pwd\rls\r")).unwrap();
        assert!(output.contains("/work\r\n"), "{output}");
        assert!(output.contains("a\r\n"), "{output}");
        shell.input(b"mv a b\rcp b c\r");
        let output = String::from_utf8(shell.input(b"ls\r")).unwrap();
        assert!(output.contains("b\r\n"), "{output}");
        assert!(output.contains("c\r\n"), "{output}");
    }

    #[test]
    fn quoting_expansion_and_session_contract() {
        let (mut shell, _) = LocalShell::new();
        shell.write_input(b"set A hello\recho \"$A world\"\r").unwrap();
        let output = String::from_utf8(shell.take_output()).unwrap();
        assert!(output.contains("hello world\r\n"), "{output}");
        assert!(shell.take_output().is_empty());
        shell.resize(100, 40).unwrap();
        assert_eq!(shell.size(), (100, 40));
        shell.write_input(b"exit\r").unwrap();
        assert!(shell.exited());
        assert!(shell.write_input(b"echo no\r").is_err());
    }

    #[test]
    fn factory_applies_spawn_spec() {
        let spec = SpawnSpec {
            columns: 100,
            rows: 40,
            cwd: Some("/work".into()),
            env: vec![("GREETING".into(), "hello".into())],
        };
        let mut shell = LocalEngine.spawn(&spec).unwrap();
        assert_eq!(shell.size(), (100, 40));
        assert!(String::from_utf8(shell.take_output()).unwrap().contains("aphrody>"));
        shell.write_input(b"pwd\recho $GREETING\r").unwrap();
        let output = String::from_utf8(shell.take_output()).unwrap();
        assert!(output.contains("/work\r\n"), "{output}");
        assert!(output.contains("hello\r\n"), "{output}");
    }
}
