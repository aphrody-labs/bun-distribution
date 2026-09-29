// SPDX-License-Identifier: Apache-2.0
//! Deterministic technology and anti-bot detection from HTTP and DNS evidence.
//!
//! `detect_response` works without network access. `detect_url` fetches a
//! bounded response and resolves A/AAAA records before calling the same core.

mod challenge;
mod rules;
mod strategy;

use std::{collections::BTreeMap, net::IpAddr, time::Duration};

pub use challenge::{Challenge, ChallengeProvider, Confidence, Recommendation};
pub use strategy::{ScrapeProfile, SiteShape, Strategy, WaitFor, suggest_strategy};
use url::Url;

/// Maximum body bytes read by `detect_url`.
pub const MAX_BODY_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Default)]
pub struct DetectionInput {
    pub url: String,
    pub final_url: String,
    pub http_status: u16,
    pub headers: BTreeMap<String, Vec<String>>,
    pub body: String,
    pub resolved_ips: Vec<IpAddr>,
    pub cname_chain: Vec<String>,
    pub ns_records: Vec<String>,
}

impl DetectionInput {
    pub fn new(url: impl Into<String>, status: u16, body: impl Into<String>) -> Self {
        let url = url.into();
        Self {
            final_url: url.clone(),
            url,
            http_status: status,
            body: body.into(),
            ..Self::default()
        }
    }

    pub fn add_header(&mut self, name: impl AsRef<str>, value: impl Into<String>) {
        self.headers.entry(name.as_ref().to_ascii_lowercase()).or_default().push(value.into());
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .and_then(|(_, values)| values.first())
            .map(String::as_str)
    }

    pub(crate) fn header_values(&self, name: &str) -> impl Iterator<Item = &str> {
        self.headers
            .iter()
            .filter(move |(key, _)| key.eq_ignore_ascii_case(name))
            .flat_map(|(_, values)| values.iter().map(String::as_str))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DetectionBucket {
    Frontend,
    Backend,
    Cdn,
    Dns,
    Hosting,
    Server,
    Language,
    Cms,
    Analytics,
    TagManager,
    Framework,
    Library,
    Other,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionEvidence {
    pub name: String,
    pub bucket: DetectionBucket,
    pub evidence: String,
    pub source: String,
    pub confidence: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionReport {
    pub url: String,
    pub final_url: String,
    pub http_status: u16,
    pub hostname: String,
    pub resolved_ips: Vec<IpAddr>,
    pub cname_chain: Vec<String>,
    pub ns_records: Vec<String>,
    pub findings: Vec<DetectionEvidence>,
    pub challenge: Challenge,
    pub strategy: Strategy,
}

impl DetectionReport {
    pub fn in_bucket(&self, bucket: DetectionBucket) -> impl Iterator<Item = &DetectionEvidence> {
        self.findings.iter().filter(move |finding| finding.bucket == bucket)
    }

    fn push(
        &mut self,
        name: &str,
        bucket: DetectionBucket,
        evidence: String,
        source: &str,
        confidence: f32,
        version: Option<String>,
    ) {
        if self
            .findings
            .iter()
            .any(|item| item.name.eq_ignore_ascii_case(name) && item.source == source)
        {
            return;
        }
        self.findings.push(DetectionEvidence {
            name: name.to_owned(),
            bucket,
            evidence,
            source: source.to_owned(),
            confidence,
            version,
        });
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DetectError {
    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),
    #[error("only http and https URLs can be detected")]
    Scheme,
    #[error("URL has no hostname")]
    Hostname,
    #[error("failed to build HTTP client: {0}")]
    Client(#[source] reqwest::Error),
    #[error("HTTP request failed: {0}")]
    Request(#[source] reqwest::Error),
    #[error("HTTP body read failed: {0}")]
    Body(#[source] reqwest::Error),
}

/// Analyze already collected evidence. No I/O or process invocation occurs.
pub fn detect_response(input: &DetectionInput) -> Result<DetectionReport, DetectError> {
    let parsed = Url::parse(&input.url)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(DetectError::Scheme);
    }
    let hostname = parsed.host_str().ok_or(DetectError::Hostname)?.to_owned();
    let mut report = DetectionReport {
        url: input.url.clone(),
        final_url: input.final_url.clone(),
        http_status: input.http_status,
        hostname,
        resolved_ips: input.resolved_ips.clone(),
        cname_chain: input.cname_chain.clone(),
        ns_records: input.ns_records.clone(),
        findings: Vec::new(),
        challenge: challenge::detect_challenge(input),
        strategy: Strategy::default(),
    };
    rules::detect_all(input, &mut report);
    report.strategy = strategy::suggest_strategy(&report);
    Ok(report)
}

/// Fetch at most 1 MiB, resolve A/AAAA records, and analyze the response.
///
/// CNAME, NS and PTR collection require a dedicated DNS resolver and can be
/// supplied to `detect_response` by callers that already have those records.
pub async fn detect_url(url: &str) -> Result<DetectionReport, DetectError> {
    let parsed = Url::parse(url)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(DetectError::Scheme);
    }
    let host = parsed.host_str().ok_or(DetectError::Hostname)?.to_owned();
    let port = parsed.port_or_known_default().ok_or(DetectError::Scheme)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("aphrody-web/1.0")
        .build()
        .map_err(DetectError::Client)?;
    let mut response = client.get(url).send().await.map_err(DetectError::Request)?;
    let mut input = DetectionInput::new(url, response.status().as_u16(), "");
    input.final_url = response.url().to_string();
    for (name, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            input.add_header(name.as_str(), value);
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(DetectError::Body)? {
        let remaining = MAX_BODY_BYTES.saturating_sub(body.len());
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if body.len() == MAX_BODY_BYTES {
            break;
        }
    }
    input.body = String::from_utf8_lossy(&body).into_owned();
    if let Ok(addrs) = tokio::net::lookup_host((host.as_str(), port)).await {
        input.resolved_ips = addrs.map(|addr| addr.ip()).collect();
        input.resolved_ips.sort_unstable();
        input.resolved_ips.dedup();
    }
    detect_response(&input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn header_normalization_and_deduplication() {
        let mut input = DetectionInput::new("https://example.com", 200, "");
        input.add_header("CF-RAY", "one");
        input.add_header("cf-ray", "two");
        let report = detect_response(&input).unwrap();
        assert_eq!(
            report.in_bucket(DetectionBucket::Cdn).filter(|f| f.name == "Cloudflare").count(),
            1
        );
    }

    #[test]
    fn serializes_camel_case_report() {
        let input = DetectionInput::new("https://example.com", 200, "");
        let json = serde_json::to_value(detect_response(&input).unwrap()).unwrap();
        assert_eq!(json["httpStatus"], 200);
        assert!(json.get("finalUrl").is_some());
    }

    #[test]
    fn rejects_non_http_urls() {
        let input = DetectionInput::new("file:///etc/passwd", 200, "");
        assert!(matches!(detect_response(&input), Err(DetectError::Scheme)));
    }

    #[tokio::test]
    async fn fetches_local_http_and_detects_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).await.unwrap();
            let body = "<script>/_next/static/</script>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nCF-Ray: abc-FRA\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        let report = detect_url(&format!("http://{address}/")).await.unwrap();
        server.await.unwrap();
        assert_eq!(report.http_status, 200);
        assert!(report.findings.iter().any(|item| item.name == "Cloudflare"));
        assert!(report.findings.iter().any(|item| item.name == "Next.js"));
    }
}
