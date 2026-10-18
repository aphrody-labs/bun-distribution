// SPDX-License-Identifier: Apache-2.0
//! MSG (Message) binary format reader.
//!
//! Layout (little endian, measured on the DBXV2 `data/msg/*.msg` files):
//!
//! | Offset | Field |
//! |---|---|
//! | 0x00 | `#MSG` |
//! | 0x04 | `u16` endianness mark (`0x0100`), `u16` version (`1`) |
//! | 0x08 | `u32` table count |
//! | 0x0C | `u32` offset of the key table: one string slot per table |
//! | 0x10 | `u32` offset of the id table: one `u32` per table |
//! | 0x14 | `u32` offset of the list table: one `{line_count, lines_offset}` per table |
//! | 0x18 | `u32` total line count |
//! | 0x1C | `u32` offset of the line table (referenced by the list table) |
//!
//! A string slot is `{offset, chars, bytes, flag}` (4 x `u32`). The text is UTF-8 when
//! `bytes == chars + 1` and UTF-16LE when `bytes == chars * 2 + 2` (both include the
//! terminator); any other size is reported as `unknown` and decoded as lossy UTF-8.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const MSG_MAGIC: &[u8; 4] = b"#MSG";

/// One string slot of the file with its decoded text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgString {
    pub offset: u32,
    pub chars: u32,
    pub bytes: u32,
    pub flag: u32,
    /// `utf8`, `utf16le` or `unknown`.
    pub encoding: String,
    pub text: String,
}

/// A message table: a key name, its numeric id and its lines.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgTable {
    pub id: u32,
    pub key: MsgString,
    pub lines: Vec<MsgString>,
}

/// Flat view of a table (`name_id` = key name, `lines` = texts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgEntry {
    pub id: u32,
    pub name_id: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsgFile {
    /// Raw `u16` at 0x04.
    pub endian_mark: u16,
    /// Raw `u16` at 0x06.
    pub version: u16,
    pub tables: Vec<MsgTable>,
    pub entries: Vec<MsgEntry>,
}

fn corrupt(details: impl Into<String>) -> ReError {
    ReError::ParseError {
        context: "msg",
        details: details.into(),
    }
}

fn u32_at(b: &[u8], at: usize) -> Result<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or_else(|| corrupt(format!("read of 4 bytes at {at:#x} is past the end")))
}

fn string_at(b: &[u8], slot: usize) -> Result<MsgString> {
    let (offset, chars, bytes, flag) = (
        u32_at(b, slot)?,
        u32_at(b, slot + 4)?,
        u32_at(b, slot + 8)?,
        u32_at(b, slot + 12)?,
    );
    let raw = b
        .get(offset as usize..)
        .and_then(|rest| rest.get(..bytes as usize))
        .ok_or_else(|| corrupt(format!("string at {offset:#x} ({bytes} bytes) is out of range")))?;
    let (encoding, text) = if bytes == chars.wrapping_add(1) {
        ("utf8", String::from_utf8_lossy(&raw[..raw.len() - 1]).into_owned())
    } else if bytes == chars.wrapping_mul(2).wrapping_add(2) {
        let units: Vec<u16> = raw[..raw.len() - 2]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        ("utf16le", String::from_utf16_lossy(&units))
    } else {
        (
            "unknown",
            String::from_utf8_lossy(raw).trim_end_matches('\0').to_string(),
        )
    };
    Ok(MsgString {
        offset,
        chars,
        bytes,
        flag,
        encoding: encoding.into(),
        text,
    })
}

impl MsgFile {
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 0x20 {
            return Err(ReError::BufferTooSmall {
                required: 0x20,
                available: buffer.len(),
            });
        }
        if &buffer[0..4] != MSG_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: MSG_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }
        let endian_mark = u16::from_le_bytes([buffer[4], buffer[5]]);
        let version = u16::from_le_bytes([buffer[6], buffer[7]]);
        let count = u32_at(buffer, 8)? as usize;
        let keys = u32_at(buffer, 0x0C)? as usize;
        let ids = u32_at(buffer, 0x10)? as usize;
        let lists = u32_at(buffer, 0x14)? as usize;
        if count > buffer.len() / 4 {
            return Err(corrupt(format!("{count} tables cannot fit in the file")));
        }

        let mut tables = Vec::with_capacity(count);
        for i in 0..count {
            let id = u32_at(buffer, ids + i * 4)?;
            let key = string_at(buffer, keys + i * 16)?;
            let line_count = u32_at(buffer, lists + i * 8)? as usize;
            let lines_at = u32_at(buffer, lists + i * 8 + 4)? as usize;
            if line_count > buffer.len() / 16 {
                return Err(corrupt(format!("{line_count} lines cannot fit in the file")));
            }
            let lines = (0..line_count)
                .map(|j| string_at(buffer, lines_at + j * 16))
                .collect::<Result<Vec<_>>>()?;
            tables.push(MsgTable { id, key, lines });
        }
        let entries = tables
            .iter()
            .map(|t| MsgEntry {
                id: t.id,
                name_id: t.key.text.clone(),
                lines: t.lines.iter().map(|l| l.text.clone()).collect(),
            })
            .collect();
        Ok(Self {
            endian_mark,
            version,
            tables,
            entries,
        })
    }

    /// Builds a MSG binary in the real layout (UTF-16LE strings): table `i` has key `MSG_i`,
    /// id `i` and one line.
    pub fn create_mock(lines: &[&str]) -> Vec<u8> {
        let n = lines.len();
        let keys_at = 0x20;
        let ids_at = keys_at + n * 16;
        let lists_at = ids_at + n * 4;
        let lines_at = lists_at + n * 8;
        let strings_at = lines_at + n * 16;
        let utf16 = |s: &str| -> Vec<u8> {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .flat_map(u16::to_le_bytes)
                .collect()
        };
        let mut blob = Vec::new();
        let slot = |text: &str, flag: u32, blob: &mut Vec<u8>| -> [u8; 16] {
            let chars = text.encode_utf16().count() as u32;
            let at = (strings_at + blob.len()) as u32;
            blob.extend(utf16(text));
            let mut out = [0u8; 16];
            for (i, v) in [at, chars, chars * 2 + 2, flag].into_iter().enumerate() {
                out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
            out
        };
        let key_slots: Vec<[u8; 16]> = (0..n).map(|i| slot(&format!("MSG_{i}"), 0, &mut blob)).collect();
        let line_slots: Vec<[u8; 16]> = lines.iter().map(|l| slot(l, 0, &mut blob)).collect();

        let mut buf = Vec::new();
        buf.extend_from_slice(MSG_MAGIC);
        buf.extend_from_slice(&0x0100u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        for v in [n, keys_at, ids_at, lists_at, n, lines_at] {
            buf.extend_from_slice(&(v as u32).to_le_bytes());
        }
        buf.resize(0x20, 0);
        key_slots.iter().for_each(|s| buf.extend_from_slice(s));
        (0..n).for_each(|i| buf.extend_from_slice(&(i as u32).to_le_bytes()));
        for i in 0..n {
            buf.extend_from_slice(&1u32.to_le_bytes());
            buf.extend_from_slice(&((lines_at + i * 16) as u32).to_le_bytes());
        }
        line_slots.iter().for_each(|s| buf.extend_from_slice(s));
        buf.extend_from_slice(&blob);
        buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_msg_mock() {
        let mock = MsgFile::create_mock(&["Kamehameha", "Super Saiyan", "Spirit Bomb"]);
        let parsed = MsgFile::parse(&mock).expect("Should parse MSG mock cleanly");

        assert_eq!(parsed.entries.len(), 3);
        assert_eq!(parsed.entries[0].lines[0], "Kamehameha");
        assert_eq!(parsed.entries[1].lines[0], "Super Saiyan");
        assert_eq!(parsed.entries[2].lines[0], "Spirit Bomb");
    }

    #[test]
    fn test_invalid_magic() {
        let mut mock = MsgFile::create_mock(&["test"]);
        mock[0] = b'?';
        assert!(MsgFile::parse(&mock).is_err());
    }
}
