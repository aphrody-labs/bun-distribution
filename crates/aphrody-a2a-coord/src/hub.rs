// SPDX-License-Identifier: Apache-2.0
//! Multi-host A2A hub: a presence registry served by the hub listener and the
//! client every host uses to reach it.
//!
//! One listener (the hub) owns the mailboxes. Every other host reaches it through
//! `APHRODY_A2A_HUB_URL` (a loopback tunnel or the hub's own loopback address)
//! and identifies each agent by a peer id such as `claude-windows` or `codex-vps`.
//! Messages use the durable `/coord/{peer}/envelopes` mailbox of the recipient; the
//! registry below only records who exists, on which host, and when it last
//! checked in.

use std::{
    io::Read as _,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

use crate::envelope::{Envelope, EnvelopeKind};

pub const ENV_HUB_URL: &str = "APHRODY_A2A_HUB_URL";
pub const ENV_PEER_ID: &str = "APHRODY_A2A_PEER_ID";
pub const ENV_AGENT: &str = "APHRODY_A2A_AGENT";
pub const ENV_HOST_ID: &str = "APHRODY_HOST_ID";

/// A peer is reported online while its last heartbeat is younger than this.
pub const ONLINE_TTL_SECS: i64 = 180;

const MAX_BODY_BYTES: u64 = 4096;

/// Identity of the calling agent on this host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelfIdentity {
    pub id: String,
    pub agent: String,
    pub host: String,
    pub os: String,
}

/// Lower-case a label and keep only characters accepted in a mailbox name.
fn sanitize(label: &str) -> String {
    label
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(64)
        .collect()
}

/// A mailbox, peer or task path segment: ASCII letters, digits, `_` and `-`.
pub(crate) fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

impl SelfIdentity {
    /// Resolve from the process environment.
    #[must_use]
    pub fn detect() -> Self {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve with an explicit environment lookup (testable).
    ///
    /// `APHRODY_A2A_PEER_ID` wins. Otherwise the id is `<agent>-<host>` where the agent
    /// is `APHRODY_A2A_AGENT`, or inferred from the launching CLI (`CLAUDECODE` for
    /// Claude Code, `CODEX_*` session variables for Codex), and the host is
    /// `APHRODY_HOST_ID`, or the operating system name.
    #[must_use]
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let present = |key: &str| get(key).is_some_and(|value| !value.trim().is_empty());
        let os = std::env::consts::OS.to_owned();
        let host = get(ENV_HOST_ID)
            .map(|value| sanitize(&value))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| os.clone());
        let agent = get(ENV_AGENT)
            .map(|value| sanitize(&value))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                if present("CLAUDECODE") {
                    "claude".to_owned()
                } else if [
                    "CODEX_THREAD_ID",
                    "CODEX_SESSION_ID",
                    "CODEX_SANDBOX",
                    "CODEX_CI",
                ]
                .iter()
                .any(|key| present(key))
                {
                    "codex".to_owned()
                } else {
                    "aphrody".to_owned()
                }
            });
        let id = get(ENV_PEER_ID)
            .map(|value| value.trim().to_owned())
            .filter(|value| valid_segment(value))
            .unwrap_or_else(|| format!("{agent}-{host}"));
        Self {
            id,
            agent,
            host,
            os,
        }
    }
}

/// A peer as stored and listed by the hub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerRecord {
    pub id: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub os: String,
    pub last_seen: String,
    /// Computed by the hub when listing; never persisted.
    #[serde(default)]
    pub online: bool,
}

/// Presence heartbeat sent by a peer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registration {
    pub id: String,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub os: String,
}

impl From<&SelfIdentity> for Registration {
    fn from(identity: &SelfIdentity) -> Self {
        Self {
            id: identity.id.clone(),
            agent: identity.agent.clone(),
            host: identity.host.clone(),
            os: identity.os.clone(),
        }
    }
}

fn is_online(last_seen: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(last_seen)
        .is_ok_and(|seen| (now - seen.with_timezone(&Utc)).num_seconds() < ONLINE_TTL_SECS)
}

fn peers_dir(coord_dir: &Path) -> PathBuf {
    coord_dir.join("peers")
}

/// Hub routes: `GET /peers` lists, `POST /peers` registers or refreshes one peer.
pub fn peers_router(coord_dir: PathBuf) -> Router {
    Router::new()
        .route("/peers", get(list_peers).post(register_peer))
        .with_state(Arc::new(peers_dir(&coord_dir)))
}

async fn list_peers(State(dir): State<Arc<PathBuf>>) -> impl IntoResponse {
    let now = Utc::now();
    let mut peers = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir.as_path()).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry.path().extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let Ok(bytes) = tokio::fs::read(entry.path()).await else {
                continue;
            };
            let Ok(mut peer) = serde_json::from_slice::<PeerRecord>(&bytes) else {
                continue;
            };
            peer.online = is_online(&peer.last_seen, now);
            peers.push(peer);
        }
    }
    peers.sort_by(|a, b| a.id.cmp(&b.id));
    let total = peers.len();
    Json(json!({ "peers": peers, "total": total, "now": now.to_rfc3339() }))
}

async fn register_peer(
    State(dir): State<Arc<PathBuf>>,
    Json(registration): Json<Registration>,
) -> impl IntoResponse {
    let bad = |message: &str| (StatusCode::BAD_REQUEST, Json(json!({ "error": message })));
    if !valid_segment(&registration.id) {
        return bad("invalid peer id").into_response();
    }
    let label = |value: &str| value.len() <= 64 && value.chars().all(|c| !c.is_control());
    if !label(&registration.agent) || !label(&registration.host) || !label(&registration.os) {
        return bad("invalid peer attributes").into_response();
    }
    let record = PeerRecord {
        id: registration.id.clone(),
        agent: registration.agent,
        host: registration.host,
        os: registration.os,
        last_seen: Utc::now().to_rfc3339(),
        online: true,
    };
    let write = async {
        tokio::fs::create_dir_all(dir.as_path()).await?;
        let path = dir.join(format!("{}.json", record.id));
        let temp = dir.join(format!("{}.json.tmp", record.id));
        let bytes = serde_json::to_vec(&record).map_err(std::io::Error::other)?;
        tokio::fs::write(&temp, bytes).await?;
        tokio::fs::rename(&temp, &path).await
    };
    match write.await {
        Ok(()) => (StatusCode::OK, Json(json!(record))).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "peer registry write failed" })),
        )
            .into_response(),
    }
}

#[derive(Debug, Error)]
pub enum HubError {
    #[error("hub credential: {0}")]
    Credential(&'static str),
    #[error("invalid peer id: {0}")]
    InvalidPeer(String),
    #[error("hub http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("hub returned {status}: {body}")]
    Status { status: u16, body: String },
}

fn checked_credential(value: &str) -> Result<String, HubError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 4096 || value.bytes().any(|byte| !byte.is_ascii_graphic())
    {
        return Err(HubError::Credential("invalid bearer credential"));
    }
    Ok(value.to_owned())
}

/// Bearer credential: `APHRODY_A2A_TOKEN_FILE`, then `APHRODY_A2A_TOKEN`, then
/// `APHRODY_A2A_COORD_TOKEN`. An unreadable configured file is an error, never an
/// anonymous fallback.
pub fn bearer_from_lookup(
    get: impl Fn(&str) -> Option<String>,
) -> Result<Option<String>, HubError> {
    if let Some(path) = get("APHRODY_A2A_TOKEN_FILE").filter(|value| !value.trim().is_empty()) {
        let file = std::fs::File::open(&path)
            .map_err(|_| HubError::Credential("credential file unavailable"))?;
        let mut value = String::new();
        file.take(MAX_BODY_BYTES + 1)
            .read_to_string(&mut value)
            .map_err(|_| HubError::Credential("credential file unreadable"))?;
        return checked_credential(&value).map(Some);
    }
    for name in ["APHRODY_A2A_TOKEN", "APHRODY_A2A_COORD_TOKEN"] {
        if let Some(value) = get(name).filter(|value| !value.trim().is_empty()) {
            return checked_credential(&value).map(Some);
        }
    }
    Ok(None)
}

/// Client of the hub listener.
#[derive(Clone)]
pub struct HubClient {
    base: String,
    token: Option<String>,
    http: reqwest::Client,
}

impl HubClient {
    #[must_use]
    pub fn new(base: &str, token: Option<String>) -> Self {
        static CRYPTO: std::sync::Once = std::sync::Once::new();
        CRYPTO.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Self {
            base: base.trim().trim_end_matches('/').to_owned(),
            token,
            http,
        }
    }

    /// `Some` when `APHRODY_A2A_HUB_URL` is configured.
    pub fn from_env() -> Result<Option<Self>, HubError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Option<Self>, HubError> {
        let Some(url) = get(ENV_HUB_URL).filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        Ok(Some(Self::new(&url, bearer_from_lookup(&get)?)))
    }

    #[must_use]
    pub fn base(&self) -> &str {
        &self.base
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let request = self.http.request(method, format!("{}{path}", self.base));
        match &self.token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    async fn json(response: reqwest::Response) -> Result<Value, HubError> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(HubError::Status {
                status: status.as_u16(),
                body: body.chars().take(300).collect(),
            });
        }
        Ok(response.json::<Value>().await?)
    }

    /// Refresh this peer's presence on the hub.
    pub async fn register(&self, identity: &SelfIdentity) -> Result<PeerRecord, HubError> {
        let response = self
            .request(reqwest::Method::POST, "/peers")
            .json(&Registration::from(identity))
            .send()
            .await?;
        let value = Self::json(response).await?;
        serde_json::from_value(value).map_err(|_| HubError::Credential("malformed peer record"))
    }

    /// Every peer registered on the hub, online or not.
    pub async fn peers(&self) -> Result<Vec<PeerRecord>, HubError> {
        let response = self.request(reqwest::Method::GET, "/peers").send().await?;
        let value = Self::json(response).await?;
        Ok(
            serde_json::from_value(value.get("peers").cloned().unwrap_or(json!([])))
                .unwrap_or_default(),
        )
    }

    /// Deliver one envelope to the recipient's durable mailbox on the hub.
    pub async fn send(
        &self,
        from: &str,
        to: &str,
        kind: EnvelopeKind,
        topic: &str,
        body: &str,
    ) -> Result<Envelope, HubError> {
        for id in [from, to] {
            if !valid_segment(id) {
                return Err(HubError::InvalidPeer(id.to_owned()));
            }
        }
        let envelope = Envelope::new(from, to, kind, topic, body);
        let response = self
            .request(reqwest::Method::POST, &format!("/coord/{to}/envelopes"))
            .json(&envelope)
            .send()
            .await?;
        Self::json(response).await?;
        Ok(envelope)
    }

    /// Newest-first envelopes addressed to `id`.
    pub async fn inbox(&self, id: &str, limit: usize) -> Result<Vec<Value>, HubError> {
        if !valid_segment(id) {
            return Err(HubError::InvalidPeer(id.to_owned()));
        }
        let response = self
            .request(
                reqwest::Method::GET,
                &format!("/coord/{id}/envelopes?limit={limit}"),
            )
            .send()
            .await?;
        let value = Self::json(response).await?;
        Ok(
            serde_json::from_value(value.get("envelopes").cloned().unwrap_or(json!([])))
                .unwrap_or_default(),
        )
    }

    /// Send a read receipt for `envelope` back to its sender.
    pub async fn acknowledge(
        &self,
        reader: &str,
        envelope: &Value,
    ) -> Result<Option<Envelope>, HubError> {
        let (Some(id), Some(sender)) = (
            envelope.get("id").and_then(Value::as_str),
            envelope.get("from").and_then(Value::as_str),
        ) else {
            return Ok(None);
        };
        let sender = sender.split('@').next().unwrap_or(sender);
        if !valid_segment(sender) {
            return Ok(None);
        }
        let mut receipt = Envelope::new(reader, sender, EnvelopeKind::Ack, "a2a.read", "read");
        receipt.re = Some(id.to_owned());
        let response = self
            .request(reqwest::Method::POST, &format!("/coord/{sender}/envelopes"))
            .json(&receipt)
            .send()
            .await?;
        Self::json(response).await?;
        Ok(Some(receipt))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    #[test]
    fn identity_prefers_explicit_peer_id_then_agent_and_host() {
        let explicit =
            SelfIdentity::from_lookup(lookup(&[(ENV_PEER_ID, "codex-vps"), ("CLAUDECODE", "1")]));
        assert_eq!(explicit.id, "codex-vps");

        let claude =
            SelfIdentity::from_lookup(lookup(&[("CLAUDECODE", "1"), (ENV_HOST_ID, "Windows")]));
        assert_eq!(
            (claude.id.as_str(), claude.agent.as_str()),
            ("claude-windows", "claude")
        );

        let codex =
            SelfIdentity::from_lookup(lookup(&[("CODEX_THREAD_ID", "t-1"), (ENV_HOST_ID, "vps")]));
        assert_eq!(codex.id, "codex-vps");

        let bare = SelfIdentity::from_lookup(lookup(&[]));
        assert_eq!(bare.id, format!("aphrody-{}", std::env::consts::OS));

        let invalid =
            SelfIdentity::from_lookup(lookup(&[(ENV_PEER_ID, "../x"), (ENV_AGENT, "Grok")]));
        assert_eq!(invalid.id, format!("grok-{}", std::env::consts::OS));
    }

    #[test]
    fn credential_file_wins_and_unreadable_file_never_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("bearer");
        std::fs::write(&file, "from-file\n").unwrap();
        let path = file.to_string_lossy().into_owned();
        let token = bearer_from_lookup(lookup(&[
            ("APHRODY_A2A_TOKEN_FILE", &path),
            ("APHRODY_A2A_TOKEN", "from-env"),
        ]))
        .unwrap();
        assert_eq!(token.as_deref(), Some("from-file"));
        let missing = dir.path().join("absent").to_string_lossy().into_owned();
        assert!(
            bearer_from_lookup(lookup(&[
                ("APHRODY_A2A_TOKEN_FILE", &missing),
                ("APHRODY_A2A_TOKEN", "from-env"),
            ]))
            .is_err()
        );
        assert_eq!(bearer_from_lookup(lookup(&[])).unwrap(), None);
        assert!(HubClient::from_lookup(lookup(&[])).unwrap().is_none());
    }

    async fn serve_hub(dir: &Path, token: Option<&str>) -> String {
        let app = Router::new()
            .merge(peers_router(dir.to_path_buf()))
            .merge(crate::task_api::task_api_router(dir.to_path_buf(), None));
        let app = crate::auth::protect(app, token.map(str::to_owned));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{address}")
    }

    fn identity(id: &str, agent: &str, host: &str) -> SelfIdentity {
        SelfIdentity {
            id: id.into(),
            agent: agent.into(),
            host: host.into(),
            os: "test".into(),
        }
    }

    #[tokio::test]
    async fn two_hosts_exchange_messages_and_receipts_through_one_hub() {
        let dir = tempfile::tempdir().unwrap();
        let url = serve_hub(dir.path(), Some("secret")).await;
        let claude = HubClient::new(&url, Some("secret".into()));
        let codex = HubClient::new(&url, Some("secret".into()));
        let intruder = HubClient::new(&url, Some("wrong".into()));
        assert!(matches!(
            intruder.peers().await,
            Err(HubError::Status { status: 401, .. })
        ));

        let claude_id = identity("claude-windows", "claude", "windows");
        let codex_id = identity("codex-vps", "codex", "vps");
        claude.register(&claude_id).await.unwrap();
        codex.register(&codex_id).await.unwrap();
        let peers = claude.peers().await.unwrap();
        assert_eq!(
            peers
                .iter()
                .map(|p| (p.id.as_str(), p.host.as_str(), p.online))
                .collect::<Vec<_>>(),
            [
                ("claude-windows", "windows", true),
                ("codex-vps", "vps", true)
            ]
        );

        let ask = claude
            .send(
                "claude-windows",
                "codex-vps",
                EnvelopeKind::Ask,
                "a2a.test",
                "ping from windows",
            )
            .await
            .unwrap();
        let inbox = codex.inbox("codex-vps", 10).await.unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0]["id"], ask.id);
        assert_eq!(inbox[0]["body"], "ping from windows");

        let receipt = codex
            .acknowledge("codex-vps", &inbox[0])
            .await
            .unwrap()
            .unwrap();
        let back = claude.inbox("claude-windows", 10).await.unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0]["kind"], "ack");
        assert_eq!(back[0]["re"], ask.id);
        assert_eq!(back[0]["id"], receipt.id);

        let reply = codex
            .send(
                "codex-vps",
                "claude-windows",
                EnvelopeKind::Fact,
                "a2a.test",
                "pong from vps",
            )
            .await
            .unwrap();
        let back = claude.inbox("claude-windows", 10).await.unwrap();
        assert!(back.iter().any(|e| e["id"] == reply.id));

        assert!(matches!(
            claude
                .send("claude-windows", "../x", EnvelopeKind::Ping, "t", "b")
                .await,
            Err(HubError::InvalidPeer(_))
        ));
    }

    #[tokio::test]
    async fn registry_marks_stale_peers_offline_and_rejects_bad_ids() {
        let dir = tempfile::tempdir().unwrap();
        let url = serve_hub(dir.path(), None).await;
        let client = HubClient::new(&url, None);
        client
            .register(&identity("claude-windows", "claude", "windows"))
            .await
            .unwrap();

        let stale = PeerRecord {
            id: "codex-old".into(),
            agent: "codex".into(),
            host: "vps".into(),
            os: "linux".into(),
            last_seen: (Utc::now() - chrono::Duration::seconds(ONLINE_TTL_SECS + 60)).to_rfc3339(),
            online: false,
        };
        let peers_path = peers_dir(dir.path());
        std::fs::write(
            peers_path.join("codex-old.json"),
            serde_json::to_vec(&stale).unwrap(),
        )
        .unwrap();

        let peers = client.peers().await.unwrap();
        let online: Vec<_> = peers.iter().map(|p| (p.id.as_str(), p.online)).collect();
        assert_eq!(online, [("claude-windows", true), ("codex-old", false)]);

        let bad = client
            .http
            .clone()
            .post(format!("{url}/peers"))
            .json(&json!({ "id": "../escape", "agent": "x" }))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status(), 400);
    }
}
