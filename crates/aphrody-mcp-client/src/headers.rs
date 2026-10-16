// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Credential helpers shared by every caller that turns a server entry into a connection.
//!
//! Configuration files never store secrets. A header value is either a literal, or a
//! `${NAME}` / `Bearer ${NAME}` placeholder naming an environment variable. These helpers expand
//! the placeholders and fail closed: a missing credential is an error, never an unauthenticated
//! request. They are the single implementation behind `aphrody mcp`, `aphrody-mcp client` and the
//! `aphrody-gemini-runtime` configuration loader.

use std::collections::BTreeMap;

use aphrody_config::mcp::{McpServerConfig, McpServerTransportConfig};

use crate::error::{McpClientError, Result};

const BEARER_PREFIX: &str = "Bearer ";

/// Name of the environment variable referenced when `value` is exactly one `${NAME}` placeholder.
fn placeholder_variable(value: &str) -> Option<&str> {
    let name = value.strip_prefix("${")?.strip_suffix('}')?;
    (!name.is_empty()).then_some(name)
}

/// Parse a `Bearer ${NAME}` header value.
///
/// Returns `NAME` only when `value` is exactly that placeholder. A loader uses it to store the
/// credential as `bearer_token_env_var` instead of keeping a placeholder inside a header map.
#[must_use]
pub fn bearer_env_var(value: &str) -> Option<&str> {
    placeholder_variable(value.strip_prefix(BEARER_PREFIX)?)
}

/// Expand one header value.
///
/// A literal is returned unchanged. `${NAME}` and `Bearer ${NAME}` are replaced by the value of
/// the environment variable `NAME`.
///
/// # Errors
///
/// [`McpClientError::MissingHeaderEnvironment`] when the variable is unset or empty. The error
/// names the header and the variable, never a value.
pub fn expand_header_value(name: &str, value: &str) -> Result<String> {
    let (prefix, raw) = match value.strip_prefix(BEARER_PREFIX) {
        Some(rest) => (BEARER_PREFIX, rest),
        None => ("", value),
    };
    let Some(variable) = placeholder_variable(raw) else {
        return Ok(value.to_owned());
    };
    match std::env::var(variable) {
        Ok(secret) if !secret.is_empty() => Ok(format!("{prefix}{secret}")),
        _ => Err(McpClientError::MissingHeaderEnvironment {
            name: name.to_owned(),
            variable: variable.to_owned(),
        }),
    }
}

/// Expand the placeholders of every header in `headers`.
///
/// # Errors
///
/// The first [`McpClientError::MissingHeaderEnvironment`] encountered.
pub fn resolve_header_placeholders(
    headers: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>> {
    let mut resolved = BTreeMap::new();
    for (name, value) in headers {
        resolved.insert(name.clone(), expand_header_value(name, value)?);
    }
    Ok(resolved)
}

/// Return a copy of `cfg` that is ready to connect with, or an error when a credential is missing.
///
/// For a streamable HTTP server the `${NAME}` placeholders of `http_headers` are expanded and the
/// variable named by `bearer_token_env_var` must be set and non-empty. Stdio entries are returned
/// unchanged. [`crate::McpClient::from_config`] also uses this helper so a missing
/// credential stops every configured connection before reaching the server.
///
/// # Errors
///
/// [`McpClientError::MissingHeaderEnvironment`] for the first unset or empty variable.
pub fn resolve_server_secrets(cfg: &McpServerConfig) -> Result<McpServerConfig> {
    let mut resolved = cfg.clone();
    if let McpServerTransportConfig::StreamableHttp { bearer_token_env_var, http_headers, .. } =
        &mut resolved.transport
    {
        if let Some(variable) = bearer_token_env_var.as_deref() {
            match std::env::var(variable) {
                Ok(secret) if !secret.is_empty() => {},
                _ => {
                    return Err(McpClientError::MissingHeaderEnvironment {
                        name: "Authorization".to_owned(),
                        variable: variable.to_owned(),
                    });
                },
            }
        }
        if let Some(map) = http_headers.take() {
            *http_headers = Some(resolve_header_placeholders(&map)?);
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(json: serde_json::Value) -> McpServerConfig {
        serde_json::from_value(json).expect("valid server entry")
    }

    #[test]
    fn bearer_env_var_accepts_only_the_exact_placeholder() {
        assert_eq!(bearer_env_var("Bearer ${API_TOKEN}"), Some("API_TOKEN"));
        assert_eq!(bearer_env_var("Bearer abc"), None);
        assert_eq!(bearer_env_var("${API_TOKEN}"), None);
        assert_eq!(bearer_env_var("Bearer ${}"), None);
        assert_eq!(bearer_env_var("Bearer pre-${API_TOKEN}"), None);
    }

    #[test]
    fn literal_values_are_returned_unchanged() {
        assert_eq!(expand_header_value("X-Project", "workspace-1").unwrap(), "workspace-1");
        assert_eq!(expand_header_value("Authorization", "Bearer abc123").unwrap(), "Bearer abc123");
    }

    #[test]
    fn placeholders_expand_from_the_environment() {
        // `PATH` is set and non-empty on every platform the tests run on, which avoids mutating
        // the process environment.
        let path = std::env::var("PATH").expect("PATH is set");
        assert_eq!(
            expand_header_value("Authorization", "Bearer ${PATH}").unwrap(),
            format!("Bearer {path}")
        );
        assert_eq!(expand_header_value("X-Path", "${PATH}").unwrap(), path);
    }

    #[test]
    fn unset_variable_fails_closed_naming_header_and_variable_only() {
        let error =
            expand_header_value("Authorization", "Bearer ${APHRODY_MCP_TEST_DEFINITELY_UNSET}")
                .unwrap_err();
        assert!(matches!(
            &error,
            McpClientError::MissingHeaderEnvironment { name, variable }
                if name == "Authorization" && variable == "APHRODY_MCP_TEST_DEFINITELY_UNSET"
        ));
    }

    #[test]
    fn resolve_server_secrets_requires_the_bearer_variable() {
        let cfg = server(serde_json::json!({
            "url": "https://example.test/mcp",
            "bearer_token_env_var": "APHRODY_MCP_TEST_DEFINITELY_UNSET",
        }));
        let error = resolve_server_secrets(&cfg).unwrap_err();
        assert!(matches!(
            error,
            McpClientError::MissingHeaderEnvironment { ref name, .. } if name == "Authorization"
        ));
    }

    #[test]
    fn resolve_server_secrets_expands_header_placeholders_and_leaves_stdio_alone() {
        let path = std::env::var("PATH").expect("PATH is set");
        let http = server(serde_json::json!({
            "url": "https://example.test/mcp",
            "bearer_token_env_var": "PATH",
            "http_headers": { "X-Path": "${PATH}", "X-Project": "workspace-1" },
        }));
        let resolved = resolve_server_secrets(&http).unwrap();
        let McpServerTransportConfig::StreamableHttp { http_headers, .. } = resolved.transport
        else {
            panic!("expected a streamable HTTP server");
        };
        let headers = http_headers.expect("headers kept");
        assert_eq!(headers.get("X-Path"), Some(&path));
        assert_eq!(headers.get("X-Project").map(String::as_str), Some("workspace-1"));

        let stdio = server(serde_json::json!({ "command": "server", "args": ["--stdio"] }));
        assert_eq!(resolve_server_secrets(&stdio).unwrap(), stdio);
    }
}
