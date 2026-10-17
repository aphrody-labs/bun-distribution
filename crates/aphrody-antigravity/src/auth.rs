// SPDX-License-Identifier: Apache-2.0
//! Google OAuth token types and acquisition from the Windows Credential Manager.
//!
//! The Antigravity CLI (`agy`) installer writes the Google OAuth token as a
//! **generic credential** named `gemini:antigravity` inside the Windows
//! Credential Manager.  The blob is plaintext UTF-8 JSON with the shape:
//!
//! ```json
//! {
//!   "token": {
//!     "access_token": "ya29.…",
//!     "refresh_token": "1//…",
//!     "expiry": "2026-05-21T12:00:00Z"
//!   }
//! }
//! ```
//!
//! `token_from_credential_manager` extracts and parses that blob on Windows.
//! On all other platforms the function returns `SdkError::Unsupported`.

use serde::{Deserialize, Serialize};

use crate::error::SdkError;

// ---------------------------------------------------------------------------
// OAuth constants
// ---------------------------------------------------------------------------

/// OAuth 2.0 client-id used by the Antigravity CLI.
pub const ANTIGRAVITY_CLIENT_ID: &str =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

/// OAuth 2.0 token endpoint.
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";

/// Environment variables that may supply the Antigravity OAuth `client_secret`,
/// in priority order.
///
/// Google rejects both the PKCE code exchange and the `refresh_token` grant
/// for this client with `400 client_secret is missing` unless the secret the
/// desktop binary ships is presented. We never embed that secret (repo policy); an operator who
/// wants a fully standalone refresh sets one of these. When none is set the
/// refresh path falls back to re-reading the OS credential store, which the
/// running Antigravity desktop app keeps fresh (the keyless design).
pub const CLIENT_SECRET_ENV_VARS: &[&str] = &[
    "APHRODY_ANTIGRAVITY_OAUTH_CLIENT_SECRET",
    "ANTIGRAVITY_OAUTH_CLIENT_SECRET",
];

/// Resolve the Antigravity OAuth client secret from the environment.
///
/// Returns the first non-empty value among [`CLIENT_SECRET_ENV_VARS`], or
/// `None` when the standalone refresh is not configured (the common case —
/// refresh then goes through the keyless credential-store re-read).
#[must_use]
pub fn resolve_client_secret_from_env() -> Option<String> {
    CLIENT_SECRET_ENV_VARS
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
}

/// Scopes that the Antigravity desktop client requests in the live sign-in
/// flow (verified against the running 2.0.1 client, 2026-05-21).
pub const ANTIGRAVITY_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
];

// ---------------------------------------------------------------------------
// Token type
// ---------------------------------------------------------------------------

/// A Google OAuth 2.0 token pair extracted from the Antigravity Credential
/// Manager entry or from an OAuth refresh response.
///
/// All fields map directly onto the JSON stored by `agy`:
/// `{"token": {"access_token": "…", "refresh_token": "…", "expiry": "…"}}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    /// Short-lived Bearer token for API requests (`Authorization: Bearer …`).
    pub access_token: String,

    /// Long-lived refresh token used to obtain a new access token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,

    /// RFC 3339 expiry time reported by the auth server (opaque string,
    /// stored as-is to avoid pulling in a datetime library at the SDK layer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry: Option<String>,

    /// Auth method reported by the credential-store envelope (`consumer` for a
    /// personal Google AI account, otherwise an enterprise/workspace value).
    /// Feeds the Antigravity `User-Agent`; `None` when the store omits it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<String>,
}

// ---------------------------------------------------------------------------
// Private helpers for JSON envelope shapes
// ---------------------------------------------------------------------------

/// Outer envelope: `{"token": <InnerToken>, "auth_method": "consumer"}`.
///
/// Read by the platform credential stores, which a browser does not have.
#[cfg(any(unix, target_os = "windows", test))]
#[derive(Deserialize)]
struct TokenEnvelope {
    token: InnerToken,
    /// Top-level `auth_method` (e.g. `consumer`) — sibling of `token`, so it is
    /// captured here rather than in [`InnerToken`].
    #[serde(default)]
    auth_method: Option<String>,
}

/// Inner token fields as stored by agy / as returned by the refresh endpoint.
#[derive(Deserialize)]
struct InnerToken {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Also accepted as `expires_in` (seconds, integer) from the refresh response;
    /// stored in `expiry` as a raw string.
    #[serde(default)]
    expiry: Option<String>,
}

impl From<InnerToken> for OAuthToken {
    fn from(inner: InnerToken) -> Self {
        OAuthToken {
            access_token: inner.access_token,
            refresh_token: inner.refresh_token,
            expiry: inner.expiry,
            auth_method: None,
        }
    }
}

#[cfg(any(unix, target_os = "windows", test))]
impl TokenEnvelope {
    /// Fold the envelope into an [`OAuthToken`], carrying the top-level
    /// `auth_method` alongside the inner token fields.
    fn into_token(self) -> OAuthToken {
        OAuthToken {
            auth_method: self.auth_method,
            ..OAuthToken::from(self.token)
        }
    }
}

// ---------------------------------------------------------------------------
// Credential Manager extraction (Windows only)
// ---------------------------------------------------------------------------

/// Read the Antigravity OAuth token from the platform credential store.
///
/// Resolution order:
///
/// * **Unix (Linux/macOS)** — first existing file among:
///   1. `~/.config/aphrody/antigravity-token.json` (`aphrody antigravity login`)
///   2. `~/.gemini/antigravity-cli/antigravity-oauth-token` (official `agy` CLI,
///      libsecret / file store per [Antigravity CLI docs](https://antigravity.google/docs/cli-reference))
/// * **Windows** — Credential Manager generic credential `gemini:antigravity` (same JSON envelope
///   as the Unix files).
///
/// # Errors
///
/// * [`SdkError::Unsupported`] — no store on this platform, or no token file.
/// * [`SdkError::CredentialManager`] — Win32 `CredReadW` failed (Windows).
/// * [`SdkError::EmptyCredential`] — blob present but zero-length (Windows).
/// * [`SdkError::TokenParse`] — blob is not valid JSON / missing fields.
/// * [`SdkError::Io`] — Unix token file could not be read.
pub fn token_from_credential_manager() -> Result<OAuthToken, SdkError> {
    #[cfg(unix)]
    {
        if let Some(token) = unix_impl::read_token_file()? {
            return Ok(token);
        }
    }

    // On Windows the credential manager is the only source, so this returns
    // directly; the fallback below is what every other target reaches. Gating
    // the fallback too keeps it from being compiled as dead code behind that
    // `return`, which is what `unreachable_expression` was flagging.
    #[cfg(target_os = "windows")]
    {
        windows_impl::read_credential()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(SdkError::Unsupported(
            "no Antigravity OAuth token found; run `agy` or `aphrody antigravity login`",
        ))
    }
}

#[cfg(unix)]
mod unix_impl {
    use std::{fs, path::PathBuf};

    use super::{OAuthToken, TokenEnvelope};
    use crate::error::SdkError;

    /// Candidate token files, highest precedence first.
    fn token_paths() -> Result<Vec<PathBuf>, SdkError> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut paths = Vec::new();

        let config_base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|h| h.join(".config")));
        if let Some(base) = config_base {
            paths.push(base.join("aphrody").join("antigravity-token.json"));
        }

        if let Some(home) = home {
            paths.push(
                home.join(".gemini")
                    .join("antigravity-cli")
                    .join("antigravity-oauth-token"),
            );
        }

        Ok(paths)
    }

    fn parse_envelope_bytes(blob: &[u8]) -> Result<OAuthToken, SdkError> {
        let envelope: TokenEnvelope = serde_json::from_slice(blob)?;
        Ok(envelope.into_token())
    }

    /// Return the first parseable token from the candidate paths, or `Ok(None)`
    /// when none exist.
    pub(super) fn read_token_file() -> Result<Option<OAuthToken>, SdkError> {
        for path in token_paths()? {
            if !path.is_file() {
                continue;
            }
            let blob = fs::read(&path)?;
            if blob.is_empty() {
                return Err(SdkError::EmptyCredential);
            }
            return parse_envelope_bytes(&blob).map(Some);
        }
        Ok(None)
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
    };

    use super::{OAuthToken, TokenEnvelope};
    use crate::error::SdkError;

    /// Credential Manager target name used by the Antigravity CLI.
    const CRED_TARGET: &str = "gemini:antigravity";

    pub(super) fn read_credential() -> Result<OAuthToken, SdkError> {
        let target: Vec<u16> = CRED_TARGET
            .encode_utf16()
            .chain(std::iter::once(0u16))
            .collect();

        // SAFETY: `target` is a NUL-terminated UTF-16 string whose lifetime
        // extends past the CredReadW call.  On success CredReadW allocates a
        // CREDENTIALW on the LSASS heap; we read its contents exactly once,
        // then release the allocation with CredFree.  The blob slice
        // (`from_raw_parts`) is valid only until CredFree — we copy all data
        // out (via serde_json) before freeing.
        unsafe {
            let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
            let ok = CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pcred);
            if ok == 0 || pcred.is_null() {
                let code = windows_sys::Win32::Foundation::GetLastError();
                return Err(SdkError::CredentialManager { code });
            }

            let cred = &*pcred;
            let result = if cred.CredentialBlob.is_null() || cred.CredentialBlobSize == 0 {
                Err(SdkError::EmptyCredential)
            } else {
                let blob = std::slice::from_raw_parts(
                    cred.CredentialBlob,
                    cred.CredentialBlobSize as usize,
                );
                parse_blob(blob)
            };
            CredFree(pcred.cast());
            result
        }
    }

    /// Parse a raw credential blob into an [`OAuthToken`].
    fn parse_blob(blob: &[u8]) -> Result<OAuthToken, SdkError> {
        let envelope: TokenEnvelope = serde_json::from_slice(blob)?;
        Ok(envelope.into_token())
    }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

impl OAuthToken {
    /// Exchange the `refresh_token` for a fresh `access_token` using the
    /// Google OAuth 2.0 token endpoint.
    ///
    /// The returned [`OAuthToken`] keeps the original `refresh_token` if the
    /// server does not issue a new one (standard Google behavior).
    ///
    /// # Errors
    ///
    /// * [`SdkError::Unsupported`] — this token has no `refresh_token`.
    /// * [`SdkError::Http`] — transport-level failure.
    /// * [`SdkError::OAuthServer`] — non-2xx response from Google.
    /// * [`SdkError::TokenParse`] — response body is not valid JSON.
    pub async fn refresh(&self, client: &reqwest::Client) -> Result<OAuthToken, SdkError> {
        let Some(ref refresh_token) = self.refresh_token else {
            return Err(SdkError::Unsupported(
                "no refresh_token available; cannot refresh",
            ));
        };

        let mut params = vec![
            ("client_id", ANTIGRAVITY_CLIENT_ID.to_owned()),
            ("grant_type", "refresh_token".to_owned()),
            ("refresh_token", refresh_token.clone()),
        ];
        // Google rejects this grant with `400 client_secret is missing` for the
        // Antigravity client unless the desktop secret is presented. We only
        // send it when an operator supplies it via the environment; otherwise
        // the caller (`AntigravityClient::refresh_token`) falls back to the
        // keyless credential-store re-read.
        if let Some(secret) = resolve_client_secret_from_env() {
            params.push(("client_secret", secret));
        }

        let response = client.post(TOKEN_ENDPOINT).form(&params).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(SdkError::OAuthServer {
                status: status.as_u16(),
                body,
            });
        }

        // Google returns a flat JSON object: {"access_token": "…", "expires_in": 3599, …}
        // We normalise it into OAuthToken, keeping our existing refresh_token
        // if Google does not rotate it.
        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            #[serde(default)]
            refresh_token: Option<String>,
            /// Seconds until expiry — stored as a string for forward compatibility.
            #[serde(default)]
            expires_in: Option<u64>,
        }

        let body_text = response.text().await?;
        let resp: RefreshResponse = serde_json::from_str(&body_text)?;

        Ok(OAuthToken {
            access_token: resp.access_token,
            refresh_token: resp.refresh_token.or_else(|| self.refresh_token.clone()),
            expiry: resp.expires_in.map(|s| s.to_string()),
            // The refresh response has no auth_method; keep the one we loaded.
            auth_method: self.auth_method.clone(),
        })
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: parse the credential-manager-style envelope.
    fn parse_envelope(json: &str) -> Result<OAuthToken, SdkError> {
        let envelope: TokenEnvelope = serde_json::from_str(json)?;
        Ok(envelope.into_token())
    }

    #[test]
    fn client_secret_env_resolution() {
        // One test to avoid racing on the shared process environment (nextest
        // runs tests in parallel threads within a process).
        for name in CLIENT_SECRET_ENV_VARS {
            // SAFETY: no other test touches these vars; assertions below are
            // sequential within this single test body.
            unsafe { std::env::remove_var(name) };
        }
        // Opt-in: unset by default → keyless path is selected.
        assert!(resolve_client_secret_from_env().is_none());

        // Set → resolved, so the standalone OAuth refresh is used.
        let name = CLIENT_SECRET_ENV_VARS[0];
        unsafe { std::env::set_var(name, "GOCSPX-example") };
        assert_eq!(
            resolve_client_secret_from_env().as_deref(),
            Some("GOCSPX-example")
        );

        // Empty is treated as unset.
        unsafe { std::env::set_var(name, "") };
        assert!(resolve_client_secret_from_env().is_none());
        unsafe { std::env::remove_var(name) };
    }

    #[test]
    fn roundtrip_full_token() {
        let token = OAuthToken {
            access_token: "ya29.test".to_owned(),
            refresh_token: Some("1//test_refresh".to_owned()),
            expiry: Some("2026-05-21T12:00:00Z".to_owned()),
            auth_method: None,
        };
        let json = serde_json::to_string(&token).expect("serialize");
        let back: OAuthToken = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.access_token, token.access_token);
        assert_eq!(back.refresh_token, token.refresh_token);
        assert_eq!(back.expiry, token.expiry);
    }

    #[test]
    fn roundtrip_minimal_token() {
        let token = OAuthToken {
            access_token: "ya29.minimal".to_owned(),
            refresh_token: None,
            expiry: None,
            auth_method: None,
        };
        let json = serde_json::to_string(&token).expect("serialize");
        let back: OAuthToken = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.access_token, "ya29.minimal");
        assert!(back.refresh_token.is_none());
        assert!(back.expiry.is_none());
    }

    #[test]
    fn parse_agy_envelope_minimal() {
        let json = r#"{"token":{"access_token":"x"}}"#;
        let tok = parse_envelope(json).expect("parse");
        assert_eq!(tok.access_token, "x");
        assert!(tok.refresh_token.is_none());
        assert!(tok.expiry.is_none());
    }

    #[test]
    fn parse_agy_envelope_full() {
        let json = r#"{
            "token": {
                "access_token": "ya29.full",
                "refresh_token": "1//full_refresh",
                "expiry": "2026-05-21T18:30:00Z"
            }
        }"#;
        let tok = parse_envelope(json).expect("parse");
        assert_eq!(tok.access_token, "ya29.full");
        assert_eq!(tok.refresh_token.as_deref(), Some("1//full_refresh"));
        assert_eq!(tok.expiry.as_deref(), Some("2026-05-21T18:30:00Z"));
    }

    #[test]
    fn parse_agy_envelope_missing_access_token_errors() {
        let json = r#"{"token":{"refresh_token":"1//x"}}"#;
        let result = parse_envelope(json);
        assert!(
            result.is_err(),
            "expected error when access_token is missing"
        );
    }

    /// On Unix without a token file, `token_from_credential_manager` returns
    /// `SdkError::Unsupported`. When `~/.gemini/antigravity-cli/antigravity-oauth-token`
    /// or `~/.config/aphrody/antigravity-token.json` exists (agy / login), it succeeds.
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn credential_manager_unix_without_panic() {
        match token_from_credential_manager() {
            Ok(_) | Err(SdkError::Unsupported(_)) => {}
            Err(e) => panic!("unexpected error variant: {e:?}"),
        }
    }

    /// On Windows, requesting a non-existent credential must return a typed
    /// error (CredentialManager Win32 code) without panicking.
    ///
    /// This test only runs on Windows because the Win32 API is unavailable
    /// elsewhere.  It does not interact with real credentials; any missing
    /// entry triggers CredReadW == 0 which becomes SdkError::CredentialManager.
    #[cfg(target_os = "windows")]
    #[test]
    fn credential_manager_missing_entry_returns_error() {
        // We call the real Windows API.  If `gemini:antigravity` happens to
        // exist on the test machine the token will be returned successfully —
        // that is also acceptable behaviour (the test asserts "no panic").
        // If it does not exist we get SdkError::CredentialManager.
        let result = token_from_credential_manager();
        match result {
            Ok(_) | Err(SdkError::CredentialManager { .. }) => {}
            Err(e) => panic!("unexpected error variant: {e:?}"),
        }
    }
}
