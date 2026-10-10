// SPDX-License-Identifier: Apache-2.0
use base64::Engine;
use regex::Regex;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceVia {
    Raw,
    Packer,
    Base64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceLayer {
    pub text: String,
    pub depth: usize,
    pub via: SourceVia,
}

fn packer_call(source: &str) -> Option<(String, usize, usize, Vec<String>)> {
    let regex = Regex::new(r#"\}\s*\(\s*(['"])([\s\S]*?)(['"])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)(['"])\s*\.split\((['"])\|(['"])\)"#).ok()?;
    let caps = regex.captures(source)?;
    if caps.get(1)?.as_str() != caps.get(3)?.as_str()
        || caps.get(6)?.as_str() != caps.get(8)?.as_str()
        || caps.get(9)?.as_str() != caps.get(10)?.as_str()
    {
        return None;
    }
    let payload = caps.get(2)?.as_str().to_string();
    let radix = caps.get(4)?.as_str().parse().ok()?;
    let count = caps.get(5)?.as_str().parse().ok()?;
    let dictionary = caps.get(7)?.as_str().split('|').map(str::to_string).collect();
    Some((payload, radix, count, dictionary))
}

fn base_encode(mut value: usize, radix: usize) -> String {
    let mut encoded = String::new();
    loop {
        let digit = value % radix;
        let character = if digit > 35 {
            char::from_u32((digit + 29) as u32).unwrap_or('?')
        } else {
            char::from_digit(digit as u32, 36).unwrap_or('?')
        };
        encoded.insert(0, character);
        value /= radix;
        if value == 0 {
            break;
        }
    }
    encoded
}

pub fn is_packed(source: &str) -> bool {
    packer_call(source).is_some()
}

pub fn unpack_packer(source: &str) -> String {
    let Some((mut payload, radix, count, dictionary)) = packer_call(source) else {
        return source.to_string();
    };
    if !(2..=62).contains(&radix) || count > 4096 || payload.len() > 2_000_000 {
        return source.to_string();
    }
    payload = payload
        .replace("\\'", "'")
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
        .replace("\\n", "\n");
    for index in (0..count).rev() {
        let Some(word) = dictionary.get(index) else { continue };
        if word.is_empty() {
            continue;
        }
        let token = base_encode(index, radix);
        let Ok(regex) = Regex::new(&format!(r"\b{}\b", regex::escape(&token))) else { continue };
        payload = regex.replace_all(&payload, regex::NoExpand(word)).into_owned();
    }
    payload
}

pub fn decode_base64_payloads(source: &str) -> Vec<String> {
    let Ok(regex) = Regex::new(r#"atob\(\s*['"]([A-Za-z0-9+/=]{24,})['"]\s*\)"#) else {
        return Vec::new();
    };
    regex
        .captures_iter(source)
        .filter_map(|caps| {
            let raw = caps.get(1)?.as_str();
            let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
            let text = String::from_utf8(bytes).ok()?;
            text.bytes().all(|b| matches!(b, 9 | 10 | 13 | 32..=126)).then_some(text)
        })
        .collect()
}

pub fn unescape_urls(source: &str) -> String {
    source
        .replace("\\/", "/")
        .replace("\\u002f", "/")
        .replace("\\u002F", "/")
        .replace("\\u003a", ":")
        .replace("\\u003A", ":")
}

pub fn peel_layers(source: &str, max_depth: usize) -> Vec<SourceLayer> {
    let mut layers = vec![SourceLayer { text: source.to_string(), depth: 0, via: SourceVia::Raw }];
    let mut seen = HashSet::from([source.to_string()]);
    let mut current = source.to_string();
    for depth in 1..=max_depth.min(4) {
        let unpacked = unpack_packer(&current);
        if unpacked == current || !seen.insert(unpacked.clone()) {
            break;
        }
        layers.push(SourceLayer { text: unpacked.clone(), depth, via: SourceVia::Packer });
        current = unpacked;
    }
    for layer in layers.clone() {
        for decoded in decode_base64_payloads(&layer.text) {
            if seen.insert(decoded.clone()) {
                layers.push(SourceLayer {
                    text: decoded,
                    depth: layer.depth + 1,
                    via: SourceVia::Base64,
                });
            }
        }
    }
    layers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpacks_without_evaluation() {
        let packed = r#"eval(function(p,a,c,k,e,d){return p}('0.1({2:"3"})',4,4,'jwplayer|setup|file|https://c.test/a.m3u8'.split('|')))"#;
        assert!(is_packed(packed));
        assert_eq!(unpack_packer(packed), r#"jwplayer.setup({file:"https://c.test/a.m3u8"})"#);
        assert_eq!(peel_layers(packed, 4)[1].via, SourceVia::Packer);
    }

    #[test]
    fn base64_payload_and_escaping() {
        assert_eq!(
            decode_base64_payloads("atob('aHR0cHM6Ly9jLnRlc3QvYS5tM3U4')"),
            ["https://c.test/a.m3u8"]
        );
        assert_eq!(unescape_urls(r"https:\/\/c.test\/a.m3u8"), "https://c.test/a.m3u8");
    }
}
