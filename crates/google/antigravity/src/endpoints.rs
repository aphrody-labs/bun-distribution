// SPDX-License-Identifier: Apache-2.0
//! Public network surface of the Antigravity (Google AI Ultra / Gemini)
//! desktop client.
//!
//! These constants were reverse-engineered from the Antigravity 2.0.1 client
//! and confirmed against its live OAuth flow. They are **not secrets**: OAuth
//! client IDs and endpoint hosts are embedded in every distributed copy of the
//! application (desktop OAuth uses the Authorization-Code + PKCE flow, which
//! has no confidential client secret). The user's tokens are *not* stored
//! here — read those at runtime via [`crate::auth::token_from_credential_manager`].
//!
//! ## Architecture
//!
//! The Antigravity desktop app is an Electron shell that launches a
//! Codeium/Windsurf-derived Go `language_server.exe` (`--standalone
//! --subclient_type hub`). All auth + API traffic flows through that local
//! language server, which exposes a self-signed, cert-pinned local HTTPS
//! endpoint speaking Codeium `exa.*` protobuf gRPC. This SDK targets the
//! upstream Google endpoints directly with the OAuth Bearer token rather than
//! the local gRPC bridge, which is the simpler and more portable surface.

// ---------------------------------------------------------------------------
// OAuth 2.0
// ---------------------------------------------------------------------------

/// Secondary OAuth 2.0 client-id also embedded in the desktop binary
/// (the primary one is [`crate::auth::ANTIGRAVITY_CLIENT_ID`]).
pub const ANTIGRAVITY_CLIENT_ID_SECONDARY: &str =
    "884354919052-36trc1jjb3tguiac32ov6cod268c5blh.apps.googleusercontent.com";

/// Loopback redirect URI used by the desktop sign-in flow.
pub const OAUTH_REDIRECT_URI: &str = "http://localhost:9109/oauth-callback";

/// Google OAuth 2.0 authorization endpoint (browser redirect target).
pub const OAUTH_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";

/// Google OAuth 2.0 `tokeninfo` endpoint (validate an access token).
pub const OAUTH_TOKENINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v3/tokeninfo";

/// Google OpenID `userinfo` endpoint (email + profile of the signed-in user).
pub const OAUTH_USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

// ---------------------------------------------------------------------------
// API hosts
// ---------------------------------------------------------------------------

/// Gemini generative-language API host (`generateContent`, models, etc.).
pub const GEMINI_API_HOST: &str = "https://generativelanguage.googleapis.com";

/// Antigravity CLI version advertised in the `User-Agent`. The Cloud Code
/// backend gates the *supported* client surface on this product token: an
/// arbitrary UA is treated as the retired "Gemini Code Assist for individuals"
/// client and rejected (`UNSUPPORTED_CLIENT` / no eligible tier). Verified by
/// capturing the live `agy.exe` 1.1.27 request (2026-09-07). Bump alongside
/// the pinned `agy` in the runtimes.
pub const ANTIGRAVITY_CLI_VERSION: &str = "1.1.27";

/// The `ideType` the Antigravity CLI declares to `loadCodeAssist`. Sending
/// `{"metadata":{"ideType":"ANTIGRAVITY"}}` (rather than an empty body) is what
/// routes a *consumer* account onto the supported Antigravity tier instead of
/// the retired individuals Code Assist tier. Verified against live `agy`.
pub const IDE_TYPE_ANTIGRAVITY: &str = "ANTIGRAVITY";

/// Build the `User-Agent` the Antigravity CLI sends, e.g.
/// `antigravity/cli/1.1.27 (aidev_client; os_type=windows; arch=amd64; auth_method=consumer)`.
///
/// `auth_method` comes from the credential-store envelope (`consumer` for a
/// personal Google AI account); it defaults to `consumer` when unknown.
#[must_use]
pub fn antigravity_user_agent(auth_method: Option<&str>) -> String {
    let os_type = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "amd64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    };
    format!(
        "antigravity/cli/{ver} (aidev_client; os_type={os_type}; arch={arch}; auth_method={am})",
        ver = ANTIGRAVITY_CLI_VERSION,
        am = auth_method.unwrap_or("consumer"),
    )
}

/// The `loadCodeAssist` request body the Antigravity CLI sends: the client
/// metadata declaring the Antigravity `ideType`.
#[must_use]
pub fn load_code_assist_metadata() -> serde_json::Value {
    serde_json::json!({ "metadata": { "ideType": IDE_TYPE_ANTIGRAVITY } })
}

/// Vertex AI host (publishers/google + publishers/anthropic models).
pub const VERTEX_AI_HOST: &str = "https://aiplatform.googleapis.com";

/// Default Vertex project bound to the Antigravity account (mirrors the Python
/// `aphrody.vertex.DEFAULT_VERTEX_PROJECT`). Override via `APHRODY_VERTEX_PROJECT`
/// or `GOOGLE_CLOUD_PROJECT`.
pub const DEFAULT_VERTEX_PROJECT: &str = "aphrody";

/// Default Vertex region (mirrors the Python `DEFAULT_VERTEX_LOCATION`).
/// Override via `APHRODY_VERTEX_LOCATION`.
pub const DEFAULT_VERTEX_LOCATION: &str = "us-central1";

/// EU Vertex AI region (Paris). Accepts French/EEA IPs with no geo-restriction,
/// unlike `cloudcode-pa.googleapis.com` which blocks EEA with `400 FAILED_PRECONDITION`.
/// Used as the automatic fallback location when Cloud Code rejects a request from France.
/// Override via `APHRODY_VERTEX_LOCATION`.
pub const EU_VERTEX_LOCATION: &str = "europe-west9";

/// Vertex AI publisher model id used as the geo-fallback when Cloud Code is
/// geo-restricted. Maps the Cloud Code wire id `gemini-3-flash` to its Vertex
/// equivalent. Override via `APHRODY_VERTEX_MODEL`.
pub const VERTEX_FALLBACK_MODEL: &str = "gemini-2.0-flash-001";

/// Build the regional Vertex AI `generateContent` URL for a Google publisher
/// model.
///
/// The agy OAuth token is accepted at this regional Vertex endpoint, unlike the
/// public `generativelanguage.googleapis.com` host which rejects it with
/// `401 ACCESS_TOKEN_TYPE_UNSUPPORTED`. This mirrors the working Python keyless
/// path (`google-genai` with `vertexai=True`).
#[must_use]
pub fn vertex_generate_content_url(project: &str, location: &str, model: &str) -> String {
    format!(
        "https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent"
    )
}

/// Cloud Code "Private API" host. The desktop client defaults its runtime to
/// [`Daily`](CloudCodeEndpoint::Daily) but ships [`Prod`](CloudCodeEndpoint::Prod)
/// as the stable surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudCodeEndpoint {
    /// Production Cloud Code endpoint (`cloudcode-pa.googleapis.com`).
    Prod,
    /// Daily / runtime-default Cloud Code endpoint
    /// (`daily-cloudcode-pa.googleapis.com`).
    Daily,
}

impl CloudCodeEndpoint {
    /// The HTTPS host (no trailing slash) for this endpoint.
    #[must_use]
    pub const fn host(self) -> &'static str {
        match self {
            CloudCodeEndpoint::Prod => "https://cloudcode-pa.googleapis.com",
            CloudCodeEndpoint::Daily => "https://daily-cloudcode-pa.googleapis.com",
        }
    }

    /// Build the absolute URL for a Cloud Code method on this endpoint.
    ///
    /// `method` is one of the `METHOD_*` path constants (e.g.
    /// [`METHOD_LOAD_CODE_ASSIST`]).
    #[must_use]
    pub fn url(self, method: &str) -> String {
        format!("{}{method}", self.host())
    }
}

impl Default for CloudCodeEndpoint {
    /// Mirrors the desktop client's runtime default ([`Daily`](Self::Daily)).
    fn default() -> Self {
        CloudCodeEndpoint::Daily
    }
}

// ---------------------------------------------------------------------------
// Cloud Code `v1internal` method paths
// ---------------------------------------------------------------------------

/// `POST /v1internal:loadCodeAssist` — bootstrap the Code Assist session
/// (project, tier, entitlements) for the signed-in user.
pub const METHOD_LOAD_CODE_ASSIST: &str = "/v1internal:loadCodeAssist";

/// `POST /v1internal:fetchAvailableModels` — list the models available to the
/// user's account / tier.
pub const METHOD_FETCH_AVAILABLE_MODELS: &str = "/v1internal:fetchAvailableModels";

/// `POST /v1internal:onboardUser` — onboarding / first-run provisioning.
pub const METHOD_ONBOARD_USER: &str = "/v1internal:onboardUser";

/// `POST /v1internal:generateContent` — the Cloud Code **modelbackend** path
/// (`cloud/developer_experience/cloudcode/pa/modelbackend`) that agy.exe uses to
/// reach Gemini/Anthropic/OpenAI. The agy OAuth token is scoped for this host;
/// it is rejected (403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) by the public
/// `generativelanguage` host. Body envelope: `{ model, project, request }`;
/// the reply wraps the standard `GenerateContentResponse` under `response`.
pub const METHOD_GENERATE_CONTENT: &str = "/v1internal:generateContent";

/// `POST /v1internal:streamGenerateContent?alt=sse` — the streaming SSE Cloud Code modelbackend
/// path.
pub const METHOD_STREAM_GENERATE_CONTENT: &str = "/v1internal:streamGenerateContent?alt=sse";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_code_default_is_daily() {
        assert_eq!(CloudCodeEndpoint::default(), CloudCodeEndpoint::Daily);
    }

    #[test]
    fn user_agent_matches_agy_shape() {
        // Verified live: antigravity/cli/<ver> (aidev_client; os_type=…; arch=…; auth_method=…)
        let ua = antigravity_user_agent(Some("consumer"));
        assert!(
            ua.starts_with(&format!("antigravity/cli/{ANTIGRAVITY_CLI_VERSION} (aidev_client;"))
        );
        assert!(ua.contains("auth_method=consumer"));
        assert!(ua.contains("os_type="));
        assert!(ua.contains("arch="));
        // Defaults to consumer when the store omits auth_method.
        assert!(antigravity_user_agent(None).contains("auth_method=consumer"));
    }

    #[test]
    fn load_code_assist_metadata_declares_antigravity_ide() {
        let body = load_code_assist_metadata();
        assert_eq!(body["metadata"]["ideType"], IDE_TYPE_ANTIGRAVITY);
    }

    #[test]
    fn cloud_code_url_composition() {
        assert_eq!(
            CloudCodeEndpoint::Prod.url(METHOD_LOAD_CODE_ASSIST),
            "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
        );
        assert_eq!(
            CloudCodeEndpoint::Daily.url(METHOD_FETCH_AVAILABLE_MODELS),
            "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
        );
    }

    #[test]
    fn hosts_have_no_trailing_slash() {
        assert!(!CloudCodeEndpoint::Prod.host().ends_with('/'));
        assert!(!CloudCodeEndpoint::Daily.host().ends_with('/'));
        assert!(!GEMINI_API_HOST.ends_with('/'));
        assert!(!VERTEX_AI_HOST.ends_with('/'));
    }

    #[test]
    fn secondary_client_id_is_well_formed() {
        assert!(ANTIGRAVITY_CLIENT_ID_SECONDARY.ends_with(".apps.googleusercontent.com"));
    }
}
