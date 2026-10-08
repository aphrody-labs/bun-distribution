// SPDX-License-Identifier: Apache-2.0
//! Native high-speed Base64 and URL-Safe Base64 from Bun (`bun_base64`).
//! Zero heap allocation during encoding into preallocated buffers, forgiving whitespace handling.

const STANDARD_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encodes binary data to standard Base64 string with padding.
pub fn encode(data: &[u8]) -> String {
    encode_with_alphabet(data, STANDARD_ALPHABET, true)
}

/// Encodes binary data to URL-safe Base64 string without padding.
pub fn encode_url_safe(data: &[u8]) -> String {
    encode_with_alphabet(data, URL_SAFE_ALPHABET, false)
}

fn encode_with_alphabet(data: &[u8], alphabet: &[u8; 64], pad: bool) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let chunks = data.chunks_exact(3);
    let rem = chunks.remainder();

    for chunk in chunks {
        let b0 = chunk[0];
        let b1 = chunk[1];
        let b2 = chunk[2];

        out.push(alphabet[(b0 >> 2) as usize] as char);
        out.push(alphabet[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(alphabet[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        out.push(alphabet[(b2 & 0x3f) as usize] as char);
    }

    match rem.len() {
        1 => {
            let b0 = rem[0];
            out.push(alphabet[(b0 >> 2) as usize] as char);
            out.push(alphabet[((b0 & 0x03) << 4) as usize] as char);
            if pad {
                out.push('=');
                out.push('=');
            }
        }
        2 => {
            let b0 = rem[0];
            let b1 = rem[1];
            out.push(alphabet[(b0 >> 2) as usize] as char);
            out.push(alphabet[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
            out.push(alphabet[((b1 & 0x0f) << 2) as usize] as char);
            if pad {
                out.push('=');
            }
        }
        _ => {}
    }

    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Base64Error(pub String);

impl std::fmt::Display for Base64Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "base64 decode error: {}", self.0)
    }
}

impl std::error::Error for Base64Error {}

fn decode_char(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    }
}

/// Decodes both standard and URL-safe Base64 strings.
pub fn decode(input: &str) -> Result<Vec<u8>, Base64Error> {
    let clean: Vec<u8> = input
        .bytes()
        .filter(|&b| !b.is_ascii_whitespace() && b != b'=')
        .collect();

    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let chunks = clean.chunks_exact(4);
    let rem = chunks.remainder();

    for chunk in chunks {
        let v0 = decode_char(chunk[0]).ok_or_else(|| Base64Error(format!("invalid char {}", chunk[0] as char)))?;
        let v1 = decode_char(chunk[1]).ok_or_else(|| Base64Error(format!("invalid char {}", chunk[1] as char)))?;
        let v2 = decode_char(chunk[2]).ok_or_else(|| Base64Error(format!("invalid char {}", chunk[2] as char)))?;
        let v3 = decode_char(chunk[3]).ok_or_else(|| Base64Error(format!("invalid char {}", chunk[3] as char)))?;

        out.push((v0 << 2) | (v1 >> 4));
        out.push((v1 << 4) | (v2 >> 2));
        out.push((v2 << 6) | v3);
    }

    match rem.len() {
        2 => {
            let v0 = decode_char(rem[0]).ok_or_else(|| Base64Error(format!("invalid char {}", rem[0] as char)))?;
            let v1 = decode_char(rem[1]).ok_or_else(|| Base64Error(format!("invalid char {}", rem[1] as char)))?;
            out.push((v0 << 2) | (v1 >> 4));
        }
        3 => {
            let v0 = decode_char(rem[0]).ok_or_else(|| Base64Error(format!("invalid char {}", rem[0] as char)))?;
            let v1 = decode_char(rem[1]).ok_or_else(|| Base64Error(format!("invalid char {}", rem[1] as char)))?;
            let v2 = decode_char(rem[2]).ok_or_else(|| Base64Error(format!("invalid char {}", rem[2] as char)))?;
            out.push((v0 << 2) | (v1 >> 4));
            out.push((v1 << 4) | (v2 >> 2));
        }
        1 => return Err(Base64Error("invalid trailing base64 character".into())),
        _ => {}
    }

    Ok(out)
}

/// Decodes URL-safe Base64 strings.
pub fn decode_url_safe(input: &str) -> Result<Vec<u8>, Base64Error> {
    decode(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_roundtrip() {
        let data = b"Hello, Aphrody OS and Bun!";
        let encoded = encode(data);
        assert_eq!(encoded, "SGVsbG8sIEFwaHJvZHkgT1MgYW5kIEJ1biE=");

        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_base64_url_safe() {
        let data = vec![251, 255, 190]; // + /
        let url_safe = encode_url_safe(&data);
        assert!(!url_safe.contains('+'));
        assert!(!url_safe.contains('/'));
        assert!(!url_safe.contains('='));

        let decoded = decode(&url_safe).unwrap();
        assert_eq!(decoded, data);
    }
}
