// SPDX-License-Identifier: Apache-2.0
//! Google Cloud Storage listing through the GCS JSON API (no `gcloud` subprocess).
//!
//! Access token resolution, first match wins:
//! 1. `GOOGLE_OAUTH_ACCESS_TOKEN` (a ready bearer token);
//! 2. Application Default Credentials of type `authorized_user`
//!    (`GOOGLE_APPLICATION_CREDENTIALS`, else the gcloud ADC file), refreshed at
//!    `https://oauth2.googleapis.com/token`;
//! 3. none, when `STORAGE_EMULATOR_HOST` points at an emulator (anonymous access).
//!
//! `service_account` key files need RS256 JWT signing, which this crate does not carry; they
//! are reported as an explicit error pointing to `GOOGLE_OAUTH_ACCESS_TOKEN`.

use std::path::PathBuf;

use aphrody_subsystem::SubsystemError;
use serde_json::{Value, json};

const GCS_ENDPOINT: &str = "https://storage.googleapis.com";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const MAX_PAGES: usize = 50;

fn failed(context: &str, error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(format!("{context}: {error}"))
}

/// Where requests go and how they authenticate.
#[derive(Debug, Clone)]
pub(crate) struct GcsConfig {
    pub endpoint: String,
    pub token: Option<String>,
}

impl GcsConfig {
    pub(crate) async fn from_env(client: &reqwest::Client) -> Result<Self, SubsystemError> {
        let emulator = std::env::var("STORAGE_EMULATOR_HOST").ok().filter(|v| !v.is_empty());
        let endpoint = emulator.clone().unwrap_or_else(|| GCS_ENDPOINT.to_owned());
        if let Some(token) =
            std::env::var("GOOGLE_OAUTH_ACCESS_TOKEN").ok().filter(|t| !t.is_empty())
        {
            return Ok(Self { endpoint, token: Some(token) });
        }
        match adc_path() {
            Some(path) if path.is_file() => {
                let token = refresh_adc(client, &path).await?;
                Ok(Self { endpoint, token: Some(token) })
            },
            _ if emulator.is_some() => Ok(Self { endpoint, token: None }),
            _ => Err(SubsystemError::Failed(
                "no GCP credentials: set GOOGLE_OAUTH_ACCESS_TOKEN or run `gcloud auth application-default login`"
                    .into(),
            )),
        }
    }
}

fn adc_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GOOGLE_APPLICATION_CREDENTIALS") {
        return Some(PathBuf::from(path));
    }
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))
    };
    base.map(|b| b.join("gcloud").join("application_default_credentials.json"))
}

async fn refresh_adc(
    client: &reqwest::Client,
    path: &std::path::Path,
) -> Result<String, SubsystemError> {
    let raw = std::fs::read_to_string(path).map_err(|e| failed("failed to read ADC file", e))?;
    let creds: Value = serde_json::from_str(&raw).map_err(|e| failed("invalid ADC file", e))?;
    match creds.get("type").and_then(Value::as_str) {
        Some("authorized_user") => {},
        Some(other) => {
            return Err(SubsystemError::Failed(format!(
                "ADC credential type `{other}` is not supported for GCS listing; export GOOGLE_OAUTH_ACCESS_TOKEN (e.g. `gcloud auth print-access-token`)"
            )));
        },
        None => return Err(SubsystemError::Failed("ADC file has no `type` field".into())),
    }
    let field = |name: &str| {
        creds
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| SubsystemError::Failed(format!("ADC file is missing `{name}`")))
    };
    let form = [
        ("client_id", field("client_id")?),
        ("client_secret", field("client_secret")?),
        ("refresh_token", field("refresh_token")?),
        ("grant_type", "refresh_token"),
    ];
    let response = client
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await
        .map_err(|e| failed("OAuth token refresh failed", e))?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| failed("OAuth token refresh failed", e))?;
    if !status.is_success() {
        let reason = body.get("error").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(SubsystemError::Failed(format!(
            "OAuth token refresh failed ({status}): {reason}"
        )));
    }
    body.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| SubsystemError::Failed("OAuth token response has no access_token".into()))
}

/// Lists objects and `/`-delimited prefixes under `gs://bucket/prefix`, following pagination.
/// HTTP client for the GCS and OAuth endpoints. The workspace builds reqwest with
/// `rustls-no-provider`, so the ring provider is installed process-wide first (idempotent).
pub(crate) fn http_client() -> Result<reqwest::Client, SubsystemError> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| failed("failed to build HTTP client", e))
}

pub(crate) async fn list(
    client: &reqwest::Client,
    config: &GcsConfig,
    bucket: &str,
    prefix: &str,
) -> Result<Value, SubsystemError> {
    if bucket.is_empty() || bucket.contains('/') {
        return Err(SubsystemError::InvalidArguments(format!("invalid bucket name: {bucket:?}")));
    }
    let url = format!("{}/storage/v1/b/{bucket}/o", config.endpoint.trim_end_matches('/'));
    let mut items = Vec::new();
    let mut prefixes = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut query = vec![
            ("prefix", prefix.to_owned()),
            ("delimiter", "/".to_owned()),
            ("fields", "items(name,size,updated,contentType),prefixes,nextPageToken".to_owned()),
        ];
        if let Some(token) = &page_token {
            query.push(("pageToken", token.clone()));
        }
        let mut request = client.get(&url).query(&query);
        if let Some(token) = &config.token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|e| failed("GCS request failed", e))?;
        let status = response.status();
        let body: Value =
            response.json().await.map_err(|e| failed("GCS response is not JSON", e))?;
        if !status.is_success() {
            let message =
                body.pointer("/error/message").and_then(Value::as_str).unwrap_or("unknown error");
            return Err(SubsystemError::Failed(format!("GCS list failed ({status}): {message}")));
        }
        for item in body.get("items").and_then(Value::as_array).into_iter().flatten() {
            items.push(json!({
                "name": item.get("name").cloned().unwrap_or(Value::Null),
                "url": format!("gs://{bucket}/{}", item.get("name").and_then(Value::as_str).unwrap_or_default()),
                "size": item
                    .get("size")
                    .and_then(Value::as_str)
                    .and_then(|s| s.parse::<u64>().ok()),
                "updated": item.get("updated").cloned().unwrap_or(Value::Null),
                "content_type": item.get("contentType").cloned().unwrap_or(Value::Null),
            }));
        }
        for p in body.get("prefixes").and_then(Value::as_array).into_iter().flatten() {
            if let Some(p) = p.as_str() {
                prefixes.push(json!(format!("gs://{bucket}/{p}")));
            }
        }
        page_token = body.get("nextPageToken").and_then(Value::as_str).map(str::to_owned);
        if page_token.is_none() {
            break;
        }
    }
    Ok(json!({
        "bucket": bucket,
        "prefix": prefix,
        "count": items.len(),
        "items": items,
        "prefixes": prefixes,
        "truncated": page_token.is_some(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    /// Minimal HTTP/1.1 server answering each connection with the next canned body and
    /// returning the request lines it received.
    async fn serve(bodies: Vec<(u16, String)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let mut seen = Vec::new();
            for (status, body) in bodies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 16 * 1024];
                let mut read = 0;
                loop {
                    let n = socket.read(&mut buf[read..]).await.unwrap();
                    read += n;
                    if n == 0 || buf[..read].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                seen.push(request);
                let response = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
                socket.shutdown().await.ok();
            }
            seen
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test]
    async fn lists_objects_across_pages_with_bearer_token() {
        let (endpoint, server) = serve(vec![
            (
                200,
                r#"{"items":[{"name":"models/a.bin","size":"10","updated":"2026-01-01T00:00:00Z","contentType":"application/octet-stream"}],"prefixes":["models/sub/"],"nextPageToken":"p2"}"#.into(),
            ),
            (200, r#"{"items":[{"name":"models/b.bin","size":"20","updated":"2026-01-02T00:00:00Z"}]}"#.into()),
        ])
        .await;
        let config = GcsConfig { endpoint, token: Some("tok".into()) };
        let client = http_client().unwrap();
        let out = list(&client, &config, "bkt", "models/").await.expect("list");
        assert_eq!(out["count"], 2);
        assert_eq!(out["items"][0]["name"], "models/a.bin");
        assert_eq!(out["items"][0]["size"], 10);
        assert_eq!(out["items"][1]["url"], "gs://bkt/models/b.bin");
        assert_eq!(out["prefixes"], json!(["gs://bkt/models/sub/"]));
        assert_eq!(out["truncated"], false);

        let requests = server.await.unwrap();
        assert!(requests[0].starts_with("GET /storage/v1/b/bkt/o?prefix=models%2F&delimiter=%2F"));
        assert!(requests[0].to_ascii_lowercase().contains("authorization: bearer tok"));
        assert!(requests[1].contains("pageToken=p2"));
    }

    #[tokio::test]
    async fn surfaces_api_errors() {
        let (endpoint, server) = serve(vec![(
            404,
            r#"{"error":{"code":404,"message":"The specified bucket does not exist."}}"#.into(),
        )])
        .await;
        let config = GcsConfig { endpoint, token: None };
        let err = list(&http_client().unwrap(), &config, "missing", "").await.unwrap_err();
        assert!(err.to_string().contains("bucket does not exist"), "{err}");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_invalid_bucket() {
        let config = GcsConfig { endpoint: "http://127.0.0.1:9".into(), token: None };
        let err = list(&http_client().unwrap(), &config, "a/b", "").await.unwrap_err();
        assert!(matches!(err, SubsystemError::InvalidArguments(_)));
    }

    #[tokio::test]
    #[ignore = "requires GCP credentials and GCS_TEST_BUCKET"]
    async fn live_listing() {
        let bucket = std::env::var("GCS_TEST_BUCKET").expect("GCS_TEST_BUCKET");
        let client = http_client().unwrap();
        let config = GcsConfig::from_env(&client).await.expect("credentials");
        let out = list(&client, &config, &bucket, "").await.expect("list");
        assert!(out["items"].is_array());
    }
}
