//! Canonical Google/Gemini facade for the Aphrody ecosystem.
//!
//! This crate owns the integration boundary, not a second implementation:
//! Rust clients, Aphrody MCP, Bun/BXC and Python use the same project/home
//! contract while the specialized crates retain their domain code.

pub use aphrody_antigravity as antigravity;
pub use aphrody_gemini_runtime as gemini_runtime;
pub use aphrody_gemini_web as gemini_web;
pub use aphrody_model_client as model_client;
pub mod atlas;
mod cli;
pub use cli::cli_main;
#[cfg(not(target_arch = "wasm32"))]
pub mod detection;
pub mod language_detect;
pub mod languages;
#[cfg(not(target_arch = "wasm32"))]
pub mod rate_limit;
#[cfg(not(target_arch = "wasm32"))]
pub mod search;
#[cfg(not(target_arch = "wasm32"))]
pub mod translate;
use serde::{Deserialize, Serialize};

/// Create an authenticated Antigravity client from the platform credential
/// store. The token is kept inside the SDK client and is never serialized.
pub fn authenticated_client() -> Result<antigravity::AntigravityClient, antigravity::SdkError> {
    antigravity::AntigravityClient::from_credential_manager()
}

/// Create an authenticated client from a completed OAuth PKCE login and persist
/// the credentials using the platform's protected credential store.
pub async fn login() -> Result<(), antigravity::SdkError> {
    let token = antigravity::login().await?;
    antigravity::persist(&token)
}

/// Cloud target for a workload. DBFR and NIE use `Aphrody`; RG uses `Rgfr`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GoogleProject {
    Aphrody,
    Rgfr,
}

impl GoogleProject {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Aphrody => "aphrody",
            Self::Rgfr => "rgfr",
        }
    }
}

/// Non-secret runtime contract shared by Rust, Bun, Python and the kernel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleRuntime {
    pub project: GoogleProject,
    pub location: String,
    pub home: String,
    pub auth: String,
}

impl GoogleRuntime {
    /// Resolve only non-secret configuration from the process environment.
    pub fn from_env() -> Self {
        let project_name = std::env::var("APHRODY_VERTEX_PROJECT")
            .ok()
            .or_else(|| std::env::var("GOOGLE_CLOUD_PROJECT").ok());
        let project = match project_name.as_deref() {
            Some("rgfr") | Some("rgfr-8927d") => GoogleProject::Rgfr,
            _ => GoogleProject::Aphrody,
        };
        Self {
            project,
            location: std::env::var("GOOGLE_CLOUD_LOCATION")
                .unwrap_or_else(|_| "us-central1".to_owned()),
            home: std::env::var("APHRODY_HOME").unwrap_or_else(|_| "~/.aphrody".to_owned()),
            auth: std::env::var("APHRODY_GCP_AUTH")
                .unwrap_or_else(|_| "adc-or-secret-manager".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids_are_canonical() {
        assert_eq!(GoogleProject::Aphrody.id(), "aphrody");
        assert_eq!(GoogleProject::Rgfr.id(), "rgfr");
    }
}
