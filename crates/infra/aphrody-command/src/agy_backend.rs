// SPDX-License-Identifier: Apache-2.0
//! `agy` (Antigravity) chat backend — drives the OAuth token written by the
//! **agy CLI** to talk to Gemini `generateContent`, with zero dependency on the
//! legacy `gemini` CLI binary.
//!
//! The token is read at **runtime** from the platform credential store (Windows
//! Credential Manager entry `gemini:antigravity`) that the agy CLI persists; no
//! secret is embedded in the binary. This is the same authentication path
//! `aphrody antigravity chat` uses (see [`crate::antigravity_cmd`]), surfaced
//! here as an [`aphrody_chat::backend::ModelBackend`] so the unified chat
//! turn-loop can default to agy instead of bootstrapping the `gemini` CLI.

use aphrody_antigravity::{
    SdkError,
    client::AntigravityClient,
    endpoints::{EU_VERTEX_LOCATION, VERTEX_FALLBACK_MODEL},
    models::{Content, GenerateContentRequest, Part},
};
use aphrody_chat::{
    Message, MessageRole,
    backend::{BackendResponse, ModelBackend},
    error::ChatError,
};
use aphrody_google::GoogleRuntime;
use async_trait::async_trait;

/// Default bare Gemini model id used when `--model` is not supplied. The Cloud
/// Code `:generateContent` envelope expects the bare id (no `models/` prefix).
///
/// `gemini-3-flash` is a current Cloud Code wire id (it appears in the live
/// `fetchAvailableModels` `commandModelIds`, verified 2026-09-07); the former
/// `gemini-3-flash-preview` id now 404s (`NOT_FOUND`). Discover the full list
/// via `aphrody antigravity models`. We pair it with the **Daily** Cloud Code
/// endpoint (see [`AGY_ENDPOINT`]), the host agy uses, which serves it with a
/// usable quota (Prod 429s it almost immediately).
const DEFAULT_AGY_MODEL: &str = "gemini-3-flash";

/// Cloud Code endpoint the agy backend targets. `agy.exe` talks to the **Daily**
/// host (`daily-cloudcode-pa.googleapis.com`), confirmed from its own logs; it
/// serves the Gemini 3 preview models with a far more generous per-model quota
/// than Prod (which rate-limits `gemini-3-flash-preview` after a single call).
/// Transient 429s are still absorbed by the SDK's back-off retry.
const AGY_ENDPOINT: aphrody_antigravity::endpoints::CloudCodeEndpoint =
    aphrody_antigravity::endpoints::CloudCodeEndpoint::Daily;

/// Chat backend authenticating via the agy (Antigravity) token and dispatching
/// turns through the **Cloud Code modelbackend** (`daily-cloudcode-pa.googleapis.com/
/// v1internal:generateContent`, see [`AGY_ENDPOINT`]) — the exact host+path
/// `agy.exe` uses. The agy OAuth token is scoped for this host (the public
/// `generativelanguage` host rejects it with `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`),
/// and it carries the account's Code Assist tier (e.g. Google One AI Ultra).
pub(crate) struct AgyBackend {
    client: AntigravityClient,
    model: String,
    /// Cloud AI Companion project. Resolved lazily on first turn via
    /// `loadCodeAssist` (like agy's startup bootstrap) unless preset from the
    /// `APHRODY_CLOUDCODE_PROJECT` / `GOOGLE_CLOUD_PROJECT` env override.
    project: tokio::sync::OnceCell<String>,
    /// When `true`, skip Cloud Code entirely and route directly to Vertex AI
    /// (`{location}-aiplatform.googleapis.com`). Set by `APHRODY_VERTEX_FALLBACK=1`
    /// at construction time, or triggered automatically at runtime after a
    /// geo-restriction `400 FAILED_PRECONDITION` from Cloud Code.
    force_vertex: bool,
}

impl AgyBackend {
    /// Build the backend, reading the agy OAuth token from the platform
    /// credential store. `model` falls back to [`DEFAULT_AGY_MODEL`] when it is
    /// `None`, empty, or a vendor-qualified slug whose bare id cannot be derived.
    ///
    /// # Errors
    ///
    /// [`ChatError::BackendFailure`] when the credential store has no usable
    /// `gemini:antigravity` token (sign in via the agy CLI first) or the host
    /// has no credential store (non-Windows).
    pub(crate) fn connect(model: Option<&str>) -> Result<Self, ChatError> {
        // rustls 0.23 requires a CryptoProvider before the first reqwest client;
        // idempotent — `main` may already have installed one (CLAUDE.md §7).
        let _ = rustls::crypto::ring::default_provider().install_default();

        let client = AntigravityClient::from_credential_manager()
            .map_err(|e| ChatError::BackendFailure(format!("agy credential store: {e}")))?;

        // Env override skips the loadCodeAssist round-trip (lower latency).
        let project = tokio::sync::OnceCell::new();
        if let Ok(p) = std::env::var("APHRODY_CLOUDCODE_PROJECT")
            .or_else(|_| std::env::var("GOOGLE_CLOUD_PROJECT"))
            && !p.is_empty()
        {
            let _ = project.set(p);
        }

        // `APHRODY_VERTEX_FALLBACK=1` skips Cloud Code entirely and routes
        // directly to Vertex AI — useful on EEA hosts (OVH VPS France) where
        // Cloud Code always returns `400 FAILED_PRECONDITION` geo-restriction.
        let force_vertex = std::env::var("APHRODY_VERTEX_FALLBACK")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        Ok(Self { client, model: normalise_model(model), project, force_vertex })
    }

    /// Resolve (and cache) the Cloud AI Companion project for this account,
    /// mirroring agy's `loadCodeAssist` bootstrap.
    async fn project(&self) -> Result<&str, ChatError> {
        self.project
            .get_or_try_init(|| async {
                self.client
                    .resolve_cloudcode_project()
                    .await
                    .map_err(|e| classify_agy_error("loadCodeAssist", e))?
                    .ok_or_else(|| {
                        ChatError::BackendFailure(
                            "no cloudaicompanionProject for this account (run `aphrody \
                             antigravity onboard` first)"
                                .to_owned(),
                        )
                    })
            })
            .await
            .map(String::as_str)
    }

    /// Dispatch a `generateContent` turn to the regional **Vertex AI** endpoint.
    ///
    /// Reads `APHRODY_VERTEX_LOCATION` (default: `europe-west9`, Paris) and
    /// `APHRODY_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT` (default: the project
    /// embedded in the SDK). The agy OAuth token is accepted at this endpoint,
    /// unlike the public `generativelanguage` host which rejects it.
    ///
    /// The Cloud Code wire model id is mapped to its Vertex publisher model id
    /// via [`vertex_model_from`]; unknown ids pass through unchanged.
    async fn generate_via_vertex(
        &self,
        req: &GenerateContentRequest,
    ) -> Result<aphrody_antigravity::models::GenerateContentResponse, ChatError> {
        let location = std::env::var("APHRODY_VERTEX_LOCATION")
            .unwrap_or_else(|_| EU_VERTEX_LOCATION.to_owned());
        let project = GoogleRuntime::from_env().project.id().to_owned();
        let model = std::env::var("APHRODY_VERTEX_MODEL")
            .unwrap_or_else(|_| vertex_model_from(&self.model));

        self.client
            .generate_content_vertex(&model, &project, &location, req)
            .await
            .map_err(|e| classify_agy_error("generateContent/vertex", e))
    }
}

/// Map a (possibly vendor-qualified) model slug to the bare Gemini id the
/// `generateContent` path expects. `gemini/default` and the empty string both
/// resolve to [`DEFAULT_AGY_MODEL`]; a `gemini/<id>` slug is reduced to `<id>`.
///
/// The public-API id `gemini-3.5-flash` (which Cloud Code 404s) is rewritten to
/// the wire id Cloud Code actually serves for that model, [`DEFAULT_AGY_MODEL`]
/// — the same mapping `agy.exe` applies behind its "Gemini 3.5 Flash" label — so
/// a caller (e.g. the desktop GUI) that requests `gemini-3.5-flash` on the agy
/// path still gets a working turn instead of a 404.
fn normalise_model(model: Option<&str>) -> String {
    let raw = model.map(str::trim).unwrap_or("");
    // Strip a leading `gemini/` vendor qualifier if present.
    let bare = raw.strip_prefix("gemini/").unwrap_or(raw);
    if bare.is_empty() || bare == "default" {
        DEFAULT_AGY_MODEL.to_owned()
    } else if matches!(
        bare,
        "gemini-3.8-flash" | "3.8-flash" | "gemini-3.5-flash" | "3.5-flash" | "gemini-flash"
    ) {
        // No literal gemini-3.x-flash on Cloud Code -> the served Gemini 3 Flash.
        // Deliberately the constant, not a second literal: when the wire id was
        // renamed, this copy kept returning the 404ing id long after the
        // constant was fixed, because nothing tied the two together.
        DEFAULT_AGY_MODEL.to_owned()
    } else {
        bare.to_owned()
    }
}

/// Map a Cloud Code wire model id to its **Vertex AI publisher model id**.
///
/// Cloud Code uses internal wire ids (e.g. `gemini-3-flash`) that differ from
/// the Vertex AI publisher model ids (`gemini-2.0-flash-001`). Unknown ids are
/// passed through unchanged — Vertex may accept them directly, and a 404 from
/// Vertex is more actionable than a silent wrong-model call.
///
/// Override the resolved id entirely with `APHRODY_VERTEX_MODEL` (read in
/// [`AgyBackend::generate_via_vertex`] before this function is called).
fn vertex_model_from(cloud_code_model: &str) -> String {
    match cloud_code_model {
        // The Cloud Code wire id for Gemini 3 Flash maps to the Vertex
        // publisher model that carries comparable capabilities.
        "gemini-3-flash" | "gemini-3.8-flash" | "gemini-3.5-flash" => {
            VERTEX_FALLBACK_MODEL.to_owned()
        },
        other => other.to_owned(),
    }
}

/// Classify an [`SdkError`] from an authenticated Cloud Code call into a
/// [`ChatError`].
///
/// A `401`/`403` from Google means the agy (Antigravity) OAuth token is expired
/// or lacks the required scope/tier. We surface a SHORT, actionable message —
/// and deliberately drop the raw Google JSON error body — so every caller
/// (including the desktop GUI, which renders the captured `stderr` verbatim) can
/// prompt a re-auth instead of dumping a nested error blob. Every other error
/// keeps the contextual `agy {stage}: {err}` form for debugging.
fn classify_agy_error(stage: &str, err: SdkError) -> ChatError {
    match err {
        SdkError::OAuthServer { status: status @ (401 | 403), .. } => {
            ChatError::BackendFailure(format!(
                "agy (Antigravity) token rejected by Google (HTTP {status}). The Google AI \
                 session has expired — re-authenticate with `aphrody antigravity login` (or `agy` \
                 login), or run `aphrody chat --stub` for an offline smoke test."
            ))
        },
        // 429 only reaches here after the SDK has already retried with back-off
        // (see `AntigravityClient::post_json_with_retry`). A clean, actionable
        // message — never the raw quota JSON, which the GUI renders verbatim.
        SdkError::OAuthServer { status: 429, .. } => ChatError::BackendFailure(
            "agy: model quota exhausted (HTTP 429) and still rate-limited after automatic \
             retries. This Code Assist tier enforces a tight per-model quota — wait ~1 min, \
             switch to a higher-quota model (e.g. `--model gemini-2.5-flash`), or point `aphrody \
             exec` at a local provider (`--oss`), which has no Cloud Code quota."
                .to_owned(),
        ),
        other => ChatError::BackendFailure(format!("agy {stage}: {other}")),
    }
}

#[async_trait]
impl ModelBackend for AgyBackend {
    fn name(&self) -> &str {
        "agy/antigravity"
    }

    async fn complete(&self, messages: &[Message]) -> Result<BackendResponse, ChatError> {
        // Project chat messages into the generateContent shape:
        //   * System turns are merged into `system_instruction`.
        //   * Assistant turns map to role "model"; user / tool turns to "user".
        let mut contents: Vec<Content> = Vec::new();
        let mut system_text = String::new();
        for m in messages {
            match m.role {
                MessageRole::System => {
                    if !system_text.is_empty() {
                        system_text.push('\n');
                    }
                    system_text.push_str(&m.content);
                },
                MessageRole::Assistant => contents.push(Content {
                    role: Some("model".to_owned()),
                    parts: vec![Part::text(m.content.clone())],
                }),
                MessageRole::User | MessageRole::Tool => contents.push(Content {
                    role: Some("user".to_owned()),
                    parts: vec![Part::text(m.content.clone())],
                }),
            }
        }

        let system_instruction = (!system_text.is_empty())
            .then(|| Content { role: None, parts: vec![Part::text(system_text)] });

        let req = GenerateContentRequest {
            contents,
            generation_config: None,
            system_instruction,
            tools: Vec::new(),
            tool_config: None,
        };

        // ── Transport selection ───────────────────────────────────────────────
        //
        // Primary:  Cloud Code modelbackend (`daily-cloudcode-pa.googleapis.com`)
        //           — the exact path agy.exe uses, carrying the AI Ultra tier.
        //
        // Fallback: Vertex AI regional endpoint (`{location}-aiplatform.googleapis.com`)
        //           — no EEA geo-restriction, accepts the same agy OAuth token.
        //           Triggered automatically when Cloud Code returns `400
        //           FAILED_PRECONDITION` (geo-block from France/EEA), or
        //           unconditionally when `APHRODY_VERTEX_FALLBACK=1` is set
        //           (recommended for OVH VPS hosts that are always in France).

        let cloud_code_result = if self.force_vertex {
            // Skip Cloud Code entirely — the VPS host is in France and will
            // always get geo-blocked. No point making a round-trip that will fail.
            None
        } else {
            let project = self.project().await?;
            Some(
                self.client
                    .generate_content_cloud_code(AGY_ENDPOINT, &self.model, project, &req)
                    .await,
            )
        };

        let resp = match cloud_code_result {
            // Cloud Code succeeded.
            Some(Ok(r)) => r,

            // Cloud Code geo-blocked this EEA request → transparent Vertex fallback.
            Some(Err(ref e)) if e.is_geo_restricted() => self.generate_via_vertex(&req).await?,

            // Cloud Code returned a different error → classify and propagate.
            Some(Err(e)) => return Err(classify_agy_error("generateContent", e)),

            // force_vertex=true: go straight to Vertex (no Cloud Code attempt).
            None => self.generate_via_vertex(&req).await?,
        };

        let resolved_model = resp.model_version.clone();
        let content = resp.first_text().ok_or_else(|| {
            ChatError::BackendFailure("agy generateContent returned no text candidate".to_owned())
        })?;

        Ok(BackendResponse {
            content,
            tool_calls: Vec::new(),
            // generateContent surfaces usage in `usage_metadata` as raw JSON;
            // the chat loop does not consume per-turn token counts yet.
            prompt_tokens: 0,
            completion_tokens: 0,
            resolved_model,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_model_defaults() {
        assert_eq!(normalise_model(None), DEFAULT_AGY_MODEL);
        assert_eq!(normalise_model(Some("")), DEFAULT_AGY_MODEL);
        assert_eq!(normalise_model(Some("  ")), DEFAULT_AGY_MODEL);
        assert_eq!(normalise_model(Some("default")), DEFAULT_AGY_MODEL);
        assert_eq!(normalise_model(Some("gemini/default")), DEFAULT_AGY_MODEL);
    }

    #[test]
    fn normalise_model_strips_vendor_prefix() {
        assert_eq!(normalise_model(Some("gemini/gemini-2.5-flash")), "gemini-2.5-flash");
        assert_eq!(normalise_model(Some("gemini-2.0-flash")), "gemini-2.0-flash");
    }

    #[test]
    fn normalise_model_rewrites_public_3_5_flash_to_served_wire_id() {
        // The public-API id 404s on Cloud Code; it must map to the id agy uses.
        assert_eq!(normalise_model(Some("gemini-3.8-flash")), "gemini-3-flash");
        assert_eq!(normalise_model(Some("gemini/gemini-3.8-flash")), "gemini-3-flash");
        assert_eq!(normalise_model(Some("3.8-flash")), "gemini-3-flash");
        assert_eq!(normalise_model(Some("gemini-3.5-flash")), "gemini-3-flash");
        assert_eq!(normalise_model(Some("gemini/gemini-3.5-flash")), "gemini-3-flash");
        assert_eq!(normalise_model(Some("3.5-flash")), "gemini-3-flash");
        // And the default is already the served wire id.
        assert_eq!(DEFAULT_AGY_MODEL, "gemini-3-flash");
    }

    #[test]
    fn classify_agy_error_maps_401_to_actionable_message() {
        // A 401 carrying a raw Google JSON body must become a short, actionable
        // re-auth message that NEVER leaks the body into the UI.
        let err = SdkError::OAuthServer {
            status: 401,
            body: "{\"error\":{\"message\":\"invalid authentication credentials\"}}".to_owned(),
        };
        let mapped = classify_agy_error("generateContent", err).to_string();
        assert!(mapped.contains("401"), "status surfaced: {mapped}");
        assert!(
            mapped.contains("aphrody antigravity login"),
            "actionable re-auth hint present: {mapped}"
        );
        assert!(
            !mapped.contains("invalid authentication credentials"),
            "raw Google JSON body must not leak: {mapped}"
        );
    }

    #[test]
    fn classify_agy_error_maps_403_scope_failure() {
        let err = SdkError::OAuthServer {
            status: 403,
            body: "ACCESS_TOKEN_SCOPE_INSUFFICIENT".to_owned(),
        };
        let mapped = classify_agy_error("generateContent", err).to_string();
        assert!(mapped.contains("403"), "status surfaced: {mapped}");
        assert!(
            !mapped.contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT"),
            "raw body must not leak: {mapped}"
        );
    }

    #[test]
    fn classify_agy_error_maps_429_to_actionable_message_without_leaking_body() {
        // After the SDK's retries are exhausted, a 429 must become a short,
        // actionable message — never the raw RESOURCE_EXHAUSTED JSON (the GUI
        // renders stderr verbatim).
        let err = SdkError::OAuthServer {
            status: 429,
            body: "{\"error\":{\"message\":\"You have exhausted your capacity on this \
                   model.\",\"status\":\"RESOURCE_EXHAUSTED\"}}"
                .to_owned(),
        };
        let mapped = classify_agy_error("generateContent", err).to_string();
        assert!(mapped.contains("429"), "status surfaced: {mapped}");
        assert!(mapped.contains("--oss"), "actionable alternative present: {mapped}");
        assert!(!mapped.contains("RESOURCE_EXHAUSTED"), "raw quota JSON must not leak: {mapped}");
    }

    #[test]
    fn classify_agy_error_preserves_non_auth_errors() {
        // A non-auth SDK error keeps the contextual stage + full message so
        // debugging information is not lost.
        let mapped = classify_agy_error("loadCodeAssist", SdkError::EmptyCredential).to_string();
        assert!(mapped.contains("loadCodeAssist"), "stage preserved: {mapped}");
    }

    #[test]
    fn classify_agy_error_preserves_non_401_oauth_status() {
        // A 5xx from the OAuth server is a transient server fault, not an
        // expired token — it must keep the raw detail (stage + status).\
        let err = SdkError::OAuthServer { status: 503, body: "upstream unavailable".to_owned() };
        let mapped = classify_agy_error("generateContent", err).to_string();
        assert!(mapped.contains("generateContent"), "stage preserved: {mapped}");
        assert!(mapped.contains("503"), "status preserved: {mapped}");
    }

    // ── vertex_model_from tests ───────────────────────────────────────────────

    #[test]
    fn vertex_model_from_maps_cloud_code_wire_ids() {
        // The Cloud Code wire ids for Gemini 3 Flash must map to the Vertex
        // publisher model id — not be passed through unchanged.
        assert_eq!(vertex_model_from("gemini-3-flash"), VERTEX_FALLBACK_MODEL);
        assert_eq!(vertex_model_from("gemini-3.8-flash"), VERTEX_FALLBACK_MODEL);
        assert_eq!(vertex_model_from("gemini-3.5-flash"), VERTEX_FALLBACK_MODEL);
    }

    #[test]
    fn vertex_model_from_passes_unknown_ids_through() {
        // Unknown ids pass through unchanged so Vertex can return a 404 if the
        // model doesn't exist — more actionable than a silent wrong-model call.
        assert_eq!(vertex_model_from("gemini-2.5-pro"), "gemini-2.5-pro");
        assert_eq!(vertex_model_from("claude-3-5-sonnet"), "claude-3-5-sonnet");
        assert_eq!(vertex_model_from("some-future-model-001"), "some-future-model-001");
    }

    // ── SdkError::is_geo_restricted tests ────────────────────────────────────
    // (The method lives in antigravity-sdk; these are integration-style tests
    // that verify the consumer-side pattern used in complete().)

    #[test]
    fn is_geo_restricted_detects_failed_precondition_400() {
        let err = SdkError::OAuthServer {
            status: 400,
            body: "{\"error\":{\"code\":400,\"message\":\"User location is not supported for the \
                   API use.\",\"status\":\"FAILED_PRECONDITION\"}}"
                .to_owned(),
        };
        assert!(err.is_geo_restricted(), "must detect EEA geo-block: {err}");
    }

    #[test]
    fn is_geo_restricted_ignores_other_status_codes() {
        // Only a 400 carrying the geo-restriction body triggers the fallback.
        // A 401, 403, or 429 must NOT be mistaken for a geo-block.
        for status in [401u16, 403, 429, 500] {
            let err = SdkError::OAuthServer { status, body: "FAILED_PRECONDITION".to_owned() };
            assert!(
                !err.is_geo_restricted(),
                "status {status} must not be treated as geo-restricted"
            );
        }
    }

    #[test]
    fn is_geo_restricted_ignores_unrelated_400() {
        // A 400 that is not a geo-restriction (e.g. a bad request body) must
        // not trigger the Vertex fallback.
        let err = SdkError::OAuthServer {
            status: 400,
            body: "{\"error\":{\"code\":400,\"message\":\"Invalid \
                   JSON\",\"status\":\"INVALID_ARGUMENT\"}}"
                .to_owned(),
        };
        assert!(!err.is_geo_restricted(), "unrelated 400 must not be geo-restricted: {err}");
    }
}
