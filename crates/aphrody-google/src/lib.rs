// SPDX-License-Identifier: Apache-2.0
//! Aphrody OS Google facade: the Bun Google SDK (`bun_google`: search, language atlas, project
//! contract) plus the OS integrations that need model clients and credentials: Antigravity, Gemini,
//! the `google` CLI, routes, detection, rate limits and translation.

pub use bun_google::*;

pub use aphrody_antigravity as antigravity;
#[cfg(not(target_arch = "wasm32"))]
pub use aphrody_gemini_runtime as gemini_runtime;
pub use aphrody_gemini_web as gemini_web;
#[cfg(not(target_arch = "wasm32"))]
pub use aphrody_model_client as model_client;
#[cfg(not(target_arch = "wasm32"))]
mod cli;
#[cfg(not(target_arch = "wasm32"))]
pub use cli::cli_main;
#[cfg(not(target_arch = "wasm32"))]
pub mod detection;
#[cfg(not(target_arch = "wasm32"))]
pub mod rate_limit;
#[cfg(not(target_arch = "wasm32"))]
pub mod routes;
#[cfg(not(target_arch = "wasm32"))]
pub mod translate;

/// Create an authenticated Antigravity client from the platform credential
/// store. The token is kept inside the SDK client and is never serialized.
pub fn authenticated_client() -> Result<antigravity::AntigravityClient, antigravity::SdkError> {
    antigravity::AntigravityClient::from_credential_manager()
}

/// Create an authenticated client from a completed OAuth PKCE login and persist
/// the credentials using the platform's protected credential store (host-only: the loopback
/// redirect listener and the credential store do not exist in a browser).
#[cfg(not(target_arch = "wasm32"))]
pub async fn login() -> Result<(), antigravity::SdkError> {
    let token = antigravity::login().await?;
    antigravity::persist(&token)
}
