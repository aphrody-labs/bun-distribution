// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `dbfr_*` — the Dragon Ball FR databooks API over MCP.
//!
//! The site at `dragonballfr.com` is where aphrody's OCR output actually
//! lands: one text per plate, in a record that a reader renders. These tools
//! give a model the read side of that API directly, and one write.
//!
//! # Why reads and the write are not the same tool
//!
//! Reading a record is free and reversible. Depositing a transcription is
//! neither: it writes into a public corpus, and although the API records a
//! revision for every deposit, a wrong text that reads as plausible is exactly
//! the kind of damage nobody notices. So `dbfr_deposit` refuses to act unless
//! the caller passes `apply: true`, and it refuses a blank text outright — the
//! API treats an empty string as "nothing to say", which means a failed read
//! could otherwise be silently recorded as a completed one.
//!
//! # Credentials
//!
//! `$DBFR_TOKEN`, falling back to `$SHENRON_ADMIN_TOKEN`. Reads work without
//! it (the public subset); hidden records and every write require it. The
//! token is never echoed back in a response.
//!
//! # Platform gating
//!
//! Native-only: it builds a reqwest client.

#![cfg(not(target_arch = "wasm32"))]

use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Default site, overridden by `$DBFR_BASE_URL` for a staging instance.
const DEFAULT_BASE_URL: &str = "https://dragonballfr.com";

/// The API refuses more than this in one deposit; refusing here too turns a
/// server-side 413 into a message that names the fix.
const PAGES_MAX: usize = 2_000;

fn base_url() -> String {
    std::env::var("DBFR_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_owned())
        .trim_end_matches('/')
        .to_owned()
}

fn token() -> Option<String> {
    ["DBFR_TOKEN", "SHENRON_ADMIN_TOKEN"].into_iter().find_map(|name| {
        std::env::var(name).ok().map(|value| value.trim().to_owned()).filter(|v| !v.is_empty())
    })
}

fn error(message: &str) -> String {
    json!({ "error": message }).to_string()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("aphrody-mcp/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| error(&format!("build HTTP client: {e}")))
}

/// GET a JSON endpoint, attaching the token when one is available.
async fn get_json(path: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}{path}", base_url());
    let mut request = client()?.get(&url);
    if let Some(token) = token() {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|e| error(&format!("GET {path} failed: {e}")))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| error(&format!("GET {path} failed: {e}")))?;
    if !status.is_success() {
        return Err(error(&format!("GET {path}: HTTP {status}: {body}")));
    }
    serde_json::from_str(&body).map_err(|e| error(&format!("GET {path}: invalid JSON: {e}")))
}

/// Percent-encode a query value; plate lists keep their commas.
fn urlencode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => {
                encoded.push(byte as char);
            },
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

/// Input schema for `dbfr_databooks`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DatabooksListRequest {
    /// Free-text query.
    #[schemars(description = "Optional free-text query over titles and metadata.")]
    #[serde(default)]
    pub q: Option<String>,

    /// Maximum records.
    #[schemars(description = "Maximum records to return. Defaults to 20.")]
    #[serde(default)]
    pub limit: Option<u32>,

    /// Include records not published publicly. Requires a token.
    #[schemars(description = "Include records hidden from the public site. Requires a \
                              configured API token; without one the API silently serves only \
                              the public subset, so this is refused rather than misreported.")]
    #[serde(default)]
    pub include_hidden: bool,
}

/// List databook records.
pub(crate) async fn list(req: DatabooksListRequest) -> String {
    let limit = req.limit.unwrap_or(20).clamp(1, 200);
    let mut path = format!("/api/databooks?limit={limit}");
    if let Some(q) = req.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        path.push_str(&format!("&q={}", urlencode(q)));
    }
    if req.include_hidden {
        if token().is_none() {
            return error(
                "include_hidden needs an API token: set $DBFR_TOKEN (or $SHENRON_ADMIN_TOKEN)",
            );
        }
        path.push_str("&includeHidden=1");
    }
    match get_json(&path).await {
        Ok(json) => json.to_string(),
        Err(message) => message,
    }
}

/// Input schema for `dbfr_pages`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DatabookPagesRequest {
    /// Databook identifier.
    #[schemars(description = "Databook identifier, as returned by dbfr_databooks.")]
    pub id: u64,
}

/// Report a record's plates and which of them still lack a transcription.
pub(crate) async fn pages(req: DatabookPagesRequest) -> String {
    let record = match get_json(&format!("/api/databooks/{}", req.id)).await {
        Ok(record) => record,
        Err(message) => return message,
    };
    let plates =
        record.get("pages").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();

    let mut with_image = 0_usize;
    let mut transcribed = 0_usize;
    let mut missing = Vec::new();
    for plate in &plates {
        let has_image = plate.get("image").and_then(serde_json::Value::as_str).is_some();
        let has_text = plate
            .get("text")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        if has_image {
            with_image += 1;
        }
        if has_text {
            transcribed += 1;
        } else if has_image {
            if let Some(number) = plate.get("number").and_then(serde_json::Value::as_u64) {
                missing.push(number);
            }
        }
    }
    json!({
        "id": req.id,
        "title": record.get("title"),
        "plates": plates.len(),
        "with_image": with_image,
        "transcribed": transcribed,
        "missing": missing,
    })
    .to_string()
}

/// Input schema for `dbfr_textes`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DatabookTextesRequest {
    /// Databook identifier.
    #[schemars(description = "Databook identifier.")]
    pub id: u64,

    /// Plate numbers to read.
    #[schemars(description = "Plate numbers to read, e.g. [12, 13, 14]. The API serves at most \
                              40 plates per call.")]
    pub pages: Vec<u64>,
}

/// Read the stored text of specific plates.
pub(crate) async fn textes(req: DatabookTextesRequest) -> String {
    if req.pages.is_empty() {
        return error("pages must name at least one plate");
    }
    if req.pages.len() > 40 {
        return error("the API serves at most 40 plates per call; split the request");
    }
    let list = req.pages.iter().map(ToString::to_string).collect::<Vec<_>>().join(",");
    match get_json(&format!("/api/databooks/{}/textes?pages={}", req.id, urlencode(&list))).await {
        Ok(json) => json.to_string(),
        Err(message) => message,
    }
}

/// One plate of a deposit.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DepositPage {
    /// Plate number, one-based.
    #[schemars(description = "Plate number, one-based.")]
    pub number: u64,

    /// Transcription for that plate.
    #[schemars(description = "Transcription for this plate. A blank string is refused: the API \
                              reads it as `nothing to say`, which would record a failed read as \
                              a completed one.")]
    pub text: String,
}

/// Input schema for `dbfr_deposit`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct DepositRequest {
    /// Databook identifier.
    #[schemars(description = "Databook identifier.")]
    pub id: u64,

    /// Plates to deposit.
    #[schemars(description = "Plates to deposit. At most 2000 per call.")]
    pub pages: Vec<DepositPage>,

    /// Actually write.
    #[schemars(description = "Must be true to write. Left false (the default) the tool \
                              validates the payload and returns exactly what it would send, \
                              without touching the site.")]
    #[serde(default)]
    pub apply: bool,

    /// Replace the whole plate array instead of merging.
    #[schemars(description = "Replace the record's whole plate array instead of merging into \
                              it. Reserved for a full re-transcription: it drops plates absent \
                              from this call. Defaults to false (merge, idempotent).")]
    #[serde(default)]
    pub replace: bool,
}

/// Deposit transcriptions into one record.
pub(crate) async fn deposit(req: DepositRequest) -> String {
    if req.pages.is_empty() {
        return error("pages must name at least one plate");
    }
    if req.pages.len() > PAGES_MAX {
        return error(&format!("at most {PAGES_MAX} plates per call; split the deposit"));
    }
    let blank = req.pages.iter().filter(|page| page.text.trim().is_empty()).count();
    if blank > 0 {
        return error(&format!(
            "{blank} plate(s) carry a blank text; a deposit must not erase a transcription by \
             accident. Remove them, or use the site's own editor to clear a plate."
        ));
    }
    let mode = if req.replace { "replace" } else { "merge" };
    let body = json!({
        "mode": mode,
        "pages": req.pages.iter()
            .map(|page| json!({ "number": page.number, "text": page.text }))
            .collect::<Vec<_>>(),
    });

    if !req.apply {
        return json!({
            "applied": false,
            "id": req.id,
            "mode": mode,
            "plates": req.pages.len(),
            "note": "dry run: pass apply=true to deposit",
        })
        .to_string();
    }

    let Some(token) = token() else {
        return error("a deposit needs an API token: set $DBFR_TOKEN (or $SHENRON_ADMIN_TOKEN)");
    };
    let client = match client() {
        Ok(client) => client,
        Err(message) => return message,
    };
    let url = format!("{}/api/databooks/{}/transcription", base_url(), req.id);
    let response = match client.post(&url).bearer_auth(token).json(&body).send().await {
        Ok(response) => response,
        Err(e) => return error(&format!("deposit failed: {e}")),
    };
    let status = response.status();
    let text = match response.text().await {
        Ok(text) => text,
        Err(e) => return error(&format!("deposit failed while reading the response: {e}")),
    };
    if !status.is_success() {
        return error(&format!("deposit refused: HTTP {status}: {text}"));
    }
    json!({
        "applied": true,
        "id": req.id,
        "mode": mode,
        "plates": req.pages.len(),
        "response": serde_json::from_str::<serde_json::Value>(&text)
            .unwrap_or(serde_json::Value::String(text)),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plate_list_keeps_its_commas() {
        assert_eq!(urlencode("12,13,14"), "12,13,14");
        assert_eq!(urlencode("v jump"), "v%20jump");
    }

    #[tokio::test]
    async fn a_deposit_without_apply_writes_nothing() {
        let response = deposit(DepositRequest {
            id: 1,
            pages: vec![DepositPage { number: 1, text: "texte".into() }],
            apply: false,
            replace: false,
        })
        .await;
        assert!(response.contains("\"applied\":false"));
    }

    #[tokio::test]
    async fn a_blank_text_is_refused_even_with_apply() {
        let response = deposit(DepositRequest {
            id: 1,
            pages: vec![DepositPage { number: 1, text: "   ".into() }],
            apply: true,
            replace: false,
        })
        .await;
        assert!(response.contains("blank text"));
    }

    #[tokio::test]
    async fn an_empty_deposit_is_refused() {
        let response =
            deposit(DepositRequest { id: 1, pages: Vec::new(), apply: true, replace: false }).await;
        assert!(response.contains("at least one plate"));
    }
}
