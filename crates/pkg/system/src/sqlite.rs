// SPDX-License-Identifier: Apache-2.0
//! Read-only SQLite table scanner: walks a rowid table b-tree straight from the
//! database bytes (winget ships its index as a SQLite file).

use crate::{Error, Result};

#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(Vec<u8>),
    Blob(Vec<u8>),
}

impl Cell {
    pub fn text(&self) -> Option<&[u8]> {
        match self {
            Cell::Text(t) => Some(t),
            _ => None,
        }
    }

    pub fn bytes(&self) -> Option<&[u8]> {
        match self {
            Cell::Text(t) | Cell::Blob(t) => Some(t),
            _ => None,
        }
    }
}

pub struct Database<'a> {
    data: &'a [u8],
    page_size: usize,
    usable: usize,
}

fn corrupt(what: &str) -> Error {
    Error::Parse(format!("malformed SQLite database ({what})"))
}

fn be16(b: &[u8], at: usize) -> Result<usize> {
    let s = b.get(at..at + 2).ok_or_else(|| corrupt("truncated u16"))?;
    Ok(usize::from(u16::from_be_bytes([s[0], s[1]])))
}

fn be32(b: &[u8], at: usize) -> Result<u32> {
    let s = b.get(at..at + 4).ok_or_else(|| corrupt("truncated u32"))?;
    Ok(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

/// SQLite varint: 1..9 bytes, big-endian 7-bit groups, the 9th byte is a full 8 bits.
fn varint(b: &[u8], at: usize) -> Result<(u64, usize)> {
    let mut v: u64 = 0;
    for i in 0..9 {
        let byte = *b.get(at + i).ok_or_else(|| corrupt("truncated varint"))?;
        if i == 8 {
            return Ok(((v << 8) | u64::from(byte), 9));
        }
        v = (v << 7) | u64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            return Ok((v, i + 1));
        }
    }
    unreachable!()
}

impl<'a> Database<'a> {
    pub fn open(data: &'a [u8]) -> Result<Database<'a>> {
        if data.len() < 100 || !data.starts_with(b"SQLite format 3\0") {
            return Err(corrupt("bad header"));
        }
        let raw = be16(data, 16)?;
        let page_size = if raw == 1 { 65536 } else { raw };
        if page_size < 512 || !page_size.is_power_of_two() {
            return Err(corrupt("bad page size"));
        }
        let reserved = usize::from(data[20]);
        Ok(Database { data, page_size, usable: page_size - reserved })
    }

    fn page(&self, no: u32) -> Result<&'a [u8]> {
        let no = no as usize;
        if no == 0 {
            return Err(corrupt("page 0"));
        }
        let start = (no - 1) * self.page_size;
        self.data.get(start..start + self.page_size).ok_or_else(|| corrupt("page out of range"))
    }

    /// Root page and column names of a rowid table, from `sqlite_schema`.
    pub fn table(&self, name: &str) -> Result<(u32, Vec<String>)> {
        let mut found = None;
        self.scan(1, &mut |_, row| {
            if found.is_none()
                && row.first().and_then(Cell::text) == Some(b"table")
                && row
                    .get(2)
                    .and_then(Cell::text)
                    .is_some_and(|t| t.eq_ignore_ascii_case(name.as_bytes()))
            {
                let root = match row.get(3) {
                    Some(Cell::Int(n)) => *n as u32,
                    _ => 0,
                };
                let sql = row.get(4).and_then(Cell::text).unwrap_or(b"");
                found = Some((root, column_names(sql)));
            }
            Ok(())
        })?;
        found.ok_or_else(|| Error::Parse(format!("SQLite table \"{name}\" not found")))
    }

    /// Calls `f(rowid, columns)` for every row of the table rooted at `root`.
    pub fn scan(&self, root: u32, f: &mut dyn FnMut(i64, Vec<Cell>) -> Result<()>) -> Result<()> {
        self.walk(root, 0, f)
    }

    fn walk(
        &self,
        page_no: u32,
        depth: u32,
        f: &mut dyn FnMut(i64, Vec<Cell>) -> Result<()>,
    ) -> Result<()> {
        if depth > 32 {
            return Err(corrupt("b-tree too deep"));
        }
        let page = self.page(page_no)?;
        let hdr = if page_no == 1 { 100 } else { 0 };
        let kind = *page.get(hdr).ok_or_else(|| corrupt("page header"))?;
        let count = be16(page, hdr + 3)?;
        match kind {
            0x05 => {
                let ptrs = hdr + 12;
                for i in 0..count {
                    let cell = be16(page, ptrs + 2 * i)?;
                    self.walk(be32(page, cell)?, depth + 1, f)?;
                }
                self.walk(be32(page, hdr + 8)?, depth + 1, f)
            },
            0x0d => {
                let ptrs = hdr + 8;
                for i in 0..count {
                    let cell = be16(page, ptrs + 2 * i)?;
                    let (len, n1) = varint(page, cell)?;
                    let (rowid, n2) = varint(page, cell + n1)?;
                    let payload = self.payload(page, cell + n1 + n2, len as usize)?;
                    f(rowid as i64, decode_record(&payload, rowid as i64)?)?;
                }
                Ok(())
            },
            _ => Err(corrupt("not a table b-tree page")),
        }
    }

    /// Local part of a table-leaf payload plus its overflow chain.
    fn payload(&self, page: &[u8], at: usize, len: usize) -> Result<Vec<u8>> {
        let u = self.usable;
        let x = u - 35;
        let local = if len <= x {
            len
        } else {
            let m = ((u - 12) * 32 / 255) - 23;
            let k = m + ((len - m) % (u - 4));
            if k <= x { k } else { m }
        };
        let mut out = Vec::with_capacity(len);
        out.extend_from_slice(page.get(at..at + local).ok_or_else(|| corrupt("cell payload"))?);
        if local < len {
            let mut next = be32(page, at + local)?;
            let mut guard = 0usize;
            while out.len() < len {
                guard += 1;
                if next == 0 || guard > self.data.len() / self.page_size + 1 {
                    return Err(corrupt("overflow chain"));
                }
                let ov = self.page(next)?;
                next = be32(ov, 0)?;
                let take = (len - out.len()).min(u - 4);
                out.extend_from_slice(&ov[4..4 + take]);
            }
        }
        Ok(out)
    }
}

fn decode_record(p: &[u8], rowid: i64) -> Result<Vec<Cell>> {
    let (hlen, mut h) = varint(p, 0)?;
    let hlen = hlen as usize;
    let mut body = hlen;
    let mut cells = Vec::new();
    while h < hlen {
        let (st, n) = varint(p, h)?;
        h += n;
        let int = |size: usize, body: usize| -> Result<i64> {
            let s = p.get(body..body + size).ok_or_else(|| corrupt("record int"))?;
            let mut v: i64 = if s[0] & 0x80 != 0 { -1 } else { 0 };
            for &b in s {
                v = (v << 8) | i64::from(b);
            }
            Ok(v)
        };
        let (cell, size) = match st {
            0 => (Cell::Null, 0),
            1 => (Cell::Int(int(1, body)?), 1),
            2 => (Cell::Int(int(2, body)?), 2),
            3 => (Cell::Int(int(3, body)?), 3),
            4 => (Cell::Int(int(4, body)?), 4),
            5 => (Cell::Int(int(6, body)?), 6),
            6 => (Cell::Int(int(8, body)?), 8),
            7 => (Cell::Real(f64::from_bits(int(8, body)? as u64)), 8),
            8 => (Cell::Int(0), 0),
            9 => (Cell::Int(1), 0),
            10 | 11 => return Err(corrupt("reserved serial type")),
            n => {
                let size = ((n - 12) / 2) as usize;
                let bytes =
                    p.get(body..body + size).ok_or_else(|| corrupt("record blob"))?.to_vec();
                (if n % 2 == 0 { Cell::Blob(bytes) } else { Cell::Text(bytes) }, size)
            },
        };
        body += size;
        cells.push(cell);
    }
    // An `INTEGER PRIMARY KEY` column is stored as NULL and aliases the rowid.
    if let Some(first) = cells.first_mut()
        && *first == Cell::Null
    {
        *first = Cell::Int(rowid);
    }
    Ok(cells)
}

/// Column names from `CREATE TABLE x(a TEXT, [b] INT, PRIMARY KEY(a))`.
fn column_names(sql: &[u8]) -> Vec<String> {
    let Some(open) = sql.iter().position(|&c| c == b'(') else {
        return Vec::new();
    };
    let body = &sql[open + 1..];
    let mut cols = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, &c) in body.iter().enumerate() {
        match c {
            b'(' => depth += 1,
            b')' if depth == 0 => {
                push_column(&body[start..i], &mut cols);
                break;
            },
            b')' => depth -= 1,
            b',' if depth == 0 => {
                push_column(&body[start..i], &mut cols);
                start = i + 1;
            },
            _ => {},
        }
    }
    cols
}

fn push_column(def: &[u8], cols: &mut Vec<String>) {
    let def = def.trim_ascii();
    let end = def.iter().position(u8::is_ascii_whitespace).unwrap_or(def.len());
    let name = &def[..end];
    let upper = name.to_ascii_uppercase();
    if matches!(&upper[..], b"PRIMARY" | b"UNIQUE" | b"CHECK" | b"FOREIGN" | b"CONSTRAINT") {
        return;
    }
    let name = name
        .strip_prefix(b"[")
        .and_then(|n| n.strip_suffix(b"]"))
        .or_else(|| name.strip_prefix(b"\"").and_then(|n| n.strip_suffix(b"\"")))
        .or_else(|| name.strip_prefix(b"`").and_then(|n| n.strip_suffix(b"`")))
        .unwrap_or(name);
    cols.push(String::from_utf8_lossy(name).into_owned());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns() {
        let sql = b"CREATE TABLE [packages](rowid INTEGER PRIMARY KEY, [id] TEXT NOT NULL, \"name\" TEXT, `hash` BLOB, PRIMARY KEY(id))";
        assert_eq!(column_names(sql), ["rowid", "id", "name", "hash"]);
    }

    #[test]
    fn varints() {
        assert_eq!(varint(&[0x05], 0).unwrap(), (5, 1));
        assert_eq!(varint(&[0x81, 0x00], 0).unwrap(), (128, 2));
        assert!(Database::open(b"not sqlite").is_err());
    }
}
