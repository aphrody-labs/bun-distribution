// SPDX-License-Identifier: Apache-2.0
//! Authenticated PTY handoff for WebSocket clients with a stable session ID.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use tokio::{net::TcpStream, sync::mpsc};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{
        Message,
        handshake::server::{ErrorResponse, Request},
        http::StatusCode,
    },
};
use tracing::{debug, warn};

use super::{ControlMsg, PtyConfig, PtyEvent, PtySession, SessionSlot};

type Socket = WebSocketStream<TcpStream>;
type Handoff = mpsc::Sender<Socket>;
const DETACHED_GRACE: Duration = Duration::from_secs(30);
const MAX_DETACHED_OUTPUT: usize = 8 * 1024 * 1024;

/// Map of currently resumable PTYs. The actor owns the quota slot until it exits.
#[derive(Clone, Default)]
pub(super) struct Registry(Arc<Mutex<HashMap<String, Handoff>>>);

impl Registry {
    pub(super) fn contains(&self, id: &str) -> bool {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).contains_key(id)
    }
}

/// The ID is opaque and deliberately restricted to one URI-safe path component.
pub(super) fn session_id(request: &Request) -> Result<Option<String>, ()> {
    let Some(query) = request.uri().query() else {
        return Ok(None);
    };
    let Some(value) = query.split('&').find_map(|part| part.strip_prefix("session=")) else {
        return Ok(None);
    };
    if value.is_empty()
        || value.len() > 128
        || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(());
    }
    Ok(Some(value.to_owned()))
}

pub(super) fn invalid_id_response() -> ErrorResponse {
    tokio_tungstenite::tungstenite::http::Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header("Content-Type", "application/json")
        .body(Some("{\"error\":\"invalid session ID\"}".into()))
        .unwrap_or_else(|_| tokio_tungstenite::tungstenite::http::Response::new(None))
}

pub(super) async fn accept(
    ws: Socket,
    id: String,
    cfg: PtyConfig,
    slot: Option<SessionSlot>,
    registry: Registry,
) -> Result<()> {
    let (handoff, incoming) = mpsc::channel(1);
    let existing = {
        let mut entries = registry.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(sender) = entries.get(&id) {
            Some(sender.clone())
        } else if slot.is_some() {
            entries.insert(id.clone(), handoff);
            None
        } else {
            return Err(anyhow!("resumable PTY disappeared during handshake"));
        }
    };
    if let Some(sender) = existing {
        drop(slot);
        sender.send(ws).await.map_err(|_| anyhow!("resumable PTY already ended"))?;
        return Ok(());
    }
    let result = run(ws, &cfg, incoming, slot.expect("new session holds quota slot")).await;
    registry.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&id);
    result
}

async fn run(
    first: Socket,
    cfg: &PtyConfig,
    mut incoming: mpsc::Receiver<Socket>,
    _slot: SessionSlot,
) -> Result<()> {
    let (events_tx, mut events_rx) = mpsc::channel::<PtyEvent>(256);
    let session = PtySession::spawn(cfg, events_tx)?;
    let mut current = Some(first);
    let mut pending = VecDeque::<Vec<u8>>::new();
    let mut pending_bytes = 0_usize;
    let mut sent_total = 0_u64;
    let mut last_activity = Instant::now();
    let mut detached_at: Option<Instant> = None;
    let mut exited_while_detached = false;

    loop {
        if exited_while_detached && current.is_some() && pending.is_empty() {
            break;
        }
        let idle_left = cfg.idle_ttl.map(|ttl| ttl.saturating_sub(last_activity.elapsed()));
        let detach_left = detached_at.map(|at| DETACHED_GRACE.saturating_sub(at.elapsed()));
        if idle_left == Some(Duration::ZERO) || detach_left == Some(Duration::ZERO) {
            break;
        }
        let wait = idle_left
            .into_iter()
            .chain(detach_left)
            .min()
            .unwrap_or(Duration::from_secs(365 * 24 * 60 * 60));

        if let Some(ws) = current.as_mut() {
            if let Some(data) = pending.pop_front() {
                if ws.send(Message::Binary(data.clone().into())).await.is_err() {
                    pending.push_front(data);
                    current = None;
                    detached_at = Some(Instant::now());
                } else {
                    pending_bytes -= data.len();
                }
                continue;
            }
            tokio::select! {
                event = events_rx.recv() => {
                    match event {
                        Some(PtyEvent::Output(data)) => {
                            sent_total = sent_total.saturating_add(data.len() as u64);
                            if cfg.max_output_bytes.is_some_and(|limit| sent_total > limit) {
                                warn!("resumable PTY output cap exceeded");
                                break;
                            }
                            last_activity = Instant::now();
                            if ws.send(Message::Binary(data.clone().into())).await.is_err() {
                                pending_bytes += data.len();
                                pending.push_back(data);
                                current = None;
                                detached_at = Some(Instant::now());
                            }
                        },
                        Some(PtyEvent::Exit { code }) => {
                            debug!("resumable PTY exited: {code:?}");
                            break;
                        },
                        None => break,
                    }
                },
                next = ws.next() => {
                    match next {
                        Some(Ok(Message::Binary(bytes))) => {
                            last_activity = Instant::now();
                            if !cfg.max_input_frame_bytes.is_some_and(|limit| bytes.len() > limit) {
                                session.write(bytes.to_vec()).await?;
                            }
                        },
                        Some(Ok(Message::Text(text))) => {
                            last_activity = Instant::now();
                            if !cfg.max_input_frame_bytes.is_some_and(|limit| text.len() > limit) {
                                match serde_json::from_str::<ControlMsg>(&text) {
                                    Ok(ControlMsg::Resize { cols, rows }) => { let _ = session.resize(cols, rows); },
                                    Ok(ControlMsg::Data { bytes }) if !cfg.max_input_frame_bytes.is_some_and(|limit| bytes.len() > limit) => {
                                        session.write(bytes).await?;
                                    },
                                    _ => {},
                                }
                            }
                        },
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                            current = None;
                            detached_at = Some(Instant::now());
                        },
                        _ => {},
                    }
                },
                new_socket = incoming.recv() => {
                    if let Some(new_socket) = new_socket {
                        current = Some(new_socket);
                        detached_at = None;
                    }
                },
                () = tokio::time::sleep(wait) => {},
            }
        } else {
            tokio::select! {
                event = events_rx.recv(), if !exited_while_detached => {
                    match event {
                        Some(PtyEvent::Output(data)) => {
                            sent_total = sent_total.saturating_add(data.len() as u64);
                            if cfg.max_output_bytes.is_some_and(|limit| sent_total > limit)
                                || pending_bytes.saturating_add(data.len()) > MAX_DETACHED_OUTPUT
                            {
                                warn!("detached PTY output cap exceeded");
                                break;
                            }
                            last_activity = Instant::now();
                            pending_bytes += data.len();
                            pending.push_back(data);
                        },
                        Some(PtyEvent::Exit { code }) => {
                            debug!("detached PTY exited: {code:?}");
                            exited_while_detached = true;
                        },
                        None => exited_while_detached = true,
                    }
                },
                new_socket = incoming.recv() => {
                    if let Some(new_socket) = new_socket {
                        current = Some(new_socket);
                        detached_at = None;
                    }
                },
                () = tokio::time::sleep(wait) => {},
            }
        }
    }
    session.close().await;
    if let Some(mut ws) = current {
        let _ = ws.close(None).await;
    }
    Ok(())
}
