// SPDX-License-Identifier: Apache-2.0
// Source contract from Shenron ingest-dragonball-volumes.ts; no editorial OCR.
use regex::Regex;
use serde_json::Value;

/// Extract the public reader's declared images without running source scripts.
pub fn parse_reader_images(html: &str) -> Result<Vec<String>, String> {
    let pattern = Regex::new(r"(?s)ts_reader\.run\((\{.*?\})\);?")
        .expect("static reader configuration regex");
    let json = pattern
        .captures(html)
        .and_then(|capture| capture.get(1))
        .ok_or("reader image configuration is absent")?;
    let value: Value = serde_json::from_str(json.as_str()).map_err(|error| error.to_string())?;
    let mut images = Vec::new();
    for source in value.get("sources").and_then(Value::as_array).into_iter().flatten() {
        for raw in source.get("images").and_then(Value::as_array).into_iter().flatten() {
            let url = raw.as_str().ok_or("reader image reference is not a string")?;
            if !images.iter().any(|image| image == url) {
                images.push(url.to_owned());
            }
        }
    }
    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_order_and_json_contract_are_preserved() {
        let html = r#"<script>ts_reader.run({"sources":[{"images":["https://cdn.example.org/2.jpg","https://cdn.example.org/1.jpg"]}]});</script>"#;
        assert_eq!(
            parse_reader_images(html).unwrap(),
            vec!["https://cdn.example.org/2.jpg", "https://cdn.example.org/1.jpg"]
        );
        assert!(parse_reader_images("<script>ts_reader.run({not:json});</script>").is_err());
    }
}
