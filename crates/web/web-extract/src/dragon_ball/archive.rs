// SPDX-License-Identifier: Apache-2.0
// Projection derived from integrated BXC apps/bxc/src/archive/shenron.ts.
use regex::Regex;
use serde_json::{Value, json};

/// Convert public Archive.org metadata without granting rights or copying media.
pub fn archive_manifest(item: &Value, series: Option<&str>) -> Result<Value, String> {
    let metadata = item.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let identifier = metadata
        .get("identifier")
        .and_then(Value::as_str)
        .or_else(|| item.get("dir").and_then(Value::as_str).and_then(|dir| dir.rsplit('/').next()))
        .filter(|value| !value.is_empty())
        .ok_or("Archive item has no identifier")?;
    let number = |value: Option<&Value>| {
        value
            .and_then(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
            })
            .filter(|value| value.is_finite())
    };
    let episode =
        Regex::new(r"^\s*(\d{1,3})\s*[-_. ]+\s*(.+?)\s*$").expect("static archive episode regex");
    let mut files = Vec::new();
    for file in item.get("files").and_then(Value::as_array).into_iter().flatten() {
        let Some(name) = file.get("name").and_then(Value::as_str) else { continue };
        if name.contains(".thumbs/") {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        let extension = lower.rsplit('.').next().unwrap_or_default();
        let kind = match extension {
            "avi" | "mkv" | "mov" | "mp4" | "m4v" | "webm" | "flv" | "mpeg" | "mpg" => "video",
            "mp3" | "flac" | "m4a" | "ogg" | "wav" | "aac" | "opus" => "audio",
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif" => "image",
            "pdf" | "epub" | "cbz" | "cbr" | "txt" | "djvu" => "document",
            _ => continue,
        };
        let stem =
            name.rsplit('/').next().unwrap_or(name).rsplit_once('.').map_or(name, |(stem, _)| stem);
        let parsed = episode.captures(stem);
        let mut content =
            url::Url::parse("https://archive.org/download/").expect("static archive origin");
        {
            let mut segments =
                content.path_segments_mut().map_err(|()| "invalid archive download URL")?;
            segments.pop_if_empty().push(identifier);
            for segment in name.split('/') {
                segments.push(segment);
            }
        }
        files.push(json!({"identifier":identifier,"filename":name,"contentUrl":content,"source":file.get("source"),"format":file.get("format"),"bytes":number(file.get("size")),"durationSec":number(file.get("length")),"width":number(file.get("width")),"height":number(file.get("height")),"sha1":file.get("sha1"),"mediaKind":kind,"series":series,"episodeNumber":parsed.as_ref().and_then(|value|value[1].parse::<u32>().ok()),"title":parsed.as_ref().map_or(stem,|value|value.get(2).map_or(stem,|value|value.as_str())),"rightsStatus":"unverified"}));
    }
    let collections = match metadata.get("collection") {
        Some(Value::Array(values)) => values.clone(),
        Some(value) => vec![value.clone()],
        None => Vec::new(),
    };
    Ok(
        json!({"identifier":identifier,"itemUrl":format!("https://archive.org/details/{identifier}"),"embedUrl":format!("https://archive.org/embed/{identifier}"),"title":metadata.get("title").cloned().unwrap_or_else(||json!(identifier)),"creator":metadata.get("creator"),"mediatype":metadata.get("mediatype"),"collections":collections,"rightsStatus":"unverified","metadata":metadata,"files":files}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_filenames_numbers_checksums_and_rights_survive() {
        let item = json!({"metadata":{"identifier":"drslump","title":"Dr Slump","collection":"anime"},"files":[{"name":"001 - First episode.mp4","size":"42","sha1":"abc","width":"640"},{"name":"drslump.thumbs/001.jpg"},{"name":"metadata.xml"}]});
        let value = archive_manifest(&item, Some("dr_slump")).unwrap();
        assert_eq!(value["files"].as_array().unwrap().len(), 1);
        assert_eq!(value["files"][0]["episodeNumber"], 1);
        assert_eq!(value["files"][0]["bytes"], 42.0);
        assert_eq!(value["files"][0]["sha1"], "abc");
        assert_eq!(value["rightsStatus"], "unverified");
        assert!(
            value["files"][0]["contentUrl"]
                .as_str()
                .unwrap()
                .contains("001%20-%20First%20episode.mp4")
        );
    }
}
