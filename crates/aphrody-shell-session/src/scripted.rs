// SPDX-License-Identifier: Apache-2.0
//! Deterministic fake engine for transport and session tests.

use crate::{SessionError, ShellEngine, ShellSession, SpawnSpec, check_size};

/// Exit code reported after [`ShellSession::kill`] when no status was set.
const KILLED_STATUS: i32 = 137;
/// Prompt written on spawn and after every handled line.
const PROMPT: &[u8] = b"$ ";

/// Engine whose sessions answer complete input lines from a fixed script.
///
/// Input is split on `\n` (a trailing `\r` is ignored). A line matching a scripted command
/// produces its canned reply followed by the prompt; `exit` ends the session with status 0 and
/// `exit N` with status N; any other line prints `unknown: <line>` and the prompt.
#[derive(Debug, Clone, Default)]
pub struct ScriptedEngine {
    replies: Vec<(String, Vec<u8>)>,
}

impl ScriptedEngine {
    /// Create an engine with an empty script.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a scripted `command -> reply` pair (builder style).
    #[must_use]
    pub fn reply(mut self, command: &str, output: &[u8]) -> Self {
        self.replies.push((command.to_owned(), output.to_vec()));
        self
    }
}

impl ShellEngine for ScriptedEngine {
    fn name(&self) -> &'static str {
        "scripted"
    }

    fn spawn(&self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, SessionError> {
        check_size(spec.columns, spec.rows)?;
        Ok(Box::new(ScriptedSession {
            replies: self.replies.clone(),
            pending: Vec::new(),
            output: PROMPT.to_vec(),
            columns: spec.columns,
            rows: spec.rows,
            status: None,
        }))
    }
}

/// Session produced by [`ScriptedEngine`].
#[derive(Debug, Clone)]
pub struct ScriptedSession {
    replies: Vec<(String, Vec<u8>)>,
    pending: Vec<u8>,
    output: Vec<u8>,
    columns: u16,
    rows: u16,
    status: Option<i32>,
}

impl ScriptedSession {
    fn handle_line(&mut self, line: &str) {
        if let Some(code) = parse_exit(line) {
            self.status = Some(code);
            return;
        }
        if let Some((_, reply)) = self.replies.iter().find(|(command, _)| command == line) {
            self.output.extend_from_slice(reply);
        } else {
            self.output
                .extend_from_slice(format!("unknown: {line}\r\n").as_bytes());
        }
        self.output.extend_from_slice(PROMPT);
    }
}

fn parse_exit(line: &str) -> Option<i32> {
    let rest = line.strip_prefix("exit")?;
    if rest.is_empty() {
        return Some(0);
    }
    rest.strip_prefix(' ')?.trim().parse().ok()
}

impl ShellSession for ScriptedSession {
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError> {
        if self.status.is_some() {
            return Err(SessionError::Exited);
        }
        self.pending.extend_from_slice(bytes);
        while self.status.is_none() {
            let Some(end) = self.pending.iter().position(|&byte| byte == b'\n') else {
                break;
            };
            let raw: Vec<u8> = self.pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&raw[..end]);
            let line = line.strip_suffix('\r').unwrap_or(&line).to_owned();
            self.handle_line(&line);
        }
        if self.status.is_some() {
            self.pending.clear();
        }
        Ok(())
    }

    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError> {
        if self.status.is_some() {
            return Err(SessionError::Exited);
        }
        check_size(columns, rows)?;
        self.columns = columns;
        self.rows = rows;
        Ok(())
    }

    fn size(&self) -> (u16, u16) {
        (self.columns, self.rows)
    }

    fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.output)
    }

    fn exit_status(&self) -> Option<i32> {
        self.status
    }

    fn kill(&mut self) {
        self.status.get_or_insert(KILLED_STATUS);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Box<dyn ShellSession> {
        ScriptedEngine::new()
            .reply("echo hi", b"hi\r\n")
            .spawn(&SpawnSpec::default())
            .expect("spawn")
    }

    #[test]
    fn prompt_then_scripted_reply() {
        let mut s = session();
        assert_eq!(s.take_output(), b"$ ");
        s.write_input(b"echo hi\n").unwrap();
        assert_eq!(s.take_output(), b"hi\r\n$ ");
        assert!(s.take_output().is_empty());
    }

    #[test]
    fn input_split_across_writes_and_crlf() {
        let mut s = session();
        s.take_output();
        s.write_input(b"echo").unwrap();
        assert!(s.take_output().is_empty());
        s.write_input(b" hi\r\n").unwrap();
        assert_eq!(s.take_output(), b"hi\r\n$ ");
    }

    #[test]
    fn unknown_command_reports() {
        let mut s = session();
        s.take_output();
        s.write_input(b"nope\n").unwrap();
        assert_eq!(s.take_output(), b"unknown: nope\r\n$ ");
    }

    #[test]
    fn exit_sets_status_and_rejects_input() {
        let mut s = session();
        s.take_output();
        assert!(!s.exited());
        s.write_input(b"exit 3\necho hi\n").unwrap();
        assert_eq!(s.exit_status(), Some(3));
        assert!(s.exited());
        assert!(s.take_output().is_empty());
        assert_eq!(s.write_input(b"x"), Err(SessionError::Exited));
        assert_eq!(s.resize(10, 10), Err(SessionError::Exited));
    }

    #[test]
    fn plain_exit_is_zero() {
        let mut s = session();
        s.write_input(b"exit\n").unwrap();
        assert_eq!(s.exit_status(), Some(0));
    }

    #[test]
    fn output_survives_exit() {
        let mut s = session();
        s.write_input(b"echo hi\nexit\n").unwrap();
        assert_eq!(s.take_output(), b"$ hi\r\n$ ");
    }

    #[test]
    fn resize_validates_and_updates() {
        let mut s = session();
        assert_eq!(s.size(), (80, 24));
        s.resize(120, 40).unwrap();
        assert_eq!(s.size(), (120, 40));
        assert_eq!(
            s.resize(0, 40),
            Err(SessionError::InvalidSize {
                columns: 0,
                rows: 40
            })
        );
        assert_eq!(s.size(), (120, 40));
    }

    #[test]
    fn kill_is_idempotent_and_keeps_status() {
        let mut s = session();
        s.kill();
        assert_eq!(s.exit_status(), Some(137));
        s.kill();
        assert_eq!(s.exit_status(), Some(137));
        let mut t = session();
        t.write_input(b"exit 2\n").unwrap();
        t.kill();
        assert_eq!(t.exit_status(), Some(2));
    }

    #[test]
    fn spawn_rejects_zero_size() {
        let engine = ScriptedEngine::new();
        let spec = SpawnSpec {
            columns: 0,
            ..SpawnSpec::default()
        };
        assert!(matches!(
            engine.spawn(&spec),
            Err(SessionError::InvalidSize { .. })
        ));
        assert_eq!(engine.name(), "scripted");
    }
}
