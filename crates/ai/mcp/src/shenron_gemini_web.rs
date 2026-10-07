// SPDX-License-Identifier: Apache-2.0
//! Gemini Web inference for Shenron's grounded text and image workloads.

use std::{path::Path, time::Duration};

use aphrody_gemini_web::{ConversationMetadata, GeminiError, GeminiModel, GeminiWebClient};
use base64::Engine as _;

const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

fn session_error(error: GeminiError) -> &'static str {
    match error {
        GeminiError::Auth(_) => "Gemini Web session was rejected",
        GeminiError::Bootstrap(_) => "Gemini Web page bootstrap failed",
        GeminiError::Network(_) => "Gemini Web network is unavailable",
        GeminiError::Rpc { .. } => "Gemini Web session RPC failed",
        GeminiError::Parse(_) => "Gemini Web session response was invalid",
    }
}

pub fn selected_model(raw: Option<&str>) -> Option<GeminiModel> {
    let raw = raw.unwrap_or("flash").trim();
    let id = raw.strip_prefix("gemini-web/").unwrap_or(raw);
    if id == "gemini-web" {
        return Some(GeminiModel::Flash);
    }
    GeminiModel::from_id(id)
}

pub fn is_selected(raw: Option<&str>) -> bool {
    raw.is_some_and(|value| value == "gemini-web" || value.starts_with("gemini-web/"))
}

async fn client(language: &str) -> Result<GeminiWebClient, &'static str> {
    let language = if language.starts_with("ja") {
        "ja"
    } else if language.starts_with("en") {
        "en"
    } else {
        "fr"
    };
    if let Ok(path) = std::env::var("APHRODY_SHENRON_GEMINI_COOKIE_FILE") {
        if path.trim().is_empty() || !Path::new(&path).is_file() {
            return Err("Gemini Web session file is unavailable");
        }
        GeminiWebClient::from_cookie_file(path, language).await.map_err(session_error)
    } else {
        GeminiWebClient::from_default_cookie_file(language).await.map_err(session_error)
    }
}

pub async fn available() -> bool {
    tokio::time::timeout(Duration::from_secs(3), client("fr"))
        .await
        .is_ok_and(|result| result.is_ok())
}

pub async fn chat(prompt: &str, model: GeminiModel) -> Result<String, &'static str> {
    let client = tokio::time::timeout(Duration::from_secs(30), client("fr"))
        .await
        .map_err(|_| "Gemini Web session timed out")??;
    let reply =
        tokio::time::timeout(Duration::from_secs(90), client.ask(prompt, Some(&model.header())))
            .await
            .map_err(|_| "Gemini Web answer timed out")?
            .map_err(|_| "Gemini Web answer failed")?;
    let answer = reply.text.trim();
    if answer.is_empty() {
        return Err("Gemini Web returned an empty answer");
    }
    Ok(answer.to_owned())
}

fn image_name(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("shenron.png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("shenron.jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("shenron.webp")
    } else {
        None
    }
}

pub async fn read_image(
    encoded: &str,
    prompt: &str,
    language: &str,
    model: GeminiModel,
) -> Result<String, &'static str> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid image_base64")?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image size must be 1..=16 MiB");
    }
    let name = image_name(&bytes).ok_or("Unsupported image format")?;
    let client = tokio::time::timeout(Duration::from_secs(30), client(language))
        .await
        .map_err(|_| "Gemini Web session timed out")??;
    let attachment =
        tokio::time::timeout(Duration::from_secs(90), client.upload_file(name, &bytes))
            .await
            .map_err(|_| "Gemini Web image upload timed out")?
            .map_err(|_| "Gemini Web image upload failed")?;
    let reply = tokio::time::timeout(
        Duration::from_secs(150),
        client.send(
            prompt,
            Some(&model.header()),
            &ConversationMetadata::default(),
            Some(&[attachment]),
        ),
    )
    .await
    .map_err(|_| "Gemini Web image answer timed out")?
    .map_err(|_| "Gemini Web image answer failed")?;
    let answer = reply.text.trim();
    if answer.is_empty() {
        return Err("Gemini Web returned an empty image answer");
    }
    Ok(answer.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{image_name, is_selected, selected_model};

    #[test]
    fn accepts_only_supported_images_and_explicit_gemini_models() {
        assert_eq!(image_name(b"\x89PNG\r\n\x1a\nbody"), Some("shenron.png"));
        assert_eq!(image_name(b"\xff\xd8\xffbody"), Some("shenron.jpg"));
        assert_eq!(image_name(b"GIF89a"), None);
        assert!(is_selected(Some("gemini-web/flash")));
        assert!(selected_model(Some("gemini-web/pro")).is_some());
        assert!(selected_model(Some("gemini-web/unknown")).is_none());
    }
}
