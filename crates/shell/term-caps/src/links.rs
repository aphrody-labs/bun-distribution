// SPDX-License-Identifier: Apache-2.0
//! OSC 8 links for file mentions in compiler, test and shell error output:
//! `src/lib.rs:12:5`, `C:\src\x.rs`, `./a/b.ts`, `/etc/hosts`. The
//! `:line:col` suffix is part of the link text; an MSVC `(line,col)` suffix
//! is left outside it.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use crate::seq::{HYPERLINK_CLOSE, file_uri, hyperlink_open};

const DELIMITERS: &[char] = &[' ', '\t', '"', '\'', '`', '<', '>', '(', '[', ']', '{', '}', '|', ',', '='];

/// Wraps every existing file mentioned in `line` in an OSC 8 link.
/// Lines that already carry OSC 8 are returned unchanged. `exists` resolves
/// relative paths against `cwd`.
#[must_use]
pub fn linkify_line<'a>(
    line: &'a str,
    cwd: &Path,
    host: Option<&str>,
    exists: impl Fn(&Path) -> bool,
) -> Cow<'a, str> {
    if line.contains("\x1b]8;") {
        return Cow::Borrowed(line);
    }
    let mut out = String::new();
    let mut copied = 0;
    for (start, end) in plain_runs(line) {
        let run = &line[start..end];
        let mut offset = 0;
        for token in run.split(DELIMITERS) {
            let token_start = start + offset;
            offset += token.len() + 1;
            let Some((path_len, target)) = candidate(token, cwd, &exists) else { continue };
            let link_end = token_start + path_len;
            out.push_str(&line[copied..token_start]);
            out.push_str(&hyperlink_open(&file_uri(host, &target), None));
            out.push_str(&line[token_start..link_end]);
            out.push_str(HYPERLINK_CLOSE);
            copied = link_end;
        }
    }
    if copied == 0 {
        return Cow::Borrowed(line);
    }
    out.push_str(&line[copied..]);
    Cow::Owned(out)
}

/// Byte ranges of `line` outside CSI/OSC/other escape sequences.
fn plain_runs(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut runs = Vec::new();
    let (mut i, mut start) = (0, 0);
    while i < bytes.len() {
        if bytes[i] != 0x1b {
            i += 1;
            continue;
        }
        if start < i {
            runs.push((start, i));
        }
        i += 1;
        match bytes.get(i) {
            Some(b'[') => {
                i += 1;
                while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                    i += 1;
                }
                i += 1;
            },
            Some(b']') => {
                while i < bytes.len() && bytes[i] != 0x07 && !(bytes[i] == 0x1b && bytes.get(i + 1) == Some(&b'\\')) {
                    i += 1;
                }
                i += if bytes.get(i) == Some(&0x07) { 1 } else { 2 };
            },
            Some(_) => i += 1,
            None => {},
        }
        i = i.min(bytes.len());
        start = i;
    }
    if start < bytes.len() {
        runs.push((start, bytes.len()));
    }
    runs
}

/// Length of the path part of `token` (location suffix included) and the
/// resolved file, when `token` names an existing file.
fn candidate(token: &str, cwd: &Path, exists: &impl Fn(&Path) -> bool) -> Option<(usize, PathBuf)> {
    let trimmed = token.trim_end_matches(['.', ',', ';', ':', ')', '!', '?']);
    if trimmed.len() < 3 || trimmed.contains("://") {
        return None;
    }
    let bytes = trimmed.as_bytes();
    let drive = bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
    // Strip `:line[:col]` and MSVC `(line,col)` location suffixes.
    let search_from = if drive { 2 } else { 0 };
    let mut path_end = trimmed.len();
    if let Some(colon) = trimmed[search_from..].find(':') {
        let colon = search_from + colon;
        if trimmed[colon + 1..].split(':').next().is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())) {
            path_end = colon;
        }
    }
    let path = &trimmed[..path_end];
    let looks_like_path = path.contains(['/', '\\']) || path.rsplit_once('.').is_some_and(|(stem, ext)| !stem.is_empty() && (1..=8).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_alphanumeric()));
    if !looks_like_path {
        return None;
    }
    let candidate = Path::new(path);
    let resolved = if candidate.is_absolute() || drive { candidate.to_path_buf() } else { cwd.join(candidate) };
    exists(&resolved).then_some((trimmed.len(), resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exists(p: &Path) -> bool {
        let p = p.to_string_lossy().replace('\\', "/");
        ["/w/src/lib.rs", "/w/a b.txt", "C:/x/y.rs", "/w/./tests/t.ts"].iter().any(|e| p == *e)
    }

    #[test]
    fn rust_style_locations_are_linked_with_their_suffix() {
        let out = linkify_line("error --> src/lib.rs:12:5 here", Path::new("/w"), None, exists);
        assert_eq!(
            out,
            "error --> \x1b]8;;file:///w/src/lib.rs\x1b\\src/lib.rs:12:5\x1b]8;;\x1b\\ here"
        );
    }

    #[test]
    fn windows_drive_paths_and_msvc_locations() {
        let out = linkify_line(r"C:\x\y.rs(3,1): warning", Path::new("/w"), None, exists);
        assert_eq!(out, "\x1b]8;;file:///C:/x/y.rs\x1b\\C:\\x\\y.rs\x1b]8;;\x1b\\(3,1): warning");
    }

    #[test]
    fn sgr_colored_paths_are_found_between_escapes() {
        let out = linkify_line("\x1b[1m./tests/t.ts\x1b[0m:", Path::new("/w"), Some("h"), exists);
        assert_eq!(out, "\x1b[1m\x1b]8;;file://h/w/./tests/t.ts\x1b\\./tests/t.ts\x1b]8;;\x1b\\\x1b[0m:");
    }

    #[test]
    fn missing_files_urls_and_existing_links_are_left_alone() {
        for line in ["see nope/x.rs:1", "https://a.b/c.rs", "\x1b]8;;file:///w/src/lib.rs\x1b\\src/lib.rs\x1b]8;;\x1b\\", "plain words."] {
            assert!(matches!(linkify_line(line, Path::new("/w"), None, exists), Cow::Borrowed(_)), "{line:?}");
        }
    }
}
