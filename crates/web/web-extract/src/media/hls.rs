// SPDX-License-Identifier: Apache-2.0
use super::{MediaVariant, absolute};
use std::collections::HashMap;

pub fn is_playlist(text: &str) -> bool {
    text.trim_start().starts_with("#EXTM3U")
}

pub fn is_master_playlist(text: &str) -> bool {
    text.to_ascii_uppercase().contains("#EXT-X-STREAM-INF")
}

pub fn label_from_height(height: Option<u32>) -> Option<String> {
    height.filter(|height| *height > 0).map(|height| format!("{height}p"))
}

fn parse_attributes(line: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut remaining = line;
    while !remaining.is_empty() {
        let Some((key, value)) = remaining.split_once('=') else {
            break;
        };
        let key = key.trim().trim_start_matches(',').to_ascii_uppercase();
        if key.is_empty() {
            break;
        }
        if let Some(quoted) = value.strip_prefix('"') {
            let Some(end) = quoted.find('"') else {
                break;
            };
            result.insert(key, quoted[..end].trim().to_string());
            remaining = quoted[end + 1..].trim_start_matches(',');
        } else {
            let (parsed, rest) = value.split_once(',').unwrap_or((value, ""));
            result.insert(key, parsed.trim().to_string());
            remaining = rest;
        }
    }
    result
}

pub fn parse_master_playlist(text: &str, base_url: &str) -> Vec<MediaVariant> {
    let mut variants = Vec::new();
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let line = line.trim();
        if !line.to_ascii_uppercase().starts_with("#EXT-X-STREAM-INF:") {
            continue;
        }
        let Some((_, attrs)) = line.split_once(':') else { continue };
        let Some(uri) =
            lines.by_ref().map(str::trim).find(|line| !line.is_empty() && !line.starts_with('#'))
        else {
            continue;
        };
        let attributes = parse_attributes(attrs);
        let (width, height) = attributes
            .get("RESOLUTION")
            .and_then(|value| value.split_once('x'))
            .map(|(width, height)| (width.parse().ok(), height.parse().ok()))
            .unwrap_or((None, None));
        variants.push(MediaVariant {
            url: absolute(uri, base_url).unwrap_or_else(|| uri.to_string()),
            bandwidth: attributes.get("BANDWIDTH").and_then(|v| v.parse().ok()),
            average_bandwidth: attributes.get("AVERAGE-BANDWIDTH").and_then(|v| v.parse().ok()),
            width,
            height,
            codecs: attributes.get("CODECS").cloned(),
            frame_rate: attributes.get("FRAME-RATE").and_then(|v| v.parse().ok()),
            name: attributes.get("NAME").cloned(),
            label: label_from_height(height),
        });
    }
    variants.sort_by(|a, b| b.height.cmp(&a.height).then_with(|| b.bandwidth.cmp(&a.bandwidth)));
    let mut counts = HashMap::new();
    for variant in &variants {
        if let Some(label) = &variant.label {
            *counts.entry(label.clone()).or_insert(0usize) += 1;
        }
    }
    for variant in &mut variants {
        if let (Some(label), Some(bandwidth)) = (&variant.label, variant.bandwidth)
            && counts.get(label).copied().unwrap_or_default() > 1
        {
            variant.label =
                Some(format!("{label} ({} kbps)", (bandwidth as f64 / 1000.0).round() as u64));
        }
    }
    variants
}

pub fn playlist_duration(text: &str) -> Option<f64> {
    let mut duration = 0.0;
    let mut found = false;
    for line in text.lines() {
        if line.trim().to_ascii_uppercase().starts_with("#EXTINF:")
            && let Some((_, raw)) = line.trim().split_once(':')
            && let Ok(value) = raw.split(',').next().unwrap_or("").trim().parse::<f64>()
            && value.is_finite()
        {
            duration += value;
            found = true;
        }
    }
    found.then(|| (duration * 1000.0_f64).round() / 1000.0_f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_variants_and_duration() {
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS=\"avc1,mp4a\"\n360/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,AVERAGE-BANDWIDTH=2100000,RESOLUTION=1280x720,NAME=\"HD\"\nhttps://other.test/720.m3u8";
        assert!(is_playlist(master));
        assert!(is_master_playlist(master));
        let variants = parse_master_playlist(master, "https://cdn.test/hls/master.m3u8?t=1");
        assert_eq!(variants.len(), 2);
        assert_eq!(variants[0].label.as_deref(), Some("720p"));
        assert_eq!(variants[1].url, "https://cdn.test/hls/360/index.m3u8");
        assert_eq!(variants[1].codecs.as_deref(), Some("avc1,mp4a"));
        assert_eq!(
            playlist_duration("#EXTM3U\n#EXTINF:10.5,\na.ts\n#EXTINF:9.5,\nb.ts"),
            Some(20.0)
        );
        assert_eq!(playlist_duration(master), None);
    }

    #[test]
    fn duplicate_heights_get_bandwidth_labels() {
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1282079,RESOLUTION=720x416\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=819894,RESOLUTION=720x416\nb.m3u8";
        let labels: Vec<_> = parse_master_playlist(master, "https://cdn.test/m.m3u8")
            .into_iter()
            .map(|v| v.label.unwrap())
            .collect();
        assert_eq!(labels, ["416p (1282 kbps)", "416p (820 kbps)"]);
    }
}
