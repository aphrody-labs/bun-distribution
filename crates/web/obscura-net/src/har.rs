// SPDX-License-Identifier: Apache-2.0

//! HTTP Archive (HAR 1.2) specification data models and serialization.
//!
//! Provides native Rust types for capturing, serializing, and replaying
//! browser and HTTP network traffic according to the HAR 1.2 specification.

use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Root HAR object container.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Har {
    pub log: HarLog,
}

impl Har {
    #[must_use]
    pub fn new(creator_name: impl Into<String>, creator_version: impl Into<String>) -> Self {
        Self {
            log: HarLog::new(creator_name, creator_version),
        }
    }
}

/// The root log object representing captured network traffic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarLog {
    pub version: String,
    pub creator: HarCreator,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<HarCreator>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<HarPage>,
    pub entries: Vec<HarEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

impl HarLog {
    #[must_use]
    pub fn new(creator_name: impl Into<String>, creator_version: impl Into<String>) -> Self {
        Self {
            version: "1.2".into(),
            creator: HarCreator {
                name: creator_name.into(),
                version: creator_version.into(),
                comment: None,
            },
            browser: None,
            pages: Vec::new(),
            entries: Vec::new(),
            comment: None,
        }
    }
}

/// Information about the creator application or browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarCreator {
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// An individual page visited during recording.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarPage {
    #[serde(rename = "startedDateTime")]
    pub started_date_time: DateTime<Utc>,
    pub id: String,
    pub title: String,
    #[serde(rename = "pageTimings")]
    pub page_timings: HarPageTimings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Timing details for a recorded page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HarPageTimings {
    #[serde(rename = "onContentLoad", skip_serializing_if = "Option::is_none")]
    pub on_content_load: Option<f64>,
    #[serde(rename = "onLoad", skip_serializing_if = "Option::is_none")]
    pub on_load: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// An individual HTTP request/response exchange recorded in HAR.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarEntry {
    #[serde(rename = "pageref", skip_serializing_if = "Option::is_none")]
    pub pageref: Option<String>,
    #[serde(rename = "startedDateTime")]
    pub started_date_time: DateTime<Utc>,
    pub time: f64,
    pub request: HarRequest,
    pub response: HarResponse,
    pub cache: HarCache,
    pub timings: HarTimings,
    #[serde(rename = "serverIPAddress", skip_serializing_if = "Option::is_none")]
    pub server_ip_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Captured HTTP request data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarRequest {
    pub method: String,
    pub url: String,
    #[serde(rename = "httpVersion")]
    pub http_version: String,
    pub cookies: Vec<HarCookie>,
    pub headers: Vec<HarHeader>,
    #[serde(rename = "queryString")]
    pub query_string: Vec<HarQueryParam>,
    #[serde(rename = "postData", skip_serializing_if = "Option::is_none")]
    pub post_data: Option<HarPostData>,
    #[serde(rename = "headersSize")]
    pub headers_size: i64,
    #[serde(rename = "bodySize")]
    pub body_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Captured HTTP response data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarResponse {
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    #[serde(rename = "httpVersion")]
    pub http_version: String,
    pub cookies: Vec<HarCookie>,
    pub headers: Vec<HarHeader>,
    pub content: HarContent,
    #[serde(rename = "redirectURL")]
    pub redirect_url: String,
    #[serde(rename = "headersSize")]
    pub headers_size: i64,
    #[serde(rename = "bodySize")]
    pub body_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// An HTTP header name-value pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarHeader {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// An HTTP cookie item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarCookie {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    #[serde(rename = "httpOnly", skip_serializing_if = "Option::is_none")]
    pub http_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// A parsed query string parameter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarQueryParam {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// POST request body data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarPostData {
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<HarPostParam>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Individual parameter in form-encoded POST body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarPostParam {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(rename = "fileName", skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(rename = "contentType", skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Response payload content details.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarContent {
    pub size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression: Option<i64>,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Cache status info.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct HarCache {
    #[serde(rename = "beforeRequest", skip_serializing_if = "Option::is_none")]
    pub before_request: Option<HarCacheEntry>,
    #[serde(rename = "afterRequest", skip_serializing_if = "Option::is_none")]
    pub after_request: Option<HarCacheEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Cache entry metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarCacheEntry {
    #[serde(rename = "expires", skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    #[serde(rename = "lastAccess")]
    pub last_access: String,
    #[serde(rename = "eTag")]
    pub etag: String,
    #[serde(rename = "hitCount")]
    pub hit_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Granular millisecond timings for request phases.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HarTimings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connect: Option<f64>,
    pub send: f64,
    pub wait: f64,
    pub receive: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Helper builder to construct an `HarEntry` from an Obscura Request and Response pair.
impl HarEntry {
    #[must_use]
    pub fn from_exchange(
        method: &str,
        url: &url::Url,
        request_headers: &HashMap<String, String>,
        status: u16,
        response_headers: &HashMap<String, String>,
        response_body: &[u8],
        duration_ms: f64,
    ) -> Self {
        let started = Utc::now();
        let query_string = url
            .query_pairs()
            .map(|(k, v)| HarQueryParam {
                name: k.to_string(),
                value: v.to_string(),
                comment: None,
            })
            .collect();

        let req_headers = request_headers
            .iter()
            .map(|(k, v)| HarHeader {
                name: k.clone(),
                value: v.clone(),
                comment: None,
            })
            .collect();

        let resp_headers = response_headers
            .iter()
            .map(|(k, v)| HarHeader {
                name: k.clone(),
                value: v.clone(),
                comment: None,
            })
            .collect();

        let mime_type = response_headers
            .get("content-type")
            .cloned()
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let text = String::from_utf8(response_body.to_vec()).ok();
        let encoding = if text.is_none() && !response_body.is_empty() {
            Some("base64".to_string())
        } else {
            None
        };

        Self {
            pageref: None,
            started_date_time: started,
            time: duration_ms,
            request: HarRequest {
                method: method.to_uppercase(),
                url: url.to_string(),
                http_version: "HTTP/1.1".into(),
                cookies: Vec::new(),
                headers: req_headers,
                query_string,
                post_data: None,
                headers_size: -1,
                body_size: 0,
                comment: None,
            },
            response: HarResponse {
                status,
                status_text: if status == 200 { "OK".into() } else { "HTTP".into() },
                http_version: "HTTP/1.1".into(),
                cookies: Vec::new(),
                headers: resp_headers,
                content: HarContent {
                    size: response_body.len() as i64,
                    compression: None,
                    mime_type,
                    text,
                    encoding,
                    comment: None,
                },
                redirect_url: String::new(),
                headers_size: -1,
                body_size: response_body.len() as i64,
                comment: None,
            },
            cache: HarCache::default(),
            timings: HarTimings {
                send: 0.0,
                wait: duration_ms,
                receive: 0.0,
                ..Default::default()
            },
            server_ip_address: None,
            connection: None,
            comment: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn har_serialization_roundtrip() {
        let mut har = Har::new("aphrody-har", "1.0.0");
        let url = url::Url::parse("https://example.com/test?a=1&b=2").unwrap();
        let mut req_headers = HashMap::new();
        req_headers.insert("accept".into(), "text/html".into());
        let mut resp_headers = HashMap::new();
        resp_headers.insert("content-type".into(), "text/html".into());

        let entry = HarEntry::from_exchange(
            "GET",
            &url,
            &req_headers,
            200,
            &resp_headers,
            b"Hello World",
            12.5,
        );

        har.log.entries.push(entry);

        let json = serde_json::to_string(&har).expect("serialize");
        assert!(json.contains("Hello World"));
        assert!(json.contains("example.com"));

        let deserialized: Har = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.log.entries.len(), 1);
        assert_eq!(deserialized.log.entries[0].response.status, 200);
    }
}
