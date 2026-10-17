// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/sd-tauri-core/src/lib.rs and src-tauri/src/main.rs),
// adopted as the Aphrody Drive file explorer.
//! Wire types of the explorer core.
//!
//! `sd-daemon` speaks newline-delimited JSON over a local TCP socket: one request object per
//! line (`{"Query": ...}`, `{"Action": ...}`, `{"Ping": null}`, `{"Subscribe": ...}`,
//! `"Unsubscribe"`), one response or event object per line. The JSON-RPC 2.0 envelope types are
//! the bridge contract the upstream `sd-tauri-core` crate defined for embedding the core.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Default daemon endpoint (the `sd-daemon` default instance).
pub const DEFAULT_SOCKET_ADDR: &str = "127.0.0.1:6969";

/// JSON-RPC 2.0 request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
    pub id: String,
}

impl JsonRpcRequest {
    /// A `2.0` request.
    #[must_use]
    pub fn new(method: impl Into<String>, params: Value, id: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            method: method.into(),
            params,
            id: id.into(),
        }
    }
}

/// JSON-RPC 2.0 response: exactly one of `result` or `error` is set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    /// A successful response.
    #[must_use]
    pub fn ok(id: impl Into<String>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: id.into(),
            result: Some(result),
            error: None,
        }
    }

    /// A failed response.
    #[must_use]
    pub fn err(id: impl Into<String>, error: JsonRpcError) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: id.into(),
            result: None,
            error: Some(error),
        }
    }
}

/// JSON-RPC 2.0 error object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Events the explorer subscribes to when the frontend names none; mirrors
/// `drive/packages/ts-client/src/event-filter.ts` (no `LogMessage` / `IndexingProgress` noise).
pub const DEFAULT_EVENT_SUBSCRIPTION: &[&str] = &[
    // Core lifecycle
    "CoreStarted",
    "CoreShutdown",
    // Libraries
    "LibraryCreated",
    "LibraryOpened",
    "LibraryClosed",
    "LibraryDeleted",
    "LibraryStatisticsUpdated",
    // Entries
    "EntryCreated",
    "EntryModified",
    "EntryDeleted",
    "EntryMoved",
    // Raw filesystem changes
    "FsRawChange",
    // Volumes
    "VolumeAdded",
    "VolumeRemoved",
    "VolumeUpdated",
    "VolumeSpeedTested",
    "VolumeMountChanged",
    "VolumeError",
    // Jobs
    "JobQueued",
    "JobStarted",
    "JobProgress",
    "JobCompleted",
    "JobFailed",
    "JobCancelled",
    "JobPaused",
    "JobResumed",
    // Indexing lifecycle
    "IndexingStarted",
    "IndexingCompleted",
    "IndexingFailed",
    // Devices
    "DeviceConnected",
    "DeviceDisconnected",
    // Resources
    "ResourceChanged",
    "ResourceChangedBatch",
    "ResourceDeleted",
    // Legacy compatibility
    "LocationAdded",
    "LocationRemoved",
    "FilesIndexed",
    "ThumbnailsGenerated",
    "FileOperationCompleted",
    "FilesModified",
];

/// Serialize one request as a protocol line (JSON plus `\n`).
///
/// # Errors
/// When the value cannot be serialized.
pub fn encode_line(request: &Value) -> Result<String, String> {
    serde_json::to_string(request)
        .map(|line| line + "\n")
        .map_err(|error| format!("Failed to serialize request: {error}"))
}

/// Parse one protocol line.
///
/// # Errors
/// When the line is not JSON; the message carries the raw line.
pub fn decode_line(line: &str) -> Result<Value, String> {
    serde_json::from_str(line.trim())
        .map_err(|error| format!("Failed to parse response: {error}. Raw: {}", line.trim()))
}

/// The `Ping` request the supervisor uses as a liveness probe.
#[must_use]
pub fn ping_request() -> Value {
    json!({ "Ping": null })
}

/// A `Subscribe` request; `None` event types select [`DEFAULT_EVENT_SUBSCRIPTION`].
#[must_use]
pub fn subscribe_request(event_types: Option<Vec<String>>, filter: Option<Value>) -> Value {
    let events = event_types.unwrap_or_else(|| {
        DEFAULT_EVENT_SUBSCRIPTION
            .iter()
            .map(ToString::to_string)
            .collect()
    });
    json!({ "Subscribe": { "event_types": events, "filter": filter } })
}

/// The `Unsubscribe` request.
#[must_use]
pub fn unsubscribe_request() -> Value {
    json!("Unsubscribe")
}

/// The event payload of a daemon line (`{"Event": ...}`), if it carries one.
#[must_use]
pub fn event_payload(message: &Value) -> Option<&Value> {
    message.get("Event")
}

/// The `libraries.list` query.
#[must_use]
pub fn list_libraries_request() -> Value {
    json!({
        "Query": {
            "method": "query:libraries.list",
            "library_id": null,
            "payload": { "include_stats": false }
        }
    })
}

/// The `libraries.open` action for a library folder.
#[must_use]
pub fn open_library_request(path: &str) -> Value {
    json!({
        "Action": {
            "method": "action:libraries.open.input",
            "library_id": null,
            "payload": { "path": path }
        }
    })
}

/// Whether a `libraries.list` response (`{"JsonOk": [...]}` or `{"result": [...]}`) lists the
/// library `id`.
///
/// # Errors
/// When the response does not carry a library array.
pub fn response_lists_library(response: &Value, id: &str) -> Result<bool, String> {
    let libraries = response
        .get("JsonOk")
        .or_else(|| response.get("result"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            format!("Invalid response format from libraries.list query. Raw: {response}")
        })?;
    Ok(libraries
        .iter()
        .any(|library| library.get("id").and_then(Value::as_str) == Some(id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_rpc_round_trip_skips_absent_members() {
        let request =
            JsonRpcRequest::new("query:libraries.list", json!({"include_stats": false}), "1");
        let text = serde_json::to_string(&request).unwrap();
        assert_eq!(
            serde_json::from_str::<JsonRpcRequest>(&text).unwrap(),
            request
        );
        assert!(text.contains(r#""jsonrpc":"2.0""#));

        let ok = serde_json::to_value(JsonRpcResponse::ok("1", json!([]))).unwrap();
        assert_eq!(ok, json!({"jsonrpc": "2.0", "id": "1", "result": []}));

        let error = JsonRpcError {
            code: -32601,
            message: "method not found".into(),
            data: None,
        };
        let failed = serde_json::to_value(JsonRpcResponse::err("2", error.clone())).unwrap();
        assert_eq!(
            failed,
            json!({"jsonrpc": "2.0", "id": "2", "error": {"code": -32601, "message": "method not found"}})
        );
        let parsed: JsonRpcResponse = serde_json::from_value(failed).unwrap();
        assert_eq!(parsed.error, Some(error));
        assert_eq!(parsed.result, None);
    }

    #[test]
    fn lines_are_newline_terminated_and_decoded() {
        let line = encode_line(&ping_request()).unwrap();
        assert_eq!(line, "{\"Ping\":null}\n");
        assert_eq!(decode_line(&line).unwrap(), ping_request());
        let error = decode_line("not json\n").unwrap_err();
        assert!(error.contains("Raw: not json"), "{error}");
    }

    #[test]
    fn subscribe_defaults_to_the_quiet_event_list() {
        let request = subscribe_request(None, None);
        let events = request["Subscribe"]["event_types"].as_array().unwrap();
        assert_eq!(events.len(), DEFAULT_EVENT_SUBSCRIPTION.len());
        assert!(
            !events
                .iter()
                .any(|event| event == "LogMessage" || event == "IndexingProgress")
        );
        let custom = subscribe_request(
            Some(vec!["JobQueued".into()]),
            Some(json!({"library_id": "x"})),
        );
        assert_eq!(
            custom,
            json!({"Subscribe": {"event_types": ["JobQueued"], "filter": {"library_id": "x"}}})
        );
        assert_eq!(unsubscribe_request(), json!("Unsubscribe"));
    }

    #[test]
    fn events_and_library_lists_are_recognised() {
        assert_eq!(
            event_payload(&json!({"Event": {"CoreStarted": null}})),
            Some(&json!({"CoreStarted": null}))
        );
        assert_eq!(event_payload(&json!({"JsonOk": 1})), None);
        let listing = json!({"JsonOk": [{"id": "a"}, {"id": "b"}]});
        assert!(response_lists_library(&listing, "b").unwrap());
        assert!(!response_lists_library(&listing, "c").unwrap());
        assert!(response_lists_library(&json!({"result": [{"id": "c"}]}), "c").unwrap());
        assert!(response_lists_library(&json!({"Error": "x"}), "c").is_err());
        assert_eq!(
            open_library_request("/x")["Action"]["payload"]["path"],
            "/x"
        );
        assert_eq!(
            list_libraries_request()["Query"]["method"],
            "query:libraries.list"
        );
    }
}
