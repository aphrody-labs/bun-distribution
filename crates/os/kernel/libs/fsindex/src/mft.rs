// SPDX-License-Identifier: Apache-2.0
//! Platform-independent NTFS USN record decoding and in-memory volume tree.
//!
//! `FSCTL_ENUM_USN_DATA` yields a packed sequence of `USN_RECORD_V2` /
//! `USN_RECORD_V3` structures. This module decodes them from raw bytes (no
//! Windows API, so it is unit-testable everywhere) and joins them into a
//! parent/child tree keyed by File Reference Number (FRN).
//!
//! Metadata only: FRN, parent FRN, name, attributes, USN and the record
//! timestamp. File contents are never read. File sizes are not part of a USN
//! record; they are a later batch.

use std::collections::HashMap;

/// `FILE_ATTRIBUTE_HIDDEN`.
pub const ATTR_HIDDEN: u32 = 0x0000_0002;
/// `FILE_ATTRIBUTE_SYSTEM`.
pub const ATTR_SYSTEM: u32 = 0x0000_0004;
/// `FILE_ATTRIBUTE_DIRECTORY`.
pub const ATTR_DIRECTORY: u32 = 0x0000_0010;

/// MFT record number of the NTFS root directory (low 48 bits of the FRN).
pub const ROOT_RECORD_NUMBER: u128 = 5;
/// Mask selecting the 48-bit MFT record number (the high 16 bits are a sequence number).
const RECORD_NUMBER_MASK: u128 = 0x0000_FFFF_FFFF_FFFF;

/// Fixed size of the `USN_RECORD_V2` header (up to the start of the name).
const V2_HEADER_LEN: usize = 60;
/// Fixed size of the `USN_RECORD_V3` header (up to the start of the name).
const V3_HEADER_LEN: usize = 76;

/// Common leading fields of every `USN_RECORD_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsnRecordHeader {
    /// Total record length in bytes (8-byte aligned by the OS).
    pub record_length: u32,
    /// Major version (2 or 3 are decoded here).
    pub major_version: u16,
    /// Minor version.
    pub minor_version: u16,
}

impl UsnRecordHeader {
    /// Decode the 8-byte common header; `None` if `buf` is too short.
    #[must_use]
    pub fn parse(buf: &[u8]) -> Option<Self> {
        Some(Self {
            record_length: read_u32(buf, 0)?,
            major_version: read_u16(buf, 4)?,
            minor_version: read_u16(buf, 6)?,
        })
    }
}

/// One decoded USN record (a file or directory known to the MFT).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsnEntry {
    /// File reference number (64-bit for V2, zero-extended; 128-bit for V3).
    pub frn: u128,
    /// FRN of the parent directory.
    pub parent_frn: u128,
    /// File name component (lossy UTF-16 decode).
    pub name: String,
    /// `FILE_ATTRIBUTE_*` bit set.
    pub attributes: u32,
    /// Update sequence number of the record.
    pub usn: i64,
    /// Record timestamp (Windows FILETIME, 100 ns ticks since 1601-01-01 UTC).
    pub timestamp: i64,
}

impl UsnEntry {
    /// True when `FILE_ATTRIBUTE_HIDDEN` is set.
    #[must_use]
    pub fn is_hidden(&self) -> bool {
        self.attributes & ATTR_HIDDEN != 0
    }

    /// True when `FILE_ATTRIBUTE_SYSTEM` is set.
    #[must_use]
    pub fn is_system(&self) -> bool {
        self.attributes & ATTR_SYSTEM != 0
    }

    /// True when `FILE_ATTRIBUTE_DIRECTORY` is set.
    #[must_use]
    pub fn is_dir(&self) -> bool {
        self.attributes & ATTR_DIRECTORY != 0
    }
}

fn read_u16(buf: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(buf.get(at..at.checked_add(2)?)?.try_into().ok()?))
}

fn read_u32(buf: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buf.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn read_u64(buf: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(buf.get(at..at.checked_add(8)?)?.try_into().ok()?))
}

fn read_i64(buf: &[u8], at: usize) -> Option<i64> {
    Some(i64::from_le_bytes(buf.get(at..at.checked_add(8)?)?.try_into().ok()?))
}

fn read_u128(buf: &[u8], at: usize) -> Option<u128> {
    Some(u128::from_le_bytes(buf.get(at..at.checked_add(16)?)?.try_into().ok()?))
}

/// Decode one `USN_RECORD_V2` or `USN_RECORD_V3` at the start of `buf`.
///
/// Returns the entry and the number of bytes consumed (the record length), so
/// callers can iterate a packed buffer. Returns `None` for truncated or
/// malformed records and for unsupported versions.
#[must_use]
pub fn parse_usn_record(buf: &[u8]) -> Option<(UsnEntry, usize)> {
    let header = UsnRecordHeader::parse(buf)?;
    let len = usize::try_from(header.record_length).ok()?;
    let record = buf.get(..len)?;
    let (frn, parent_frn, usn, timestamp, attr_at, header_len) = match header.major_version {
        2 => (
            u128::from(read_u64(record, 8)?),
            u128::from(read_u64(record, 16)?),
            read_i64(record, 24)?,
            read_i64(record, 32)?,
            52,
            V2_HEADER_LEN,
        ),
        3 => (
            read_u128(record, 8)?,
            read_u128(record, 24)?,
            read_i64(record, 40)?,
            read_i64(record, 48)?,
            68,
            V3_HEADER_LEN,
        ),
        _ => return None,
    };
    if len < header_len {
        return None;
    }
    let attributes = read_u32(record, attr_at)?;
    let name_len = usize::from(read_u16(record, attr_at + 4)?);
    let name_off = usize::from(read_u16(record, attr_at + 6)?);
    if name_len % 2 != 0 || name_off < header_len {
        return None;
    }
    let name_bytes = record.get(name_off..name_off.checked_add(name_len)?)?;
    let units: Vec<u16> =
        name_bytes.as_chunks::<2>().0.iter().map(|&c| u16::from_le_bytes(c)).collect();
    Some((
        UsnEntry {
            frn,
            parent_frn,
            name: String::from_utf16_lossy(&units),
            attributes,
            usn,
            timestamp,
        },
        len,
    ))
}

/// Parent/child tree of volume entries keyed by FRN.
#[derive(Debug, Default, Clone)]
pub struct MftTree {
    nodes: HashMap<u128, UsnEntry>,
    children: HashMap<u128, Vec<u128>>,
    /// Explicit root id for trees that are not the NTFS volume (e.g. a walkdir
    /// scan rooted at an arbitrary directory). The NTFS root (record 5) is
    /// always treated as root regardless of this.
    root: Option<u128>,
}

impl MftTree {
    /// Empty tree.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// True when the tree holds no entry.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Insert (or replace) an entry; the children index follows the new parent.
    pub fn insert(&mut self, entry: UsnEntry) {
        let frn = entry.frn;
        let parent = entry.parent_frn;
        if let Some(old) = self.nodes.insert(frn, entry)
            && let Some(siblings) = self.children.get_mut(&old.parent_frn)
        {
            siblings.retain(|c| *c != frn);
        }
        self.children.entry(parent).or_default().push(frn);
    }

    /// Look up an entry by FRN.
    #[must_use]
    pub fn get(&self, frn: u128) -> Option<&UsnEntry> {
        self.nodes.get(&frn)
    }

    /// Iterate every entry (unordered).
    pub fn iter(&self) -> impl Iterator<Item = &UsnEntry> {
        self.nodes.values()
    }

    /// Iterate the direct children of `parent_frn` (insertion order).
    pub fn children(&self, parent_frn: u128) -> impl Iterator<Item = &UsnEntry> {
        self.children.get(&parent_frn).into_iter().flatten().filter_map(|c| self.nodes.get(c))
    }

    /// True if `frn` designates the NTFS root directory (record number 5).
    #[must_use]
    pub fn is_root(frn: u128) -> bool {
        frn & RECORD_NUMBER_MASK == ROOT_RECORD_NUMBER
    }

    /// Set an explicit root id (for non-NTFS trees such as a walkdir scan).
    pub fn set_root(&mut self, frn: u128) {
        self.root = Some(frn);
    }

    /// True if `frn` is a root of this tree: the NTFS record 5, or the explicit
    /// root set by [`set_root`](Self::set_root).
    fn is_root_frn(&self, frn: u128) -> bool {
        Self::is_root(frn) || self.root == Some(frn)
    }

    /// Walk up from `frn`; returns the name components (leaf last) and whether
    /// the chain reached the root. Cycles and over-long chains count as orphans.
    fn walk(&self, frn: u128) -> Option<(Vec<&str>, bool)> {
        let mut cur = self.nodes.get(&frn)?;
        let mut parts = Vec::new();
        let mut rooted = false;
        for _ in 0..=self.nodes.len() {
            if self.is_root_frn(cur.frn) {
                rooted = true;
                break;
            }
            parts.push(cur.name.as_str());
            if self.is_root_frn(cur.parent_frn) {
                rooted = true;
                break;
            }
            match self.nodes.get(&cur.parent_frn) {
                Some(parent) => cur = parent,
                None => break,
            }
        }
        parts.reverse();
        Some((parts, rooted))
    }

    /// True when `frn` is present but its parent chain never reaches the root.
    #[must_use]
    pub fn is_orphan(&self, frn: u128) -> bool {
        self.walk(frn).is_some_and(|(_, rooted)| !rooted)
    }

    /// Resolve the full path of `frn`, joined with `\` and starting with
    /// `root_prefix` (for example `"C:"`). The root itself resolves to
    /// `"{root_prefix}\"`. Orphans (missing or cyclic ancestors) resolve under
    /// `"{root_prefix}\<orphan>"`. `None` if `frn` is unknown.
    #[must_use]
    pub fn resolve_path(&self, frn: u128, root_prefix: &str) -> Option<String> {
        let (parts, rooted) = self.walk(frn)?;
        let mut out = String::from(root_prefix);
        out.push('\\');
        if !rooted {
            out.push_str("<orphan>\\");
        }
        out.push_str(&parts.join("\\"));
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(name: &str) -> Vec<u8> {
        name.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    fn pad8(buf: &mut Vec<u8>) {
        while !buf.len().is_multiple_of(8) {
            buf.push(0);
        }
    }

    /// Build a USN_RECORD_V2 byte buffer (8-byte aligned).
    fn v2(frn: u64, parent: u64, usn: i64, attrs: u32, name: &str) -> Vec<u8> {
        let n = utf16(name);
        let mut b = Vec::new();
        b.extend_from_slice(&0u32.to_le_bytes()); // RecordLength (patched)
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&0u16.to_le_bytes());
        b.extend_from_slice(&frn.to_le_bytes());
        b.extend_from_slice(&parent.to_le_bytes());
        b.extend_from_slice(&usn.to_le_bytes());
        b.extend_from_slice(&1234i64.to_le_bytes()); // TimeStamp
        b.extend_from_slice(&0u32.to_le_bytes()); // Reason
        b.extend_from_slice(&0u32.to_le_bytes()); // SourceInfo
        b.extend_from_slice(&0u32.to_le_bytes()); // SecurityId
        b.extend_from_slice(&attrs.to_le_bytes());
        b.extend_from_slice(&u16::try_from(n.len()).unwrap().to_le_bytes());
        b.extend_from_slice(&60u16.to_le_bytes());
        b.extend_from_slice(&n);
        pad8(&mut b);
        let len = u32::try_from(b.len()).unwrap();
        b[..4].copy_from_slice(&len.to_le_bytes());
        b
    }

    /// Build a USN_RECORD_V3 byte buffer (8-byte aligned).
    fn v3(frn: u128, parent: u128, usn: i64, attrs: u32, name: &str) -> Vec<u8> {
        let n = utf16(name);
        let mut b = Vec::new();
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&3u16.to_le_bytes());
        b.extend_from_slice(&0u16.to_le_bytes());
        b.extend_from_slice(&frn.to_le_bytes());
        b.extend_from_slice(&parent.to_le_bytes());
        b.extend_from_slice(&usn.to_le_bytes());
        b.extend_from_slice(&99i64.to_le_bytes()); // TimeStamp
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&attrs.to_le_bytes());
        b.extend_from_slice(&u16::try_from(n.len()).unwrap().to_le_bytes());
        b.extend_from_slice(&76u16.to_le_bytes());
        b.extend_from_slice(&n);
        pad8(&mut b);
        let len = u32::try_from(b.len()).unwrap();
        b[..4].copy_from_slice(&len.to_le_bytes());
        b
    }

    fn entry(frn: u128, parent: u128, name: &str, attrs: u32) -> UsnEntry {
        UsnEntry {
            frn,
            parent_frn: parent,
            name: name.to_owned(),
            attributes: attrs,
            usn: 0,
            timestamp: 0,
        }
    }

    #[test]
    fn decodes_v2_fields_and_length() {
        let buf = v2(0x0001_0000_0000_002A, 5, 777, ATTR_HIDDEN | ATTR_SYSTEM, "pagefile.sys");
        let (e, used) = parse_usn_record(&buf).expect("v2");
        assert_eq!(used, buf.len());
        assert_eq!(e.frn, 0x0001_0000_0000_002A);
        assert_eq!(e.parent_frn, 5);
        assert_eq!(e.usn, 777);
        assert_eq!(e.timestamp, 1234);
        assert_eq!(e.name, "pagefile.sys");
        assert!(e.is_hidden() && e.is_system() && !e.is_dir());
    }

    #[test]
    fn decodes_v3_128bit_ids_and_non_ascii_name() {
        let frn = (0xDEAD_BEEFu128 << 64) | 0x1234;
        let parent = (0xCAFEu128 << 64) | 5;
        let buf = v3(frn, parent, -5, ATTR_DIRECTORY, "Données été");
        let (e, used) = parse_usn_record(&buf).expect("v3");
        assert_eq!(used, buf.len());
        assert_eq!((e.frn, e.parent_frn, e.usn, e.timestamp), (frn, parent, -5, 99));
        assert_eq!(e.name, "Données été");
        assert!(e.is_dir() && !e.is_hidden() && !e.is_system());
    }

    #[test]
    fn iterates_packed_mixed_buffer() {
        let mut buf = v2(10, 5, 1, 0, "a.txt");
        buf.extend(v3(11, 5, 2, ATTR_DIRECTORY, "dir"));
        buf.extend(v2(12, 11, 3, 0, "b"));
        let mut rest = buf.as_slice();
        let mut names = Vec::new();
        while !rest.is_empty() {
            let (e, used) = parse_usn_record(rest).expect("record");
            names.push(e.name);
            rest = &rest[used..];
        }
        assert_eq!(names, ["a.txt", "dir", "b"]);
    }

    #[test]
    fn rejects_malformed_records() {
        let good = v2(10, 5, 1, 0, "a.txt");
        assert!(parse_usn_record(&good[..good.len() - 8]).is_none()); // truncated
        assert!(parse_usn_record(&[0u8; 4]).is_none());
        let mut bad_ver = good.clone();
        bad_ver[4] = 4;
        assert!(parse_usn_record(&bad_ver).is_none());
        let mut bad_off = good;
        bad_off[58] = 0xF0; // name offset beyond the record
        assert!(parse_usn_record(&bad_off).is_none());
    }

    #[test]
    fn resolves_paths_on_small_tree() {
        let root = 0x0005_0000_0000_0005u128; // sequence bits set, record number 5
        let mut t = MftTree::new();
        t.insert(entry(30, 20, "file.txt", 0));
        t.insert(entry(20, root, "Users", ATTR_DIRECTORY));
        t.insert(entry(21, 20, "me", ATTR_DIRECTORY));
        t.insert(entry(31, 21, "notes.md", ATTR_HIDDEN));
        assert_eq!(t.len(), 4);
        assert_eq!(t.resolve_path(20, "C:").as_deref(), Some("C:\\Users"));
        assert_eq!(t.resolve_path(30, "C:").as_deref(), Some("C:\\Users\\file.txt"));
        assert_eq!(t.resolve_path(31, "C:").as_deref(), Some("C:\\Users\\me\\notes.md"));
        assert!(!t.is_orphan(31));
        assert_eq!(t.resolve_path(999, "C:"), None);
        let mut kids: Vec<&str> = t.children(20).map(|e| e.name.as_str()).collect();
        kids.sort_unstable();
        assert_eq!(kids, ["file.txt", "me"]);
        assert_eq!(t.children(root).count(), 1);
    }

    #[test]
    fn handles_root_orphans_and_cycles() {
        let mut t = MftTree::new();
        t.insert(entry(5, 5, ".", ATTR_DIRECTORY));
        assert_eq!(t.resolve_path(5, "C:").as_deref(), Some("C:\\"));
        t.insert(entry(40, 777, "lost.bin", 0)); // parent 777 missing
        assert!(t.is_orphan(40));
        assert_eq!(t.resolve_path(40, "C:").as_deref(), Some("C:\\<orphan>\\lost.bin"));
        t.insert(entry(50, 51, "x", ATTR_DIRECTORY)); // 50 <-> 51 cycle
        t.insert(entry(51, 50, "y", ATTR_DIRECTORY));
        assert!(t.is_orphan(50));
        assert!(t.resolve_path(50, "C:").is_some());
    }

    #[test]
    fn reinsert_moves_entry_between_parents() {
        let mut t = MftTree::new();
        t.insert(entry(20, 5, "a", ATTR_DIRECTORY));
        t.insert(entry(21, 5, "b", ATTR_DIRECTORY));
        t.insert(entry(30, 20, "f", 0));
        t.insert(entry(30, 21, "f", 0));
        assert_eq!(t.children(20).count(), 0);
        assert_eq!(t.resolve_path(30, "C:").as_deref(), Some("C:\\b\\f"));
    }
}
