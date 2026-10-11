// SPDX-License-Identifier: Apache-2.0
//! Host terminal identification and capability profiles.
//!
//! Detection runs in three steps, each optional after the first:
//! 1. [`Detection::from_env`]: `APHRODY_TERMINAL` override, `TERM_PROGRAM`,
//!    `WT_SESSION`, `VTE_VERSION`, `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR`,
//!    `WEZTERM_*`, `ALACRITTY_*`, `TERM`, `COLORTERM`, `TMUX`.
//! 2. [`Detection::apply_replies`] with the terminal's answers to DA1,
//!    XTVERSION and the kitty graphics query (see [`crate::probe`]).
//! 3. [`Detection::image_protocol`]: Kitty, then Sixel, then iTerm2.

use std::fmt;

/// A terminal emulator with a known capability profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Terminal {
    /// Aphrody's own engine (`aphrody-terminal-core`).
    Aphrody,
    /// Windows Terminal (AtlasEngine).
    WindowsTerminal,
    /// VTE-based terminals (GNOME Terminal, Ptyxis, Tilix).
    Vte,
    /// COSMIC Terminal (alacritty_terminal + cosmic-text).
    Cosmic,
    /// Rio (rio-vt + Sugarloaf).
    Rio,
    /// Ghostty.
    Ghostty,
    /// kitty.
    Kitty,
    /// WezTerm.
    WezTerm,
    /// Alacritty.
    Alacritty,
    /// iTerm2.
    ITerm2,
    /// Visual Studio Code integrated terminal (xterm.js).
    VsCode,
    /// foot.
    Foot,
    /// Konsole.
    Konsole,
    /// xterm.
    XTerm,
    /// Not identified: only `COLORTERM` and probe replies are trusted.
    Unknown,
}

impl Terminal {
    /// Stable lowercase identifier (also accepted by `APHRODY_TERMINAL`).
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Aphrody => "aphrody",
            Self::WindowsTerminal => "windows-terminal",
            Self::Vte => "vte",
            Self::Cosmic => "cosmic",
            Self::Rio => "rio",
            Self::Ghostty => "ghostty",
            Self::Kitty => "kitty",
            Self::WezTerm => "wezterm",
            Self::Alacritty => "alacritty",
            Self::ITerm2 => "iterm2",
            Self::VsCode => "vscode",
            Self::Foot => "foot",
            Self::Konsole => "konsole",
            Self::XTerm => "xterm",
            Self::Unknown => "unknown",
        }
    }

    /// Parses an identifier produced by [`Terminal::id`].
    #[must_use]
    pub fn from_id(id: &str) -> Option<Self> {
        const ALL: [Terminal; 15] = [
            Terminal::Aphrody,
            Terminal::WindowsTerminal,
            Terminal::Vte,
            Terminal::Cosmic,
            Terminal::Rio,
            Terminal::Ghostty,
            Terminal::Kitty,
            Terminal::WezTerm,
            Terminal::Alacritty,
            Terminal::ITerm2,
            Terminal::VsCode,
            Terminal::Foot,
            Terminal::Konsole,
            Terminal::XTerm,
            Terminal::Unknown,
        ];
        let id = id.trim().to_ascii_lowercase();
        ALL.into_iter().find(|t| t.id() == id)
    }
}

impl fmt::Display for Terminal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.id())
    }
}

/// A terminal multiplexer between the program and the terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Multiplexer {
    /// tmux: graphics and OSC need `ESC P tmux;` passthrough.
    Tmux,
    /// GNU screen.
    Screen,
    /// Zellij.
    Zellij,
}

/// Inline image protocols, in Aphrody's preference order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ImageProtocol {
    /// Kitty graphics protocol (APC `_G`).
    Kitty,
    /// DEC Sixel (DCS `q`).
    Sixel,
    /// iTerm2 inline images (OSC 1337 `File=`).
    ITerm2,
}

impl ImageProtocol {
    /// Lowercase identifier (`kitty`, `sixel`, `iterm2`).
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Kitty => "kitty",
            Self::Sixel => "sixel",
            Self::ITerm2 => "iterm2",
        }
    }

    /// Parses an identifier produced by [`ImageProtocol::id`].
    #[must_use]
    pub fn from_id(id: &str) -> Option<Self> {
        match id.trim().to_ascii_lowercase().as_str() {
            "kitty" => Some(Self::Kitty),
            "sixel" => Some(Self::Sixel),
            "iterm2" | "iterm" => Some(Self::ITerm2),
            _ => None,
        }
    }
}

/// What a terminal is known (or probed) to support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Capabilities {
    /// 24-bit SGR colors.
    pub truecolor: bool,
    /// OSC 8 hyperlinks.
    pub hyperlinks: bool,
    /// OSC 133 prompt/command marks.
    pub prompt_marks: bool,
    /// OSC 633 (VS Code shell integration).
    pub vscode_marks: bool,
    /// OSC 7 working directory.
    pub cwd_osc7: bool,
    /// OSC 9;9 working directory (ConEmu / Windows Terminal).
    pub cwd_osc9_9: bool,
    /// OSC 9;4 progress.
    pub progress: bool,
    /// OSC 52 clipboard write.
    pub clipboard: bool,
    /// OSC 9 desktop notification.
    pub notify_osc9: bool,
    /// OSC 99 (kitty) desktop notification.
    pub notify_osc99: bool,
    /// OSC 777 `notify` desktop notification.
    pub notify_osc777: bool,
    /// OSC 22 mouse pointer shape.
    pub pointer_shape: bool,
    /// DEC mode 2026 synchronized output.
    pub synchronized_output: bool,
    /// Kitty keyboard protocol (`CSI > flags u`).
    pub kitty_keyboard: bool,
    /// DEC mode 9001 win32-input-mode.
    pub win32_input: bool,
    /// SGR 4:x underline styles and SGR 58 underline color.
    pub styled_underlines: bool,
    /// DEC mode 1016 SGR pixel mouse reports.
    pub sgr_pixel_mouse: bool,
    /// OSC 66 text sizing.
    pub text_sizing: bool,
    /// Sixel images.
    pub sixel: bool,
    /// Kitty graphics protocol.
    pub kitty_graphics: bool,
    /// iTerm2 inline images.
    pub iterm2_images: bool,
}

impl Capabilities {
    /// The verified profile of `terminal` (see the capability matrix).
    #[must_use]
    pub const fn for_terminal(terminal: Terminal) -> Self {
        let none = Self {
            truecolor: false,
            hyperlinks: false,
            prompt_marks: false,
            vscode_marks: false,
            cwd_osc7: false,
            cwd_osc9_9: false,
            progress: false,
            clipboard: false,
            notify_osc9: false,
            notify_osc99: false,
            notify_osc777: false,
            pointer_shape: false,
            synchronized_output: false,
            kitty_keyboard: false,
            win32_input: false,
            styled_underlines: false,
            sgr_pixel_mouse: false,
            text_sizing: false,
            sixel: false,
            kitty_graphics: false,
            iterm2_images: false,
        };
        match terminal {
            Terminal::Aphrody => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                vscode_marks: true,
                cwd_osc7: true,
                cwd_osc9_9: true,
                progress: true,
                clipboard: true,
                notify_osc9: true,
                notify_osc99: true,
                notify_osc777: true,
                pointer_shape: true,
                synchronized_output: true,
                kitty_keyboard: true,
                win32_input: true,
                styled_underlines: true,
                sgr_pixel_mouse: true,
                text_sizing: true,
                sixel: true,
                kitty_graphics: true,
                iterm2_images: true,
            },
            // Windows Terminal 1.25 stable: no OSC 7 before 1.27-dev, OSC 777
            // only behind an opt-in setting, kitty keyboard only in 1.27-dev.
            Terminal::WindowsTerminal => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                vscode_marks: true,
                cwd_osc9_9: true,
                progress: true,
                clipboard: true,
                synchronized_output: true,
                win32_input: true,
                styled_underlines: true,
                sixel: true,
                ..none
            },
            // VTE 0.84: Sixel exists but the embedding app must enable it.
            Terminal::Vte => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                progress: true,
                notify_osc777: true,
                styled_underlines: true,
                ..none
            },
            // COSMIC Terminal epoch-1.10 = alacritty_terminal 0.25.1.
            Terminal::Cosmic | Terminal::Alacritty => Self {
                truecolor: true,
                hyperlinks: true,
                clipboard: true,
                synchronized_output: true,
                kitty_keyboard: true,
                styled_underlines: true,
                ..none
            },
            Terminal::Rio => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                cwd_osc9_9: true,
                progress: true,
                clipboard: true,
                notify_osc9: true,
                notify_osc777: true,
                pointer_shape: true,
                synchronized_output: true,
                kitty_keyboard: true,
                styled_underlines: true,
                sixel: true,
                kitty_graphics: true,
                iterm2_images: true,
                ..none
            },
            // Ghostty 1.3.1: OSC 66 and OSC 1337 File are parsed but unimplemented.
            Terminal::Ghostty => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                progress: true,
                clipboard: true,
                notify_osc9: true,
                notify_osc777: true,
                pointer_shape: true,
                synchronized_output: true,
                kitty_keyboard: true,
                styled_underlines: true,
                sgr_pixel_mouse: true,
                kitty_graphics: true,
                ..none
            },
            Terminal::Kitty => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                progress: true,
                clipboard: true,
                notify_osc9: true,
                notify_osc99: true,
                notify_osc777: true,
                pointer_shape: true,
                synchronized_output: true,
                kitty_keyboard: true,
                styled_underlines: true,
                sgr_pixel_mouse: true,
                text_sizing: true,
                kitty_graphics: true,
                ..none
            },
            // WezTerm 20240203: kitty keyboard and kitty graphics are opt-in settings.
            Terminal::WezTerm => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                clipboard: true,
                notify_osc9: true,
                notify_osc777: true,
                synchronized_output: true,
                win32_input: true,
                styled_underlines: true,
                sgr_pixel_mouse: true,
                sixel: true,
                iterm2_images: true,
                ..none
            },
            Terminal::ITerm2 => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                clipboard: true,
                notify_osc9: true,
                iterm2_images: true,
                ..none
            },
            Terminal::VsCode => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                vscode_marks: true,
                ..none
            },
            Terminal::Foot => Self {
                truecolor: true,
                hyperlinks: true,
                prompt_marks: true,
                cwd_osc7: true,
                clipboard: true,
                synchronized_output: true,
                kitty_keyboard: true,
                sixel: true,
                ..none
            },
            Terminal::Konsole => Self { truecolor: true, hyperlinks: true, sixel: true, ..none },
            Terminal::XTerm | Terminal::Unknown => none,
        }
    }

    /// Every capability as `(id, enabled)`; ids are the field names.
    #[must_use]
    pub const fn entries(&self) -> [(&'static str, bool); 21] {
        [
            ("truecolor", self.truecolor),
            ("hyperlinks", self.hyperlinks),
            ("prompt_marks", self.prompt_marks),
            ("vscode_marks", self.vscode_marks),
            ("cwd_osc7", self.cwd_osc7),
            ("cwd_osc9_9", self.cwd_osc9_9),
            ("progress", self.progress),
            ("clipboard", self.clipboard),
            ("notify_osc9", self.notify_osc9),
            ("notify_osc99", self.notify_osc99),
            ("notify_osc777", self.notify_osc777),
            ("pointer_shape", self.pointer_shape),
            ("synchronized_output", self.synchronized_output),
            ("kitty_keyboard", self.kitty_keyboard),
            ("win32_input", self.win32_input),
            ("styled_underlines", self.styled_underlines),
            ("sgr_pixel_mouse", self.sgr_pixel_mouse),
            ("text_sizing", self.text_sizing),
            ("sixel", self.sixel),
            ("kitty_graphics", self.kitty_graphics),
            ("iterm2_images", self.iterm2_images),
        ]
    }

    /// Comma-separated ids of the enabled capabilities (`APHRODY_TERM_CAPS`).
    #[must_use]
    pub fn enabled_ids(&self) -> String {
        let mut out = String::new();
        for (id, on) in self.entries() {
            if on {
                if !out.is_empty() {
                    out.push(',');
                }
                out.push_str(id);
            }
        }
        out
    }
}

/// Replies collected from the terminal by [`crate::probe`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProbeReplies {
    /// DA1 attribute list (`CSI ? Ps ; ... c`).
    pub da1: Option<Vec<u16>>,
    /// XTVERSION text (`DCS > | text ST`).
    pub xtversion: Option<String>,
    /// Kitty graphics query answer: `Some(true)` for `OK`.
    pub kitty_graphics: Option<bool>,
}

impl ProbeReplies {
    /// Extracts DA1, XTVERSION and kitty graphics replies from raw input.
    #[must_use]
    pub fn parse(bytes: &[u8]) -> Self {
        let mut out = Self::default();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != 0x1b || i + 1 >= bytes.len() {
                i += 1;
                continue;
            }
            match bytes[i + 1] {
                b'[' if bytes.get(i + 2) == Some(&b'?') => {
                    let start = i + 3;
                    let Some(len) = bytes[start..]
                        .iter()
                        .position(|b| !(b.is_ascii_digit() || *b == b';'))
                    else {
                        break;
                    };
                    if bytes[start + len] == b'c' {
                        out.da1 = Some(
                            bytes[start..start + len]
                                .split(|b| *b == b';')
                                .filter_map(|p| std::str::from_utf8(p).ok()?.parse().ok())
                                .collect(),
                        );
                    }
                    i = start + len + 1;
                },
                b'P' if bytes.get(i + 2..i + 4) == Some(b">|") => {
                    let start = i + 4;
                    let Some(end) = find_st(&bytes[start..]) else { break };
                    out.xtversion =
                        Some(String::from_utf8_lossy(&bytes[start..start + end]).into_owned());
                    i = start + end;
                },
                b'_' if bytes.get(i + 2) == Some(&b'G') => {
                    let start = i + 3;
                    let Some(end) = find_st(&bytes[start..]) else { break };
                    let body = &bytes[start..start + end];
                    if let Some(semi) = body.iter().position(|b| *b == b';') {
                        out.kitty_graphics = Some(&body[semi + 1..] == b"OK");
                    }
                    i = start + end;
                },
                _ => i += 1,
            }
        }
        out
    }

    /// Whether the DA1 sentinel (sent last by the probe) has been received.
    #[must_use]
    pub fn complete(&self) -> bool {
        self.da1.is_some()
    }
}

fn find_st(bytes: &[u8]) -> Option<usize> {
    bytes.iter().enumerate().find_map(|(i, b)| match b {
        0x07 | 0x9c => Some(i),
        0x1b if bytes.get(i + 1) == Some(&b'\\') => Some(i),
        _ => None,
    })
}

/// The detected terminal and its effective capabilities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detection {
    /// Identified terminal.
    pub terminal: Terminal,
    /// Version string when the environment or XTVERSION provides one.
    pub version: Option<String>,
    /// Multiplexer between this process and the terminal.
    pub multiplexer: Option<Multiplexer>,
    /// Effective capabilities.
    pub caps: Capabilities,
    /// Which signals decided the identification (for `aphrody shell caps`).
    pub evidence: Vec<String>,
}

impl Detection {
    /// Detects from the process environment.
    #[must_use]
    pub fn from_process_env() -> Self {
        Self::from_env(|key| std::env::var(key).ok().filter(|v| !v.is_empty()))
    }

    /// Detects from an environment lookup (injectable for tests).
    #[must_use]
    pub fn from_env(env: impl Fn(&str) -> Option<String>) -> Self {
        let term = env("TERM").unwrap_or_default();
        let program = env("TERM_PROGRAM").unwrap_or_default();
        let mut evidence = Vec::new();
        let mut version = env("TERM_PROGRAM_VERSION");

        let multiplexer = if env("TMUX").is_some() || program == "tmux" {
            evidence.push("TMUX".to_owned());
            Some(Multiplexer::Tmux)
        } else if env("ZELLIJ").is_some() {
            evidence.push("ZELLIJ".to_owned());
            Some(Multiplexer::Zellij)
        } else if env("STY").is_some() || term.starts_with("screen") {
            evidence.push("STY".to_owned());
            Some(Multiplexer::Screen)
        } else {
            None
        };

        let mut found = |name: &str, terminal: Terminal| {
            evidence.push(name.to_owned());
            terminal
        };
        let terminal = if let Some(id) = env("APHRODY_TERMINAL")
            .as_deref()
            .and_then(Terminal::from_id)
        {
            found("APHRODY_TERMINAL", id)
        } else if program.eq_ignore_ascii_case("aphrody") {
            found("TERM_PROGRAM=Aphrody", Terminal::Aphrody)
        } else if env("KITTY_WINDOW_ID").is_some() || term == "xterm-kitty" {
            found("KITTY_WINDOW_ID", Terminal::Kitty)
        } else if env("GHOSTTY_RESOURCES_DIR").is_some()
            || program == "ghostty"
            || term == "xterm-ghostty"
        {
            found("GHOSTTY_RESOURCES_DIR", Terminal::Ghostty)
        } else if env("WEZTERM_EXECUTABLE").is_some()
            || env("WEZTERM_PANE").is_some()
            || program == "WezTerm"
        {
            found("WEZTERM_PANE", Terminal::WezTerm)
        } else if program.eq_ignore_ascii_case("rio") || term == "rio" {
            found("TERM_PROGRAM=rio", Terminal::Rio)
        } else if program == "vscode" {
            found("TERM_PROGRAM=vscode", Terminal::VsCode)
        } else if program == "iTerm.app" || env("LC_TERMINAL").as_deref() == Some("iTerm2") {
            found("TERM_PROGRAM=iTerm.app", Terminal::ITerm2)
        } else if env("WT_SESSION").is_some() {
            found("WT_SESSION", Terminal::WindowsTerminal)
        } else if env("ALACRITTY_WINDOW_ID").is_some()
            || env("ALACRITTY_SOCKET").is_some()
            || term == "alacritty"
        {
            found("ALACRITTY_WINDOW_ID", Terminal::Alacritty)
        } else if let Some(vte) = env("VTE_VERSION") {
            version = Some(vte);
            found("VTE_VERSION", Terminal::Vte)
        } else if let Some(konsole) = env("KONSOLE_VERSION") {
            version = Some(konsole);
            found("KONSOLE_VERSION", Terminal::Konsole)
        } else if term.starts_with("foot") {
            found("TERM=foot", Terminal::Foot)
        } else if let Some(xterm) = env("XTERM_VERSION") {
            version = Some(xterm);
            found("XTERM_VERSION", Terminal::XTerm)
        } else {
            Terminal::Unknown
        };

        let mut detection = Self {
            terminal,
            version,
            multiplexer,
            caps: Capabilities::for_terminal(terminal),
            evidence,
        };
        if matches!(env("COLORTERM").as_deref(), Some("truecolor" | "24bit")) {
            detection.caps.truecolor = true;
            detection.evidence.push("COLORTERM".to_owned());
        }
        detection
    }

    /// Refines the detection with probe replies: XTVERSION identifies the
    /// terminal, DA1 attribute 4 announces Sixel, and a kitty graphics `OK`
    /// enables the kitty protocol.
    pub fn apply_replies(&mut self, replies: &ProbeReplies) {
        if let Some(text) = &replies.xtversion {
            let (name, version) = split_xtversion(text);
            let identified = match name.to_ascii_lowercase().as_str() {
                "kitty" => Some(Terminal::Kitty),
                "wezterm" => Some(Terminal::WezTerm),
                "ghostty" => Some(Terminal::Ghostty),
                "rio" => Some(Terminal::Rio),
                "vte" => Some(Terminal::Vte),
                "aphrody" => Some(Terminal::Aphrody),
                "xterm" => Some(Terminal::XTerm),
                "foot" => Some(Terminal::Foot),
                "iterm2" => Some(Terminal::ITerm2),
                "konsole" => Some(Terminal::Konsole),
                "tmux" => {
                    self.multiplexer = Some(Multiplexer::Tmux);
                    None
                },
                _ => None,
            };
            if let Some(terminal) = identified {
                let truecolor = self.caps.truecolor;
                self.terminal = terminal;
                self.caps = Capabilities::for_terminal(terminal);
                self.caps.truecolor |= truecolor;
                if !version.is_empty() {
                    self.version = Some(version.to_owned());
                }
            }
            self.evidence.push(format!("XTVERSION={text}"));
        }
        if let Some(attributes) = &replies.da1 {
            if attributes.iter().skip(1).any(|a| *a == 4) {
                self.caps.sixel = true;
            }
            self.evidence.push(format!(
                "DA1={}",
                attributes.iter().map(u16::to_string).collect::<Vec<_>>().join(";")
            ));
        }
        if let Some(ok) = replies.kitty_graphics {
            self.caps.kitty_graphics = ok;
            self.evidence.push(format!("kitty-graphics={}", if ok { "OK" } else { "error" }));
        }
    }

    /// The preferred inline image protocol: Kitty, then Sixel, then iTerm2.
    #[must_use]
    pub fn image_protocol(&self) -> Option<ImageProtocol> {
        if self.caps.kitty_graphics {
            Some(ImageProtocol::Kitty)
        } else if self.caps.sixel {
            Some(ImageProtocol::Sixel)
        } else if self.caps.iterm2_images {
            Some(ImageProtocol::ITerm2)
        } else {
            None
        }
    }

    /// Whether escape sequences must be wrapped for tmux passthrough.
    #[must_use]
    pub fn needs_passthrough(&self) -> bool {
        self.multiplexer == Some(Multiplexer::Tmux)
    }
}

/// Splits `kitty(0.49.2)`, `WezTerm 20240203-110809-5046fc22`, `VTE(8401)`
/// and `ghostty 1.3.1` into name and version.
fn split_xtversion(text: &str) -> (&str, &str) {
    let text = text.trim();
    let cut = text.find(['(', ' ']).unwrap_or(text.len());
    let name = &text[..cut];
    let version = text[cut..].trim_matches(|c: char| c == '(' || c == ')' || c.is_whitespace());
    (name, version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| vars.iter().find(|(k, _)| *k == key).map(|(_, v)| (*v).to_owned())
    }

    #[test]
    fn windows_terminal_is_detected_from_wt_session_and_prefers_sixel() {
        let d = Detection::from_env(env(&[("WT_SESSION", "1b2c"), ("TERM", "xterm-256color")]));
        assert_eq!(d.terminal, Terminal::WindowsTerminal);
        assert_eq!(d.image_protocol(), Some(ImageProtocol::Sixel));
        assert!(d.caps.cwd_osc9_9 && d.caps.progress && d.caps.win32_input);
    }

    #[test]
    fn kitty_beats_other_markers_and_prefers_kitty_graphics() {
        let d = Detection::from_env(env(&[("KITTY_WINDOW_ID", "1"), ("WT_SESSION", "x")]));
        assert_eq!(d.terminal, Terminal::Kitty);
        assert_eq!(d.image_protocol(), Some(ImageProtocol::Kitty));
    }

    #[test]
    fn vte_records_its_version_and_has_no_image_protocol() {
        let d = Detection::from_env(env(&[("VTE_VERSION", "8401")]));
        assert_eq!((d.terminal, d.version.as_deref()), (Terminal::Vte, Some("8401")));
        assert_eq!(d.image_protocol(), None);
    }

    #[test]
    fn wezterm_falls_back_to_sixel_then_iterm2() {
        let mut d = Detection::from_env(env(&[("TERM_PROGRAM", "WezTerm")]));
        assert_eq!(d.image_protocol(), Some(ImageProtocol::Sixel));
        d.caps.sixel = false;
        assert_eq!(d.image_protocol(), Some(ImageProtocol::ITerm2));
    }

    #[test]
    fn override_and_tmux_are_honoured() {
        let d = Detection::from_env(env(&[
            ("APHRODY_TERMINAL", "cosmic"),
            ("TMUX", "/tmp/tmux-1000/default,1,0"),
        ]));
        assert_eq!(d.terminal, Terminal::Cosmic);
        assert!(d.needs_passthrough());
    }

    #[test]
    fn replies_parse_da1_xtversion_and_kitty_graphics() {
        let raw = b"\x1b_Gi=31;OK\x1b\\\x1bP>|kitty(0.49.2)\x1b\\\x1b[?62;4;22c";
        let replies = ProbeReplies::parse(raw);
        assert_eq!(replies.da1.as_deref(), Some(&[62, 4, 22][..]));
        assert_eq!(replies.xtversion.as_deref(), Some("kitty(0.49.2)"));
        assert_eq!(replies.kitty_graphics, Some(true));
        assert!(replies.complete());
    }

    #[test]
    fn xtversion_reidentifies_an_unknown_terminal_and_da1_adds_sixel() {
        let mut d = Detection::from_env(env(&[("COLORTERM", "truecolor")]));
        assert_eq!(d.terminal, Terminal::Unknown);
        d.apply_replies(&ProbeReplies {
            da1: Some(vec![65, 4, 6, 18, 22]),
            xtversion: Some("WezTerm 20240203-110809-5046fc22".into()),
            kitty_graphics: Some(false),
        });
        assert_eq!(d.terminal, Terminal::WezTerm);
        assert_eq!(d.version.as_deref(), Some("20240203-110809-5046fc22"));
        assert!(d.caps.truecolor && d.caps.sixel && !d.caps.kitty_graphics);
    }

    #[test]
    fn da1_level_number_alone_does_not_claim_sixel() {
        let mut d = Detection::from_env(env(&[]));
        d.apply_replies(&ProbeReplies { da1: Some(vec![4]), ..Default::default() });
        assert!(!d.caps.sixel);
    }

    #[test]
    fn terminal_ids_round_trip() {
        for t in [Terminal::Aphrody, Terminal::WindowsTerminal, Terminal::Cosmic, Terminal::Unknown] {
            assert_eq!(Terminal::from_id(t.id()), Some(t));
        }
    }
}
