// SPDX-License-Identifier: Apache-2.0
//! Self-contained line shell that runs entirely inside WebAssembly.
//!
//! It needs no PTY and no backend: bytes typed by the user go in, VT output bytes come out, ready
//! to be fed to a [`aphrody_terminal_core::TerminalState`]. Hosts that have a real backend
//! (native PTY over WebSocket, Tauri IPC) bypass it.

use aphrody_shell_session::{SessionError, ShellEngine, ShellSession, SpawnSpec, check_size};
use aphrody_shell_vfs::{FileKind, MemVfs, Vfs, path};
use std::{collections::BTreeMap, rc::Rc};

mod execute;

const PROMPT: &str = "aphrody> ";

/// A command that can be registered in the local WASM shell.
pub trait ShellCommand {
    /// Execute with expanded arguments and pipeline input; return raw output bytes.
    ///
    /// # Errors
    /// Returns a displayable command failure, used by `&&` and `||`.
    fn run(&self, shell: &mut LocalShell, args: &[String], stdin: &[u8])
    -> Result<Vec<u8>, String>;
}

struct UtilityCommand(&'static str);

impl ShellCommand for UtilityCommand {
    fn run(
        &self,
        shell: &mut LocalShell,
        args: &[String],
        stdin: &[u8],
    ) -> Result<Vec<u8>, String> {
        let cwd = shell.cwd().to_vec();
        crate::utils::run(self.0, shell.vfs(), &cwd, args, stdin)
    }
}

/// Factory for isolated local sessions backed by `MemVfs`.
#[derive(Default)]
pub struct LocalEngine;

impl ShellEngine for LocalEngine {
    fn name(&self) -> &str {
        "local"
    }

    fn spawn(&self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, SessionError> {
        let (mut shell, greeting) = LocalShell::with_spec_and_vfs(spec, Box::new(MemVfs::new()))?;
        shell.output = greeting;
        Ok(Box::new(shell))
    }
}

/// Line editor plus a small builtin command set.
pub struct LocalShell {
    line: String,
    utf8_pending: Vec<u8>,
    history: Vec<String>,
    history_index: Option<usize>,
    escape: String,
    env: BTreeMap<String, String>,
    commands: BTreeMap<String, Rc<dyn ShellCommand>>,
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
        let mut shell = Self {
            line: String::new(),
            utf8_pending: Vec::new(),
            history: Vec::new(),
            history_index: None,
            escape: String::new(),
            env: BTreeMap::new(),
            commands: BTreeMap::new(),
            cwd: b"/".to_vec(),
            vfs,
            output: Vec::new(),
            size: (80, 24),
            exited: false,
        };
        for utility in crate::utils::catalog() {
            shell.register_command(utility.name, Rc::new(UtilityCommand(utility.name)));
        }
        (shell, greeting.into_bytes())
    }

    /// Create a session with a shared or persistent filesystem and the requested settings.
    ///
    /// # Errors
    /// Returns an invalid size or a VFS error for the requested working directory.
    pub fn with_spec_and_vfs(
        spec: &SpawnSpec,
        vfs: Box<dyn Vfs>,
    ) -> Result<(Self, Vec<u8>), SessionError> {
        check_size(spec.columns, spec.rows)?;
        let (mut shell, greeting) = Self::with_vfs(vfs);
        if let Some(cwd) = &spec.cwd {
            shell
                .vfs
                .mkdir_all(cwd.as_bytes())
                .map_err(|e| SessionError::Engine(e.to_string()))?;
            shell.cwd =
                path::normalize(cwd.as_bytes()).map_err(|e| SessionError::Engine(e.to_string()))?;
        }
        shell.env.extend(spec.env.iter().cloned());
        shell.size = (spec.columns, spec.rows);
        Ok((shell, greeting))
    }

    /// Whether `exit` was run.
    #[must_use]
    pub fn exited(&self) -> bool {
        self.exited
    }

    /// Register or replace a command by name.
    pub fn register_command(&mut self, name: impl Into<String>, command: Rc<dyn ShellCommand>) {
        self.commands.insert(name.into(), command);
    }

    /// Mutable filesystem access for a registered command.
    pub fn vfs(&mut self) -> &mut dyn Vfs {
        self.vfs.as_mut()
    }

    /// Current absolute directory for a registered command.
    #[must_use]
    pub fn cwd(&self) -> &[u8] {
        &self.cwd
    }

    /// Environment for a registered command.
    #[must_use]
    pub fn environment(&self) -> &BTreeMap<String, String> {
        &self.env
    }

    /// Feeds typed input and returns the bytes to render.
    pub fn input(&mut self, bytes: &[u8]) -> Vec<u8> {
        if self.exited {
            return Vec::new();
        }
        self.utf8_pending.extend_from_slice(bytes);
        let decoded = match std::str::from_utf8(&self.utf8_pending) {
            Ok(text) => {
                let text = text.to_owned();
                self.utf8_pending.clear();
                text
            }
            Err(error) if error.error_len().is_none() => {
                let valid = error.valid_up_to();
                let pending = self.utf8_pending.split_off(valid);
                let text = String::from_utf8_lossy(&self.utf8_pending).into_owned();
                self.utf8_pending = pending;
                text
            }
            Err(_) => {
                let text = String::from_utf8_lossy(&self.utf8_pending).into_owned();
                self.utf8_pending.clear();
                text
            }
        };
        let mut out = String::new();
        for ch in decoded.chars() {
            if ch == '\u{1b}' || !self.escape.is_empty() {
                self.escape.push(ch);
                if self.escape.len() == 3 {
                    match self.escape.as_str() {
                        "\u{1b}[A" => self.recall(true, &mut out),
                        "\u{1b}[B" => self.recall(false, &mut out),
                        _ => {}
                    }
                    self.escape.clear();
                }
                continue;
            }
            match ch {
                '\r' | '\n' => {
                    out.push_str("\r\n");
                    let line = std::mem::take(&mut self.line);
                    self.history_index = None;
                    self.run(line.trim(), &mut out);
                    if !self.exited {
                        out.push_str(PROMPT);
                    }
                }
                '\u{7f}' | '\u{8}' => {
                    if self.line.pop().is_some() {
                        self.history_index = None;
                        out.push_str("\u{8} \u{8}");
                    }
                }
                '\u{0c}' => {
                    out.push_str("\x1b[2J\x1b[H");
                    out.push_str(PROMPT);
                    out.push_str(&self.line);
                }
                '\u{3}' => {
                    self.line.clear();
                    self.history_index = None;
                    out.push_str("^C\r\n");
                    out.push_str(PROMPT);
                }
                c if !c.is_control() => {
                    self.line.push(c);
                    self.history_index = None;
                    out.push(c);
                }
                _ => {}
            }
        }
        out.into_bytes()
    }

    fn recall(&mut self, previous: bool, out: &mut String) {
        if self.history.is_empty() {
            return;
        }
        let next = if previous {
            self.history_index
                .map_or(self.history.len() - 1, |i| i.saturating_sub(1))
        } else {
            self.history_index.map_or(self.history.len(), |i| i + 1)
        };
        self.history_index = (next < self.history.len()).then_some(next);
        let replacement = self.history_index.map_or("", |i| self.history[i].as_str());
        out.push_str("\r\x1b[2K");
        out.push_str(PROMPT);
        out.push_str(replacement);
        self.line = replacement.to_owned();
    }

    fn run(&mut self, line: &str, out: &mut String) {
        if line.is_empty() {
            return;
        }
        self.history.push(line.to_owned());
        match execute::run(self, line) {
            Ok(bytes) => out.push_str(&String::from_utf8_lossy(&bytes).replace('\n', "\r\n")),
            Err(error) => out.push_str(&format!("{error}\r\n")),
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
                self.vfs
                    .rename(&source, &target)
                    .map_err(|e| e.to_string())?;
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
                }
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

#[cfg(test)]
mod tests {
    use aphrody_shell_session::{ShellEngine, ShellSession, SpawnSpec};
    use aphrody_terminal_core::TerminalState;

    use super::{LocalEngine, LocalShell, ShellCommand};

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
        shell
            .write_input(b"set A hello\recho \"$A world\"\r")
            .unwrap();
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
    fn ctrl_l_clears_screen_and_redraws_prompt_and_input() {
        let (mut shell, _) = LocalShell::new();
        shell.input(b"echo retained");
        let cleared = String::from_utf8(shell.input(b"\x0c")).unwrap();
        assert!(cleared.starts_with("\x1b[2J\x1b[H"), "{cleared:?}");
        assert!(cleared.ends_with("aphrody> echo retained"), "{cleared:?}");

        let executed = String::from_utf8(shell.input(b"\r")).unwrap();
        assert!(executed.contains("retained\r\n"), "{executed:?}");
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
        assert!(
            String::from_utf8(shell.take_output())
                .unwrap()
                .contains("aphrody>")
        );
        shell.write_input(b"pwd\recho $GREETING\r").unwrap();
        let output = String::from_utf8(shell.take_output()).unwrap();
        assert!(output.contains("/work\r\n"), "{output}");
        assert!(output.contains("hello\r\n"), "{output}");
    }

    #[test]
    fn pipelines_redirects_and_conditionals_use_vfs_bytes() {
        let (mut shell, _) = LocalShell::new();
        let output = String::from_utf8(shell.input(
            b"mkdir work\rcd work\recho 'a b' > file\recho second >> file\rcat < file | wc -l\rnope || echo recovered\rtrue && echo yes\rnope && echo skipped\rcat file\r",
        )).unwrap();
        assert!(output.contains("2\r\n"), "{output}");
        assert!(output.contains("recovered\r\n"), "{output}");
        assert!(output.contains("yes\r\n"), "{output}");
        assert!(!output.contains("skipped\r\naphrody>"), "{output}");
        assert!(output.contains("a b\r\nsecond\r\n"), "{output}");
    }

    #[test]
    fn variable_expansion_occurs_after_prior_command_in_same_line() {
        let (mut shell, _) = LocalShell::new();
        let output = String::from_utf8(shell.input(b"set A ready && echo \"$A\"\r")).unwrap();
        assert!(output.contains("ready\r\n"), "{output}");
    }

    #[test]
    fn globbing_obeys_quotes_and_matches_vfs_entries() {
        let (mut shell, _) = LocalShell::new();
        shell.input(b"touch alpha.txt beta.txt gamma.md .hidden.txt\r");
        let output =
            String::from_utf8(shell.input(b"echo *.txt\recho '*.txt'\recho a?pha.txt\r")).unwrap();
        assert!(output.contains("alpha.txt beta.txt\r\n"), "{output}");
        assert!(output.contains("*.txt\r\n"), "{output}");
        assert!(output.contains("alpha.txt\r\n"), "{output}");
        assert!(!output.contains(".hidden.txt\r\n"), "{output}");
    }

    #[test]
    fn arrow_keys_recall_history_across_input_chunks() {
        let (mut shell, _) = LocalShell::new();
        shell.input(b"echo first\recho second\r");
        shell.input(b"\x1b[");
        let recalled = String::from_utf8(shell.input(b"A")).unwrap();
        assert!(recalled.ends_with("echo second"), "{recalled}");
        let output = String::from_utf8(shell.input(b"\r")).unwrap();
        assert!(output.contains("second\r\n"), "{output}");
    }

    #[test]
    fn registered_command_receives_pipeline_bytes() {
        struct Upper;
        impl ShellCommand for Upper {
            fn run(
                &self,
                _: &mut LocalShell,
                _: &[String],
                stdin: &[u8],
            ) -> Result<Vec<u8>, String> {
                Ok(stdin.to_ascii_uppercase())
            }
        }
        let (mut shell, _) = LocalShell::new();
        shell.register_command("upper", std::rc::Rc::new(Upper));
        let output = String::from_utf8(shell.input(b"echo hello | upper\r")).unwrap();
        assert!(output.contains("HELLO\r\n"), "{output}");
    }

    #[test]
    fn composed_commands_render_through_terminal_state() {
        let (mut shell, greeting) = LocalShell::new();
        let mut terminal = TerminalState::new(80, 14);
        terminal.ingest(&greeting);
        terminal.ingest(&shell.input(b"echo alpha > file\rcat file | wc -l\r"));
        let screen = terminal.snapshot().lines.join("\n");
        assert!(screen.contains("1"), "{screen}");
        assert!(!screen.contains("command not found"), "{screen}");
    }

    #[test]
    fn utf8_input_survives_transport_chunks_and_multilingual_text() {
        let (mut shell, _) = LocalShell::new();
        let input = "echo café 東京 مرحبا 🌍".as_bytes();
        let split = input.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
        let mut output = shell.input(&input[..split]);
        output.extend(shell.input(&input[split..]));
        let output = String::from_utf8(output).expect("terminal output remains valid UTF-8");
        assert!(output.contains("café 東京 مرحبا 🌍"), "{output}");
    }

    #[test]
    fn malformed_composition_reports_error_without_panicking() {
        let (mut shell, _) = LocalShell::new();
        let output =
            String::from_utf8(shell.input(b"echo ok |\recho >\recho 'unterminated\r")).unwrap();
        assert!(output.contains("empty pipeline segment"), "{output}");
        assert!(output.contains("missing redirect path"), "{output}");
        assert!(output.contains("unterminated quote"), "{output}");
    }
}
