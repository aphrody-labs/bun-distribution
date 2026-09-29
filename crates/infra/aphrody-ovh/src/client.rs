// SPDX-License-Identifier: Apache-2.0
//! Pure Rust OVHcloud API Client.
//!
//! Provides cryptographic SHA-1 request signing via `ring`, automatic server time
//! drift synchronization, query serialization, and typed JSON responses.

use std::{
    fmt::Write,
    sync::{
        Arc, Once,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

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
    let raw =
        format!("{app_secret}+{consumer_key}+{}+{url}+{body}+{timestamp}", method.to_uppercase());
    format!("$1${}", sha1_hex(&raw))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvhCredentials {
    pub application_key: String,
    pub application_secret: String,
    pub consumer_key: String,
    pub endpoint: String,
}

#[derive(Clone)]
pub struct OvhClient {
    creds: Arc<OvhCredentials>,
    base_url: String,
    http: reqwest::Client,
    time_delta_sec: Arc<AtomicI64>,
    time_synced: Arc<AtomicBool>,
}

impl OvhClient {
    pub fn new(creds: OvhCredentials) -> Result<Self> {
        ensure_crypto_provider();

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

        Ok(Self {
            creds: Arc::new(creds),
            base_url,
            http,
            time_delta_sec: Arc::new(AtomicI64::new(0)),
            time_synced: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn sync_time(&self) -> Result<i64> {
        let url = format!("{}/auth/time", self.base_url);
        if let Ok(res) = self.http.get(&url).send().await
            && res.status().is_success()
            && let Ok(text) = res.text().await
            && let Ok(server_time) = text.trim().parse::<i64>()
        {
            let local_time =
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
            let delta = server_time - local_time;
            self.time_delta_sec.store(delta, Ordering::SeqCst);
            self.time_synced.store(true, Ordering::SeqCst);
            return Ok(delta);
        }
        Ok(self.time_delta_sec.load(Ordering::SeqCst))
    }

    pub fn timestamp(&self) -> i64 {
        let local =
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
        local + self.time_delta_sec.load(Ordering::SeqCst)
    }

    pub async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        if !self.time_synced.load(Ordering::SeqCst) {
            let _ = self.sync_time().await;
        }

        self.execute_with_retry::<T>(method, path, body, true).await
    }

    async fn execute_with_retry<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
        allow_time_retry: bool,
    ) -> Result<T> {
        let normalized = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
        let full_url = format!("{}{}", self.base_url, normalized);
        let body_str = body.as_ref().map(|b| b.to_string()).unwrap_or_default();
        let ts = self.timestamp();
        let sig = sign_request(
            &self.creds.application_secret,
            &self.creds.consumer_key,
            method.as_str(),
            &full_url,
            &body_str,
            ts,
        );

        let mut req = self.http.request(method.clone(), &full_url);
        req = req
            .header("X-Ovh-Application", &self.creds.application_key)
            .header("X-Ovh-Consumer", &self.creds.consumer_key)
            .header("X-Ovh-Timestamp", ts.to_string())
            .header("X-Ovh-Signature", sig)
            .header("Accept", "application/json");

        if !body_str.is_empty() {
            req = req.header("Content-Type", "application/json").body(body_str.clone());
        }

        let resp =
            req.send().await.with_context(|| format!("OVH HTTP request failed for {full_url}"))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            if status.as_u16() == 400
                && allow_time_retry
                && text.to_lowercase().contains("timestamp")
            {
                let _ = self.sync_time().await;
                return Box::pin(self.execute_with_retry::<T>(method, path, body, false)).await;
            }
            bail!("OVH {} {} -> HTTP {}: {}", method, path, status.as_u16(), text);
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
}
