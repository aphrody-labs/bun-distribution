// SPDX-License-Identifier: Apache-2.0
//! HTTP client construction and generic GraphQL invoker for the X private web
//! API.
//!
//! Builds a `reqwest::Client` pre-loaded with the static headers the X private API expects on every
//! request. The credentials (`Cookie`, `X-CSRF-Token`) are attached per request from the live
//! session, so a `ct0` / `auth_token` rotation announced through `Set-Cookie` takes effect on the
//! next call (and is written back to the session file it came from).
//!
//! # Generic GraphQL invoker
//!
//! [`XClient::graphql`] dispatches any of the 158 catalog operations without
//! requiring a hand-written method per operation.  Typed helpers in `api.rs`
//! wrap it for common use cases.
//!
//! # Rate-limit tracking
//!
//! Every response's `x-rate-limit-*` headers are captured into `last_rate_limit` and, per endpoint
//! (the GraphQL operation name or the REST path), into a table: a batch mixes endpoints with
//! independent windows, so one global "last" value would be wrong. [`XClient::graphql_waiting`]
//! uses the endpoint's own bucket to sleep until the reset epoch when `remaining == 0`, bounded by a
//! caller-supplied `max_wait` duration; the operation runner ([`crate::ops`]) does the same
//! proactively through a [`CallScope`].
//!
//! # Client-transaction-ID
//!
//! X is progressively enforcing `x-client-transaction-id` on write
//! mutations. This header is computed client-side using a keyed HMAC over
//! the endpoint path + a random nonce, with a rotating key extracted from
//! X's main JS bundle. No stable open-source Rust implementation exists yet
//! (see lib.rs module-level docs). We send a random value per request; if
//! you need the real one, set `XSession::transaction_id` and it will be
//! forwarded as-is. If X returns error code 353, that is the signal.

use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{
    Method,
    header::{HeaderMap, HeaderName, HeaderValue, SET_COOKIE},
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    Result, XError,
    catalog::{self, OpType},
    features,
    runtime_query_ids::QueryIdStore,
    session::XSession,
};

/// The static public bearer token embedded in X's web JavaScript bundle.
///
/// This is NOT a personal token — it is the same for every logged-in browser
/// session and can be extracted from `main.<hash>.js` on x.com. X rotates it
/// very rarely (last change was from the Twitter-era bearer to the x.com
/// bearer in early 2024). Update this constant if requests start returning
/// HTTP 403 with no error body.
pub const WEB_BEARER: &str = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%\
                              3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/// Chrome 124 on Windows — realistic UA that X's bot-detection accepts.
///
/// Update this string if X starts returning 403 / Forbidden for all
/// requests (UA-based detection tightened), matching a then-current
/// stable Chrome version.
pub const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, \
                             like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Base URL prefix for all X private API calls.
pub const API_BASE: &str = "https://x.com/i/api";

/// Legacy media upload endpoint (separate host from the GraphQL API).
pub const UPLOAD_URL: &str = "https://upload.twitter.com/i/media/upload.json";

/// Default total timeout of one HTTP request.
const DEFAULT_TIMEOUT_MS: u64 = 60_000;

/// Generate a random `x-client-transaction-id` value.
///
/// The real X web client derives this from an animation SVG plus a verification
/// key embedded in the page. Empirically X accepts an opaque random hex value
/// (the reference `@steipete/bird` client simply sends 16 random bytes), so we
/// send 32 lowercase hex chars unless the caller pinned a real value on the
/// session. A fresh value per request mirrors genuine browser traffic.
pub(crate) fn random_transaction_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub(crate) fn now_epoch() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Rate-limit snapshot
// ---------------------------------------------------------------------------

/// A snapshot of the X API rate-limit headers for the most recent response.
///
/// X includes these headers on all GraphQL and REST v1.1 responses.  Values
/// are per-endpoint, per-15-minute-window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct RateLimit {
    /// The maximum number of requests allowed in the window.
    pub limit: i64,
    /// Remaining requests in the current window.
    pub remaining: i64,
    /// Unix epoch second at which the window resets.
    pub reset_epoch: i64,
}

// ---------------------------------------------------------------------------
// Per-call scope (set by the operation runner)
// ---------------------------------------------------------------------------

/// Context an operation runner establishes around one call.
///
/// `soft_wait` bounds how long a call may sleep, before sending, because its endpoint's window is
/// exhausted (`x-rate-limit-remaining: 0`); longer waits fail with [`XError::RateLimited`] so the
/// runner can decide. The rate-limit snapshot of the *call itself* is collected here, which a global
/// "last value" cannot give under concurrency.
///
/// Without a scope (the CLI, direct library users) no proactive wait happens and behaviour is
/// unchanged.
#[derive(Debug, Default)]
pub struct CallScope {
    soft_wait: Duration,
    request_timeout: Option<Duration>,
    observed: Mutex<Option<RateLimit>>,
}

impl CallScope {
    /// A scope allowing proactive waits up to `soft_wait`.
    pub fn new(soft_wait: Duration) -> Self {
        Self { soft_wait, request_timeout: None, observed: Mutex::new(None) }
    }

    /// Cap every HTTP request made inside the scope at `timeout` (the waits above are not requests
    /// and are not capped by it).
    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = Some(timeout);
        self
    }

    /// The most recent rate-limit snapshot seen by a call made inside this scope.
    pub fn observed(&self) -> Option<RateLimit> {
        *self.observed.lock().unwrap_or_else(|e| e.into_inner())
    }
}

tokio::task_local! {
    static CALL_SCOPE: Arc<CallScope>;
}

/// Run `future` with `scope` as its call scope (task-local: it does not leak into spawned tasks).
pub async fn with_call_scope<F: Future>(scope: Arc<CallScope>, future: F) -> F::Output {
    CALL_SCOPE.scope(scope, future).await
}

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/// Options of [`XClient::with_options`]; every field is optional.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct XClientOptions {
    /// Replaces `https://x.com/i/api` (loopback servers in tests, a proxy). Credentials are sent
    /// to this base, so it must be a host the caller trusts.
    pub api_base: Option<String>,
    /// Replaces the media upload endpoint.
    pub upload_base: Option<String>,
    /// Total timeout of one HTTP request, in milliseconds (default 60 000).
    pub timeout_ms: Option<u64>,
    /// Write a rotated `ct0` / `auth_token` back to the session file (default `true` when the
    /// session came from a file).
    pub persist_session: Option<bool>,
    /// Disk cache of the runtime queryIds (default: the user config directory).
    pub query_ids_path: Option<PathBuf>,
    /// Freshness window of that cache in seconds (default 24 h).
    pub query_ids_ttl_secs: Option<u64>,
    /// Pages scanned for bundle URLs when a queryId must be refreshed (default: the public x.com
    /// pages). An empty list disables discovery: tests use it so that a rotated-queryId recovery
    /// never leaves the machine.
    pub discovery_pages: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// XClient
// ---------------------------------------------------------------------------

/// Stateless X API client.
///
/// Holds a `reqwest::Client` configured with the static headers and the live session. All methods
/// take `&self` and are safe to call from concurrent tasks.
///
/// The rate-limit tables are protected by `Mutex`es so that concurrent requests race only over a
/// tiny critical section (header parsing).
#[derive(Debug)]
pub struct XClient {
    pub(crate) inner: reqwest::Client,
    session: RwLock<XSession>,
    /// Stable per-client UUID (`x-client-uuid`), generated once at construction.
    client_uuid: String,
    /// Stable per-client device id (`x-twitter-client-deviceid`).
    client_device_id: String,
    /// Disk-backed runtime queryId cache, shared across clones.
    query_ids: Arc<QueryIdStore>,
    /// Most recent rate-limit snapshot captured from response headers.
    last_rate_limit: Mutex<Option<RateLimit>>,
    /// Latest snapshot per endpoint (GraphQL operation name or REST path).
    rate_limits: Mutex<HashMap<String, RateLimit>>,
    api_base: String,
    upload_base: String,
    persist_session: bool,
}

impl Clone for XClient {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            session: RwLock::new(self.session()),
            client_uuid: self.client_uuid.clone(),
            client_device_id: self.client_device_id.clone(),
            query_ids: Arc::clone(&self.query_ids),
            last_rate_limit: Mutex::new(
                *self.last_rate_limit.lock().unwrap_or_else(|e| e.into_inner()),
            ),
            rate_limits: Mutex::new(
                self.rate_limits.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            ),
            api_base: self.api_base.clone(),
            upload_base: self.upload_base.clone(),
            persist_session: self.persist_session,
        }
    }
}

impl XClient {
    /// Build a new `XClient` from a loaded `XSession`.
    ///
    /// Installs the ring rustls CryptoProvider (idempotent) and constructs
    /// a `reqwest::Client` with:
    /// - the static headers of an x.com browser session
    /// - `https://x.com` as origin / referer
    ///
    /// # Errors
    ///
    /// Returns `XError::Auth` if `reqwest::Client` construction fails (rare —
    /// would indicate a system TLS configuration problem).
    pub fn new(session: XSession) -> Result<Self> {
        Self::with_options(session, XClientOptions::default())
    }

    /// Like [`XClient::new`] with explicit [`XClientOptions`].
    pub fn with_options(session: XSession, options: XClientOptions) -> Result<Self> {
        // rustls 0.23 requires an explicit CryptoProvider before the first
        // Client is constructed (cf. CLAUDE.md §7). The error is ignored
        // because another crate may have already installed one.
        let _ = rustls::crypto::ring::default_provider().install_default();

        let client_uuid = uuid::Uuid::new_v4().to_string();
        let client_device_id = uuid::Uuid::new_v4().to_string();

        let headers = static_headers(&client_uuid, &client_device_id);
        let timeout = Duration::from_millis(options.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));

        let inner = reqwest::Client::builder()
            .user_agent(CHROME_UA)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(15))
            .timeout(timeout)
            .tcp_keepalive(Some(Duration::from_secs(30)))
            .build()
            .map_err(|e| XError::Auth(format!("failed to build reqwest::Client: {e}")))?;

        let mut query_ids = match options.query_ids_path {
            Some(path) => QueryIdStore::new(path, options.query_ids_ttl_secs.unwrap_or(24 * 3600)),
            None => match options.query_ids_ttl_secs {
                Some(ttl) => QueryIdStore::new(crate::runtime_query_ids::default_cache_path(), ttl),
                None => QueryIdStore::default(),
            },
        };
        if let Some(pages) = options.discovery_pages {
            query_ids = query_ids.with_discovery_pages(pages);
        }
        let persist_session = options.persist_session.unwrap_or(session.source_path().is_some());

        Ok(Self {
            inner,
            session: RwLock::new(session),
            client_uuid,
            client_device_id,
            query_ids: Arc::new(query_ids),
            last_rate_limit: Mutex::new(None),
            rate_limits: Mutex::new(HashMap::new()),
            api_base: options
                .api_base
                .map(|base| base.trim_end_matches('/').to_owned())
                .unwrap_or_else(|| API_BASE.to_owned()),
            upload_base: options.upload_base.unwrap_or_else(|| UPLOAD_URL.to_owned()),
            persist_session,
        })
    }

    /// Returns the shared runtime queryId store.
    pub fn query_ids(&self) -> &Arc<QueryIdStore> {
        &self.query_ids
    }

    /// The API base this client talks to (`https://x.com/i/api` unless overridden).
    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// The media upload endpoint this client talks to.
    pub fn upload_url(&self) -> &str {
        &self.upload_base
    }

    /// Resolve the live `queryId` for an operation: runtime cache first, then
    /// the embedded catalog snapshot.
    fn resolve_query_id(&self, op_name: &str, catalog_qid: &str) -> String {
        self.query_ids.get(op_name).unwrap_or_else(|| catalog_qid.to_owned())
    }

    /// A request builder for `method` and `url` with the live credentials attached: `Cookie`
    /// (`auth_token` plus `ct0`), the matching `X-CSRF-Token` and a per-request
    /// `x-client-transaction-id` (the session-pinned value if set, otherwise a fresh random one,
    /// like browser traffic).
    pub(crate) fn req(&self, method: Method, url: &str) -> reqwest::RequestBuilder {
        let (cookie, csrf, txn) = {
            let session = self.session.read().unwrap_or_else(|e| e.into_inner());
            (session.cookie_header(), session.ct0.clone(), session.transaction_id.clone())
        };
        let builder = self
            .inner
            .request(method, url)
            .header(reqwest::header::COOKIE, cookie)
            .header("x-csrf-token", csrf)
            .header("x-client-transaction-id", txn.unwrap_or_else(random_transaction_id));
        match CALL_SCOPE.try_with(|scope| scope.request_timeout) {
            Ok(Some(timeout)) => builder.timeout(timeout),
            _ => builder,
        }
    }

    /// Returns the underlying `reqwest::Client` for ad-hoc requests.
    ///
    /// It carries only the static headers: use [`XClient::req`] to attach the credentials.
    pub fn inner(&self) -> &reqwest::Client {
        &self.inner
    }

    /// A copy of the session this client currently authenticates with (it follows `ct0` /
    /// `auth_token` rotations).
    pub fn session(&self) -> XSession {
        self.session.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Returns the most recently captured rate-limit snapshot, or `None` if
    /// no response has been received yet.
    pub fn last_rate_limit(&self) -> Option<RateLimit> {
        *self.last_rate_limit.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The latest rate-limit snapshot of one endpoint (a GraphQL operation name such as
    /// `"SearchTimeline"`, or a REST path such as `"1.1/friendships/create.json"`).
    pub fn rate_limit_for(&self, endpoint: &str) -> Option<RateLimit> {
        self.rate_limits.lock().unwrap_or_else(|e| e.into_inner()).get(endpoint).copied()
    }

    // -----------------------------------------------------------------------
    // Generic GraphQL invoker
    // -----------------------------------------------------------------------

    /// Invoke any operation from the embedded GraphQL catalog.
    ///
    /// - `op_name` — exact operation name from the catalog (e.g. `"CreateTweet"`).
    /// - `variables` — the `variables` JSON object for this call.
    /// - `extra_features` — optional caller overrides merged on top of the catalog-derived feature
    ///   flags (caller values win on conflicts).
    ///
    /// **GET queries** are dispatched as `GET
    /// /i/api/graphql/{qid}/{op}?variables=...&features=...`.
    ///
    /// **POST mutations** are dispatched as `POST /i/api/graphql/{qid}/{op}`
    /// with body `{"variables":..,"features":..,"queryId":..}`.
    ///
    /// Rate-limit headers on every response are captured into [`XClient::last_rate_limit`] and the
    /// endpoint table. HTTP 404 (rotated queryId, or an operation only served over POST) and HTTP 414
    /// (variables too long for a GET URL) are recovered automatically, see below.
    ///
    /// # Errors
    ///
    /// - [`XError::UnknownOperation`] — `op_name` not found in catalog.
    /// - [`XError::Api`] — X returned a structured error in the `errors[]` array.
    /// - [`XError::Http`] — transport / TLS failure.
    /// - [`XError::RateLimited`] — the endpoint window is exhausted for longer than the call scope's
    ///   proactive wait allows.
    pub async fn graphql(
        &self,
        op_name: &str,
        variables: Value,
        extra_features: Option<Value>,
    ) -> Result<Value> {
        let op = catalog::operation(op_name)
            .ok_or_else(|| XError::UnknownOperation(op_name.to_owned()))?;

        // Build feature flags: catalog-derived base, then merge caller overrides.
        let mut feat = features::features_for(op);
        if let Some(extra) = extra_features
            && let (Some(base_obj), Some(extra_obj)) = (feat.as_object_mut(), extra.as_object())
        {
            for (k, v) in extra_obj {
                base_obj.insert(k.clone(), v.clone());
            }
        }

        // First attempt with the currently-resolved queryId (runtime cache, else
        // embedded catalog).
        let query_id = self.resolve_query_id(op_name, &op.query_id);
        self.wait_for_endpoint(op_name).await?;
        let first = self.graphql_send(op_name, op.op_type, &query_id, &feat, &variables).await;

        // Auto-recovery: HTTP 404 means either a rotated queryId or an
        // operation that X only serves over the POST-hybrid form (variables in
        // the URL, `{features, queryId}` in the body — e.g. SearchTimeline).
        // Refresh the live queryId once, then retry: queries fall back to the
        // POST-hybrid form (which works for both causes), mutations re-POST.
        // HTTP 414 (URI too long) only concerns GET queries: the POST-hybrid form moves the
        // features into the body.
        match first {
            Err(ref e) if e.http_status() == Some(404) || is_code_404(e) => match op.op_type {
                OpType::Query => {
                    // First try the POST-hybrid with the same queryId (cheap):
                    // covers ops X only serves over POST. Only if that also
                    // 404s do we pay for a live queryId refresh and retry.
                    let post =
                        self.graphql_send_query_post(op_name, &query_id, &feat, &variables).await;
                    if let Err(e) = &post
                        && (e.http_status() == Some(404) || is_code_404(e))
                    {
                        let _ = self.query_ids.refresh(&[op_name], true).await;
                        let retry_qid = self.resolve_query_id(op_name, &op.query_id);
                        self.graphql_send_query_post(op_name, &retry_qid, &feat, &variables).await
                    } else {
                        post
                    }
                },
                OpType::Mutation | OpType::Subscription => {
                    let _ = self.query_ids.refresh(&[op_name], true).await;
                    let retry_qid = self.resolve_query_id(op_name, &op.query_id);
                    self.graphql_send(op_name, op.op_type, &retry_qid, &feat, &variables).await
                },
            },
            Err(ref e) if e.http_status() == Some(414) && matches!(op.op_type, OpType::Query) => {
                self.graphql_send_query_post(op_name, &query_id, &feat, &variables).await
            },
            other => other,
        }
    }

    /// POST-hybrid form for read operations X refuses over GET.
    ///
    /// `variables` go in the URL query string; `{ features, queryId }` go in the
    /// JSON body. This is the shape X's web client uses for `SearchTimeline`
    /// and friends, and it also works for ordinary queries — so it is our
    /// universal 404 fallback for `OpType::Query`.
    async fn graphql_send_query_post(
        &self,
        op_name: &str,
        query_id: &str,
        feat: &Value,
        variables: &Value,
    ) -> Result<Value> {
        let vars_str = serde_json::to_string(variables)?;
        let url = format!("{}/graphql/{query_id}/{op_name}", self.api_base);
        let body = serde_json::json!({ "features": feat, "queryId": query_id });
        let resp = self
            .req(Method::POST, &url)
            .query(&[("variables", &vars_str)])
            .json(&body)
            .send()
            .await?;
        self.finish(op_name, resp).await
    }

    /// Single GraphQL round-trip with an explicit `query_id`. HTTP 404 (invalid
    /// queryId) is mapped to `XError::Api { code: 404, .. }` so the caller can
    /// trigger a queryId refresh + retry.
    async fn graphql_send(
        &self,
        op_name: &str,
        op_type: OpType,
        query_id: &str,
        feat: &Value,
        variables: &Value,
    ) -> Result<Value> {
        let url = format!("{}/graphql/{query_id}/{op_name}", self.api_base);

        let resp = match op_type {
            OpType::Query => {
                let vars_str = serde_json::to_string(variables)?;
                let feat_str = serde_json::to_string(feat)?;
                self.req(Method::GET, &url)
                    .query(&[("variables", &vars_str), ("features", &feat_str)])
                    .send()
                    .await?
            },
            OpType::Mutation | OpType::Subscription => {
                let body = serde_json::json!({
                    "variables": variables,
                    "features": feat,
                    "queryId": query_id,
                });
                self.req(Method::POST, &url).json(&body).send().await?
            },
        };
        self.finish(op_name, resp).await
    }

    /// Turn a response into JSON: capture the rate limit and rotated cookies, surface the
    /// structured X error first (it carries the real code), then the bare HTTP status.
    pub(crate) async fn finish(&self, endpoint: &str, resp: reqwest::Response) -> Result<Value> {
        // Capture headers before consuming the response body.
        self.observe(endpoint, resp.headers());

        let status = resp.status();
        let json: Value = resp.json().await.unwrap_or(Value::Null);

        if !status.is_success() {
            if json.is_object() {
                check_api_errors(&json)?;
            }
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(json)
    }

    /// POST a form-encoded body to a REST v1.1 path under the API base and return the JSON reply.
    ///
    /// The path (for example `1.1/friendships/create.json`) is also the endpoint key of the
    /// rate-limit table.
    pub(crate) async fn post_form(&self, path: &str, form: &[(&str, &str)]) -> Result<Value> {
        let url = format!("{}/{path}", self.api_base);
        self.wait_for_endpoint(path).await?;
        let resp = self.req(Method::POST, &url).form(form).send().await?;
        self.finish(path, resp).await
    }

    /// Like [`XClient::graphql`] but transparently waits out soft rate limits.
    ///
    /// If the endpoint's last known [`RateLimit`] has `remaining == 0`, this method
    /// sleeps until `reset_epoch` before issuing the call.  If the required
    /// wait would exceed `max_wait`, it returns
    /// [`XError::RateLimited`] immediately without sleeping.
    ///
    /// # Note on hard limits
    ///
    /// X's hard per-account limits (e.g. error code 344 — daily tweet cap)
    /// are enforced server-side and **cannot** be bypassed by waiting.  This
    /// method only helps with soft window-based rate limits (remaining == 0
    /// from the response headers).  A 344 error will still propagate as
    /// `XError::Api { code: 344, .. }`.
    pub async fn graphql_waiting(
        &self,
        op_name: &str,
        variables: Value,
        extra_features: Option<Value>,
        max_wait: Duration,
    ) -> Result<Value> {
        // Check whether we already know we are rate-limited on this endpoint.
        if let Some(rl) = self.rate_limit_for(op_name).or_else(|| self.last_rate_limit())
            && rl.remaining == 0
        {
            let wait_secs = (rl.reset_epoch - now_epoch()).max(0) as u64;
            let wait = Duration::from_secs(wait_secs);

            if wait > max_wait {
                return Err(XError::RateLimited { reset_epoch: rl.reset_epoch });
            }

            if wait > Duration::ZERO {
                tokio::time::sleep(wait).await;
            }
        }

        self.graphql(op_name, variables, extra_features).await
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Fold everything a response tells us: rate-limit headers (global and per endpoint) and
    /// rotated credentials.
    pub(crate) fn observe(&self, endpoint: &str, headers: &HeaderMap) {
        self.record_rate_limit(Some(endpoint), headers);
        self.rotate_cookies(headers);
    }

    fn record_rate_limit(&self, endpoint: Option<&str>, headers: &HeaderMap) {
        let parse_i64 = |name: &str| -> Option<i64> {
            headers.get(name).and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i64>().ok())
        };

        let limit = parse_i64("x-rate-limit-limit");
        let remaining = parse_i64("x-rate-limit-remaining");
        let reset = parse_i64("x-rate-limit-reset");

        if let (Some(limit), Some(remaining), Some(reset_epoch)) = (limit, remaining, reset) {
            let rl = RateLimit { limit, remaining, reset_epoch };
            if let Ok(mut guard) = self.last_rate_limit.lock() {
                *guard = Some(rl);
            }
            if let Some(endpoint) = endpoint
                && let Ok(mut table) = self.rate_limits.lock()
            {
                table.insert(endpoint.to_owned(), rl);
            }
            let _ = CALL_SCOPE.try_with(|scope| {
                *scope.observed.lock().unwrap_or_else(|e| e.into_inner()) = Some(rl);
            });
        }
    }

    /// Apply a `Set-Cookie` rotation of `ct0` or `auth_token` to the live session (and persist it
    /// when the session came from a file). Empty values (cookie deletions) are ignored.
    fn rotate_cookies(&self, headers: &HeaderMap) {
        let mut updates: Vec<(&'static str, String)> = Vec::new();
        for value in headers.get_all(SET_COOKIE) {
            let Ok(text) = value.to_str() else { continue };
            let pair = text.split(';').next().unwrap_or_default();
            let Some((name, val)) = pair.split_once('=') else { continue };
            let (name, val) = (name.trim(), val.trim());
            if val.is_empty() {
                continue;
            }
            match name {
                "ct0" => updates.push(("ct0", val.to_owned())),
                "auth_token" => updates.push(("auth_token", val.to_owned())),
                _ => {},
            }
        }
        if updates.is_empty() {
            return;
        }
        let snapshot = {
            let mut session = self.session.write().unwrap_or_else(|e| e.into_inner());
            let mut changed = false;
            for (name, val) in updates {
                let slot = if name == "ct0" { &mut session.ct0 } else { &mut session.auth_token };
                if *slot != val {
                    *slot = val;
                    changed = true;
                }
            }
            changed.then(|| session.clone())
        };
        if let Some(session) = snapshot
            && self.persist_session
        {
            // Best effort: a read-only home must not fail the request that carried the cookie.
            let _ = session.persist();
        }
    }

    /// Proactive wait for an exhausted endpoint window, bounded by the call scope.
    ///
    /// Only active inside a [`CallScope`]: direct library users keep the old behaviour (the request
    /// is sent and X answers 429 if the window is really exhausted).
    async fn wait_for_endpoint(&self, endpoint: &str) -> Result<()> {
        let Ok(cap) = CALL_SCOPE.try_with(|scope| scope.soft_wait) else {
            return Ok(());
        };
        let Some(rl) = self.rate_limit_for(endpoint) else {
            return Ok(());
        };
        if rl.remaining > 0 {
            return Ok(());
        }
        let wait_secs = rl.reset_epoch - now_epoch();
        if wait_secs <= 0 {
            // The window has reopened: forget the stale snapshot so the next call is not delayed.
            self.rate_limits.lock().unwrap_or_else(|e| e.into_inner()).remove(endpoint);
            return Ok(());
        }
        let wait = Duration::from_secs(wait_secs as u64);
        if wait > cap {
            return Err(XError::RateLimited { reset_epoch: rl.reset_epoch });
        }
        // One extra second: the reset epoch can be ahead of the local clock.
        tokio::time::sleep(wait + Duration::from_secs(1)).await;
        self.rate_limits.lock().unwrap_or_else(|e| e.into_inner()).remove(endpoint);
        Ok(())
    }
}

/// A body-level `{"errors":[{"code":404}]}` is treated like an HTTP 404 by the recovery path
/// (that is how `graphql_send` historically surfaced it).
fn is_code_404(error: &XError) -> bool {
    matches!(error, XError::Api { code: 404, .. })
}

// ---------------------------------------------------------------------------
// Auth header builders
// ---------------------------------------------------------------------------

fn insert_header(map: &mut HeaderMap, key: &'static str, value: &str) {
    if let Ok(val) = HeaderValue::from_str(value) {
        map.insert(HeaderName::from_static(key), val);
    }
}

/// The headers identical on every request of a client (no credentials).
///
/// - `Authorization` carries the public web bearer token (not personal).
/// - `X-Twitter-Auth-Type`, `X-Twitter-Active-User`, language headers convince X's server-side checks
///   that the request originates from a normal browser session.
/// - `X-Client-Uuid` / `X-Twitter-Client-Deviceid` — stable per-client identifiers the real web
///   client sends; included to look human.
pub(crate) fn static_headers(client_uuid: &str, client_device_id: &str) -> HeaderMap {
    let mut map = HeaderMap::new();

    // Bearer token — same value for all browser sessions (public constant).
    insert_header(&mut map, "authorization", &format!("Bearer {WEB_BEARER}"));

    // X session-type marker.
    insert_header(&mut map, "x-twitter-auth-type", "OAuth2Session");

    // Active-user marker (required on all authenticated GraphQL calls).
    insert_header(&mut map, "x-twitter-active-user", "yes");

    // Language / locale — must be present; "en" is the safest value.
    insert_header(&mut map, "x-twitter-client-language", "en");

    // Content negotiation. NOTE: we deliberately do not set a default
    // `content-type` — GraphQL POSTs set `application/json` via `.json()`, REST
    // form posts set `application/x-www-form-urlencoded`, and media APPEND uses
    // multipart; a default JSON content-type would corrupt the multipart body.
    insert_header(&mut map, "accept", "*/*");

    // Origin + Referer — required to pass X's CORS-like server checks.
    insert_header(&mut map, "origin", "https://x.com");
    insert_header(&mut map, "referer", "https://x.com/");

    // Browser-like client identifiers (stable per client).
    insert_header(&mut map, "x-client-uuid", client_uuid);
    insert_header(&mut map, "x-twitter-client-deviceid", client_device_id);

    map
}

// ---------------------------------------------------------------------------
// Shared response checker (also used in api.rs)
// ---------------------------------------------------------------------------

/// Extract the first X `errors[]` entry, if present, and return it as
/// `XError::Api`. Returns `Ok(())` when no `errors` key is found.
pub(crate) fn check_api_errors(body: &Value) -> Result<()> {
    if let Some(errors) = body.get("errors").and_then(Value::as_array)
        && let Some(first) = errors.first()
    {
        let code = first.get("code").and_then(Value::as_i64).unwrap_or(-1);
        let message =
            first.get("message").and_then(Value::as_str).unwrap_or("unknown error").to_owned();
        return Err(XError::Api { code, message });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::XSession;

    fn make_session() -> XSession {
        XSession::new("AUTH_TOKEN_PLACEHOLDER", "CT0_PLACEHOLDER")
    }

    #[test]
    fn static_headers_contain_the_public_bearer() {
        let headers = static_headers("test-uuid", "test-device");
        let auth =
            headers.get("authorization").expect("authorization header missing").to_str().unwrap();
        assert!(auth.starts_with("Bearer "), "expected Bearer prefix");
        assert!(auth.contains(WEB_BEARER), "expected WEB_BEARER constant in auth header");
    }

    #[test]
    fn static_headers_include_client_ids() {
        let headers = static_headers("test-uuid", "test-device");
        assert_eq!(headers.get("x-client-uuid").unwrap().to_str().unwrap(), "test-uuid");
        assert_eq!(
            headers.get("x-twitter-client-deviceid").unwrap().to_str().unwrap(),
            "test-device"
        );
    }

    #[test]
    fn static_headers_carry_no_credentials() {
        let headers = static_headers("u", "d");
        assert!(headers.get("cookie").is_none());
        assert!(headers.get("x-csrf-token").is_none());
        assert!(headers.get("authorization").is_some());
    }

    #[test]
    fn random_transaction_id_is_unique() {
        assert_ne!(random_transaction_id(), random_transaction_id());
    }

    #[test]
    fn xclient_new_succeeds_with_valid_session() {
        let session = make_session();
        let client = XClient::new(session).expect("XClient::new must succeed");
        assert_eq!(client.session().ct0, "CT0_PLACEHOLDER");
        assert_eq!(client.api_base(), API_BASE);
    }

    #[test]
    fn api_base_override_drops_the_trailing_slash() {
        let options = XClientOptions {
            api_base: Some("http://127.0.0.1:9/i/api/".into()),
            ..XClientOptions::default()
        };
        let client = XClient::with_options(make_session(), options).unwrap();
        assert_eq!(client.api_base(), "http://127.0.0.1:9/i/api");
    }

    #[test]
    fn last_rate_limit_is_none_initially() {
        let session = make_session();
        let client = XClient::new(session).unwrap();
        assert!(client.last_rate_limit().is_none());
    }

    #[test]
    fn observe_parses_rate_limit_headers() {
        let session = make_session();
        let client = XClient::new(session).unwrap();

        // Build a minimal HeaderMap with rate-limit headers.
        let mut hmap = reqwest::header::HeaderMap::new();
        hmap.insert("x-rate-limit-limit", "100".parse().unwrap());
        hmap.insert("x-rate-limit-remaining", "0".parse().unwrap());
        hmap.insert("x-rate-limit-reset", "9999999999".parse().unwrap());

        client.observe("Likes", &hmap);

        let rl = client.last_rate_limit().expect("rate limit must be set");
        assert_eq!(rl.limit, 100);
        assert_eq!(rl.remaining, 0);
        assert_eq!(rl.reset_epoch, 9_999_999_999);
    }

    #[test]
    fn observe_keeps_a_table_per_endpoint() {
        let client = XClient::new(make_session()).unwrap();
        let headers = |remaining: &str| {
            let mut h = HeaderMap::new();
            h.insert("x-rate-limit-limit", "50".parse().unwrap());
            h.insert("x-rate-limit-remaining", remaining.parse().unwrap());
            h.insert("x-rate-limit-reset", "9999999999".parse().unwrap());
            h
        };
        client.observe("SearchTimeline", &headers("3"));
        client.observe("UserTweets", &headers("40"));
        assert_eq!(client.rate_limit_for("SearchTimeline").unwrap().remaining, 3);
        assert_eq!(client.rate_limit_for("UserTweets").unwrap().remaining, 40);
        assert!(client.rate_limit_for("Likes").is_none());
        assert_eq!(client.last_rate_limit().unwrap().remaining, 40, "global value is the last one");
    }

    #[test]
    fn set_cookie_rotates_ct0_and_auth_token_without_persisting_when_not_file_backed() {
        let client = XClient::new(make_session()).unwrap();
        let mut h = HeaderMap::new();
        h.append(SET_COOKIE, "ct0=NEW_CT0; Max-Age=21600; Path=/; Secure".parse().unwrap());
        h.append(SET_COOKIE, "auth_token=NEW_AUTH; Path=/; HttpOnly".parse().unwrap());
        h.append(SET_COOKIE, "guest_id=ignored; Path=/".parse().unwrap());
        client.observe("Viewer", &h);
        let session = client.session();
        assert_eq!(session.ct0, "NEW_CT0");
        assert_eq!(session.auth_token, "NEW_AUTH");
    }

    #[test]
    fn empty_set_cookie_values_are_deletions_not_rotations() {
        let client = XClient::new(make_session()).unwrap();
        let mut h = HeaderMap::new();
        h.append(SET_COOKIE, "ct0=; Max-Age=0; Path=/".parse().unwrap());
        client.observe("Viewer", &h);
        assert_eq!(client.session().ct0, "CT0_PLACEHOLDER");
    }

    #[tokio::test]
    async fn call_scope_collects_the_snapshot_of_its_own_call() {
        let client = XClient::new(make_session()).unwrap();
        let scope = Arc::new(CallScope::new(Duration::ZERO));
        let mut h = HeaderMap::new();
        h.insert("x-rate-limit-limit", "10".parse().unwrap());
        h.insert("x-rate-limit-remaining", "7".parse().unwrap());
        h.insert("x-rate-limit-reset", "9999999999".parse().unwrap());
        with_call_scope(scope.clone(), async {
            client.observe("Likes", &h);
        })
        .await;
        assert_eq!(scope.observed().unwrap().remaining, 7);
    }

    #[tokio::test]
    async fn exhausted_endpoint_fails_fast_when_the_wait_exceeds_the_scope() {
        let client = XClient::new(make_session()).unwrap();
        let mut h = HeaderMap::new();
        h.insert("x-rate-limit-limit", "10".parse().unwrap());
        h.insert("x-rate-limit-remaining", "0".parse().unwrap());
        h.insert("x-rate-limit-reset", (now_epoch() + 3600).to_string().parse().unwrap());
        client.observe("Likes", &h);

        // No scope: no proactive wait (legacy behaviour).
        assert!(client.wait_for_endpoint("Likes").await.is_ok());
        // Scope too short for a one-hour window: the caller decides.
        let scope = Arc::new(CallScope::new(Duration::from_secs(5)));
        let outcome = with_call_scope(scope, client.wait_for_endpoint("Likes")).await;
        assert!(matches!(outcome, Err(XError::RateLimited { .. })), "{outcome:?}");
    }

    #[test]
    fn check_api_errors_returns_ok_when_no_errors_key() {
        let body = serde_json::json!({"data": {"foo": "bar"}});
        assert!(check_api_errors(&body).is_ok());
    }

    #[test]
    fn check_api_errors_surfaces_code_and_message() {
        let body = serde_json::json!({
            "errors": [{"code": 32, "message": "Could not authenticate you"}]
        });
        let err = check_api_errors(&body).unwrap_err();
        match err {
            XError::Api { code, message } => {
                assert_eq!(code, 32);
                assert!(message.contains("authenticate"));
            },
            other => panic!("expected XError::Api, got {other:?}"),
        }
    }

    #[test]
    fn check_api_errors_empty_errors_array_is_ok() {
        let body = serde_json::json!({"errors": []});
        assert!(check_api_errors(&body).is_ok());
    }
}
