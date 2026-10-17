// SPDX-License-Identifier: Apache-2.0
//! Valve KeyValues (VDF): the text dialect (`appmanifest_*.acf`, `libraryfolders.vdf`,
//! `config.vdf`, `loginusers.vdf`, `remoteclients.vdf`) with a round-trip writer, the binary
//! encoding (`shortcuts.vdf`, the payload of `appinfo.vdf` / `packageinfo.vdf`) with a writer,
//! and the `appinfo.vdf` / `packageinfo.vdf` container readers.
//!
//! Pure functions over `&str` / `&[u8]`: no filesystem access, usable from `wasm32`. The Bun
//! counterpart is `packages/bun-steam/src/vdf.ts`; both parse the shared fixtures in
//! `crates/bun-steam/tests/fixtures`.

use serde::{Deserialize, Serialize};

use crate::SteamError;

// ---------------------------------------------------------------------------
// VDF / KeyValues Parser
// ---------------------------------------------------------------------------

/// A parsed Valve Data Format (VDF / KeyValues1) value node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VdfValue {
    /// String scalar value.
    Str(String),
    /// Nested Key-Value table preserving ordering and supporting repeated keys.
    Table(Vec<(String, VdfValue)>),
}

impl VdfValue {
    /// Retrieve the first child value matching a key name (case-insensitive).
    pub fn get(&self, key: &str) -> Option<&VdfValue> {
        match self {
            Self::Table(entries) => entries
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            _ => None,
        }
    }

    /// Retrieve the first child string scalar matching a key name.
    pub fn get_str(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(Self::Str(s)) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Retrieve a nested table slice matching a key name.
    pub fn get_table(&self, key: &str) -> Option<&[(String, VdfValue)]> {
        match self.get(key) {
            Some(Self::Table(entries)) => Some(entries.as_slice()),
            _ => None,
        }
    }

    /// Retrieve a child scalar parsed as an unsigned 64-bit integer.
    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.get_str(key).and_then(|s| s.parse::<u64>().ok())
    }

    /// Retrieve a child scalar parsed as a signed 64-bit integer.
    pub fn get_i64(&self, key: &str) -> Option<i64> {
        self.get_str(key).and_then(|s| s.parse::<i64>().ok())
    }

    /// Traverse a nested path of keys (e.g. `&["AppState", "UserConfig", "language"]`).
    pub fn get_path(&self, keys: &[&str]) -> Option<&VdfValue> {
        let mut cur = self;
        for &k in keys {
            cur = cur.get(k)?;
        }
        Some(cur)
    }

    /// Iterate over key-value pairs if this value is a table.
    pub fn entries(&self) -> Option<&[(String, VdfValue)]> {
        match self {
            Self::Table(entries) => Some(entries.as_slice()),
            Self::Str(_) => None,
        }
    }

    /// Render this VDF tree back into formatted KeyValues text.
    pub fn to_vdf_string(&self) -> String {
        let mut out = String::new();
        render_vdf_node(self, 0, &mut out);
        out
    }

    /// Mutable access to the first child matching `key` (case-insensitive).
    pub fn get_mut(&mut self, key: &str) -> Option<&mut VdfValue> {
        match self {
            Self::Table(entries) => entries
                .iter_mut()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Self::Str(_) => None,
        }
    }

    /// Child table `key`, created (or replacing a scalar) when absent. Returns `None` only when
    /// `self` is a scalar.
    pub fn table_mut(&mut self, key: &str) -> Option<&mut VdfValue> {
        let Self::Table(entries) = self else {
            return None;
        };
        let index = match entries
            .iter()
            .position(|(k, _)| k.eq_ignore_ascii_case(key))
        {
            Some(index) => {
                if matches!(entries[index].1, Self::Str(_)) {
                    entries[index].1 = Self::Table(Vec::new());
                }
                index
            }
            None => {
                entries.push((key.to_owned(), Self::Table(Vec::new())));
                entries.len() - 1
            }
        };
        Some(&mut entries[index].1)
    }

    /// Follows (and creates) nested tables along `keys`.
    pub fn path_mut(&mut self, keys: &[&str]) -> Option<&mut VdfValue> {
        let mut cur = self;
        for key in keys {
            cur = cur.table_mut(key)?;
        }
        Some(cur)
    }

    /// Sets `key` to `value` (replacing the first match, keeping its position and spelling).
    /// No-op when `self` is a scalar.
    pub fn set(&mut self, key: &str, value: VdfValue) {
        let Self::Table(entries) = self else { return };
        match entries
            .iter_mut()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
        {
            Some((_, slot)) => *slot = value,
            None => entries.push((key.to_owned(), value)),
        }
    }

    /// JSON view shared with the Bun parser: tables become objects (a repeated key keeps its last
    /// value), scalars become strings.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Str(s) => serde_json::Value::String(s.clone()),
            Self::Table(entries) => {
                let mut map = serde_json::Map::new();
                for (k, v) in entries {
                    map.insert(k.clone(), v.to_json());
                }
                serde_json::Value::Object(map)
            }
        }
    }

    /// Removes every child matching `key`; returns whether one existed.
    pub fn remove(&mut self, key: &str) -> bool {
        let Self::Table(entries) = self else {
            return false;
        };
        let before = entries.len();
        entries.retain(|(k, _)| !k.eq_ignore_ascii_case(key));
        entries.len() != before
    }
}

fn render_vdf_node(node: &VdfValue, indent: usize, out: &mut String) {
    let pad = "\t".repeat(indent);
    match node {
        VdfValue::Str(s) => {
            out.push('"');
            escape_into(s, out);
            out.push_str("\"\n");
        }
        VdfValue::Table(entries) => {
            for (k, v) in entries {
                out.push_str(&pad);
                out.push('"');
                escape_into(k, out);
                out.push('"');
                match v {
                    VdfValue::Str(val_str) => {
                        out.push_str("\t\t\"");
                        escape_into(val_str, out);
                        out.push_str("\"\n");
                    }
                    VdfValue::Table(_) => {
                        out.push('\n');
                        out.push_str(&pad);
                        out.push_str("{\n");
                        render_vdf_node(v, indent + 1, out);
                        out.push_str(&pad);
                        out.push_str("}\n");
                    }
                }
            }
        }
    }
}

/// Escapes like the Steam client: only backslash and double quote. Newlines and tabs stay raw
/// inside the quotes (SDL controller mappings in `config.vdf` carry raw newlines), so the output
/// is byte-identical to the client's own files and [`parse_vdf`] reads it back unchanged.
fn escape_into(value: &str, out: &mut String) {
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            other => out.push(other),
        }
    }
}

/// Token in the VDF lexical stream.
#[derive(Debug, PartialEq, Eq)]
enum VdfToken {
    String(String),
    OpenBrace,
    CloseBrace,
}

struct VdfLexer<'a> {
    chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    input: &'a str,
    line: usize,
    col: usize,
}

impl<'a> VdfLexer<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            chars: input.char_indices().peekable(),
            input,
            line: 1,
            col: 1,
        }
    }

    fn next_token(&mut self) -> Result<Option<(VdfToken, usize, usize)>, SteamError> {
        {
            self.skip_whitespace_and_comments()?;

            let token_line = self.line;
            let token_col = self.col;

            let Some(&(start_idx, ch)) = self.chars.peek() else {
                return Ok(None);
            };

            match ch {
                '{' => {
                    self.bump();
                    Ok(Some((VdfToken::OpenBrace, token_line, token_col)))
                }
                '}' => {
                    self.bump();
                    Ok(Some((VdfToken::CloseBrace, token_line, token_col)))
                }
                '"' => {
                    // Quoted string
                    self.bump(); // consume opening quote
                    let mut s = String::new();
                    let mut escaped = false;

                    while let Some((_, c)) = self.bump() {
                        if escaped {
                            match c {
                                'n' => s.push('\n'),
                                'r' => s.push('\r'),
                                't' => s.push('\t'),
                                '\\' => s.push('\\'),
                                '"' => s.push('"'),
                                other => s.push(other),
                            }
                            escaped = false;
                        } else if c == '\\' {
                            escaped = true;
                        } else if c == '"' {
                            return Ok(Some((VdfToken::String(s), token_line, token_col)));
                        } else {
                            s.push(c);
                        }
                    }

                    Err(SteamError::VdfParse {
                        line: token_line,
                        col: token_col,
                        message: "unclosed quoted string in VDF".to_string(),
                    })
                }
                _ => {
                    // Bare / unquoted identifier
                    let mut end_idx = start_idx;
                    while let Some(&(idx, c)) = self.chars.peek() {
                        if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                            break;
                        }
                        end_idx = idx + c.len_utf8();
                        self.bump();
                    }

                    let bare = &self.input[start_idx..end_idx];
                    // `[$WIN32]`-style platform conditionals annotate the previous token.
                    if bare.starts_with('[') && bare.ends_with(']') {
                        return self.next_token();
                    }
                    Ok(Some((
                        VdfToken::String(bare.to_string()),
                        token_line,
                        token_col,
                    )))
                }
            }
        }
    }

    fn bump(&mut self) -> Option<(usize, char)> {
        let item = self.chars.next();
        if let Some((_, c)) = item {
            if c == '\n' {
                self.line += 1;
                self.col = 1;
            } else {
                self.col += 1;
            }
        }
        item
    }

    fn skip_whitespace_and_comments(&mut self) -> Result<(), SteamError> {
        loop {
            // Skip whitespace
            while let Some(&(_, c)) = self.chars.peek() {
                if c.is_whitespace() || c == '\u{feff}' {
                    self.bump();
                } else {
                    break;
                }
            }

            // Check for line comment //
            if let Some(&(idx, '/')) = self.chars.peek() {
                let rest = &self.input[idx..];
                if rest.starts_with("//") {
                    // Consume until newline
                    while let Some((_, c)) = self.bump() {
                        if c == '\n' {
                            break;
                        }
                    }
                    continue;
                }
            }

            break;
        }
        Ok(())
    }
}

/// Parse a raw Valve Data Format string into a [`VdfValue`].
pub fn parse_vdf(input: &str) -> Result<VdfValue, SteamError> {
    let mut lexer = VdfLexer::new(input);
    let mut entries = Vec::new();

    while let Some((token, line, col)) = lexer.next_token()? {
        match token {
            VdfToken::String(key) => {
                let val = parse_vdf_value(&mut lexer, line, col)?;
                entries.push((key, val));
            }
            VdfToken::CloseBrace => {
                return Err(SteamError::VdfParse {
                    line,
                    col,
                    message: "unexpected closing brace at top level".to_string(),
                });
            }
            VdfToken::OpenBrace => {
                return Err(SteamError::VdfParse {
                    line,
                    col,
                    message: "unexpected opening brace without key".to_string(),
                });
            }
        }
    }

    Ok(VdfValue::Table(entries))
}

fn parse_vdf_value(
    lexer: &mut VdfLexer<'_>,
    key_line: usize,
    key_col: usize,
) -> Result<VdfValue, SteamError> {
    let Some((token, line, col)) = lexer.next_token()? else {
        return Err(SteamError::VdfParse {
            line: key_line,
            col: key_col,
            message: "unexpected end of file after key".to_string(),
        });
    };

    match token {
        VdfToken::String(val_str) => Ok(VdfValue::Str(val_str)),
        VdfToken::OpenBrace => {
            let mut entries = Vec::new();
            while let Some((inner_token, inner_line, inner_col)) = lexer.next_token()? {
                match inner_token {
                    VdfToken::String(k) => {
                        let v = parse_vdf_value(lexer, inner_line, inner_col)?;
                        entries.push((k, v));
                    }
                    VdfToken::CloseBrace => {
                        return Ok(VdfValue::Table(entries));
                    }
                    VdfToken::OpenBrace => {
                        return Err(SteamError::VdfParse {
                            line: inner_line,
                            col: inner_col,
                            message: "unexpected opening brace inside table".to_string(),
                        });
                    }
                }
            }
            Err(SteamError::VdfParse {
                line,
                col,
                message: "unclosed table brace in VDF".to_string(),
            })
        }
        VdfToken::CloseBrace => Err(SteamError::VdfParse {
            line,
            col,
            message: "unexpected closing brace when expecting value".to_string(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Binary KeyValues
// ---------------------------------------------------------------------------

/// Binary KeyValues type tags.
pub mod bin_type {
    /// Nested object, terminated by [`END`] or [`END_ALT`].
    pub const OBJECT: u8 = 0x00;
    /// NUL-terminated UTF-8 string.
    pub const STRING: u8 = 0x01;
    /// Little-endian `i32`.
    pub const INT32: u8 = 0x02;
    /// Little-endian `f32`.
    pub const FLOAT32: u8 = 0x03;
    /// 32-bit pointer value.
    pub const POINTER: u8 = 0x04;
    /// NUL-terminated UTF-16LE string.
    pub const WSTRING: u8 = 0x05;
    /// 32-bit RGBA color.
    pub const COLOR: u8 = 0x06;
    /// Little-endian `u64`.
    pub const UINT64: u8 = 0x07;
    /// End of the current object.
    pub const END: u8 = 0x08;
    /// Little-endian `i64`.
    pub const INT64: u8 = 0x0A;
    /// Alternate end marker.
    pub const END_ALT: u8 = 0x0B;
}

/// A typed binary KeyValues node. Keeps the wire type so documents round-trip byte for byte.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum BinValue {
    /// Ordered child entries (repeated keys preserved).
    Object(Vec<(String, BinValue)>),
    /// UTF-8 string.
    String(String),
    /// Signed 32-bit integer.
    Int32(i32),
    /// 32-bit float.
    Float32(f32),
    /// 32-bit pointer.
    Pointer(i32),
    /// UTF-16 string.
    WString(String),
    /// 32-bit color.
    Color(i32),
    /// Unsigned 64-bit integer.
    UInt64(u64),
    /// Signed 64-bit integer.
    Int64(i64),
}

impl BinValue {
    /// First child matching `key` (case-insensitive).
    pub fn get(&self, key: &str) -> Option<&BinValue> {
        match self {
            Self::Object(entries) => entries
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            _ => None,
        }
    }

    /// Mutable child matching `key` (case-insensitive).
    pub fn get_mut(&mut self, key: &str) -> Option<&mut BinValue> {
        match self {
            Self::Object(entries) => entries
                .iter_mut()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            _ => None,
        }
    }

    /// Child entries when this is an object.
    pub fn entries(&self) -> Option<&[(String, BinValue)]> {
        match self {
            Self::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// String form of a scalar (`None` for objects), matching the Bun normalization.
    pub fn as_text(&self) -> Option<String> {
        Some(match self {
            Self::Object(_) => return None,
            Self::String(s) | Self::WString(s) => s.clone(),
            Self::Int32(v) | Self::Pointer(v) | Self::Color(v) => v.to_string(),
            Self::Float32(v) => v.to_string(),
            Self::UInt64(v) => v.to_string(),
            Self::Int64(v) => v.to_string(),
        })
    }

    /// Normalizes to the text-KV shape: every scalar becomes its decimal / string form.
    pub fn to_vdf(&self) -> VdfValue {
        match self {
            Self::Object(entries) => VdfValue::Table(
                entries
                    .iter()
                    .map(|(k, v)| (k.clone(), v.to_vdf()))
                    .collect(),
            ),
            scalar => VdfValue::Str(scalar.as_text().unwrap_or_default()),
        }
    }
}

/// Little-endian byte cursor over an in-memory document.
struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn err(&self, message: impl Into<String>) -> SteamError {
        SteamError::BinaryVdf {
            offset: self.pos,
            message: message.into(),
        }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], SteamError> {
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len());
        let Some(end) = end else {
            return Err(self.err("unexpected end of data"));
        };
        let out = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, SteamError> {
        Ok(self.take(1)?[0])
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], SteamError> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.take(N)?);
        Ok(out)
    }

    fn u32(&mut self) -> Result<u32, SteamError> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    fn u64(&mut self) -> Result<u64, SteamError> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    fn cstr(&mut self) -> Result<String, SteamError> {
        let rest = &self.bytes[self.pos..];
        let Some(len) = rest.iter().position(|b| *b == 0) else {
            return Err(self.err("unterminated string"));
        };
        let out = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.pos += len + 1;
        Ok(out)
    }

    fn wstr(&mut self) -> Result<String, SteamError> {
        let mut units = Vec::new();
        loop {
            let unit = u16::from_le_bytes(self.array()?);
            if unit == 0 {
                return Ok(String::from_utf16_lossy(&units));
            }
            units.push(unit);
        }
    }
}

fn read_bin_object(
    cur: &mut Cursor<'_>,
    table: Option<&[String]>,
    depth: usize,
) -> Result<BinValue, SteamError> {
    if depth > 256 {
        return Err(cur.err("binary KeyValues nested too deeply"));
    }
    let mut entries = Vec::new();
    while cur.pos < cur.bytes.len() {
        let tag = cur.u8()?;
        if tag == bin_type::END || tag == bin_type::END_ALT {
            break;
        }
        let key = match table {
            Some(table) => {
                let index = cur.u32()?;
                table
                    .get(index as usize)
                    .cloned()
                    .unwrap_or_else(|| format!("#{index}"))
            }
            None => cur.cstr()?,
        };
        let value = match tag {
            bin_type::OBJECT => read_bin_object(cur, table, depth + 1)?,
            bin_type::STRING => BinValue::String(cur.cstr()?),
            bin_type::WSTRING => BinValue::WString(cur.wstr()?),
            bin_type::INT32 => BinValue::Int32(i32::from_le_bytes(cur.array()?)),
            bin_type::POINTER => BinValue::Pointer(i32::from_le_bytes(cur.array()?)),
            bin_type::COLOR => BinValue::Color(i32::from_le_bytes(cur.array()?)),
            bin_type::FLOAT32 => BinValue::Float32(f32::from_le_bytes(cur.array()?)),
            bin_type::UINT64 => BinValue::UInt64(cur.u64()?),
            bin_type::INT64 => BinValue::Int64(i64::from_le_bytes(cur.array()?)),
            other => {
                return Err(cur.err(format!("unknown binary KeyValues type 0x{other:02x}")));
            }
        };
        entries.push((key, value));
    }
    Ok(BinValue::Object(entries))
}

/// Parses a binary KeyValues document (`shortcuts.vdf`, a `packageinfo.vdf` payload): the root
/// object's entries up to its end marker.
pub fn parse_binary_vdf(bytes: &[u8]) -> Result<BinValue, SteamError> {
    read_bin_object(&mut Cursor { bytes, pos: 0 }, None, 0)
}

/// Serializes the entries of an object (`BinValue::Object`) followed by the end marker: the
/// exact inverse of [`parse_binary_vdf`]. A scalar root yields an empty document.
pub fn write_binary_vdf(root: &BinValue) -> Vec<u8> {
    let mut out = Vec::new();
    if let BinValue::Object(entries) = root {
        write_bin_entries(entries, &mut out);
    }
    out.push(bin_type::END);
    out
}

fn write_cstr(s: &str, out: &mut Vec<u8>) {
    out.extend(s.bytes().filter(|b| *b != 0));
    out.push(0);
}

fn write_bin_entries(entries: &[(String, BinValue)], out: &mut Vec<u8>) {
    for (key, value) in entries {
        let tag = match value {
            BinValue::Object(_) => bin_type::OBJECT,
            BinValue::String(_) => bin_type::STRING,
            BinValue::Int32(_) => bin_type::INT32,
            BinValue::Float32(_) => bin_type::FLOAT32,
            BinValue::Pointer(_) => bin_type::POINTER,
            BinValue::WString(_) => bin_type::WSTRING,
            BinValue::Color(_) => bin_type::COLOR,
            BinValue::UInt64(_) => bin_type::UINT64,
            BinValue::Int64(_) => bin_type::INT64,
        };
        out.push(tag);
        write_cstr(key, out);
        match value {
            BinValue::Object(children) => {
                write_bin_entries(children, out);
                out.push(bin_type::END);
            }
            BinValue::String(s) => write_cstr(s, out),
            BinValue::WString(s) => {
                for unit in s.encode_utf16().filter(|u| *u != 0) {
                    out.extend_from_slice(&unit.to_le_bytes());
                }
                out.extend_from_slice(&[0, 0]);
            }
            BinValue::Int32(v) | BinValue::Pointer(v) | BinValue::Color(v) => {
                out.extend_from_slice(&v.to_le_bytes());
            }
            BinValue::Float32(v) => out.extend_from_slice(&v.to_le_bytes()),
            BinValue::UInt64(v) => out.extend_from_slice(&v.to_le_bytes()),
            BinValue::Int64(v) => out.extend_from_slice(&v.to_le_bytes()),
        }
    }
}

// ---------------------------------------------------------------------------
// appinfo.vdf / packageinfo.vdf
// ---------------------------------------------------------------------------

/// `appcache/appinfo.vdf` magics (format versions 39, 40, 41).
pub mod appinfo_magic {
    /// v39.
    pub const V39: u32 = 0x0756_4427;
    /// v40: adds the binary-KV SHA-1.
    pub const V40: u32 = 0x0756_4428;
    /// v41: keys are indices into a trailing string table.
    pub const V41: u32 = 0x0756_4429;
}

/// `appcache/packageinfo.vdf` magics.
pub mod packageinfo_magic {
    /// v39.
    pub const V39: u32 = 0x0656_5527;
    /// v40: adds the PICS token.
    pub const V40: u32 = 0x0656_5528;
}

/// One app record of `appinfo.vdf`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppInfoEntry {
    /// App id.
    pub app_id: u32,
    /// Record size in bytes after the size field.
    pub size: u32,
    /// PICS info state.
    pub info_state: u32,
    /// Unix time of the last update.
    pub last_updated: u32,
    /// PICS access token (public app metadata, not an account secret).
    pub pics_token: u64,
    /// SHA-1 of the text KeyValues, lowercase hex.
    pub sha1: String,
    /// PICS change number.
    pub change_number: u32,
    /// SHA-1 of the binary KeyValues (v40+), lowercase hex.
    pub binary_sha1: Option<String>,
    /// App KeyValues; `None` when the payload failed to parse.
    pub kv: Option<BinValue>,
}

/// A parsed `appinfo.vdf`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppInfoFile {
    /// Magic (see [`appinfo_magic`]).
    pub version: u32,
    /// Steam universe.
    pub universe: u32,
    /// App records in file order.
    pub apps: Vec<AppInfoEntry>,
    /// Number of strings in the v41 string table (0 before v41).
    pub string_table: usize,
}

fn hex_lower(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[usize::from(b >> 4)] as char);
        out.push(DIGITS[usize::from(b & 0x0f)] as char);
    }
    out
}

fn read_app_entry(
    cur: &mut Cursor<'_>,
    app_id: u32,
    version: u32,
    end: usize,
    table: Option<&[String]>,
) -> Result<AppInfoEntry, SteamError> {
    let size = cur.u32()?;
    let entry_end = cur.pos.saturating_add(size as usize).min(end);
    let info_state = cur.u32()?;
    let last_updated = cur.u32()?;
    let pics_token = cur.u64()?;
    let sha1 = hex_lower(cur.take(20)?);
    let change_number = cur.u32()?;
    let binary_sha1 = if version >= appinfo_magic::V40 {
        Some(hex_lower(cur.take(20)?))
    } else {
        None
    };
    let kv = read_bin_object(cur, table, 0).ok();
    cur.pos = entry_end;
    Ok(AppInfoEntry {
        app_id,
        size,
        info_state,
        last_updated,
        pics_token,
        sha1,
        change_number,
        binary_sha1,
        kv,
    })
}

/// Parses `appinfo.vdf` v39/v40/v41. A corrupt tail stops the scan and keeps earlier apps; a
/// corrupt app payload yields `kv: None` for that app only.
pub fn parse_appinfo(bytes: &[u8]) -> Result<AppInfoFile, SteamError> {
    let mut cur = Cursor { bytes, pos: 0 };
    let version = cur.u32()?;
    if !matches!(
        version,
        appinfo_magic::V39 | appinfo_magic::V40 | appinfo_magic::V41
    ) {
        return Err(cur.err(format!("appinfo.vdf: unknown magic 0x{version:08x}")));
    }
    let universe = cur.u32()?;
    let mut table: Option<Vec<String>> = None;
    let mut end = bytes.len();
    if version == appinfo_magic::V41 {
        let offset = usize::try_from(cur.u64()?)
            .unwrap_or(usize::MAX)
            .min(bytes.len());
        let mut tc = Cursor { bytes, pos: offset };
        let count = tc.u32()?;
        let mut strings = Vec::with_capacity((count as usize).min(1 << 20));
        for _ in 0..count {
            strings.push(tc.cstr()?);
        }
        table = Some(strings);
        end = offset;
    }
    let mut apps = Vec::new();
    while cur.pos + 4 <= end {
        let Ok(app_id) = cur.u32() else { break };
        if app_id == 0 {
            break;
        }
        match read_app_entry(&mut cur, app_id, version, end, table.as_deref()) {
            Ok(entry) => apps.push(entry),
            Err(_) => break,
        }
    }
    Ok(AppInfoFile {
        version,
        universe,
        apps,
        string_table: table.as_ref().map_or(0, Vec::len),
    })
}

/// One package record of `packageinfo.vdf`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackageInfoEntry {
    /// Package id.
    pub package_id: u32,
    /// SHA-1, lowercase hex.
    pub sha1: String,
    /// PICS change number.
    pub change_number: u32,
    /// PICS token (v40).
    pub token: Option<u64>,
    /// Package KeyValues.
    pub kv: BinValue,
}

/// A parsed `packageinfo.vdf`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackageInfoFile {
    /// Magic (see [`packageinfo_magic`]).
    pub version: u32,
    /// Steam universe.
    pub universe: u32,
    /// Package records in file order.
    pub packages: Vec<PackageInfoEntry>,
}

/// Parses `packageinfo.vdf` v39/v40.
pub fn parse_packageinfo(bytes: &[u8]) -> Result<PackageInfoFile, SteamError> {
    let mut cur = Cursor { bytes, pos: 0 };
    let version = cur.u32()?;
    if !matches!(version, packageinfo_magic::V39 | packageinfo_magic::V40) {
        return Err(cur.err(format!("packageinfo.vdf: unknown magic 0x{version:08x}")));
    }
    let universe = cur.u32()?;
    let mut packages = Vec::new();
    while cur.bytes.len() - cur.pos >= 4 {
        let package_id = cur.u32()?;
        if package_id == u32::MAX {
            break;
        }
        let sha1 = hex_lower(cur.take(20)?);
        let change_number = cur.u32()?;
        let token = if version == packageinfo_magic::V40 {
            Some(cur.u64()?)
        } else {
            None
        };
        let kv = read_bin_object(&mut cur, None, 0)?;
        packages.push(PackageInfoEntry {
            package_id,
            sha1,
            change_number,
            token,
            kv,
        });
    }
    Ok(PackageInfoFile {
        version,
        universe,
        packages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vdf_libraryfolders_parsing() {
        let vdf_text = r#"
        "libraryfolders"
        {
            "0"
            {
                "path"         "/home/user/.local/share/Steam"
                "label"        ""
                "contentid"    "123456789"
                "totalsize"    "500000000000"
                "apps"
                {
                    "730"      "35000000000"
                    "570"      "45000000000"
                }
            }
            "1"
            {
                "path"         "/mnt/games/SteamLibrary"
                "label"        "GamesSSD"
                "totalsize"    "1000000000000"
                "apps"
                {
                    "1091500"  "75000000000"
                }
            }
        }
        "#;

        let parsed = parse_vdf(vdf_text).expect("libraryfolders should parse");
        let root = parsed.get("libraryfolders").expect("libraryfolders table");

        let lib0 = root.get("0").expect("folder 0");
        assert_eq!(lib0.get_str("path"), Some("/home/user/.local/share/Steam"));
        assert_eq!(lib0.get_u64("totalsize"), Some(500000000000));

        let lib1 = root.get("1").expect("folder 1");
        assert_eq!(lib1.get_str("path"), Some("/mnt/games/SteamLibrary"));
        assert_eq!(lib1.get_str("label"), Some("GamesSSD"));
    }

    #[test]
    fn test_vdf_parser_comments_and_escapes() {
        let vdf_text = r#"
        // Top-level comment
        "RootNode"
        {
            // Comment inside block
            "quoted_key"    "quoted \"escaped\" value\nwith newline"
            bare_key        bare_value // inline comment
            "path_key"      "C:\\Program Files (x86)\\Steam"
        }
        "#;

        let parsed = parse_vdf(vdf_text).expect("parse with comments and escapes");
        let root = parsed.get("RootNode").expect("RootNode");

        assert_eq!(
            root.get_str("quoted_key"),
            Some("quoted \"escaped\" value\nwith newline")
        );
        assert_eq!(root.get_str("bare_key"), Some("bare_value"));
        assert_eq!(
            root.get_str("path_key"),
            Some("C:\\Program Files (x86)\\Steam")
        );
    }

    #[test]
    fn test_vdf_error_reporting() {
        let unclosed_quote = "\"AppState\" { \"name\" \"unclosed string }";
        assert!(matches!(
            parse_vdf(unclosed_quote),
            Err(SteamError::VdfParse { .. })
        ));

        let unexpected_brace = "}";
        assert!(matches!(
            parse_vdf(unexpected_brace),
            Err(SteamError::VdfParse { .. })
        ));
    }
}

#[cfg(test)]
mod round_trip_tests {
    use super::*;

    #[test]
    fn text_writer_round_trips_escapes() {
        let doc = VdfValue::Table(vec![(
            "Root".into(),
            VdfValue::Table(vec![
                (
                    "path".into(),
                    VdfValue::Str("C:\\Program Files (x86)\\Steam".into()),
                ),
                ("quote".into(), VdfValue::Str("say \"hi\"\n\tbye".into())),
                (
                    "nested".into(),
                    VdfValue::Table(vec![("k".into(), VdfValue::Str(String::new()))]),
                ),
            ]),
        )]);
        let text = doc.to_vdf_string();
        assert_eq!(parse_vdf(&text).unwrap(), doc);
    }

    #[test]
    fn text_parser_skips_bom_and_conditionals() {
        let doc =
            parse_vdf("\u{feff}\"a\" { \"b\" \"1\" [$WIN32] \"c\" \"2\" [$!WIN32] }").unwrap();
        assert_eq!(doc.get_path(&["a", "b"]), Some(&VdfValue::Str("1".into())));
        assert_eq!(doc.get_path(&["a", "c"]), Some(&VdfValue::Str("2".into())));
    }

    #[test]
    fn binary_round_trip_every_type() {
        let doc = BinValue::Object(vec![(
            "root".into(),
            BinValue::Object(vec![
                ("s".into(), BinValue::String("héllo".into())),
                ("i".into(), BinValue::Int32(-5)),
                ("f".into(), BinValue::Float32(1.5)),
                ("p".into(), BinValue::Pointer(7)),
                ("w".into(), BinValue::WString("wide é".into())),
                ("c".into(), BinValue::Color(0x00ff_00ff)),
                ("u".into(), BinValue::UInt64(u64::MAX)),
                ("l".into(), BinValue::Int64(-9_000_000_000)),
            ]),
        )]);
        let bytes = write_binary_vdf(&doc);
        assert_eq!(parse_binary_vdf(&bytes).unwrap(), doc);
        assert_eq!(
            doc.to_vdf().get_path(&["root", "u"]),
            Some(&VdfValue::Str(u64::MAX.to_string()))
        );
    }

    #[test]
    fn appinfo_v41_string_table() {
        // One app (id 10) whose KV is { "common" { "name" "Game" } } with keys from the table.
        let mut kv = vec![bin_type::OBJECT];
        kv.extend_from_slice(&0u32.to_le_bytes());
        kv.push(bin_type::STRING);
        kv.extend_from_slice(&1u32.to_le_bytes());
        kv.extend_from_slice(b"Game\0");
        kv.extend_from_slice(&[bin_type::END, bin_type::END]);
        let mut record = Vec::new();
        record.extend_from_slice(&1u32.to_le_bytes()); // info_state
        record.extend_from_slice(&2u32.to_le_bytes()); // last_updated
        record.extend_from_slice(&3u64.to_le_bytes()); // pics token
        record.extend_from_slice(&[0xab; 20]);
        record.extend_from_slice(&4u32.to_le_bytes()); // change number
        record.extend_from_slice(&[0xcd; 20]);
        record.extend_from_slice(&kv);
        let mut body = Vec::new();
        body.extend_from_slice(&10u32.to_le_bytes());
        body.extend_from_slice(&u32::try_from(record.len()).unwrap().to_le_bytes());
        body.extend_from_slice(&record);
        body.extend_from_slice(&0u32.to_le_bytes());
        let table_offset = 16 + body.len();
        let mut file = Vec::new();
        file.extend_from_slice(&appinfo_magic::V41.to_le_bytes());
        file.extend_from_slice(&1u32.to_le_bytes());
        file.extend_from_slice(&(table_offset as u64).to_le_bytes());
        file.extend_from_slice(&body);
        file.extend_from_slice(&2u32.to_le_bytes());
        file.extend_from_slice(b"common\0name\0");
        let parsed = parse_appinfo(&file).unwrap();
        assert_eq!(parsed.string_table, 2);
        assert_eq!(parsed.apps.len(), 1);
        let app = &parsed.apps[0];
        assert_eq!(app.app_id, 10);
        assert_eq!(app.sha1, "ab".repeat(20));
        let kv = app.kv.as_ref().unwrap().to_vdf();
        assert_eq!(
            kv.get_path(&["common", "name"]),
            Some(&VdfValue::Str("Game".into()))
        );
    }
}
