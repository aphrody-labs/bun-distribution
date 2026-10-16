// SPDX-License-Identifier: Apache-2.0
//! Wire-level JSON-RPC types for Codex app-server v2.
//!
//! Upstream Codex protocol specification:
//! - "We do not do true JSON-RPC 2.0, as we neither send nor expect the 'jsonrpc': '2.0' field."
//! - Request IDs can be either a string or an integer.
//! - Tolerates optional "jsonrpc" on input when deserializing, but never emits it when serializing.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Stable JSON-RPC version constant.
pub const JSONRPC_VERSION: &str = "2.0";

/// Identifier for a request/response pair: string or integer.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    /// String identifier (e.g. UUIDv7 or client-assigned string).
    String(String),
    /// Numeric integer identifier.
    Integer(i64),
}

impl fmt::Display for RequestId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::String(s) => f.write_str(s),
            Self::Integer(i) => write!(f, "{i}"),
        }
    }
}

impl From<String> for RequestId {
    fn from(s: String) -> Self {
        Self::String(s)
    }
}

impl From<&str> for RequestId {
    fn from(s: &str) -> Self {
        Self::String(s.to_string())
    }
}

impl From<i64> for RequestId {
    fn from(i: i64) -> Self {
        Self::Integer(i)
    }
}

impl From<u64> for RequestId {
    fn from(i: u64) -> Self {
        #[allow(clippy::cast_possible_wrap)]
        Self::Integer(i as i64)
    }
}

/// A request expecting a response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JSONRPCRequest {
    /// Request identifier matching the subsequent response.
    pub id: RequestId,
    /// Wire method name (e.g. "thread/start", "turn/start").
    pub method: String,
    /// Method-specific parameter payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    /// Optional W3C Trace Context string or map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace: Option<serde_json::Value>,
    /// Optional jsonrpc version string (tolerated on parse, omitted on emit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jsonrpc: Option<String>,
}

impl JSONRPCRequest {
    /// Create a new request without jsonrpc marker.
    #[must_use]
    pub fn new(
        id: impl Into<RequestId>,
        method: impl Into<String>,
        params: Option<serde_json::Value>,
    ) -> Self {
        Self {
            id: id.into(),
            method: method.into(),
            params,
            trace: None,
            jsonrpc: None,
        }
    }
}

/// A notification not expecting a response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JSONRPCNotification {
    /// Wire method name (e.g. "turn/started", "item/completed").
    pub method: String,
    /// Notification parameter payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    /// Optional jsonrpc version string (tolerated on parse, omitted on emit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jsonrpc: Option<String>,
}

impl JSONRPCNotification {
    /// Create a new notification without jsonrpc marker.
    #[must_use]
    pub fn new(method: impl Into<String>, params: Option<serde_json::Value>) -> Self {
        Self {
            method: method.into(),
            params,
            jsonrpc: None,
        }
    }
}

/// A successful response to a request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JSONRPCResponse {
    /// Request identifier corresponding to the original request.
    pub id: RequestId,
    /// Method-specific result payload.
    pub result: serde_json::Value,
    /// Optional jsonrpc version string (tolerated on parse, omitted on emit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jsonrpc: Option<String>,
}

impl JSONRPCResponse {
    /// Create a new response without jsonrpc marker.
    #[must_use]
    pub fn new(id: impl Into<RequestId>, result: serde_json::Value) -> Self {
        Self {
            id: id.into(),
            result,
            jsonrpc: None,
        }
    }
}

/// An error response to a request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JSONRPCError {
    /// Request identifier corresponding to the failed request.
    pub id: RequestId,
    /// Error detail structure.
    pub error: JSONRPCErrorError,
    /// Optional jsonrpc version string (tolerated on parse, omitted on emit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jsonrpc: Option<String>,
}

impl JSONRPCError {
    /// Create a standard error response.
    #[must_use]
    pub fn new(
        id: impl Into<RequestId>,
        code: i64,
        message: impl Into<String>,
        data: Option<serde_json::Value>,
    ) -> Self {
        Self {
            id: id.into(),
            error: JSONRPCErrorError {
                code,
                message: message.into(),
                data,
            },
            jsonrpc: None,
        }
    }

    /// Method not found (-32601) with unsupported: true data.
    #[must_use]
    pub fn method_not_found(id: impl Into<RequestId>, method: &str) -> Self {
        Self::new(
            id,
            -32601,
            format!("Method not found: {method}"),
            Some(serde_json::json!({ "unsupported": true })),
        )
    }
}

/// Error body within [`JSONRPCError`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JSONRPCErrorError {
    /// Numeric error code (standard JSON-RPC or application-specific).
    pub code: i64,
    /// Human-readable error description.
    pub message: String,
    /// Optional structured error data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Any valid wire frame received or sent over the app-server transport.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JSONRPCMessage {
    /// An inbound or outbound request.
    Request(JSONRPCRequest),
    /// An inbound or outbound notification.
    Notification(JSONRPCNotification),
    /// A successful response.
    Response(JSONRPCResponse),
    /// An error response.
    Error(JSONRPCError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_id_display_and_equality() {
        let s: RequestId = "req-123".into();
        let i: RequestId = 42i64.into();
        assert_eq!(s.to_string(), "req-123");
        assert_eq!(i.to_string(), "42");
        assert_ne!(s, i);
    }

    #[test]
    fn serde_omits_jsonrpc_by_default() {
        let req = JSONRPCRequest::new(1i64, "thread/start", Some(serde_json::json!({})));
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("jsonrpc"));
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"method\":\"thread/start\""));
    }

    #[test]
    fn serde_tolerates_jsonrpc_on_input() {
        let raw =
            r#"{"jsonrpc":"2.0","id":"abc","method":"turn/start","params":{"threadId":"t1"}}"#;
        let parsed: JSONRPCRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.id, RequestId::String("abc".to_string()));
        assert_eq!(parsed.method, "turn/start");
        assert_eq!(parsed.jsonrpc, Some("2.0".to_string()));
    }

    #[test]
    fn method_not_found_has_unsupported_flag() {
        let err = JSONRPCError::method_not_found("test-id", "unknown/verb");
        assert_eq!(err.error.code, -32601);
        let data = err.error.data.unwrap();
        assert_eq!(data["unsupported"], true);
    }
}
