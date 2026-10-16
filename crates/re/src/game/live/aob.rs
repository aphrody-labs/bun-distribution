// SPDX-License-Identifier: Apache-2.0
//! Array of Bytes (AOB) Pattern Matching for reverse engineering and memory analysis.

use crate::game::error::{ReError, Result};

#[derive(Debug, Clone)]
pub struct AobPattern {
    bytes: Vec<Option<u8>>,
}

impl AobPattern {
    /// Parses an IDA/Cheat Engine style signature, e.g. "48 89 5C 24 ?? 48 89 6C 24 ??".
    pub fn parse(pattern_str: &str) -> Result<Self> {
        let mut bytes = Vec::new();
        for token in pattern_str.split_whitespace() {
            if token == "?" || token == "??" {
                bytes.push(None);
            } else {
                let byte = u8::from_str_radix(token, 16).map_err(|e| ReError::ParseError {
                    context: "aob_parse",
                    details: format!("Invalid hex byte `{token}`: {e}"),
                })?;
                bytes.push(Some(byte));
            }
        }
        Ok(Self { bytes })
    }

    /// Scans a byte slice and returns the offset of the first match, if found.
    pub fn scan(&self, data: &[u8]) -> Option<usize> {
        if self.bytes.is_empty() || data.len() < self.bytes.len() {
            return None;
        }

        let max_idx = data.len() - self.bytes.len();
        for i in 0..=max_idx {
            let mut matches = true;
            for (p_idx, &expected) in self.bytes.iter().enumerate() {
                if let Some(expected_byte) = expected
                    && data[i + p_idx] != expected_byte
                {
                    matches = false;
                    break;
                }
            }
            if matches {
                return Some(i);
            }
        }
        None
    }

    /// Scans a byte slice and returns all matching offsets up to `limit`.
    pub fn scan_all(&self, data: &[u8], limit: usize) -> Vec<usize> {
        let mut results = Vec::new();
        if self.bytes.is_empty() || data.len() < self.bytes.len() {
            return results;
        }

        let max_idx = data.len() - self.bytes.len();
        for i in 0..=max_idx {
            let mut matches = true;
            for (p_idx, &expected) in self.bytes.iter().enumerate() {
                if let Some(expected_byte) = expected
                    && data[i + p_idx] != expected_byte
                {
                    matches = false;
                    break;
                }
            }
            if matches {
                results.push(i);
                if results.len() >= limit {
                    break;
                }
            }
        }
        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aob_scan() {
        let pattern = AobPattern::parse("48 89 ?? 24").expect("Valid pattern");
        let buffer = [0x90, 0x90, 0x48, 0x89, 0x5C, 0x24, 0xC3];
        let offset = pattern.scan(&buffer);
        assert_eq!(offset, Some(2));
    }
}
