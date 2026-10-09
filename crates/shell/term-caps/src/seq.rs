// SPDX-License-Identifier: Apache-2.0
//! Escape-sequence emitters. Every OSC is terminated with ST (`ESC \`), and
//! text parameters are stripped of C0/C1 controls so caller data cannot end
//! the sequence early or inject another one.

use std::fmt::Write as _;
use std::path::Path;

use base64::Engine as _;

const ST: &str = "\x1b\\";

/// Primary device attributes query (DA1).
pub const QUERY_DA1: &str = "\x1b[c";
/// XTVERSION query.
pub const QUERY_XTVERSION: &str = "\x1b[>0q";
/// Kitty graphics support query: a 1x1 RGB image that is checked, not stored.
pub const QUERY_KITTY_GRAPHICS: &str = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
/// Begin a synchronized update (DEC mode 2026).
pub const SYNC_BEGIN: &str = "\x1b[?2026h";
/// End a synchronized update (DEC mode 2026).
pub const SYNC_END: &str = "\x1b[?2026l";

/// Removes C0, DEL and C1 controls from text placed inside a sequence.
#[must_use]
pub fn clean(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).collect()
}

/// DECRQM query for a private mode (`CSI ? mode $ p`).
#[must_use]
pub fn query_private_mode(mode: u16) -> String {
    format!("\x1b[?{mode}$p")
}

/// OSC 8 hyperlink around `text`. `id` groups the cells of one link.
#[must_use]
pub fn hyperlink(uri: &str, id: Option<&str>, text: &str) -> String {
    let mut out = hyperlink_open(uri, id);
    out.push_str(text);
    out.push_str(HYPERLINK_CLOSE);
    out
}

/// Opening half of an OSC 8 hyperlink.
#[must_use]
pub fn hyperlink_open(uri: &str, id: Option<&str>) -> String {
    let params = id.map(|id| format!("id={}", clean(id).replace([':', ';'], "_")));
    format!("\x1b]8;{};{}{ST}", params.unwrap_or_default(), clean(uri))
}

/// Closing half of an OSC 8 hyperlink.
pub const HYPERLINK_CLOSE: &str = "\x1b]8;;\x1b\\";

/// OSC 133 semantic marks (FinalTerm).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    /// `A`: prompt starts.
    PromptStart,
    /// `B`: prompt ends, command input starts.
    CommandStart,
    /// `C`: command executed, output starts.
    CommandExecuted,
    /// `D[;exit]`: command finished.
    CommandFinished(Option<i32>),
}

/// OSC 133 mark.
#[must_use]
pub fn mark(mark: Mark) -> String {
    match mark {
        Mark::PromptStart => format!("\x1b]133;A{ST}"),
        Mark::CommandStart => format!("\x1b]133;B{ST}"),
        Mark::CommandExecuted => format!("\x1b]133;C{ST}"),
        Mark::CommandFinished(None) => format!("\x1b]133;D{ST}"),
        Mark::CommandFinished(Some(code)) => format!("\x1b]133;D;{code}{ST}"),
    }
}

/// OSC 633 mark (VS Code shell integration), same states as OSC 133.
#[must_use]
pub fn vscode_mark(mark: Mark) -> String {
    match mark {
        Mark::PromptStart => format!("\x1b]633;A{ST}"),
        Mark::CommandStart => format!("\x1b]633;B{ST}"),
        Mark::CommandExecuted => format!("\x1b]633;C{ST}"),
        Mark::CommandFinished(None) => format!("\x1b]633;D{ST}"),
        Mark::CommandFinished(Some(code)) => format!("\x1b]633;D;{code}{ST}"),
    }
}

/// OSC 633;E: the command line about to run, escaped as VS Code expects.
#[must_use]
pub fn vscode_command_line(command: &str) -> String {
    let mut out = String::from("\x1b]633;E;");
    for c in command.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\x3b"),
            c if (c as u32) < 0x20 || c == '\x7f' => {
                let _ = write!(out, "\\x{:02x}", c as u32);
            },
            c if c.is_control() => {},
            c => out.push(c),
        }
    }
    out.push_str(ST);
    out
}

/// OSC 633;P property (for example `Cwd`).
#[must_use]
pub fn vscode_property(key: &str, value: &str) -> String {
    format!("\x1b]633;P;{}={}{ST}", clean(key), clean(value).replace(';', "\\x3b"))
}

/// OSC 7 working directory as a `file://` URI.
#[must_use]
pub fn cwd_osc7(host: Option<&str>, path: &Path) -> String {
    format!("\x1b]7;{}{ST}", file_uri(host, path))
}

/// OSC 9;9 working directory (ConEmu, Windows Terminal).
#[must_use]
pub fn cwd_osc9_9(path: &Path) -> String {
    format!("\x1b]9;9;{}{ST}", clean(&path.to_string_lossy()))
}

/// OSC 9;4 progress states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    /// Hide the progress indicator.
    Clear,
    /// Determinate progress, 0-100.
    Value(u8),
    /// Error state at the given value.
    Error(u8),
    /// Indeterminate (busy) state.
    Indeterminate,
    /// Paused at the given value.
    Paused(u8),
}

/// OSC 9;4 progress report.
#[must_use]
pub fn progress(progress: Progress) -> String {
    let (state, value) = match progress {
        Progress::Clear => (0, 0),
        Progress::Value(v) => (1, v.min(100)),
        Progress::Error(v) => (2, v.min(100)),
        Progress::Indeterminate => (3, 0),
        Progress::Paused(v) => (4, v.min(100)),
    };
    format!("\x1b]9;4;{state};{value}{ST}")
}

/// OSC 52 clipboard write (`c` = clipboard, `p` = primary selection).
#[must_use]
pub fn clipboard_set(target: char, data: &[u8]) -> String {
    let target = if matches!(target, 'c' | 'p' | 's') { target } else { 'c' };
    format!("\x1b]52;{target};{}{ST}", base64::engine::general_purpose::STANDARD.encode(data))
}

/// OSC 9 notification (iTerm2/ConEmu style, body only).
#[must_use]
pub fn notify_osc9(body: &str) -> String {
    // A body starting with a digit and ';' would be parsed as a ConEmu command.
    let body = clean(body);
    let body = if body.as_bytes().first().is_some_and(u8::is_ascii_digit) {
        format!(" {body}")
    } else {
        body
    };
    format!("\x1b]9;{body}{ST}")
}

/// OSC 777 `notify` notification (urxvt, VTE, Ghostty, kitty, Rio).
#[must_use]
pub fn notify_osc777(title: &str, body: &str) -> String {
    format!("\x1b]777;notify;{};{}{ST}", clean(title).replace(';', ","), clean(body))
}

/// OSC 99 notification (kitty protocol); title and body are base64 encoded.
#[must_use]
pub fn notify_osc99(id: &str, title: &str, body: &str) -> String {
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.encode(s.as_bytes());
    let id: String = clean(id).chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    format!(
        "\x1b]99;i={id}:d=0:e=1:p=title;{}{ST}\x1b]99;i={id}:d=1:e=1:p=body;{}{ST}",
        b64(title),
        b64(body)
    )
}

/// OSC 2 window title.
#[must_use]
pub fn title(text: &str) -> String {
    format!("\x1b]2;{}{ST}", clean(text))
}

/// OSC 0 icon name and window title.
#[must_use]
pub fn icon_and_title(text: &str) -> String {
    format!("\x1b]0;{}{ST}", clean(text))
}

/// OSC 22 mouse pointer shape (CSS cursor name such as `pointer`, `text`).
#[must_use]
pub fn pointer_shape(name: &str) -> String {
    format!("\x1b]22;{}{ST}", clean(name))
}

/// OSC 66 text sizing: `text` drawn `scale` cells tall (1-7).
#[must_use]
pub fn text_sized(scale: u8, text: &str) -> String {
    format!("\x1b]66;s={};{}{ST}", scale.clamp(1, 7), clean(text))
}

/// Wraps a sequence for tmux passthrough (`set -g allow-passthrough on`).
#[must_use]
pub fn tmux_passthrough(sequence: &str) -> String {
    format!("\x1bPtmux;{}{ST}", sequence.replace('\x1b', "\x1b\x1b"))
}

/// `file://host/path` URI with percent-encoding; Windows drive paths become
/// `file:///C:/...`.
#[must_use]
pub fn file_uri(host: Option<&str>, path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut normalized = raw.replace('\\', "/");
    if let Some(rest) = normalized.strip_prefix("//?/") {
        normalized = rest.to_owned();
    }
    let bytes = normalized.as_bytes();
    let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let mut out = String::with_capacity(normalized.len() + 16);
    out.push_str("file://");
    out.push_str(&clean(host.unwrap_or_default()));
    if drive || !normalized.starts_with('/') {
        out.push('/');
    }
    for (i, b) in normalized.bytes().enumerate() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~')
            || (b == b':' && drive && i == 1);
        if keep {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyperlink_is_terminated_and_cleaned() {
        assert_eq!(
            hyperlink("https://a.b/\x1b]x", Some("k:1"), "t"),
            "\x1b]8;id=k_1;https://a.b/]x\x1b\\t\x1b]8;;\x1b\\"
        );
    }

    #[test]
    fn marks_progress_and_cwd() {
        assert_eq!(mark(Mark::CommandFinished(Some(2))), "\x1b]133;D;2\x1b\\");
        assert_eq!(vscode_mark(Mark::PromptStart), "\x1b]633;A\x1b\\");
        assert_eq!(progress(Progress::Value(150)), "\x1b]9;4;1;100\x1b\\");
        assert_eq!(progress(Progress::Indeterminate), "\x1b]9;4;3;0\x1b\\");
        assert_eq!(cwd_osc9_9(Path::new("C:\\src")), "\x1b]9;9;C:\\src\x1b\\");
    }

    #[test]
    fn file_uris_cover_windows_unix_and_spaces() {
        assert_eq!(file_uri(None, Path::new(r"C:\a b\c.rs")), "file:///C:/a%20b/c.rs");
        assert_eq!(file_uri(Some("box"), Path::new("/home/u/x#1")), "file://box/home/u/x%231");
        assert_eq!(file_uri(None, Path::new(r"\\?\C:\x")), "file:///C:/x");
    }

    #[test]
    fn vscode_command_line_escapes_separators() {
        assert_eq!(vscode_command_line("a;b\\c\n"), "\x1b]633;E;a\\x3bb\\\\c\\x0a\x1b\\");
    }

    #[test]
    fn notifications_and_clipboard() {
        assert_eq!(notify_osc777("t;x", "b"), "\x1b]777;notify;t,x;b\x1b\\");
        assert_eq!(notify_osc9("4;1"), "\x1b]9; 4;1\x1b\\");
        assert_eq!(clipboard_set('c', b"hi"), "\x1b]52;c;aGk=\x1b\\");
        assert!(notify_osc99("n1", "T", "B").contains("i=n1:d=1:e=1:p=body;Qg=="));
    }

    #[test]
    fn tmux_passthrough_doubles_escapes() {
        assert_eq!(tmux_passthrough("\x1b]9;x\x1b\\"), "\x1bPtmux;\x1b\x1b]9;x\x1b\x1b\\\x1b\\");
    }
}
