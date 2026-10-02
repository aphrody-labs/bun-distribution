// SPDX-License-Identifier: Apache-2.0
//! The app-server broker: sole owner of the JSON-RPC connection to the agent.
//!
//! The agent runs in this process. [`aphrody_app_server::serve_stdio_with`] serves
//! newline-delimited JSON-RPC over two `tokio::io::duplex` pipes (one per direction), so there is
//! no child process, no `aphrody` binary to locate and no output to scrape. The broker starts the
//! server on first use, rewrites request ids so that several webviews can never collide,
//! correlates each response to its caller, pushes every server notification to the webviews as
//! the `aphrody://notification` event, and, if the server task ends (a failure, a panic, which
//! Tokio contains in the task, or a shutdown), fails the pending calls, starts a fresh server on
//! the next request and replays the `initialize` / `initialized` handshake the UI performed.
//! The renderer never opens a pipe or a process: it only reaches this module through the
//! allow-listed Tauri commands.
//!
//! The model store root the user picked is an option of the server
//! ([`aphrody_app_server::AppServer::with_models_dir`]), never an environment variable: mutating
//! the environment of a threaded process is `unsafe` in edition 2024.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aphrody_app_server::{AppServer, serve_stdio_with};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, ipc::Channel};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, duplex},
    sync::{Mutex, oneshot},
};

/// Event carrying one server notification to the webviews.
pub const NOTIFICATION_EVENT: &str = "aphrody://notification";
/// Event carrying backend lifecycle changes (`started`, `exited`).
pub const BACKEND_EVENT: &str = "aphrody://backend";

/// Upper bound for one request. `thread/start` may wait for a local model server to load.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

/// Capacity of each in-process pipe. A message larger than this still goes through: the writer
/// waits while the other end drains it.
const PIPE_CAPACITY: usize = 1 << 20;

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Value>>>>;
/// Per-thread streaming subscriptions installed by [`AppServerBroker::subscribe`].
type Channels = Arc<std::sync::Mutex<HashMap<String, Vec<Channel<Value>>>>>;

struct Connection {
    /// Client end of the server's input pipe. Closing it (dropping the connection) is the
    /// shutdown signal: the server joins every session, so each rollout is flushed, and returns.
    input: DuplexStream,
    /// Cleared by the supervising task once the server has ended, whatever the reason.
    alive: Arc<AtomicBool>,
    pending: Pending,
}

/// One destination for a routed notification. Real subscriptions are
/// [`tauri::ipc::Channel`]; the trait exists so [`route_to_subscriber`] is unit-testable
/// without a webview.
trait NotificationSink {
    /// Attempts delivery. `false` means the sink is no longer usable and its
    /// subscription must be dropped.
    fn deliver(&self, message: &Value) -> bool;
}

impl NotificationSink for Channel<Value> {
    fn deliver(&self, message: &Value) -> bool {
        self.send(message.clone()).is_ok()
    }
}

/// The thread a JSON-RPC notification is scoped to, read from `params.threadId`.
///
/// `None` for process-wide notifications (e.g. a malformed line diagnostic), which are
/// only ever broadcast on [`NOTIFICATION_EVENT`], never routed to a per-session channel.
fn notification_thread_id(message: &Value) -> Option<&str> {
    message.get("params")?.get("threadId")?.as_str()
}

/// Forward `message` to all channels subscribed to its thread, if any.
///
/// Drops dead subscriptions when delivery fails, which happens once the frontend has
/// dropped its side of the channel. Cleans up empty subscriber lists and returns whether
/// at least one subscriber received the message successfully.
fn route_to_subscriber<S: NotificationSink>(
    channels: &mut HashMap<String, Vec<S>>,
    message: &Value,
) -> bool {
    let Some(thread_id) = notification_thread_id(message) else { return false };
    let (any_delivered, is_empty) = match channels.get_mut(thread_id) {
        Some(sinks) => {
            let mut any_delivered = false;
            sinks.retain(|sink| {
                let delivered = sink.deliver(message);
                if delivered {
                    any_delivered = true;
                }
                delivered
            });
            (any_delivered, sinks.is_empty())
        },
        None => return false,
    };
    if is_empty {
        channels.remove(thread_id);
    }
    any_delivered
}

/// An in-process app-server and the client ends of its two pipes.
struct Link {
    /// Requests written here reach the server.
    input: DuplexStream,
    /// Responses and notifications the server wrote.
    output: DuplexStream,
    /// `true` while the server task runs.
    alive: Arc<AtomicBool>,
    /// Resolves with the reason the server ended, after `alive` has been cleared.
    exit: oneshot::Receiver<String>,
}

/// Start `server` on its own task, wired to two fresh in-memory pipes.
///
/// The server runs [`serve_stdio_with`] until its input is closed or it fails. A second task
/// supervises it: it observes how the first one ended (a clean close, an error, or a panic,
/// which Tokio contains in the task) and publishes that as the `exit` reason. Must be called
/// from within a Tokio runtime.
fn open_link(server: AppServer) -> Link {
    let (input, server_input) = duplex(PIPE_CAPACITY);
    let (server_output, output) = duplex(PIPE_CAPACITY);
    let serving =
        tokio::spawn(serve_stdio_with(BufReader::new(server_input), server_output, server));
    let alive = Arc::new(AtomicBool::new(true));
    let (publish, exit) = oneshot::channel();
    let flag = Arc::clone(&alive);
    tokio::spawn(async move {
        let reason = match serving.await {
            Ok(Ok(())) => "closed".to_owned(),
            Ok(Err(error)) => format!("failed: {error}"),
            Err(error) => format!("crashed: {error}"),
        };
        flag.store(false, Ordering::Release);
        let _ = publish.send(reason);
    });
    Link { input, output, alive, exit }
}

/// Deliver everything the server writes until its output ends.
///
/// A response (a message with `result` or `error` and a numeric `id`) wakes the caller waiting
/// on that id. Anything else is a notification: it is stamped with the backend `generation`,
/// routed to the subscribers of its thread and handed to `emit` for the global broadcast. When
/// the output ends, every call still waiting is failed by dropping its sender.
async fn pump<R, S>(
    output: R,
    pending: &Pending,
    channels: &std::sync::Mutex<HashMap<String, Vec<S>>>,
    generation: u64,
    mut emit: impl FnMut(Value),
) where
    R: AsyncBufRead + Unpin,
    S: NotificationSink,
{
    let mut lines = output.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            log::warn!("app-server wrote a non-JSON line ({} bytes)", line.len());
            continue;
        };
        let is_response = message.get("result").is_some() || message.get("error").is_some();
        match message.get("id").and_then(Value::as_u64) {
            Some(id) if is_response => {
                let sender =
                    pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&id);
                if let Some(sender) = sender {
                    let _ = sender.send(message);
                }
            },
            _ => {
                let mut notification = message;
                if let Some(object) = notification.as_object_mut() {
                    object.insert("backendGeneration".into(), json!(generation));
                }
                route_to_subscriber(
                    &mut channels.lock().unwrap_or_else(std::sync::PoisonError::into_inner),
                    &notification,
                );
                emit(notification);
            },
        }
    }
    // Dropping the senders fails every call still waiting on this server.
    pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clear();
}

/// Owns the in-process app-server and its JSON-RPC stream.
pub struct AppServerBroker {
    app: AppHandle,
    connection: Mutex<Option<Connection>>,
    next_id: std::sync::atomic::AtomicU64,
    /// Generation counter incremented on every app-server spawn to detect stale replies.
    generation: std::sync::atomic::AtomicU64,
    /// The UI's `initialize` params, replayed after a backend restart.
    handshake: std::sync::Mutex<Option<Value>>,
    /// Per-thread streaming subscriptions, keyed by `threadId`.
    channels: Channels,
}

impl AppServerBroker {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            connection: Mutex::new(None),
            next_id: std::sync::atomic::AtomicU64::new(1),
            generation: std::sync::atomic::AtomicU64::new(0),
            handshake: std::sync::Mutex::new(None),
            channels: Arc::default(),
        }
    }

    /// Return the active backend generation.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.generation.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Stream every future notification for `thread_id` over `channel`, in arrival order,
    /// in addition to the existing [`NOTIFICATION_EVENT`] broadcast. Adds the channel to
    /// the subscriber list for `thread_id` without overwriting subscriptions from other windows.
    pub fn subscribe(&self, thread_id: String, channel: Channel<Value>) {
        self.channels
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(thread_id)
            .or_default()
            .push(channel);
    }

    /// Stop streaming notifications for `thread_id`. A no-op when it has no subscription.
    pub fn unsubscribe(&self, thread_id: &str) {
        self.channels.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(thread_id);
    }

    /// Forward one JSON-RPC message from a webview and return the server's reply.
    ///
    /// A request (with `id`) resolves to the full response object with the caller's
    /// original `id` restored. A notification (no `id`) resolves to `{}` once written.
    ///
    /// # Errors
    /// Returns a message when the write fails, the backend ends before answering, or the
    /// request exceeds its timeout.
    pub async fn call(&self, mut message: Value) -> Result<Value, String> {
        let method = message.get("method").and_then(Value::as_str).unwrap_or_default().to_owned();
        if method == "initialize" {
            *self.handshake.lock().unwrap_or_else(std::sync::PoisonError::into_inner) =
                Some(message.get("params").cloned().unwrap_or(Value::Null));
        }
        let original_id = message.get("id").cloned();
        let mut guard = self.connection.lock().await;
        let restarted = self.ensure_started(&mut guard);
        let connection = guard.as_mut().ok_or("app-server backend unavailable")?;
        if restarted && method != "initialize" {
            self.replay_handshake(connection).await?;
        }
        let Some(original_id) = original_id else {
            write_line(&mut connection.input, &message).await?;
            return Ok(json!({}));
        };
        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        message["id"] = json!(id);
        let (sender, receiver) = oneshot::channel();
        connection
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, sender);
        if let Err(error) = write_line(&mut connection.input, &message).await {
            connection
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&id);
            return Err(error);
        }
        // Do not hold the connection while waiting: other calls and interrupts must pass.
        let pending = Arc::clone(&connection.pending);
        drop(guard);
        let mut response = match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return Err(format!("app-server exited before answering {method}")),
            Err(_) => {
                pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&id);
                return Err(format!("{method} timed out after {}s", REQUEST_TIMEOUT.as_secs()));
            },
        };
        response["id"] = original_id;
        if method == "thread/close"
            && let Some(thread_id) = message
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str)
        {
            self.unsubscribe(thread_id);
        }
        Ok(response)
    }

    /// Forward one response to a server request (e.g. command or file change approval).
    ///
    /// Preserves the original server-issued request ID without rewriting it or waiting
    /// for a response. Rejects stale replies if an expected `backendGeneration` was provided
    /// and does not match the active generation.
    pub async fn reply(&self, mut response: Value) -> Result<(), String> {
        if response.get("id").is_none() {
            return Err("server reply requires an `id` field".into());
        }
        if response.get("result").is_none() && response.get("error").is_none() {
            return Err("server reply requires either a `result` or `error` field".into());
        }
        if let Some(expected_gen) = response.get("backendGeneration").and_then(Value::as_u64) {
            let current_gen = self.generation();
            if expected_gen != current_gen {
                return Err(format!(
                    "stale approval/reply from generation {expected_gen} rejected (current generation is {current_gen})"
                ));
            }
        }
        if let Some(obj) = response.as_object_mut() {
            obj.remove("backendGeneration");
        }
        let mut guard = self.connection.lock().await;
        let connection = guard.as_mut().ok_or("app-server backend unavailable")?;
        write_line(&mut connection.input, &response).await
    }

    /// Stop the in-process agent and wait up to `grace` for it to finish.
    ///
    /// Closing the server's input is its shutdown signal: it joins every session, so each
    /// rollout is flushed before the process exits. Called when the application exits. A turn
    /// that is still running when the grace period ends is abandoned with the process.
    pub async fn shutdown(&self, grace: Duration) {
        let Some(connection) = self.connection.lock().await.take() else { return };
        let alive = Arc::clone(&connection.alive);
        drop(connection);
        let deadline = tokio::time::Instant::now() + grace;
        while alive.load(Ordering::Acquire) && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Start the server if it is not running. Returns whether a new server replaced one that had
    /// ended (the handshake must then be replayed).
    fn ensure_started(&self, slot: &mut Option<Connection>) -> bool {
        let had_previous = match slot.as_ref() {
            Some(connection) if connection.alive.load(Ordering::Acquire) => return false,
            Some(_) => true,
            None => false,
        };
        *slot = Some(self.spawn());
        let generation = self.generation();
        let _ = self.app.emit(
            BACKEND_EVENT,
            json!({"state": "started", "restarted": had_previous, "backendGeneration": generation}),
        );
        had_previous
    }

    /// Start an in-process server: no process, no binary, no environment variable.
    fn spawn(&self) -> Connection {
        let generation = self.generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let mut server = AppServer::new();
        if let Some(dir) = crate::models::stored_models_dir(&self.app) {
            server = server.with_models_dir(dir);
        }
        let Link { input, output, alive, exit } = open_link(server);
        let pending: Pending = Arc::default();

        let app = self.app.clone();
        let reader_pending = Arc::clone(&pending);
        let reader_channels = Arc::clone(&self.channels);
        tokio::spawn(async move {
            pump(
                BufReader::new(output),
                &reader_pending,
                &*reader_channels,
                generation,
                |message| {
                    let _ = app.emit(NOTIFICATION_EVENT, message);
                },
            )
            .await;
            let reason = exit.await.unwrap_or_else(|_| "unknown".to_owned());
            if reason != "closed" {
                log::warn!("app-server ended: {reason}");
            }
            let _ = app.emit(
                BACKEND_EVENT,
                json!({"state": "exited", "backendGeneration": generation, "reason": reason}),
            );
        });
        Connection { input, alive, pending }
    }

    async fn replay_handshake(&self, connection: &mut Connection) -> Result<(), String> {
        let params =
            self.handshake.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let Some(params) = params else { return Ok(()) };
        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        connection
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, sender);
        write_line(
            &mut connection.input,
            &json!({"id": id, "method": "initialize", "params": params}),
        )
        .await?;
        let response = tokio::time::timeout(REQUEST_TIMEOUT, receiver)
            .await
            .map_err(|_| "initialize timed out after a backend restart".to_owned())?
            .map_err(|_| "app-server exited during the handshake".to_owned())?;
        if let Some(error) = response.get("error") {
            return Err(format!("initialize failed after a backend restart: {error}"));
        }
        write_line(&mut connection.input, &json!({"method": "initialized", "params": {}})).await
    }
}

/// Write one JSON-RPC message, newline-terminated, to the server's input pipe.
async fn write_line(input: &mut DuplexStream, message: &Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    line.push(b'\n');
    input.write_all(&line).await.map_err(|error| format!("app-server write failed: {error}"))?;
    input.flush().await.map_err(|error| format!("app-server write failed: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{
        cell::RefCell,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use serde_json::json;

    use super::{
        AppServer, AtomicBool, BufReader, DuplexStream, HashMap, Link, NotificationSink, Ordering,
        Pending, Value, notification_thread_id, oneshot, open_link, pump, route_to_subscriber,
        write_line,
    };

    /// In-memory [`NotificationSink`] recording deliveries, standing in for
    /// [`tauri::ipc::Channel`] so routing is testable without a webview.
    struct RecordingSink {
        received: RefCell<Vec<Value>>,
        closed: bool,
    }

    impl RecordingSink {
        fn open() -> Self {
            Self { received: RefCell::new(Vec::new()), closed: false }
        }

        fn closed() -> Self {
            Self { received: RefCell::new(Vec::new()), closed: true }
        }
    }

    impl NotificationSink for RecordingSink {
        fn deliver(&self, message: &Value) -> bool {
            if self.closed {
                return false;
            }
            self.received.borrow_mut().push(message.clone());
            true
        }
    }

    #[test]
    fn notification_thread_id_reads_params_thread_id() {
        let message = json!({"method": "item/agentMessage/delta", "params": {"threadId": "t-1", "delta": "hi"}});
        assert_eq!(notification_thread_id(&message), Some("t-1"));
    }

    #[test]
    fn notification_thread_id_is_none_when_absent_or_wrong_type() {
        assert_eq!(notification_thread_id(&json!({"method": "backend/started"})), None);
        assert_eq!(notification_thread_id(&json!({"method": "x", "params": {}})), None);
        assert_eq!(
            notification_thread_id(&json!({"method": "x", "params": {"threadId": 1}})),
            None,
        );
    }

    #[test]
    fn route_to_subscriber_delivers_to_the_matching_thread_only() {
        let mut channels = HashMap::new();
        channels.insert("t-1".to_owned(), vec![RecordingSink::open()]);
        channels.insert("t-2".to_owned(), vec![RecordingSink::open()]);

        let message = json!({"method": "item/agentMessage/delta", "params": {"threadId": "t-1"}});
        assert!(route_to_subscriber(&mut channels, &message));

        assert_eq!(channels["t-1"][0].received.borrow().as_slice(), [message]);
        assert!(channels["t-2"][0].received.borrow().is_empty());
    }

    #[test]
    fn route_to_subscriber_ignores_notifications_without_a_subscriber() {
        let mut channels: HashMap<String, Vec<RecordingSink>> = HashMap::new();
        channels.insert("t-1".to_owned(), vec![RecordingSink::open()]);

        assert!(!route_to_subscriber(&mut channels, &json!({"method": "backend/started"})));
        assert!(!route_to_subscriber(
            &mut channels,
            &json!({"method": "x", "params": {"threadId": "t-unknown"}})
        ));
        assert!(channels["t-1"][0].received.borrow().is_empty());
    }

    #[test]
    fn route_to_subscriber_drops_a_closed_subscription() {
        let mut channels = HashMap::new();
        channels.insert("t-1".to_owned(), vec![RecordingSink::closed()]);

        let delivered = route_to_subscriber(
            &mut channels,
            &json!({"method": "turn/completed", "params": {"threadId": "t-1"}}),
        );

        assert!(!delivered);
        assert!(!channels.contains_key("t-1"), "a failed delivery must drop the subscription");
    }

    #[test]
    fn route_delivers_to_multiple_subscribers_on_same_thread() {
        let mut channels = HashMap::new();
        let sink1 = RecordingSink::open();
        let sink2 = RecordingSink::open();
        channels.insert("t-1".to_owned(), vec![sink1, sink2]);

        let message = json!({"method": "item/agentMessage/delta", "params": {"threadId": "t-1", "delta": "hi"}});
        assert!(route_to_subscriber(&mut channels, &message));

        assert_eq!(channels["t-1"].len(), 2);
        assert_eq!(channels["t-1"][0].received.borrow().as_slice(), std::slice::from_ref(&message));
        assert_eq!(channels["t-1"][1].received.borrow().as_slice(), [message]);
    }

    #[test]
    fn route_cleans_up_closed_subscribers_while_retaining_open_ones() {
        let mut channels = HashMap::new();
        let closed_sink = RecordingSink::closed();
        let open_sink = RecordingSink::open();
        channels.insert("t-1".to_owned(), vec![closed_sink, open_sink]);

        let message = json!({"method": "item/agentMessage/delta", "params": {"threadId": "t-1", "delta": "update"}});
        assert!(route_to_subscriber(&mut channels, &message));

        assert_eq!(channels["t-1"].len(), 1);
        assert_eq!(channels["t-1"][0].received.borrow().as_slice(), [message]);
    }

    #[test]
    fn route_cleans_up_when_all_subscribers_are_closed() {
        let mut channels = HashMap::new();
        channels.insert("t-1".to_owned(), vec![RecordingSink::closed(), RecordingSink::closed()]);

        let message = json!({"method": "turn/completed", "params": {"threadId": "t-1"}});
        assert!(!route_to_subscriber(&mut channels, &message));
        assert!(
            !channels.contains_key("t-1"),
            "when all subscribers fail delivery, the thread key must be removed"
        );
    }

    #[test]
    fn server_reply_validation_requires_id_and_result_or_error() {
        let no_id = json!({"result": {"decision": "accept"}});
        assert!(no_id.get("id").is_none());

        let with_id_no_result = json!({"id": "req-1"});
        assert!(
            with_id_no_result.get("result").is_none() && with_id_no_result.get("error").is_none()
        );

        let valid_result = json!({"id": "req-1", "result": {"decision": "accept"}});
        assert!(valid_result.get("id").is_some());
        assert!(valid_result.get("result").is_some());

        let valid_error = json!({"id": "req-1", "error": {"code": -32000, "message": "denied"}});
        assert!(valid_error.get("id").is_some());
        assert!(valid_error.get("error").is_some());
    }

    #[tokio::test]
    async fn pump_wakes_callers_and_stamps_and_routes_notifications() {
        let pending: Pending = Arc::default();
        let (answer, answered) = oneshot::channel::<Value>();
        let (orphan, orphaned) = oneshot::channel::<Value>();
        pending.lock().unwrap().insert(5, answer);
        pending.lock().unwrap().insert(6, orphan);
        let channels = Mutex::new(HashMap::from([("t-1".to_owned(), vec![RecordingSink::open()])]));
        let output = concat!(
            r#"{"method":"item/agentMessage/delta","params":{"threadId":"t-1"}}"#,
            "\n",
            "this line is not json\n",
            r#"{"id":5,"result":{"ok":true}}"#,
            "\n",
            r#"{"id":"approval-1","method":"item/requestApproval","params":{"threadId":"t-2"}}"#,
            "\n",
        );
        let mut broadcast = Vec::new();

        pump(output.as_bytes(), &pending, &channels, 3, |message| broadcast.push(message)).await;

        // A response goes to its caller only; the non-JSON line is skipped; every other message,
        // including a server-initiated request with a string id, is a stamped notification.
        assert_eq!(answered.await.unwrap()["result"]["ok"], true);
        assert_eq!(broadcast.len(), 2, "{broadcast:?}");
        assert_eq!(broadcast[0]["backendGeneration"], 3);
        assert_eq!(broadcast[1]["id"], "approval-1");
        {
            let channels = channels.lock().unwrap();
            let routed = channels["t-1"][0].received.borrow().len();
            assert_eq!(routed, 1, "routed to the matching thread only");
        }
        // The output ended: a call still waiting is failed instead of hanging.
        assert!(orphaned.await.is_err());
    }

    /// An in-process server and a `pump` over its output, wired like `AppServerBroker::spawn`
    /// wires them, minus the webview.
    struct Harness {
        input: DuplexStream,
        alive: Arc<AtomicBool>,
        exit: oneshot::Receiver<String>,
        pending: Pending,
        pumped: tokio::task::JoinHandle<()>,
        _home: tempfile::TempDir,
    }

    fn harness() -> Harness {
        let home = tempfile::tempdir().unwrap();
        let Link { input, output, alive, exit } = open_link(AppServer::with_home(home.path()));
        let pending: Pending = Arc::default();
        let channels = Mutex::new(HashMap::<String, Vec<RecordingSink>>::new());
        let pumped = tokio::spawn({
            let pending = Arc::clone(&pending);
            async move {
                pump(BufReader::new(output), &pending, &channels, 1, drop).await;
            }
        });
        Harness { input, alive, exit, pending, pumped, _home: home }
    }

    #[tokio::test]
    async fn the_in_process_server_answers_a_request_through_the_pipes() {
        let mut harness = harness();
        let (sender, receiver) = oneshot::channel::<Value>();
        harness.pending.lock().unwrap().insert(7, sender);

        write_line(&mut harness.input, &json!({"id": 7, "method": "initialize", "params": {}}))
            .await
            .unwrap();

        let response = tokio::time::timeout(Duration::from_secs(5), receiver)
            .await
            .expect("the server answers within five seconds")
            .expect("the pump delivers the response");
        assert_eq!(response["id"], 7);
        assert_eq!(response["result"]["serverInfo"]["name"], "aphrody");
        assert!(harness.alive.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn closing_the_input_ends_the_server_cleanly_and_fails_waiting_calls() {
        let harness = harness();
        let (sender, waiting) = oneshot::channel::<Value>();
        harness.pending.lock().unwrap().insert(9, sender);
        let Harness { input, alive, exit, pumped, .. } = harness;

        drop(input);

        let reason = tokio::time::timeout(Duration::from_secs(5), exit).await.unwrap().unwrap();
        assert_eq!(reason, "closed");
        assert!(!alive.load(Ordering::Acquire), "the flag is cleared before the reason is sent");
        pumped.await.unwrap();
        assert!(waiting.await.is_err(), "a call still waiting is failed, never left hanging");
    }
}
