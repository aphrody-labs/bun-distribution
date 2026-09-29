// SPDX-License-Identifier: Apache-2.0
//! Account and authentication management types.

use serde::{Deserialize, Serialize};

use super::common::AuthMode;

/// Parameters for `account/login/start`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginAccountParams {
    /// Requested authentication mode (e.g. ApiKey, Chatgpt, Oss).
    pub mode: Option<AuthMode>,
    /// API key string when mode is ApiKey.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// Response returned by `account/login/start`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginAccountResponse {
    /// URL to visit if interactive OAuth browser flow is required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_url: Option<String>,
    /// True if authentication completed immediately (e.g. valid API key or re-read store).
    #[serde(default)]
    pub completed: bool,
}

/// Parameters for `account/read`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountParams {}

/// Response returned by `account/read`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountResponse {
    /// Active authentication mode.
    pub auth_mode: Option<AuthMode>,
    /// Account email or identifier when authenticated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Plan type (e.g. "free", "plus", "team", "enterprise", "oss").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
}

/// Response returned by `account/logout`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutAccountResponse {
    pub success: bool,
}
