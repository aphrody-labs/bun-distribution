// SPDX-License-Identifier: Apache-2.0
//! Shell braces expansion inspired by Bun's `bun_shell_parser::braces`.
//!
//! Supports:
//! - Comma-separated lists: `{a,b,c}`
//! - Cartesian products: `{a,b}{1,2}` -> `a1 a2 b1 b2`
//! - Numeric ranges: `{1..5}` -> `1 2 3 4 5`
//! - Zero-padded ranges: `{01..05}` -> `01 02 03 04 05`
//! - Stepped ranges: `{1..10..2}` -> `1 3 5 7 9`
//! - Character ranges: `{a..e}` -> `a b c d e`
//! - Nested braces: `a{b,c{1,2}}` -> `ab ac1 ac2`

/// Expand shell brace expressions within a single word.
/// If no valid brace expression is found, returns a vec with the original string.
pub fn expand_braces(input: &str) -> Vec<String> {
    if !input.contains('{') || !input.contains('}') {
        return vec![input.to_string()];
    }

    expand_word(input)
}

fn expand_word(input: &str) -> Vec<String> {
    let bytes = input.as_bytes();
    let mut i = 0;
    let len = bytes.len();

    // Find the first unescaped '{'
    let mut brace_start = None;
    while i < len {
        if bytes[i] == b'\\' && i + 1 < len {
            i += 2;
            continue;
        }
        if bytes[i] == b'{' {
            brace_start = Some(i);
            break;
        }
        i += 1;
    }

    let start = match brace_start {
        Some(s) => s,
        None => return vec![unescape_braces(input)],
    };

    // Find matching '}' taking nesting into account
    let mut depth = 0;
    let mut brace_end = None;
    let mut j = start;
    while j < len {
        if bytes[j] == b'\\' && j + 1 < len {
            j += 2;
            continue;
        }
        if bytes[j] == b'{' {
            depth += 1;
        } else if bytes[j] == b'}' {
            depth -= 1;
            if depth == 0 {
                brace_end = Some(j);
                break;
            }
        }
        j += 1;
    }

    let end = match brace_end {
        Some(e) => e,
        None => return vec![unescape_braces(input)],
    };

    let prefix = &input[..start];
    let body = &input[start + 1..end];
    let suffix = &input[end + 1..];

    // Try range expansion: {start..end} or {start..end..step}
    if let Some(range_items) = try_expand_range(body) {
        let mut results = Vec::new();
        for item in range_items {
            let combined = format!("{}{}{}", prefix, item, suffix);
            results.extend(expand_word(&combined));
        }
        return results;
    }

    // Try comma-separated list
    let parts = split_top_level_commas(body);
    if parts.len() > 1 {
        let mut results = Vec::new();
        for part in parts {
            let combined = format!("{}{}{}", prefix, part, suffix);
            results.extend(expand_word(&combined));
        }
        return results;
    }

    // Single item inside braces without commas or range (e.g. `{foo}`)
    // In POSIX/bash, `{foo}` expands to literally `{foo}`
    let raw_literal = format!("{{{}}}", body);
    let combined = format!("{}{}{}", prefix, raw_literal, suffix);
    vec![unescape_braces(&combined)]
}

fn try_expand_range(body: &str) -> Option<Vec<String>> {
    let parts: Vec<&str> = body.split("..").collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }

    let start_str = parts[0];
    let end_str = parts[1];
    let step: isize = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        1
    };

    if step <= 0 {
        return None;
    }

    // Numeric range
    if let (Ok(start), Ok(end)) = (start_str.parse::<isize>(), end_str.parse::<isize>()) {
        let pad_len = if start_str.starts_with('0') || end_str.starts_with('0') {
            start_str.len().max(end_str.len())
        } else {
            0
        };

        let mut out = Vec::new();
        if start <= end {
            let mut curr = start;
            while curr <= end {
                if pad_len > 0 {
                    out.push(format!("{:0width$}", curr, width = pad_len));
                } else {
                    out.push(curr.to_string());
                }
                curr += step;
            }
        } else {
            let mut curr = start;
            while curr >= end {
                if pad_len > 0 {
                    out.push(format!("{:0width$}", curr, width = pad_len));
                } else {
                    out.push(curr.to_string());
                }
                curr -= step;
            }
        }
        return Some(out);
    }

    // Character range
    if start_str.len() == 1 && end_str.len() == 1 {
        let sc = start_str.chars().next()?;
        let ec = end_str.chars().next()?;
        if sc.is_ascii_alphabetic() && ec.is_ascii_alphabetic() {
            let mut out = Vec::new();
            if sc <= ec {
                let mut curr = sc as u8;
                let end = ec as u8;
                while curr <= end {
                    out.push((curr as char).to_string());
                    if curr as isize + step > 255 {
                        break;
                    }
                    curr += step as u8;
                }
            } else {
                let mut curr = sc as u8;
                let end = ec as u8;
                while curr >= end {
                    out.push((curr as char).to_string());
                    if curr < step as u8 {
                        break;
                    }
                    curr -= step as u8;
                }
            }
            return Some(out);
        }
    }

    None
}

fn split_top_level_commas(input: &str) -> Vec<&str> {
    let bytes = input.as_bytes();
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut last = 0;
    let mut i = 0;
    let len = bytes.len();

    while i < len {
        if bytes[i] == b'\\' && i + 1 < len {
            i += 2;
            continue;
        }
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
        } else if bytes[i] == b',' && depth == 0 {
            parts.push(&input[last..i]);
            last = i + 1;
        }
        i += 1;
    }

    parts.push(&input[last..]);
    parts
}

fn unescape_braces(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&next) = chars.peek() {
                if next == '{' || next == '}' || next == ',' {
                    out.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comma_expansion() {
        assert_eq!(expand_braces("a{b,c}d"), vec!["abd", "acd"]);
        assert_eq!(expand_braces("{a,b}{1,2}"), vec!["a1", "a2", "b1", "b2"]);
    }

    #[test]
    fn test_range_expansion() {
        assert_eq!(expand_braces("{1..3}"), vec!["1", "2", "3"]);
        assert_eq!(expand_braces("{01..03}"), vec!["01", "02", "03"]);
        assert_eq!(expand_braces("{3..1}"), vec!["3", "2", "1"]);
        assert_eq!(expand_braces("{a..c}"), vec!["a", "b", "c"]);
    }

    #[test]
    fn test_nested_expansion() {
        assert_eq!(expand_braces("a{b,c{1,2}}"), vec!["ab", "ac1", "ac2"]);
    }

    #[test]
    fn test_literal_single_brace() {
        assert_eq!(expand_braces("{foo}"), vec!["{foo}"]);
    }
}
