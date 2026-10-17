// SPDX-License-Identifier: Apache-2.0
//! Ren'Py `RPA-2.0`/`RPA-3.0` archives. The index is a zlib-compressed Python pickle mapping
//! each name to `[(offset, length[, prefix])]`; version 3 XORs offsets and lengths with the
//! obfuscation value written in the archive header itself. A bounded pickle reader covers the
//! opcodes Ren'Py emits (protocols 0-5); it never constructs objects or calls anything.

use std::{io::Read, path::Path};

use super::{Archive, ArchiveEntry};
use crate::game::assets::{
    AssetError, AssetResult, format_err, normalize_path, source::FileSource,
};

const FORMAT: &str = "renpy-rpa";

/// Pickle value subset.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `None`.
    None,
    /// Boolean.
    Bool(bool),
    /// Integer (arbitrary-width integers are clamped to `i128`).
    Int(i128),
    /// Text.
    Str(String),
    /// Bytes (Python 2 `str` and Python 3 `bytes`).
    Bytes(Vec<u8>),
    /// List or tuple.
    List(Vec<Value>),
    /// Dictionary in insertion order.
    Dict(Vec<(Value, Value)>),
    /// Stack mark.
    Mark,
}

impl Value {
    fn as_int(&self) -> Option<i128> {
        match self {
            Self::Int(value) => Some(*value),
            Self::Bool(value) => Some(i128::from(*value)),
            _ => None,
        }
    }
    fn as_bytes(&self) -> Vec<u8> {
        match self {
            Self::Str(text) => text.as_bytes().to_vec(),
            Self::Bytes(bytes) => bytes.clone(),
            _ => Vec::new(),
        }
    }
}

fn err(details: impl Into<String>) -> AssetError {
    format_err(FORMAT, details)
}

/// Unpickle `data` (bounded: 64 MiB input, 10 M stack items).
///
/// # Errors
/// Unsupported opcodes, truncation, malformed structure.
#[allow(clippy::too_many_lines)]
pub fn unpickle(data: &[u8]) -> AssetResult<Value> {
    fn take<'a>(data: &'a [u8], pos: &mut usize, len: usize) -> AssetResult<&'a [u8]> {
        let end = pos
            .checked_add(len)
            .filter(|end| *end <= data.len())
            .ok_or_else(|| err("truncated pickle"))?;
        let slice = &data[*pos..end];
        *pos = end;
        Ok(slice)
    }
    fn uint(data: &[u8], pos: &mut usize, len: usize) -> AssetResult<u64> {
        Ok(take(data, pos, len)?
            .iter()
            .rev()
            .fold(0u64, |acc, b| (acc << 8) | u64::from(*b)))
    }
    fn line<'a>(data: &'a [u8], pos: &mut usize) -> AssetResult<&'a [u8]> {
        let rest = &data[*pos..];
        let len = rest
            .iter()
            .position(|b| *b == b'\n')
            .ok_or_else(|| err("unterminated line"))?;
        *pos += len + 1;
        Ok(&rest[..len])
    }
    fn pop_mark(stack: &mut Vec<Value>) -> AssetResult<Vec<Value>> {
        let at = stack
            .iter()
            .rposition(|v| *v == Value::Mark)
            .ok_or_else(|| err("no mark"))?;
        let items = stack.split_off(at + 1);
        stack.pop();
        Ok(items)
    }
    fn set_items(target: &mut Value, items: Vec<Value>) -> AssetResult<()> {
        let Value::Dict(dict) = target else {
            return Err(err("SETITEMS on a non-dict"));
        };
        let mut iter = items.into_iter();
        while let (Some(key), Some(value)) = (iter.next(), iter.next()) {
            dict.push((key, value));
        }
        Ok(())
    }
    fn append(target: &mut Value, items: Vec<Value>) -> AssetResult<()> {
        let Value::List(list) = target else {
            return Err(err("APPEND on a non-list"));
        };
        list.extend(items);
        Ok(())
    }

    if data.len() > 64 << 20 {
        return Err(err("pickle larger than 64 MiB"));
    }
    let mut stack: Vec<Value> = Vec::new();
    let mut memo: std::collections::HashMap<u64, Value> = std::collections::HashMap::new();
    let mut pos = 0usize;
    loop {
        if stack.len() > 10_000_000 {
            return Err(err("pickle stack overflow"));
        }
        let op = *data.get(pos).ok_or_else(|| err("pickle without STOP"))?;
        pos += 1;
        match op {
            0x80 => {
                take(data, &mut pos, 1)?;
            }
            0x95 => {
                take(data, &mut pos, 8)?;
            }
            b'.' => return stack.pop().ok_or_else(|| err("empty stack at STOP")),
            b'(' => stack.push(Value::Mark),
            b'}' => stack.push(Value::Dict(Vec::new())),
            b']' | b')' => stack.push(Value::List(Vec::new())),
            b'N' => stack.push(Value::None),
            0x88 => stack.push(Value::Bool(true)),
            0x89 => stack.push(Value::Bool(false)),
            b'J' => {
                let value = take(data, &mut pos, 4)?;
                stack.push(Value::Int(i128::from(i32::from_le_bytes(
                    value.try_into().unwrap_or_default(),
                ))));
            }
            b'K' => stack.push(Value::Int(i128::from(uint(data, &mut pos, 1)?))),
            b'M' => stack.push(Value::Int(i128::from(uint(data, &mut pos, 2)?))),
            0x8a | 0x8b => {
                let len = if op == 0x8a {
                    uint(data, &mut pos, 1)?
                } else {
                    uint(data, &mut pos, 4)?
                };
                let raw = take(data, &mut pos, usize::try_from(len).unwrap_or(usize::MAX))?;
                if raw.len() > 16 {
                    return Err(err("integer wider than 128 bits"));
                }
                let mut value: i128 = 0;
                for (shift, byte) in raw.iter().enumerate() {
                    value |= i128::from(*byte) << (8 * shift);
                }
                if raw.last().is_some_and(|b| b & 0x80 != 0) && raw.len() < 16 {
                    value -= 1i128 << (8 * raw.len());
                }
                stack.push(Value::Int(value));
            }
            b'I' | b'L' => {
                let text = String::from_utf8_lossy(line(data, &mut pos)?)
                    .trim_end_matches('L')
                    .to_string();
                match text.as_str() {
                    "00" => stack.push(Value::Bool(false)),
                    "01" => stack.push(Value::Bool(true)),
                    other => stack.push(Value::Int(other.parse().map_err(|_| err("bad INT"))?)),
                }
            }
            b'X' | 0x8c | 0x8d => {
                let len = match op {
                    b'X' => uint(data, &mut pos, 4)?,
                    0x8c => uint(data, &mut pos, 1)?,
                    _ => uint(data, &mut pos, 8)?,
                };
                let raw = take(data, &mut pos, usize::try_from(len).unwrap_or(usize::MAX))?;
                stack.push(Value::Str(String::from_utf8_lossy(raw).into_owned()));
            }
            b'T' | b'U' | b'B' | b'C' | 0x8e => {
                let len = match op {
                    b'U' | b'C' => uint(data, &mut pos, 1)?,
                    0x8e => uint(data, &mut pos, 8)?,
                    _ => uint(data, &mut pos, 4)?,
                };
                let raw = take(data, &mut pos, usize::try_from(len).unwrap_or(usize::MAX))?;
                stack.push(Value::Bytes(raw.to_vec()));
            }
            b'V' => {
                let raw = line(data, &mut pos)?;
                stack.push(Value::Str(String::from_utf8_lossy(raw).into_owned()));
            }
            b'S' => {
                let raw = line(data, &mut pos)?;
                let trimmed = raw
                    .strip_prefix(b"'")
                    .and_then(|r| r.strip_suffix(b"'"))
                    .or_else(|| raw.strip_prefix(b"\"").and_then(|r| r.strip_suffix(b"\"")))
                    .unwrap_or(raw);
                stack.push(Value::Bytes(trimmed.to_vec()));
            }
            b't' | b'l' => {
                let items = pop_mark(&mut stack)?;
                stack.push(Value::List(items));
            }
            b'd' => {
                let items = pop_mark(&mut stack)?;
                let mut dict = Value::Dict(Vec::new());
                set_items(&mut dict, items)?;
                stack.push(dict);
            }
            0x85..=0x87 => {
                let count = usize::from(op - 0x84);
                if stack.len() < count {
                    return Err(err("TUPLE underflow"));
                }
                let items = stack.split_off(stack.len() - count);
                stack.push(Value::List(items));
            }
            b's' => {
                let value = stack.pop().ok_or_else(|| err("SETITEM underflow"))?;
                let key = stack.pop().ok_or_else(|| err("SETITEM underflow"))?;
                let target = stack.last_mut().ok_or_else(|| err("SETITEM underflow"))?;
                set_items(target, vec![key, value])?;
            }
            b'u' => {
                let items = pop_mark(&mut stack)?;
                let target = stack.last_mut().ok_or_else(|| err("SETITEMS underflow"))?;
                set_items(target, items)?;
            }
            b'a' => {
                let value = stack.pop().ok_or_else(|| err("APPEND underflow"))?;
                let target = stack.last_mut().ok_or_else(|| err("APPEND underflow"))?;
                append(target, vec![value])?;
            }
            b'e' => {
                let items = pop_mark(&mut stack)?;
                let target = stack.last_mut().ok_or_else(|| err("APPENDS underflow"))?;
                append(target, items)?;
            }
            0x94 => {
                let top = stack
                    .last()
                    .cloned()
                    .ok_or_else(|| err("MEMOIZE underflow"))?;
                memo.insert(memo.len() as u64, top);
            }
            b'q' | b'r' | b'p' => {
                let key = match op {
                    b'q' => uint(data, &mut pos, 1)?,
                    b'r' => uint(data, &mut pos, 4)?,
                    _ => String::from_utf8_lossy(line(data, &mut pos)?)
                        .parse()
                        .map_err(|_| err("bad PUT"))?,
                };
                let top = stack.last().cloned().ok_or_else(|| err("PUT underflow"))?;
                memo.insert(key, top);
            }
            b'h' | b'j' | b'g' => {
                let key = match op {
                    b'h' => uint(data, &mut pos, 1)?,
                    b'j' => uint(data, &mut pos, 4)?,
                    _ => String::from_utf8_lossy(line(data, &mut pos)?)
                        .parse()
                        .map_err(|_| err("bad GET"))?,
                };
                stack.push(
                    memo.get(&key)
                        .cloned()
                        .ok_or_else(|| err("GET of an unknown memo"))?,
                );
            }
            0x30 => {
                stack.pop();
            }
            other => return Err(err(format!("unsupported pickle opcode 0x{other:02x}"))),
        }
    }
}

/// A mounted Ren'Py archive.
pub struct RpaArchive {
    label: String,
    source: FileSource,
    version: &'static str,
    /// Per entry: (offset, payload length, prefix).
    records: Vec<(u64, u64, Vec<u8>)>,
    entries: Vec<ArchiveEntry>,
}

impl RpaArchive {
    /// Open an `RPA-2.0`/`RPA-3.0` archive.
    ///
    /// # Errors
    /// Malformed header or index.
    pub fn open(path: &Path, label: String) -> AssetResult<Self> {
        let source = FileSource::open(path)?;
        let head = source.read_clamped(0, 64)?;
        let line = head.split(|b| *b == b'\n').next().unwrap_or_default();
        let fields: Vec<&str> = std::str::from_utf8(line)
            .unwrap_or_default()
            .split(' ')
            .collect();
        let (version, offset, key) = match fields.as_slice() {
            ["RPA-3.0", offset, key, ..] => (
                "3.0",
                *offset,
                i128::from(u32::from_str_radix(key, 16).map_err(|_| err("bad key field"))?),
            ),
            ["RPA-2.0", offset, ..] => ("2.0", *offset, 0),
            _ => return Err(err("unsupported RPA header")),
        };
        let offset = u64::from_str_radix(offset, 16).map_err(|_| err("bad index offset"))?;
        let packed = source.read_at(offset, source.len().saturating_sub(offset))?;
        let mut index = Vec::new();
        flate2::read::ZlibDecoder::new(packed.as_slice())
            .take(64 << 20)
            .read_to_end(&mut index)
            .map_err(|e| err(format!("index zlib: {e}")))?;
        let Value::Dict(dict) = unpickle(&index)? else {
            return Err(err("index is not a dict"));
        };
        let mut records = Vec::with_capacity(dict.len());
        let mut entries = Vec::with_capacity(dict.len());
        for (name, value) in dict {
            let name = String::from_utf8_lossy(&name.as_bytes()).into_owned();
            let Value::List(parts) = value else { continue };
            let Some(Value::List(first)) = parts.first() else {
                continue;
            };
            let start = first
                .first()
                .and_then(Value::as_int)
                .ok_or_else(|| err("missing offset"))?
                ^ key;
            let length = first
                .get(1)
                .and_then(Value::as_int)
                .ok_or_else(|| err("missing length"))?
                ^ key;
            let prefix = first.get(2).map(Value::as_bytes).unwrap_or_default();
            let start = u64::try_from(start).map_err(|_| err("negative offset"))?;
            let length = u64::try_from(length).map_err(|_| err("negative length"))?;
            let payload = length.saturating_sub(prefix.len() as u64);
            entries.push(ArchiveEntry {
                path: normalize_path(&name),
                size: length,
                stored: length,
                compression: String::new(),
                encrypted: false,
            });
            records.push((start, payload, prefix));
        }
        Ok(Self {
            label,
            source,
            version,
            records,
            entries,
        })
    }
}

impl Archive for RpaArchive {
    fn format(&self) -> &'static str {
        FORMAT
    }
    fn label(&self) -> &str {
        &self.label
    }
    fn entries(&self) -> &[ArchiveEntry] {
        &self.entries
    }
    fn read(&self, index: usize) -> AssetResult<Vec<u8>> {
        let (offset, length, prefix) = self
            .records
            .get(index)
            .ok_or_else(|| AssetError::NotFound(format!("{}#{index}", self.label)))?;
        let mut out = prefix.clone();
        out.extend(self.source.read_at(*offset, *length)?);
        Ok(out)
    }
    fn info(&self) -> serde_json::Value {
        serde_json::json!({ "version": self.version })
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn reads_an_rpa3_archive() {
        let body = b"label start:\n    \"Hello\"\n";
        let key: u32 = 0xDEAD_BEEF;
        let offset_field = 34u64;
        // Protocol 2 pickle: {u'script.rpy': [(offset ^ key, len ^ key, b'')]}
        let mut pickle = vec![0x80, 2, b'}', b'q', 0, 0x8c];
        let name = b"game/script.rpy";
        pickle.push(u8::try_from(name.len()).unwrap());
        pickle.extend(name);
        pickle.extend([b']', b'(']);
        pickle.push(0x8a);
        pickle.push(5);
        pickle.extend(&(u64::from(u32::try_from(offset_field).unwrap() ^ key)).to_le_bytes()[..5]);
        pickle.push(0x8a);
        pickle.push(5);
        pickle.extend(&(u64::from(u32::try_from(body.len()).unwrap() ^ key)).to_le_bytes()[..5]);
        pickle.extend([b'C', 0, b't', b'a', b's', b'.']);
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&pickle).unwrap();
        let packed = encoder.finish().unwrap();

        let index_offset = offset_field + body.len() as u64;
        let mut file = format!("RPA-3.0 {index_offset:016x} {key:08x}\n").into_bytes();
        assert_eq!(file.len() as u64, offset_field);
        file.extend(body);
        file.extend(&packed);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.rpa");
        std::fs::write(&path, &file).unwrap();
        let archive = RpaArchive::open(&path, "archive.rpa".into()).unwrap();
        assert_eq!(archive.entries()[0].path, "game/script.rpy");
        assert_eq!(archive.read(0).unwrap(), body);
    }
}
