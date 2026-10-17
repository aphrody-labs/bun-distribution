// SPDX-License-Identifier: Apache-2.0
//! Keyless Google Translate RPC with a mobile-web fallback.
//!
//! Ports the shared transport and v2 response shape from the Web checkout's
//! `google/translate/engine.ts` and `google/keyless.ts`. Callers may supply an
//! existing Gemini or ADC fallback rather than creating another auth client.

use std::{future::Future, sync::LazyLock, time::Duration};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::language_detect::detect_single_local;

const RPC_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";
const WEB_ENDPOINT: &str = "https://translate.google.com/translate_a/single";
const MOBILE_ENDPOINT: &str = "https://translate.google.com/m";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

static MOBILE_RESULT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<div class="result-container">([^<]+)</div>"#).expect("mobile result pattern")
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TextInput {
    Single(String),
    Multiple(Vec<String>),
}

impl TextInput {
    fn into_vec(self) -> Vec<String> {
        match self {
            Self::Single(text) => vec![text],
            Self::Multiple(texts) => texts,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranslateV2Request {
    pub q: TextInput,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationV2Item {
    pub translated_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_source_language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranslateV2Data {
    pub translations: Vec<TranslationV2Item>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranslateV2Response {
    pub data: TranslateV2Data,
}

#[derive(Debug, Clone)]
pub struct TranslateOptions {
    pub timeout: Duration,
    pub concurrency: usize,
    /// Optional session cookie header supplied by a caller's existing store.
    pub cookie_header: Option<String>,
}

impl Default for TranslateOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(8),
            concurrency: 8,
            cookie_header: None,
        }
    }
}

#[derive(Clone)]
pub struct GoogleTranslateClient {
    client: reqwest::Client,
}

impl GoogleTranslateClient {
    pub fn new() -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client })
    }

    /// Translate one string, first via public RPC, then via the mobile page.
    pub async fn translate_single(
        &self,
        text: &str,
        target: &str,
        source: Option<&str>,
        options: &TranslateOptions,
    ) -> Result<TranslationV2Item, String> {
        if target.trim().is_empty() {
            return Err("Google Translate target language is empty".to_owned());
        }
        if text.trim().is_empty() {
            return Ok(TranslationV2Item {
                translated_text: text.to_owned(),
                detected_source_language: Some(source.unwrap_or("und").to_owned()),
                model: None,
            });
        }
        let mut failures = Vec::new();
        for endpoint in [RPC_ENDPOINT, WEB_ENDPOINT] {
            let request = self
                .client
                .get(endpoint)
                .query(&[
                    ("client", "gtx"),
                    ("sl", source.unwrap_or("auto")),
                    ("tl", target),
                    ("dt", "t"),
                    ("q", text.trim()),
                ])
                .timeout(options.timeout);
            let request = if let Some(cookie) = &options.cookie_header {
                request.header(reqwest::header::COOKIE, cookie)
            } else {
                request
            };
            match request.send().await {
                Ok(response) if response.status().is_success() => {
                    match response.json::<Value>().await {
                        Ok(data) => {
                            if let Some((translated_text, detected)) = parse_translation(&data) {
                                return Ok(TranslationV2Item {
                                    translated_text,
                                    detected_source_language: Some(
                                        source
                                            .map(str::to_owned)
                                            .or(detected)
                                            .unwrap_or_else(|| detect_single_local(text).language),
                                    ),
                                    model: Some("nmt".to_owned()),
                                });
                            }
                            failures.push("RPC response had no translation".to_owned());
                        }
                        Err(_) => failures.push("RPC response was not JSON".to_owned()),
                    }
                }
                Ok(response) => failures.push(format!("RPC HTTP {}", response.status())),
                Err(error) => failures.push(format!("RPC request failed: {error}")),
            }
        }

        let request = self
            .client
            .get(MOBILE_ENDPOINT)
            .query(&[
                ("sl", source.unwrap_or("auto")),
                ("tl", target),
                ("q", text.trim()),
            ])
            .timeout(options.timeout);
        let request = if let Some(cookie) = &options.cookie_header {
            request.header(reqwest::header::COOKIE, cookie)
        } else {
            request
        };
        match request.send().await {
            Ok(response) if response.status().is_success() => {
                let html = response.text().await.map_err(|error| error.to_string())?;
                if let Some(translated_text) = MOBILE_RESULT
                    .captures(&html)
                    .and_then(|capture| capture.get(1))
                    .map(|capture| capture.as_str().trim().to_owned())
                    .filter(|text| !text.is_empty())
                {
                    return Ok(TranslationV2Item {
                        translated_text,
                        detected_source_language: Some(
                            source
                                .map(str::to_owned)
                                .unwrap_or_else(|| detect_single_local(text).language),
                        ),
                        model: Some("nmt".to_owned()),
                    });
                }
                failures.push("mobile response had no translation".to_owned());
            }
            Ok(response) => failures.push(format!("mobile HTTP {}", response.status())),
            Err(error) => failures.push(format!("mobile request failed: {error}")),
        }
        Err(format!(
            "Google Translate transports failed: {}",
            failures.join("; ")
        ))
    }

    /// Reuse a caller-owned Gemini client if both Google web transports fail.
    /// The callback receives only the translation prompt; auth stays with its owner.
    pub async fn translate_single_with_fallback<F, Fut>(
        &self,
        text: &str,
        target: &str,
        source: Option<&str>,
        format: &str,
        options: &TranslateOptions,
        ask: F,
    ) -> Result<TranslationV2Item, String>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Result<String, String>>,
    {
        match self.translate_single(text, target, source, options).await {
            Ok(result) => Ok(result),
            Err(primary_error) => {
                let answer = ask(gemini_translation_prompt(text, target, format))
                    .await
                    .map_err(|error| format!("{primary_error}; Gemini fallback failed: {error}"))?;
                let translated_text = answer.trim();
                if translated_text.is_empty() {
                    return Err(format!(
                        "{primary_error}; Gemini fallback returned empty text"
                    ));
                }
                Ok(TranslationV2Item {
                    translated_text: translated_text.to_owned(),
                    detected_source_language: Some(
                        source
                            .map(str::to_owned)
                            .unwrap_or_else(|| detect_single_local(text).language),
                    ),
                    model: Some("gemini".to_owned()),
                })
            }
        }
    }

    /// Return the Google Cloud Translation v2 response shape for one or more inputs.
    pub async fn translate(
        &self,
        request: TranslateV2Request,
        options: &TranslateOptions,
    ) -> Result<TranslateV2Response, String> {
        if options.concurrency == 0 {
            return Err("Google Translate concurrency must be at least 1".to_owned());
        }
        if request
            .format
            .as_deref()
            .is_some_and(|format| !matches!(format, "text" | "html"))
        {
            return Err("Google Translate format must be text or html".to_owned());
        }
        use futures::StreamExt as _;

        let texts = request.q.into_vec();
        let target = request.target.as_str();
        let source = request.source.as_deref();
        let mut translations = Vec::with_capacity(texts.len());
        // A sliding window of `concurrency` requests: one slow text never idles
        // the other slots (a `chunks` + `join_all` loop waits for each chunk's
        // slowest member). Order is preserved, and the first failure drops the
        // stream, cancelling what is still in flight.
        let mut window = futures::stream::iter(texts.iter())
            .map(|text| self.translate_single(text, target, source, options))
            .buffered(options.concurrency);
        while let Some(result) = window.next().await {
            translations.push(result?);
        }
        Ok(TranslateV2Response {
            data: TranslateV2Data { translations },
        })
    }
}

/// Extract the joined text segments and the detected source language from RPC JSON.
pub fn parse_translation(data: &Value) -> Option<(String, Option<String>)> {
    let parts = data.get(0)?.as_array()?;
    let translated = parts
        .iter()
        .filter_map(|item| item.get(0).and_then(Value::as_str))
        .collect::<String>();
    if translated.is_empty() {
        return None;
    }
    let detected = data.get(2).and_then(Value::as_str).map(str::to_owned);
    Some((translated, detected))
}

pub fn gemini_translation_prompt(text: &str, target: &str, format: &str) -> String {
    if format == "html" {
        format!(
            "Translate the following HTML into {target} language. Strictly preserve all HTML tags, attributes, entities and structure without adding any markdown or commentary:\n\n{}",
            text.trim(),
        )
    } else {
        format!(
            "Translate the following text into {target} language. Output ONLY the raw translated text with zero commentary, formatting or preamble:\n\n{}",
            text.trim(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_rpc_segments_and_detected_language() {
        let data = serde_json::json!([[["Hello", "Bonjour"], [" world", " monde"]], null, "fr"]);
        assert_eq!(
            parse_translation(&data),
            Some(("Hello world".to_owned(), Some("fr".to_owned())))
        );
        assert_eq!(parse_translation(&serde_json::json!([[]])), None);
    }

    #[test]
    fn v2_request_supports_single_and_batch_inputs() {
        let single: TranslateV2Request =
            serde_json::from_value(serde_json::json!({"q":"Bonjour","target":"en"})).unwrap();
        assert_eq!(single.q, TextInput::Single("Bonjour".to_owned()));
        let batch: TranslateV2Request =
            serde_json::from_value(serde_json::json!({"q":["Bonjour","Merci"],"target":"en"}))
                .unwrap();
        assert_eq!(batch.q.into_vec().len(), 2);
    }

    #[test]
    fn gemini_prompt_preserves_html_instruction() {
        let prompt = gemini_translation_prompt("<b>bonjour</b>", "en", "html");
        assert!(prompt.contains("Strictly preserve all HTML tags"));
        assert!(prompt.contains("<b>bonjour</b>"));
    }
}
