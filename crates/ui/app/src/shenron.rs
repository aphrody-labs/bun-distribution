// SPDX-License-Identifier: Apache-2.0
//! Public, read-only Shenron API integration for the desktop.

use serde::{Deserialize, Serialize};

const CHAT_ENDPOINT: &str = "https://dragonballfr.com/api/chat";
const MAX_QUERY_CHARS: usize = 600;

#[derive(Debug, Serialize, Deserialize)]
pub struct RagHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub score: f64,
    pub kind: String,
    #[serde(default)]
    pub source_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub answer: String,
    #[serde(default)]
    pub hits: Vec<RagHit>,
    pub mode: String,
}

/// Ask the public, grounded Shenron RAG endpoint. This command has no access to
/// admin credentials and cannot select an arbitrary host or backend route.
#[tauri::command]
pub async fn aphrody_shenron_chat(query: String) -> Result<ChatResponse, String> {
    // RG and Shenron are strictly kept out of Aphrody UI and App until production
    // readiness qualification and explicit user agreement (see GEMINI.md).
    if std::env::var("APHRODY_SHENRON_PRODUCTION_READY").as_deref() != Ok("1") {
        return Err("Shenron and RG are kept out of Aphrody UI and App pending production readiness qualification and explicit user agreement (see GEMINI.md).".into());
    }

    let query = query.trim();
    if query.is_empty() || query.encode_utf16().count() > MAX_QUERY_CHARS {
        return Err("Shenron query must contain between 1 and 600 characters".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(35))
        .https_only(true)
        .build()
        .map_err(|error| format!("Shenron client initialization failed: {error}"))?;
    let response = client
        .get(CHAT_ENDPOINT)
        .query(&[("q", query), ("persona", "shenron")])
        .send()
        .await
        .map_err(|error| format!("Shenron API request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Shenron API returned HTTP {}", response.status()));
    }
    response
        .json::<ChatResponse>()
        .await
        .map_err(|error| format!("Shenron API response was invalid: {error}"))
}
