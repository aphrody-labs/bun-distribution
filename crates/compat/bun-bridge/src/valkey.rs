// SPDX-License-Identifier: Apache-2.0
//! Native Valkey / Redis RESP2 and RESP3 Serialization Protocol parser from Bun (`bun_valkey`).
//! Enables ultra-fast in-memory and socket caching, key-value storage, and vector store interfacing
//! without heavy external client dependencies.

use std::fmt;

/// RESP Data Types.
#[derive(Debug, Clone, PartialEq)]
pub enum RespValue {
    /// `+string\r\n`
    SimpleString(String),
    /// `-error message\r\n`
    Error(String),
    /// `:1000\r\n`
    Integer(i64),
    /// `$4\r\ntest\r\n`
    BulkString(Option<Vec<u8>>),
    /// `*2\r\n...`
    Array(Option<Vec<RespValue>>),
    /// `_` (RESP3 Null)
    Null,
    /// `#t\r\n` or `#f\r\n` (RESP3 Boolean)
    Boolean(bool),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RespError {
    Incomplete,
    InvalidProtocol(String),
}

impl fmt::Display for RespError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Incomplete => write!(f, "incomplete RESP buffer"),
            Self::InvalidProtocol(msg) => write!(f, "invalid RESP protocol: {msg}"),
        }
    }
}

impl std::error::Error for RespError {}

/// Formats a Redis/Valkey command as a RESP array of bulk strings.
/// (e.g. `["SET", "mykey", "hello"]` -> `*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$5\r\nhello\r\n`).
pub fn encode_command<S: AsRef<str>>(args: &[S]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(format!("*{}\r\n", args.len()).as_bytes());
    for arg in args {
        let b = arg.as_ref().as_bytes();
        out.extend_from_slice(format!("${}\r\n", b.len()).as_bytes());
        out.extend_from_slice(b);
        out.extend_from_slice(b"\r\n");
    }
    out
}

/// Parses a single RESP frame from a byte buffer.
/// Returns the parsed `RespValue` and the number of consumed bytes.
pub fn parse_resp(buf: &[u8]) -> Result<(RespValue, usize), RespError> {
    if buf.is_empty() {
        return Err(RespError::Incomplete);
    }

    match buf[0] {
        b'+' => {
            // Simple string: +<str>\r\n
            let line_end = find_crlf(&buf[1..]).ok_or(RespError::Incomplete)?;
            let text = String::from_utf8_lossy(&buf[1..1 + line_end]).to_string();
            Ok((RespValue::SimpleString(text), 1 + line_end + 2))
        }
        b'-' => {
            // Error: -<msg>\r\n
            let line_end = find_crlf(&buf[1..]).ok_or(RespError::Incomplete)?;
            let text = String::from_utf8_lossy(&buf[1..1 + line_end]).to_string();
            Ok((RespValue::Error(text), 1 + line_end + 2))
        }
        b':' => {
            // Integer: :<num>\r\n
            let line_end = find_crlf(&buf[1..]).ok_or(RespError::Incomplete)?;
            let text = std::str::from_utf8(&buf[1..1 + line_end])
                .map_err(|e| RespError::InvalidProtocol(e.to_string()))?;
            let num: i64 = text.parse().map_err(|e: std::num::ParseIntError| {
                RespError::InvalidProtocol(e.to_string())
            })?;
            Ok((RespValue::Integer(num), 1 + line_end + 2))
        }
        b'$' => {
            // Bulk String: $<len>\r\n<data>\r\n
            let line_end = find_crlf(&buf[1..]).ok_or(RespError::Incomplete)?;
            let len_str = std::str::from_utf8(&buf[1..1 + line_end])
                .map_err(|e| RespError::InvalidProtocol(e.to_string()))?;
            let len: i64 = len_str
                .parse()
                .map_err(|e: std::num::ParseIntError| RespError::InvalidProtocol(e.to_string()))?;

            if len == -1 {
                // Null bulk string
                return Ok((RespValue::BulkString(None), 1 + line_end + 2));
            }
            if len < 0 {
                return Err(RespError::InvalidProtocol("negative bulk string length".into()));
            }

            let ulen = len as usize;
            let data_start = 1 + line_end + 2;
            let data_end = data_start + ulen;
            if buf.len() < data_end + 2 {
                return Err(RespError::Incomplete);
            }
            if &buf[data_end..data_end + 2] != b"\r\n" {
                return Err(RespError::InvalidProtocol("missing CRLF after bulk string".into()));
            }

            let data = buf[data_start..data_end].to_vec();
            Ok((RespValue::BulkString(Some(data)), data_end + 2))
        }
        b'*' => {
            // Array: *<len>\r\n<elem1>...<elemN>
            let line_end = find_crlf(&buf[1..]).ok_or(RespError::Incomplete)?;
            let len_str = std::str::from_utf8(&buf[1..1 + line_end])
                .map_err(|e| RespError::InvalidProtocol(e.to_string()))?;
            let count: i64 = len_str
                .parse()
                .map_err(|e: std::num::ParseIntError| RespError::InvalidProtocol(e.to_string()))?;

            if count == -1 {
                return Ok((RespValue::Array(None), 1 + line_end + 2));
            }
            if count < 0 {
                return Err(RespError::InvalidProtocol("negative array length".into()));
            }

            let mut offset = 1 + line_end + 2;
            let mut items = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let (elem, consumed) = parse_resp(&buf[offset..])?;
                items.push(elem);
                offset += consumed;
            }

            Ok((RespValue::Array(Some(items)), offset))
        }
        b'_' => {
            // Null: _\r\n
            if buf.len() < 3 || &buf[1..3] != b"\r\n" {
                return Err(RespError::Incomplete);
            }
            Ok((RespValue::Null, 3))
        }
        b'#' => {
            // Boolean: #t\r\n or #f\r\n
            if buf.len() < 4 || &buf[2..4] != b"\r\n" {
                return Err(RespError::Incomplete);
            }
            let b = buf[1] == b't';
            Ok((RespValue::Boolean(b), 4))
        }
        other => Err(RespError::InvalidProtocol(format!("unknown RESP type byte: {other}"))),
    }
}

fn find_crlf(buf: &[u8]) -> Option<usize> {
    for i in 0..buf.len().saturating_sub(1) {
        if buf[i] == b'\r' && buf[i + 1] == b'\n' {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_parse_resp() {
        let cmd = encode_command(&["SET", "mykey", "hello"]);
        assert_eq!(cmd, b"*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$5\r\nhello\r\n");

        let (val, consumed) = parse_resp(&cmd).unwrap();
        assert_eq!(consumed, cmd.len());

        if let RespValue::Array(Some(arr)) = val {
            assert_eq!(arr.len(), 3);
            assert_eq!(arr[0], RespValue::BulkString(Some(b"SET".to_vec())));
            assert_eq!(arr[1], RespValue::BulkString(Some(b"mykey".to_vec())));
            assert_eq!(arr[2], RespValue::BulkString(Some(b"hello".to_vec())));
        } else {
            panic!("Expected array");
        }
    }

    #[test]
    fn test_simple_string_and_integer() {
        let s = b"+OK\r\n";
        let (val, consumed) = parse_resp(s).unwrap();
        assert_eq!(consumed, s.len());
        assert_eq!(val, RespValue::SimpleString("OK".into()));

        let num = b":42\r\n";
        let (val, consumed) = parse_resp(num).unwrap();
        assert_eq!(consumed, num.len());
        assert_eq!(val, RespValue::Integer(42));
    }
}
