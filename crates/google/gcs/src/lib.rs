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

use std::path::{Path, PathBuf};

use aphrody_subsystem::SubsystemError;
use serde_json::{Value, json};

use std::ffi::OsString;

/// Environment lookup injected by tests; production reads the process environment.
type EnvLookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;

fn process_env(key: &str) -> Option<OsString> {
    std::env::var_os(key)
}

/// A variable that is set and not empty.
fn var(env: EnvLookup<'_>, key: &str) -> Option<OsString> {
    env(key).filter(|value| !value.is_empty())
}

const GCS_ENDPOINT: &str = "https://storage.googleapis.com";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const MAX_PAGES: usize = 50;
/// File name of Application Default Credentials inside the gcloud configuration directory.
const ADC_FILE: &str = "application_default_credentials.json";

fn failed(context: &str, error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(format!("{context}: {error}"))
}

/// Where requests go and how they authenticate.
#[derive(Debug, Clone)]
pub struct GcsConfig {
    pub endpoint: String,
    pub token: Option<String>,
}

impl GcsConfig {
    /// `home` is the user's home directory, where gcloud keeps Application Default Credentials.
    pub async fn from_env(
        client: &reqwest::Client,
        home: Option<&Path>,
    ) -> Result<Self, SubsystemError> {
        let emulator = std::env::var("STORAGE_EMULATOR_HOST").ok().filter(|v| !v.is_empty());
        let endpoint = emulator.clone().unwrap_or_else(|| GCS_ENDPOINT.to_owned());
        if let Some(token) =
            std::env::var("GOOGLE_OAUTH_ACCESS_TOKEN").ok().filter(|t| !t.is_empty())
        {
            return Ok(Self { endpoint, token: Some(token) });
        }
        let adc = adc_path(home);
        match adc.as_deref() {
            Some(path) if path.is_file() => {
                let token = refresh_adc(client, path).await?;
                Ok(Self { endpoint, token: Some(token) })
            },
            _ if emulator.is_some() => Ok(Self { endpoint, token: None }),
            searched => Err(SubsystemError::Failed(no_credentials_message(searched))),
        }
    }
}

/// The remedies for a missing credential, naming the file that was looked for when there is one.
fn no_credentials_message(searched: Option<&Path>) -> String {
    let remedies = "set GOOGLE_OAUTH_ACCESS_TOKEN, point GOOGLE_APPLICATION_CREDENTIALS at a \
                    credentials file, or run `gcloud auth application-default login`";
    match searched {
        Some(path) => {
            format!("no GCP credentials: {} is not an existing file; {remedies}", path.display())
        },
        None => format!("no GCP credentials: {remedies}"),
    }
}

fn adc_path(home: Option<&Path>) -> Option<PathBuf> {
    adc_path_from(&process_env, cfg!(windows), home)
}

/// Where Application Default Credentials are looked for, first match wins:
///
/// 1. `GOOGLE_APPLICATION_CREDENTIALS`: an explicit file.
/// 2. `CLOUDSDK_CONFIG`: the gcloud configuration directory override.
/// 3. The gcloud default: `%APPDATA%\gcloud` on Windows, `<home>/.config/gcloud` elsewhere
///    (gcloud does not honour `XDG_CONFIG_HOME`, so neither does this).
///
/// A variable that is set but empty counts as unset.
fn adc_path_from(env: EnvLookup<'_>, windows: bool, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = var(env, "GOOGLE_APPLICATION_CREDENTIALS") {
        return Some(PathBuf::from(path));
    }
    if let Some(directory) = var(env, "CLOUDSDK_CONFIG") {
        return Some(PathBuf::from(directory).join(ADC_FILE));
    }
    let base = if windows {
        var(env, "APPDATA").map(PathBuf::from)
    } else {
        home.map(|home| home.join(".config"))
    };
    base.map(|base| base.join("gcloud").join(ADC_FILE))
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
pub fn http_client() -> Result<reqwest::Client, SubsystemError> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| failed("failed to build HTTP client", e))
}

pub async fn list(
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
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    type OwnedLookup = Box<dyn Fn(&str) -> Option<OsString>>;

    /// A fixed environment table: nothing reads the process environment.
    fn table<K: AsRef<str>, V: AsRef<std::ffi::OsStr>>(
        pairs: impl IntoIterator<Item = (K, V)>,
    ) -> OwnedLookup {
        let map: std::collections::HashMap<String, OsString> = pairs
            .into_iter()
            .map(|(key, value)| (key.as_ref().to_owned(), value.as_ref().to_owned()))
            .collect();
        Box::new(move |key| map.get(key).cloned())
    }

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
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let config = GcsConfig::from_env(&client, home.as_deref()).await.expect("credentials");
        let out = list(&client, &config, &bucket, "").await.expect("list");
        assert!(out["items"].is_array());
    }

    #[test]
    fn adc_resolution_order_is_explicit_file_then_gcloud_directory_then_default() {
        let home = Some(Path::new("/h"));
        let all = table([
            ("GOOGLE_APPLICATION_CREDENTIALS", "/explicit/creds.json"),
            ("CLOUDSDK_CONFIG", "/gcloud-config"),
            ("APPDATA", "/appdata"),
        ]);
        for windows in [false, true] {
            assert_eq!(
                adc_path_from(&all, windows, home),
                Some(PathBuf::from("/explicit/creds.json"))
            );
        }
        let without_file = table([("CLOUDSDK_CONFIG", "/gcloud-config"), ("APPDATA", "/appdata")]);
        for windows in [false, true] {
            assert_eq!(
                adc_path_from(&without_file, windows, home),
                Some(Path::new("/gcloud-config").join(ADC_FILE))
            );
        }
    }

    #[test]
    fn adc_default_follows_the_gcloud_layout_of_each_platform() {
        let none = table::<&str, &str>([]);
        // gcloud keeps its configuration in `~/.config/gcloud` on Unix, whatever XDG says.
        let xdg = table([("XDG_CONFIG_HOME", "/xdg"), ("APPDATA", "/appdata")]);
        assert_eq!(
            adc_path_from(&xdg, false, Some(Path::new("/h"))),
            Some(Path::new("/h").join(".config").join("gcloud").join(ADC_FILE))
        );
        assert_eq!(adc_path_from(&none, false, None), None);
        // On Windows it is `%APPDATA%\gcloud`; without APPDATA there is no default.
        assert_eq!(
            adc_path_from(&xdg, true, Some(Path::new("/h"))),
            Some(Path::new("/appdata").join("gcloud").join(ADC_FILE))
        );
        assert_eq!(adc_path_from(&none, true, Some(Path::new("/h"))), None);
    }

    #[test]
    fn empty_adc_variables_count_as_unset() {
        let env = table([("GOOGLE_APPLICATION_CREDENTIALS", ""), ("CLOUDSDK_CONFIG", "")]);
        assert_eq!(
            adc_path_from(&env, false, Some(Path::new("/h"))),
            Some(Path::new("/h").join(".config").join("gcloud").join(ADC_FILE))
        );
    }

    #[test]
    fn missing_credentials_name_the_searched_file_and_the_remedies() {
        let searched = Path::new("/h/.config/gcloud").join(ADC_FILE);
        let named = no_credentials_message(Some(&searched));
        assert!(named.contains(&searched.display().to_string()), "{named}");
        for message in [named, no_credentials_message(None)] {
            for remedy in [
                "GOOGLE_OAUTH_ACCESS_TOKEN",
                "GOOGLE_APPLICATION_CREDENTIALS",
                "gcloud auth application-default login",
            ] {
                assert!(message.contains(remedy), "missing `{remedy}` in: {message}");
            }
        }
    }
}
