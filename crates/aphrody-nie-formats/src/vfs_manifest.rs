//! Canonical, content-addressed VFS manifest shared by every host.
//!
//! A manifest is the list of logical paths a game install serves, each with the pack that
//! holds it, where, and how big it is, taken from the pack TOCs. It is produced by the same
//! code on the server (local packs) and on a client (SFTP/HTTP range reads of the same packs):
//! two hosts that see the same install derive the same [`Manifest::digest`].
//!
//! Contract (version 1):
//!
//! - **Paths** use `/`, no leading or duplicate separator ([`canonical_path`]); case is kept
//!   as stored in the TOC and compared byte for byte.
//! - **Rows** are sorted by `(path, source, offset)` in byte order. The IEVR logical view has
//!   one row per path (main `cpk_list.cfg.bin` index first, then extra packs in byte order of
//!   their file name); the DBXV2 view lists every `(pack, path)` of every pack.
//! - **Canonical line** of a row: `path TAB source TAB offset TAB size TAB extract_size TAB
//!   flags LF` with `size` the stored bytes in the pack, `extract_size` the bytes after
//!   decryption/decompression (equal to `size` when the TOC stores 0), `flags` a sorted
//!   subset of `c` compressed, `e` pack outside `cpk_list`, `l` loose (no pack), `u` declared
//!   but not found in the TOC. `\`, TAB, LF and CR in a path are escaped as `%5C %09 %0A %0D`
//!   (and `%` as `%25`).
//! - **Digest** is `sha256:` + lowercase hex of the concatenated canonical lines.
//!
//! The wire form is NDJSON: a header line `{"manifest":1,"game":…,"count":N,"digest":…}` then
//! one JSON object per row.

use crate::FormatError;
use crate::cpk::CpkEntry;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

pub const MANIFEST_VERSION: u64 = 1;

/// `/`-separated path without leading, trailing-empty or duplicate separators.
#[must_use]
pub fn canonical_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for part in path.split(['/', '\\']).filter(|p| !p.is_empty()) {
        if !out.is_empty() {
            out.push('/');
        }
        out.push_str(part);
    }
    out
}

/// Join a TOC directory and file name the one canonical way (the CPK reader, the
/// `cpk_list.cfg.bin` index and the manifest must agree, or lookups miss).
#[must_use]
pub fn join_canonical(directory: &str, filename: &str) -> String {
    if directory.is_empty() {
        return canonical_path(filename);
    }
    canonical_path(&format!("{directory}/{filename}"))
}

/// One row of the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestEntry {
    pub path: String,
    /// Pack file name, empty for a loose file.
    pub source: String,
    pub offset: u64,
    /// Stored bytes in the pack.
    pub size: u64,
    /// Bytes after decryption and decompression.
    pub extract_size: u64,
    pub compressed: bool,
    pub extra: bool,
    pub loose: bool,
    pub unresolved: bool,
}

impl ManifestEntry {
    #[must_use]
    pub fn packed(path: &str, pack: &str, entry: &CpkEntry, extra: bool) -> Self {
        Self {
            path: path.to_string(),
            source: pack.to_string(),
            offset: entry.offset,
            size: entry.size,
            extract_size: if entry.extract_size == 0 {
                entry.size
            } else {
                entry.extract_size
            },
            compressed: entry.is_compressed,
            extra,
            loose: false,
            unresolved: false,
        }
    }

    #[must_use]
    pub fn loose(path: &str, size: u64) -> Self {
        Self {
            path: path.to_string(),
            source: String::new(),
            offset: 0,
            size,
            extract_size: size,
            compressed: false,
            extra: false,
            loose: true,
            unresolved: false,
        }
    }

    #[must_use]
    pub fn unresolved(path: &str, pack: &str, declared: u64, extra: bool) -> Self {
        Self {
            path: path.to_string(),
            source: pack.to_string(),
            offset: 0,
            size: declared,
            extract_size: declared,
            compressed: false,
            extra,
            loose: false,
            unresolved: true,
        }
    }

    #[must_use]
    pub fn flags(&self) -> String {
        let mut f = String::new();
        if self.compressed {
            f.push('c');
        }
        if self.extra {
            f.push('e');
        }
        if self.loose {
            f.push('l');
        }
        if self.unresolved {
            f.push('u');
        }
        f
    }

    fn sort_key(&self) -> (&[u8], &[u8], u64) {
        (self.path.as_bytes(), self.source.as_bytes(), self.offset)
    }

    /// The canonical line hashed by [`Manifest::digest`] (with its trailing LF).
    #[must_use]
    pub fn canonical_line(&self) -> String {
        let mut line = String::with_capacity(self.path.len() + 64);
        escape_into(&mut line, &self.path);
        line.push('\t');
        escape_into(&mut line, &self.source);
        let _ = writeln!(
            line,
            "\t{}\t{}\t{}\t{}",
            self.offset,
            self.size,
            self.extract_size,
            self.flags()
        );
        line
    }

    fn to_json(&self) -> Value {
        json!({
            "path": self.path,
            "source": self.source,
            "offset": self.offset,
            "size": self.size,
            "extractSize": self.extract_size,
            "flags": self.flags(),
        })
    }

    fn from_json(v: &Value) -> Result<Self, FormatError> {
        let flags = v["flags"].as_str().ok_or(FormatError::Corrupt("manifest row: flags"))?;
        Ok(Self {
            path: v["path"].as_str().ok_or(FormatError::Corrupt("manifest row: path"))?.to_string(),
            source: v["source"].as_str().ok_or(FormatError::Corrupt("manifest row: source"))?.to_string(),
            offset: v["offset"].as_u64().ok_or(FormatError::Corrupt("manifest row: offset"))?,
            size: v["size"].as_u64().ok_or(FormatError::Corrupt("manifest row: size"))?,
            extract_size: v["extractSize"].as_u64().ok_or(FormatError::Corrupt("manifest row: extractSize"))?,
            compressed: flags.contains('c'),
            extra: flags.contains('e'),
            loose: flags.contains('l'),
            unresolved: flags.contains('u'),
        })
    }
}

fn escape_into(out: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '%' => out.push_str("%25"),
            '\\' => out.push_str("%5C"),
            '\t' => out.push_str("%09"),
            '\n' => out.push_str("%0A"),
            '\r' => out.push_str("%0D"),
            c => out.push(c),
        }
    }
}

/// A sorted set of rows plus the game label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub game: String,
    entries: Vec<ManifestEntry>,
}

/// One difference between two manifests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Difference {
    OnlyLeft(ManifestEntry),
    OnlyRight(ManifestEntry),
    Changed {
        left: ManifestEntry,
        right: ManifestEntry,
    },
}

impl Manifest {
    /// Sort `entries` into canonical order.
    #[must_use]
    pub fn new(game: &str, mut entries: Vec<ManifestEntry>) -> Self {
        entries.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        Self {
            game: game.to_string(),
            entries,
        }
    }

    #[must_use]
    pub fn entries(&self) -> &[ManifestEntry] {
        &self.entries
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// `sha256:<hex>` over the canonical lines.
    #[must_use]
    pub fn digest(&self) -> String {
        let mut hasher = Sha256::new();
        for e in &self.entries {
            hasher.update(e.canonical_line().as_bytes());
        }
        format!("sha256:{}", hex(&hasher.finalize()))
    }

    #[must_use]
    pub fn header_json(&self) -> Value {
        json!({
            "manifest": MANIFEST_VERSION,
            "game": self.game,
            "count": self.entries.len(),
            "digest": self.digest(),
        })
    }

    /// Header line then one line per row, each terminated by LF.
    #[must_use]
    pub fn to_ndjson(&self) -> String {
        let mut out = String::with_capacity(self.entries.len() * 140 + 128);
        out.push_str(&self.header_json().to_string());
        out.push('\n');
        for e in &self.entries {
            out.push_str(&e.to_json().to_string());
            out.push('\n');
        }
        out
    }

    /// Parse the NDJSON wire form and check its header (count and digest included).
    ///
    /// # Errors
    /// Malformed JSON/rows, an unknown version, or a count/digest that does not match the rows.
    pub fn parse_ndjson(text: &str) -> Result<Self, FormatError> {
        let mut lines = text.lines().filter(|l| !l.is_empty());
        let header: Value = serde_json::from_str(lines.next().ok_or(FormatError::Corrupt("manifest empty"))?)
            .map_err(|_| FormatError::Corrupt("manifest header is not JSON"))?;
        if header["manifest"].as_u64() != Some(MANIFEST_VERSION) {
            return Err(FormatError::Corrupt("unsupported manifest version"));
        }
        let game = header["game"].as_str().unwrap_or_default().to_string();
        let mut entries = Vec::new();
        for line in lines {
            let v: Value = serde_json::from_str(line)
                .map_err(|_| FormatError::Corrupt("manifest row is not JSON"))?;
            entries.push(ManifestEntry::from_json(&v)?);
        }
        let manifest = Self::new(&game, entries);
        if header["count"].as_u64() != Some(manifest.len() as u64) {
            return Err(FormatError::Corrupt("manifest count does not match its rows"));
        }
        if header["digest"].as_str() != Some(manifest.digest().as_str()) {
            return Err(FormatError::Corrupt("manifest digest does not match its rows"));
        }
        Ok(manifest)
    }

    /// Differences by `(path, source)`; both sides are in canonical order so this is one merge.
    #[must_use]
    pub fn diff(&self, other: &Self) -> Vec<Difference> {
        let (mut i, mut j) = (0, 0);
        let mut out = Vec::new();
        let key = |e: &ManifestEntry| (e.path.clone(), e.source.clone());
        while i < self.entries.len() || j < other.entries.len() {
            match (self.entries.get(i), other.entries.get(j)) {
                (Some(l), Some(r)) => match key(l).cmp(&key(r)) {
                    std::cmp::Ordering::Less => {
                        out.push(Difference::OnlyLeft(l.clone()));
                        i += 1;
                    }
                    std::cmp::Ordering::Greater => {
                        out.push(Difference::OnlyRight(r.clone()));
                        j += 1;
                    }
                    std::cmp::Ordering::Equal => {
                        if l != r {
                            out.push(Difference::Changed {
                                left: l.clone(),
                                right: r.clone(),
                            });
                        }
                        i += 1;
                        j += 1;
                    }
                },
                (Some(l), None) => {
                    out.push(Difference::OnlyLeft(l.clone()));
                    i += 1;
                }
                (None, Some(r)) => {
                    out.push(Difference::OnlyRight(r.clone()));
                    j += 1;
                }
                (None, None) => break,
            }
        }
        out
    }

    /// Manifest of a directory of CPKs where every pack is its own namespace (DBXV2: `cpk/*.cpk`
    /// next to the executable). Packs are read in byte order of their file name; nothing is
    /// shadowed, so the same path in two packs yields two rows.
    ///
    /// # Errors
    /// The directory cannot be listed or a pack TOC cannot be parsed.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn from_cpk_dir(game: &str, dir: &std::path::Path) -> Result<Self, FormatError> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map_err(|_| FormatError::Corrupt("cpk directory not readable"))?
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.to_ascii_lowercase().ends_with(".cpk"))
            .collect();
        names.sort();
        let mut rows = Vec::new();
        for name in &names {
            let reader = crate::vfs::open_local_toc(&dir.join(name), name)?;
            for entry in &reader.entries {
                if entry.filename.is_empty() {
                    continue;
                }
                let path = join_canonical(&entry.directory, &entry.filename);
                rows.push(ManifestEntry::packed(&path, name, entry, false));
            }
        }
        Ok(Self::new(game, rows))
    }
}

/// Extract one entry of a pack by its canonical path (exact match, first occurrence), with
/// positioned reads only. This is the byte-level counterpart of a [`ManifestEntry`] whose
/// `source` is `pack`.
///
/// # Errors
/// The pack cannot be opened, or holds no such path.
#[cfg(not(target_arch = "wasm32"))]
pub fn read_pack_entry(
    pack_path: &std::path::Path,
    path: &str,
) -> Result<Vec<u8>, FormatError> {
    let name = pack_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let reader = crate::vfs::open_local_toc(pack_path, &name)?;
    let entry = reader
        .entries
        .iter()
        .find(|e| !e.filename.is_empty() && join_canonical(&e.directory, &e.filename) == path)
        .ok_or(FormatError::Corrupt("path not present in pack"))?;
    reader.extract_from_reader(entry, |offset, size| {
        crate::vfs::read_file_range(pack_path, offset, size)
    })
}

/// Lowercase hex of `bytes`.
#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// `sha256:<hex>` of a byte slice (used for content addressing of extracted entries).
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, source: &str, offset: u64) -> ManifestEntry {
        ManifestEntry {
            path: path.into(),
            source: source.into(),
            offset,
            size: 10,
            extract_size: 20,
            compressed: true,
            extra: false,
            loose: false,
            unresolved: false,
        }
    }

    #[test]
    fn paths_are_canonical() {
        assert_eq!(join_canonical("data/common/", "a.bin"), "data/common/a.bin");
        assert_eq!(join_canonical("data\\common", "a.bin"), "data/common/a.bin");
        assert_eq!(join_canonical("", "/a.bin"), "a.bin");
    }

    #[test]
    fn digest_ignores_input_order_and_roundtrips() {
        let a = Manifest::new("t", vec![row("b", "p", 2), row("a", "p", 1)]);
        let b = Manifest::new("t", vec![row("a", "p", 1), row("b", "p", 2)]);
        assert_eq!(a.digest(), b.digest());
        let back = Manifest::parse_ndjson(&a.to_ndjson()).unwrap();
        assert_eq!(back, a);
        let tampered = a.to_ndjson().replace("\"size\":10", "\"size\":11");
        assert!(Manifest::parse_ndjson(&tampered).is_err());
    }

    #[test]
    fn diff_reports_each_kind() {
        let a = Manifest::new("t", vec![row("a", "p", 1), row("b", "p", 2)]);
        let mut changed = row("b", "p", 2);
        changed.size = 99;
        let b = Manifest::new("t", vec![changed, row("c", "p", 3)]);
        let d = a.diff(&b);
        assert_eq!(d.len(), 3);
    }

    #[test]
    fn hostile_paths_cannot_forge_a_line() {
        let e = row("a\tb\nc", "p", 0);
        assert_eq!(e.canonical_line().matches('\n').count(), 1);
    }
}
