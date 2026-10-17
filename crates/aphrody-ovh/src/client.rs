// SPDX-License-Identifier: Apache-2.0
//! Pure Rust OVHcloud API Client.
//!
//! Two authentication modes, chosen from the credentials:
//!
//! - [`AuthMode::OAuth2`]: service account (client credentials). The access token is cached in
//!   memory, renewed [`TOKEN_REFRESH_MARGIN`] before it expires and once on HTTP 401. Also serves
//!   the API v2 base (IAM).
//! - [`AuthMode::ApplicationKey`]: cryptographic SHA-1 request signing via `ring` with automatic
//!   server time drift synchronization.
//!
//! Secrets never appear in `Debug` output nor in error messages.

use std::{
    fmt::Write,
    sync::{
        Arc, Mutex, Once,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use serde::de::DeserializeOwned;

static INIT_CRYPTO: Once = Once::new();

pub fn ensure_crypto_provider() {
    INIT_CRYPTO.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Compute SHA-1 hex digest using `ring`.
pub fn sha1_hex(content: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY, content.as_bytes());
    let bytes = digest.as_ref();
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

/// Compute OVH authentication signature string.
/// Format: $1$ + SHA1(applicationSecret + "+" + consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp)
pub fn sign_request(
    app_secret: &str,
    consumer_key: &str,
    method: &str,
    url: &str,
    body: &str,
    timestamp: i64,
) -> String {
    let raw = format!(
        "{app_secret}+{consumer_key}+{}+{url}+{body}+{timestamp}",
        method.to_uppercase()
    );
    format!("$1${}", sha1_hex(&raw))
}

/// Renew the OAuth2 access token this long before it expires.
pub const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(60);

/// Lifetime assumed when the token endpoint omits `expires_in`.
const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(3600);

/// How a client authenticates against the OVH API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
    /// Service account: `client_id` / `client_secret` exchanged for a Bearer token.
    OAuth2,
    /// Legacy application key, application secret and consumer key signing.
    ApplicationKey,
}

impl AuthMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::OAuth2 => "oauth2_client_credentials",
            Self::ApplicationKey => "application_key",
        }
    }
}

/// API generation: `/1.0` (most products) or `/v2` (IAM).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiVersion {
    V1,
    V2,
}

/// OVH API credentials. Fields not used by the selected mode stay empty. `Debug` masks secrets;
/// the type is deliberately not serialisable.
#[derive(Clone, Default)]
pub struct OvhCredentials {
    pub application_key: String,
    pub application_secret: String,
    pub consumer_key: String,
    pub endpoint: String,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

impl std::fmt::Debug for OvhCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OvhCredentials")
            .field("auth_mode", &self.auth_mode())
            .field("endpoint", &self.endpoint)
            .field("secrets", &"<masked>")
            .finish()
    }
}

impl OvhCredentials {
    /// OAuth2 wins over the application key triplet; `None` when neither is complete.
    pub fn auth_mode(&self) -> Option<AuthMode> {
        let filled = |v: &Option<String>| v.as_deref().is_some_and(|s| !s.is_empty());
        if filled(&self.client_id) && filled(&self.client_secret) {
            Some(AuthMode::OAuth2)
        } else if !self.application_key.is_empty()
            && !self.application_secret.is_empty()
            && !self.consumer_key.is_empty()
        {
            Some(AuthMode::ApplicationKey)
        } else {
            None
        }
    }

    /// Same credentials restricted to the application key triplet (OAuth2 pair dropped).
    pub fn legacy_only(&self) -> Option<Self> {
        let legacy = Self {
            client_id: None,
            client_secret: None,
            ..self.clone()
        };
        (legacy.auth_mode() == Some(AuthMode::ApplicationKey)).then_some(legacy)
    }
}

/// OAuth2 token endpoint of the official OVHcloud SDKs (python-ovh, go-ovh) for an endpoint name.
pub fn oauth2_token_url(endpoint: &str) -> Option<&'static str> {
    match endpoint {
        "ovh-eu" => Some("https://www.ovh.com/auth/oauth2/token"),
        "ovh-ca" => Some("https://ca.ovh.com/auth/oauth2/token"),
        "ovh-us" => Some("https://us.ovhcloud.com/auth/oauth2/token"),
        _ => None,
    }
}

/// Replace the `/1.0` suffix of a base URL by `/v2`.
pub fn v2_base_url(base_url: &str) -> String {
    match base_url.strip_suffix("/1.0") {
        Some(root) => format!("{root}/v2"),
        None => base_url.to_string(),
    }
}

#[derive(Clone)]
struct CachedToken {
    value: String,
    expires_at: Instant,
}

impl CachedToken {
    /// True while the token still has more than [`TOKEN_REFRESH_MARGIN`] to live.
    fn is_fresh(&self, now: Instant) -> bool {
        now + TOKEN_REFRESH_MARGIN < self.expires_at
    }
}

/// Parse the token endpoint answer. Only the OAuth2 error code is ever surfaced, never the body.
pub fn parse_token_response(status: u16, body: &str) -> Result<(String, Duration)> {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    let token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty());
    match (status, token) {
        (200..=299, Some(token)) => {
            let ttl = json
                .get("expires_in")
                .and_then(serde_json::Value::as_u64)
                .filter(|s| *s > 0)
                .map_or(DEFAULT_TOKEN_TTL, Duration::from_secs);
            Ok((token.to_string(), ttl))
        }
        _ => {
            let code = json
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unexpected_response");
            bail!("OVH OAuth2 token request failed: HTTP {status} ({code})")
        }
    }
}

#[derive(Clone)]
pub struct OvhClient {
    creds: Arc<OvhCredentials>,
    mode: AuthMode,
    base_url: String,
    base_url_v2: String,
    token_url: String,
    token: Arc<Mutex<Option<CachedToken>>>,
    http: reqwest::Client,
    time_delta_sec: Arc<AtomicI64>,
    time_synced: Arc<AtomicBool>,
}

impl OvhClient {
    pub fn new(creds: OvhCredentials) -> Result<Self> {
        ensure_crypto_provider();

        let mode = creds.auth_mode().ok_or_else(|| {
            anyhow::anyhow!(
                "incomplete OVH credentials: need client_id+client_secret or application_key+application_secret+consumer_key"
            )
        })?;

        let base_url = match creds.endpoint.as_str() {
            "ovh-eu" => "https://eu.api.ovh.com/1.0".to_string(),
            "ovh-ca" => "https://ca.api.ovh.com/1.0".to_string(),
            "ovh-us" => "https://api.us.ovhcloud.com/1.0".to_string(),
            other if other.starts_with("http") => other.to_string(),
            _ => "https://eu.api.ovh.com/1.0".to_string(),
        };

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("failed to construct reqwest client")?;

        let token_url = match oauth2_token_url(&creds.endpoint) {
            Some(url) => url.to_string(),
            // Custom endpoint (tests, proxies): token endpoint on the same host.
            None => format!("{}/auth/oauth2/token", base_url.trim_end_matches("/1.0")),
        };
        let base_url_v2 = v2_base_url(&base_url);

        Ok(Self {
            creds: Arc::new(creds),
            mode,
            base_url,
            base_url_v2,
            token_url,
            token: Arc::new(Mutex::new(None)),
            http,
            time_delta_sec: Arc::new(AtomicI64::new(0)),
            time_synced: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn base_url_v2(&self) -> &str {
        &self.base_url_v2
    }

    pub fn auth_mode(&self) -> AuthMode {
        self.mode
    }

    fn cached_token(&self) -> Option<String> {
        let guard = self.token.lock().ok()?;
        guard
            .as_ref()
            .filter(|t| t.is_fresh(Instant::now()))
            .map(|t| t.value.clone())
    }

    fn drop_token(&self) {
        if let Ok(mut guard) = self.token.lock() {
            *guard = None;
        }
    }

    /// Cached OAuth2 access token, fetched when absent or within the refresh margin of expiry.
    pub async fn access_token(&self) -> Result<String> {
        if let Some(token) = self.cached_token() {
            return Ok(token);
        }
        let (Some(id), Some(secret)) = (&self.creds.client_id, &self.creds.client_secret) else {
            bail!("access tokens need OAuth2 credentials");
        };
        let resp = self
            .http
            .post(&self.token_url)
            .header("Accept", "application/json")
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", id.as_str()),
                ("client_secret", secret.as_str()),
                ("scope", "all"),
            ])
            .send()
            .await
            .context("OVH OAuth2 token request failed (network)")?;
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let (value, ttl) = parse_token_response(status, &body)?;
        if let Ok(mut guard) = self.token.lock() {
            *guard = Some(CachedToken {
                value: value.clone(),
                expires_at: Instant::now() + ttl,
            });
        }
        Ok(value)
    }

    pub async fn sync_time(&self) -> Result<i64> {
        let url = format!("{}/auth/time", self.base_url);
        if let Ok(res) = self.http.get(&url).send().await
            && res.status().is_success()
            && let Ok(text) = res.text().await
            && let Ok(server_time) = text.trim().parse::<i64>()
        {
            let local_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let delta = server_time - local_time;
            self.time_delta_sec.store(delta, Ordering::SeqCst);
            self.time_synced.store(true, Ordering::SeqCst);
            return Ok(delta);
        }
        Ok(self.time_delta_sec.load(Ordering::SeqCst))
    }

    pub fn timestamp(&self) -> i64 {
        let local = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        local + self.time_delta_sec.load(Ordering::SeqCst)
    }

    pub async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request_versioned(ApiVersion::V1, method, path, body)
            .await
    }

    /// Same as [`Self::request`] on an explicit API generation.
    pub async fn request_versioned<T: DeserializeOwned>(
        &self,
        version: ApiVersion,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        if self.mode == AuthMode::ApplicationKey && !self.time_synced.load(Ordering::SeqCst) {
            let _ = self.sync_time().await;
        }

        self.execute_with_retry::<T>(version, method, path, body, true)
            .await
    }

    async fn execute_with_retry<T: DeserializeOwned>(
        &self,
        version: ApiVersion,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
        allow_retry: bool,
    ) -> Result<T> {
        let normalized = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{path}")
        };
        let root = match version {
            ApiVersion::V1 => &self.base_url,
            ApiVersion::V2 => &self.base_url_v2,
        };
        let full_url = format!("{root}{normalized}");
        let body_str = body.as_ref().map(|b| b.to_string()).unwrap_or_default();

        let mut req = self
            .http
            .request(method.clone(), &full_url)
            .header("Accept", "application/json");
        match self.mode {
            AuthMode::OAuth2 => {
                req = req.bearer_auth(self.access_token().await?);
            }
            AuthMode::ApplicationKey => {
                let ts = self.timestamp();
                let sig = sign_request(
                    &self.creds.application_secret,
                    &self.creds.consumer_key,
                    method.as_str(),
                    &full_url,
                    &body_str,
                    ts,
                );
                req = req
                    .header("X-Ovh-Application", &self.creds.application_key)
                    .header("X-Ovh-Consumer", &self.creds.consumer_key)
                    .header("X-Ovh-Timestamp", ts.to_string())
                    .header("X-Ovh-Signature", sig);
            }
        }

        if !body_str.is_empty() {
            req = req
                .header("Content-Type", "application/json")
                .body(body_str.clone());
        }

        let resp = req
            .send()
            .await
            .with_context(|| format!("OVH HTTP request failed for {full_url}"))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if self.mode == AuthMode::ApplicationKey
                && status.as_u16() == 400
                && allow_retry
                && text.to_lowercase().contains("timestamp")
            {
                let _ = self.sync_time().await;
                return Box::pin(self.execute_with_retry::<T>(version, method, path, body, false))
                    .await;
            }
            // Expired or revoked access token: drop it and retry once with a fresh one.
            if self.mode == AuthMode::OAuth2 && status.as_u16() == 401 && allow_retry {
                self.drop_token();
                return Box::pin(self.execute_with_retry::<T>(version, method, path, body, false))
                    .await;
            }
            bail!(
                "OVH {} {} -> HTTP {}: {}",
                method,
                path,
                status.as_u16(),
                text
            );
        }

        if text.trim().is_empty() {
            let empty_val: T = serde_json::from_str("null")?;
            return Ok(empty_val);
        }

        serde_json::from_str(&text)
            .with_context(|| format!("failed to parse JSON response from {full_url}: {text}"))
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request(reqwest::Method::GET, path, None).await
    }

    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request(reqwest::Method::POST, path, body).await
    }

    pub async fn put<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request(reqwest::Method::PUT, path, body).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request(reqwest::Method::DELETE, path, None).await
    }

    /// GET on the API v2 base (IAM).
    pub async fn get_v2<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request_versioned(ApiVersion::V2, reqwest::Method::GET, path, None)
            .await
    }

    pub async fn post_v2<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request_versioned(ApiVersion::V2, reqwest::Method::POST, path, body)
            .await
    }

    pub async fn put_v2<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request_versioned(ApiVersion::V2, reqwest::Method::PUT, path, body)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oauth_fixture() -> OvhCredentials {
        OvhCredentials {
            endpoint: "ovh-eu".into(),
            client_id: Some("fixture-id".into()),
            client_secret: Some("fixture-secret".into()),
            ..Default::default()
        }
    }

    fn triplet_fixture() -> OvhCredentials {
        OvhCredentials {
            application_key: "ak".into(),
            application_secret: "as".into(),
            consumer_key: "ck".into(),
            endpoint: "ovh-eu".into(),
            ..Default::default()
        }
    }

    #[test]
    fn oauth_pair_wins_over_triplet() {
        let both = OvhCredentials {
            client_id: Some("i".into()),
            client_secret: Some("s".into()),
            ..triplet_fixture()
        };
        assert_eq!(both.auth_mode(), Some(AuthMode::OAuth2));
        assert_eq!(
            triplet_fixture().auth_mode(),
            Some(AuthMode::ApplicationKey)
        );
        assert_eq!(oauth_fixture().auth_mode(), Some(AuthMode::OAuth2));
        let half = OvhCredentials {
            client_id: Some("i".into()),
            ..Default::default()
        };
        assert_eq!(half.auth_mode(), None);
        assert!(OvhClient::new(half).is_err());
    }

    #[test]
    fn legacy_only_drops_the_oauth_pair() {
        let both = OvhCredentials {
            client_id: Some("i".into()),
            client_secret: Some("s".into()),
            ..triplet_fixture()
        };
        let legacy = both.legacy_only().expect("triplet present");
        assert_eq!(legacy.auth_mode(), Some(AuthMode::ApplicationKey));
        assert!(oauth_fixture().legacy_only().is_none());
    }

    #[test]
    fn debug_never_prints_secrets() {
        let creds = OvhCredentials {
            client_id: Some("sentinel-id".into()),
            client_secret: Some("sentinel-secret".into()),
            ..triplet_fixture()
        };
        let shown = format!("{creds:?}");
        for needle in ["sentinel-id", "sentinel-secret", "ak", "as", "ck"] {
            if needle.len() > 2 {
                assert!(!shown.contains(needle), "{needle} leaked in {shown}");
            }
        }
        assert!(shown.contains("masked"));
    }

    #[test]
    fn token_urls_follow_the_official_sdks() {
        assert_eq!(
            oauth2_token_url("ovh-eu"),
            Some("https://www.ovh.com/auth/oauth2/token")
        );
        assert_eq!(
            oauth2_token_url("ovh-ca"),
            Some("https://ca.ovh.com/auth/oauth2/token")
        );
        assert_eq!(
            oauth2_token_url("ovh-us"),
            Some("https://us.ovhcloud.com/auth/oauth2/token")
        );
        assert_eq!(oauth2_token_url("kimsufi-eu"), None);
    }

    #[test]
    fn v2_base_replaces_the_version_suffix() {
        assert_eq!(
            v2_base_url("https://eu.api.ovh.com/1.0"),
            "https://eu.api.ovh.com/v2"
        );
        assert_eq!(v2_base_url("https://x.test"), "https://x.test");
        let client = OvhClient::new(oauth_fixture()).unwrap();
        assert_eq!(client.base_url(), "https://eu.api.ovh.com/1.0");
        assert_eq!(client.base_url_v2(), "https://eu.api.ovh.com/v2");
        assert_eq!(client.auth_mode(), AuthMode::OAuth2);
    }

    #[test]
    fn token_is_refreshed_within_the_margin() {
        let now = Instant::now();
        let fresh = CachedToken {
            value: "t".into(),
            expires_at: now + Duration::from_secs(3599),
        };
        assert!(fresh.is_fresh(now));
        let almost = CachedToken {
            value: "t".into(),
            expires_at: now + Duration::from_secs(60),
        };
        assert!(!almost.is_fresh(now));
        let edge = CachedToken {
            value: "t".into(),
            expires_at: now + Duration::from_secs(61),
        };
        assert!(edge.is_fresh(now));
        assert!(!fresh.is_fresh(now + Duration::from_secs(3540)));
    }

    #[test]
    fn token_response_parsing_hides_the_body_on_failure() {
        let (token, ttl) = parse_token_response(
            200,
            r#"{"access_token":"abc","token_type":"Bearer","expires_in":3599}"#,
        )
        .unwrap();
        assert_eq!(token, "abc");
        assert_eq!(ttl, Duration::from_secs(3599));

        let (_, default_ttl) = parse_token_response(200, r#"{"access_token":"abc"}"#).unwrap();
        assert_eq!(default_ttl, DEFAULT_TOKEN_TTL);

        let error = parse_token_response(
            401,
            r#"{"error":"invalid_client","error_description":"secret-echo"}"#,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("invalid_client") && error.contains("401"));
        assert!(!error.contains("secret-echo"));
        assert!(parse_token_response(200, "not json").is_err());
    }
}
