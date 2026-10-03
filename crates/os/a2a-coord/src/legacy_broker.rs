// SPDX-License-Identifier: Apache-2.0
//! Legacy `a2a-broker.ts` compatibility layer: `POST /jsonrpc` (`message/send`,
//! `message/stream`, `tasks/list`, `tasks/get`, `ping`) over the flat `.coord/messages.jsonl`
//! and `.coord/tasks.json` files, plus the live SSE feed `GET /events`.
//!
//! The agent card is intentionally not served here: the regular listener already serves
//! `/.well-known/agent-card.json` from the manifest.

use std::{
    convert::Infallible,
    io::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use futures::{Stream, StreamExt};
use serde_json::{Value, json};
use tokio::sync::broadcast;

/// SSE keep-alive period (same as the TS broker).
pub const KEEP_ALIVE: Duration = Duration::from_secs(30);

/// Shared broker state: coord files location and the live event bus.
#[derive(Debug)]
pub struct LegacyBroker {
    coord_dir: PathBuf,
    tx: broadcast::Sender<Value>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn empty_tasks_doc() -> String {
    let mut s = serde_json::to_string_pretty(&json!({ "tasks": [] })).unwrap_or_default();
    s.push('\n');
    s
}

/// Create the coordination directory (recursive).
///
/// # Errors
/// Propagates the I/O error.
pub fn ensure_coord_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Create `tasks.json` as `{"tasks": []}` when missing/empty (or always when `force`).
///
/// # Errors
/// Propagates I/O errors.
pub fn init_tasks_file(path: &Path, force: bool) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if force || !path.exists() {
        return std::fs::write(path, empty_tasks_doc());
    }
    if std::fs::read_to_string(path)?.trim().is_empty() {
        std::fs::write(path, empty_tasks_doc())?;
    }
    Ok(())
}

/// Read `tasks.json`, repairing missing/empty/corrupt/mis-shaped files to `{"tasks": []}`.
#[must_use]
pub fn read_tasks(path: &Path) -> Vec<Value> {
    let repair = |force: bool| {
        if let Err(e) = init_tasks_file(path, force) {
            tracing::warn!(path = %path.display(), "tasks.json repair failed: {e}");
        }
        Vec::new()
    };
    if !path.exists() {
        return repair(false);
    }
    let Ok(text) = std::fs::read_to_string(path) else { return repair(true) };
    if text.trim().is_empty() {
        return repair(false);
    }
    match serde_json::from_str::<Value>(text.trim()) {
        Ok(Value::Object(mut o)) => match o.remove("tasks") {
            Some(Value::Array(a)) => a,
            _ => repair(true),
        },
        _ => repair(true),
    }
}

/// Append one JSON line to `messages.jsonl`, creating parent directories.
///
/// # Errors
/// Propagates I/O errors.
pub fn append_message(msg: &Value, path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{msg}")
}

fn rpc_error(id: &Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

impl LegacyBroker {
    /// Create the broker; creates `coord_dir` and repairs `tasks.json`.
    #[must_use]
    pub fn new(coord_dir: impl Into<PathBuf>) -> Arc<Self> {
        let coord_dir = coord_dir.into();
        if let Err(e) = ensure_coord_dir(&coord_dir) {
            tracing::warn!(dir = %coord_dir.display(), "mkdir failed: {e}");
        }
        if let Err(e) = init_tasks_file(&coord_dir.join("tasks.json"), false) {
            tracing::warn!("initTasksFile failed: {e}");
        }
        let (tx, _) = broadcast::channel(256);
        Arc::new(Self { coord_dir, tx })
    }

    fn messages_path(&self) -> PathBuf {
        self.coord_dir.join("messages.jsonl")
    }

    fn tasks_path(&self) -> PathBuf {
        self.coord_dir.join("tasks.json")
    }

    /// Publish an event to every live SSE subscriber (no-op without subscribers).
    pub fn broadcast(&self, event: Value) {
        let _ = self.tx.send(event);
    }

    /// Live SSE stream: a `ready` event, then every broadcast event.
    pub fn sse(&self) -> Sse<impl Stream<Item = Result<Event, Infallible>> + use<>> {
        let rx = self.tx.subscribe();
        let ready = Event::default().data(json!({ "kind": "ready", "ts": now_iso() }).to_string());
        let first = futures::stream::once(async move { Ok::<Event, Infallible>(ready) });
        let rest = futures::stream::unfold(rx, |mut rx| async move {
            loop {
                match rx.recv().await {
                    Ok(v) => return Some((Ok::<Event, Infallible>(Event::default().data(v.to_string())), rx)),
                    Err(broadcast::error::RecvError::Lagged(_)) => {},
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        });
        Sse::new(first.chain(rest)).keep_alive(KeepAlive::new().interval(KEEP_ALIVE).text("ping"))
    }

    /// Handle one non-streaming JSON-RPC request body; always returns a JSON-RPC envelope.
    #[must_use]
    pub fn handle(&self, body: &Value) -> Value {
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        let params = body.get("params").unwrap_or(&Value::Null);
        let method = body.get("method").and_then(Value::as_str);
        match method {
            Some("message/send") => self.message_send(&id, params),
            Some("tasks/list") => {
                let want = |k: &str| params.get(k).filter(|v| !v.is_null() && v.as_str() != Some(""));
                let (status, agent) = (want("status"), want("agent"));
                let tasks: Vec<Value> = read_tasks(&self.tasks_path())
                    .into_iter()
                    .filter(|t| status.is_none_or(|s| t.get("status") == Some(s)))
                    .filter(|t| agent.is_none_or(|a| t.get("agent") == Some(a)))
                    .collect();
                json!({ "jsonrpc": "2.0", "id": id, "result": { "tasks": tasks } })
            },
            Some("tasks/get") => {
                let want = params.get("id");
                let found = read_tasks(&self.tasks_path())
                    .into_iter()
                    .find(|t| want.is_some() && t.get("id") == want)
                    .unwrap_or(Value::Null);
                json!({ "jsonrpc": "2.0", "id": id, "result": found })
            },
            Some("ping") => json!({ "jsonrpc": "2.0", "id": id, "result": { "pong": true } }),
            other => rpc_error(&id, -32601, format!("Method not found: {}", other.unwrap_or("undefined"))),
        }
    }

    fn message_send(&self, id: &Value, params: &Value) -> Value {
        let incoming = params.get("message").unwrap_or(&Value::Null);
        let parts = incoming.get("parts").and_then(Value::as_array).filter(|p| !p.is_empty());
        let Some(parts) = parts else { return rpc_error(id, -32602, "parts required") };
        let text = parts
            .iter()
            .filter(|p| p.get("kind").and_then(Value::as_str) == Some("text"))
            .map(|p| p.get("text").and_then(Value::as_str).unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        let non_null = |v: Option<&Value>| v.filter(|v| !v.is_null()).cloned();
        let msg_id = non_null(incoming.get("messageId"))
            .unwrap_or_else(|| Value::String(crate::envelope::new_id("msg")));
        let from = if incoming.get("role").and_then(Value::as_str) == Some("agent") {
            "agent"
        } else {
            "user"
        };
        let context = non_null(incoming.get("contextId")).unwrap_or(Value::Null);
        let msg = json!({
            "id": msg_id,
            "from": from,
            "to": non_null(params.get("to")).unwrap_or_else(|| json!("all")),
            "type": "request",
            "contextId": context,
            "content": text,
            "ts": now_iso(),
        });
        if let Err(e) = append_message(&msg, &self.messages_path()) {
            return rpc_error(id, -32000, e.to_string());
        }
        self.broadcast(json!({ "kind": "message", "message": msg }));
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "kind": "message",
                "messageId": msg["id"],
                "role": "agent",
                "parts": [{ "kind": "text", "text": "ack" }],
                "contextId": msg["contextId"],
            },
        })
    }
}

async fn jsonrpc(State(b): State<Arc<LegacyBroker>>, body: Bytes) -> Response {
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return Json(rpc_error(&Value::Null, -32700, "Parse error")).into_response();
    };
    if body.get("method").and_then(Value::as_str) == Some("message/stream") {
        return b.sse().into_response();
    }
    Json(b.handle(&body)).into_response()
}

async fn events(State(b): State<Arc<LegacyBroker>>) -> Response {
    b.sse().into_response()
}

/// Router exposing `POST /jsonrpc` and `GET /events`.
pub fn legacy_broker_router(broker: Arc<LegacyBroker>) -> Router {
    Router::new()
        .route("/jsonrpc", post(jsonrpc))
        .route("/events", get(events))
        .with_state(broker)
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn ensure_coord_dir_is_recursive() {
        let d = tmp();
        let nested = d.path().join("nested/sub/.coord");
        assert!(!nested.exists());
        ensure_coord_dir(&nested).unwrap();
        assert!(nested.exists());
    }

    #[test]
    fn read_tasks_initialises_missing_file() {
        let d = tmp();
        let p = d.path().join("tasks.json");
        assert!(read_tasks(&p).is_empty());
        let on_disk: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(on_disk, json!({ "tasks": [] }));
    }

    #[test]
    fn read_tasks_repairs_empty_file() {
        let d = tmp();
        let p = d.path().join("tasks.json");
        std::fs::write(&p, "").unwrap();
        assert!(read_tasks(&p).is_empty());
        let on_disk: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(on_disk, json!({ "tasks": [] }));
    }

    #[test]
    fn read_tasks_repairs_corrupt_file() {
        let d = tmp();
        let p = d.path().join("tasks.json");
        std::fs::write(&p, r#"{"tasks": [corrupted json..."#).unwrap();
        assert!(read_tasks(&p).is_empty());
        let on_disk: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(on_disk, json!({ "tasks": [] }));
    }

    #[test]
    fn read_tasks_reads_existing() {
        let d = tmp();
        let p = d.path().join("tasks.json");
        let tasks = json!([
            { "id": "task-1", "status": "pending", "agent": "claude" },
            { "id": "task-2", "status": "completed", "agent": "gemini" },
        ]);
        std::fs::write(&p, json!({ "tasks": tasks }).to_string()).unwrap();
        let got = read_tasks(&p);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0]["id"], "task-1");
        assert_eq!(got[1]["id"], "task-2");
    }

    #[test]
    fn append_message_creates_parent_dirs() {
        let d = tmp();
        let dir = d.path().join("nested/deep/.coord");
        let p = dir.join("messages.jsonl");
        assert!(!dir.exists());
        let msg = json!({ "id": "msg-test-1", "content": "Test append message auto mkdir" });
        append_message(&msg, &p).unwrap();
        let parsed: Value = serde_json::from_str(std::fs::read_to_string(&p).unwrap().trim()).unwrap();
        assert_eq!(parsed["id"], "msg-test-1");
        assert_eq!(parsed["content"], "Test append message auto mkdir");
    }

    #[test]
    fn append_message_stacks_jsonl_lines() {
        let d = tmp();
        let p = d.path().join("messages.jsonl");
        append_message(&json!({ "id": "msg-1", "content": "Premier message" }), &p).unwrap();
        append_message(&json!({ "id": "msg-2", "content": "Deuxième message" }), &p).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        let lines: Vec<&str> = text.trim().split('\n').collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(serde_json::from_str::<Value>(lines[0]).unwrap()["id"], "msg-1");
        assert_eq!(serde_json::from_str::<Value>(lines[1]).unwrap()["id"], "msg-2");
    }

    async fn post_rpc(app: &Router, body: Value) -> Value {
        let req = Request::builder()
            .method("POST")
            .uri("/jsonrpc")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), 200);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn jsonrpc_list_send_get_ping() {
        let d = tmp();
        let coord = d.path().join(".coord");
        let broker = LegacyBroker::new(&coord);
        let app = legacy_broker_router(broker.clone());

        let list = post_rpc(&app, json!({ "jsonrpc": "2.0", "id": 1, "method": "tasks/list" })).await;
        assert_eq!(list["result"]["tasks"], json!([]));

        let mut rx = broker.tx.subscribe();
        let send = post_rpc(
            &app,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "message/send", "params": { "message": {
                "messageId": "test-msg-rpc", "role": "user",
                "parts": [{ "kind": "text", "text": "salut broker" }] } } }),
        )
        .await;
        assert_eq!(send["result"]["messageId"], "test-msg-rpc");
        assert_eq!(send["result"]["parts"][0]["text"], "ack");
        let written = std::fs::read_to_string(coord.join("messages.jsonl")).unwrap();
        assert!(written.contains("salut broker"));
        let ev = rx.recv().await.unwrap();
        assert_eq!(ev["kind"], "message");
        assert_eq!(ev["message"]["content"], "salut broker");

        std::fs::write(
            coord.join("tasks.json"),
            json!({ "tasks": [
                { "id": "t1", "status": "pending", "agent": "claude" },
                { "id": "t2", "status": "completed", "agent": "gemini" } ] })
            .to_string(),
        )
        .unwrap();
        let f = post_rpc(
            &app,
            json!({ "jsonrpc": "2.0", "id": 3, "method": "tasks/list", "params": { "status": "completed" } }),
        )
        .await;
        assert_eq!(f["result"]["tasks"].as_array().unwrap().len(), 1);
        let g = post_rpc(
            &app,
            json!({ "jsonrpc": "2.0", "id": 4, "method": "tasks/get", "params": { "id": "t1" } }),
        )
        .await;
        assert_eq!(g["result"]["agent"], "claude");
        let ping = post_rpc(&app, json!({ "jsonrpc": "2.0", "id": 5, "method": "ping" })).await;
        assert_eq!(ping["result"], json!({ "pong": true }));
        let bad = post_rpc(&app, json!({ "jsonrpc": "2.0", "id": 6, "method": "nope" })).await;
        assert_eq!(bad["error"]["code"], -32601);
        let empty = post_rpc(
            &app,
            json!({ "jsonrpc": "2.0", "id": 7, "method": "message/send", "params": { "message": {} } }),
        )
        .await;
        assert_eq!(empty["error"]["code"], -32602);
    }
}
