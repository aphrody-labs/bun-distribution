// SPDX-License-Identifier: Apache-2.0
//! Source kinds and `<source>:<id>[@<range>]` specifiers.

use std::fmt;

/// `package.json` field holding `"<source>:<id>": "<range>"` entries.
pub const PACKAGE_JSON_FIELD: &[u8] = b"systemDependencies";

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum SourceKind {
    Winget,
    Apk,
    Deb,
    Pacman,
}

impl SourceKind {
    pub const ALL: [SourceKind; 4] =
        [SourceKind::Winget, SourceKind::Apk, SourceKind::Deb, SourceKind::Pacman];

    pub fn name(self) -> &'static str {
        match self {
            SourceKind::Winget => "winget",
            SourceKind::Apk => "apk",
            SourceKind::Deb => "deb",
            SourceKind::Pacman => "pacman",
        }
    }

    /// `apt` is accepted as an alias of `deb`.
    pub fn from_name(name: &[u8]) -> Option<SourceKind> {
        match name {
            b"winget" => Some(SourceKind::Winget),
            b"apk" => Some(SourceKind::Apk),
            b"deb" | b"apt" => Some(SourceKind::Deb),
            b"pacman" => Some(SourceKind::Pacman),
            _ => None,
        }
    }
}

impl fmt::Display for SourceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// A parsed `<source>:<id>[@<range>]` specifier (`winget:Microsoft.PowerToys@^0.100`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spec {
    pub source: SourceKind,
    pub id: String,
    /// `"*"` when omitted.
    pub range: String,
}

impl Spec {
    pub fn key(&self) -> String {
        lock_key(self.source, &self.id)
    }
}

/// `true` when `spec` starts with a known `<source>:` prefix.
pub fn is_system_spec(spec: &[u8]) -> bool {
    split_source(spec).is_some()
}

fn split_source(spec: &[u8]) -> Option<(SourceKind, &[u8])> {
    let colon = spec.iter().position(|&c| c == b':')?;
    let kind = SourceKind::from_name(&spec[..colon])?;
    let rest = &spec[colon + 1..];
    if rest.is_empty() {
        return None;
    }
    Some((kind, rest))
}

fn range_or_star(range: &str) -> String {
    if range.is_empty() { "*".to_owned() } else { range.to_owned() }
}

/// Parses `<source>:<id>[@<range>]`. The range separator is the last `@` that
/// is not the first character, so ids never need quoting.
pub fn parse_spec(spec: &[u8]) -> Option<Spec> {
    let (source, rest) = split_source(spec)?;
    let (id, range) = match rest.iter().rposition(|&c| c == b'@') {
        Some(at) if at > 0 => (&rest[..at], &rest[at + 1..]),
        _ => (rest, &b""[..]),
    };
    if id.is_empty() || id.iter().any(u8::is_ascii_whitespace) {
        return None;
    }
    let id = core::str::from_utf8(id).ok()?;
    let range = core::str::from_utf8(range).ok()?;
    Some(Spec { source, id: id.to_owned(), range: range_or_star(range) })
}

/// Parses a `systemDependencies` key (`"winget:Microsoft.PowerToys"`) plus its range value.
pub fn parse_entry(key: &[u8], range: &[u8]) -> Option<Spec> {
    let (source, id) = split_source(key)?;
    let id = core::str::from_utf8(id).ok()?;
    let range = core::str::from_utf8(range).ok()?.trim();
    Some(Spec { source, id: id.to_owned(), range: range_or_star(range) })
}

pub fn lock_key(source: SourceKind, id: &str) -> String {
    let mut key = String::with_capacity(source.name().len() + 1 + id.len());
    key.push_str(source.name());
    key.push(':');
    key.push_str(id);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specs() {
        let s = parse_spec(b"winget:Microsoft.PowerToys@^0.100").unwrap();
        assert_eq!(
            (s.source, s.id.as_str(), s.range.as_str()),
            (SourceKind::Winget, "Microsoft.PowerToys", "^0.100")
        );
        assert_eq!(parse_spec(b"apt:curl").unwrap().source, SourceKind::Deb);
        assert_eq!(parse_spec(b"apk:curl").unwrap().range, "*");
        assert!(parse_spec(b"winget:bad id").is_none());
        assert!(parse_spec(b"npm:react").is_none());
        assert!(!is_system_spec(b"winget:"));
        assert_eq!(parse_entry(b"pacman:git", b" >=2 ").unwrap().key(), "pacman:git");
    }
}
