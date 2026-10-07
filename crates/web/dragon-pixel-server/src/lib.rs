// SPDX-License-Identifier: Apache-2.0
use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header::ORIGIN},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{RwLock, broadcast},
    time::Instant,
};
use uuid::Uuid;

const MAX_ROOM_LENGTH: usize = 32;
const MAX_ROOMS: usize = 128;
const MAX_PLAYERS_PER_ROOM: usize = 4;
const MAX_CLIENT_MESSAGE_BYTES: usize = 1024;
const UPDATE_INTERVAL: Duration = Duration::from_millis(33);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Avatar {
    pub name: String,
    pub race: String,
    pub hairstyle: String,
    pub skin: String,
    pub hair: String,
    pub outfit: String,
}

impl Avatar {
    fn is_valid(&self) -> bool {
        !self.name.trim().is_empty()
            && self.name.chars().count() <= 20
            && !self.name.chars().any(char::is_control)
            && ["saiyan", "earthling", "namekian", "majin"].contains(&self.race.as_str())
            && ["spiky", "short", "crest"].contains(&self.hairstyle.as_str())
            && [&self.skin, &self.hair, &self.outfit].iter().all(|color| valid_color(color))
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PlayerInput {
    pub x: f32,
    pub y: f32,
    pub avatar: Avatar,
}

impl PlayerInput {
    fn is_valid(&self) -> bool {
        self.x.is_finite()
            && self.y.is_finite()
            && (0.0..=960.0).contains(&self.x)
            && (0.0..=320.0).contains(&self.y)
            && self.avatar.is_valid()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PlayerSnapshot {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub avatar: Avatar,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Update { player: PlayerInput },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Joined { player_id: String, players: Vec<PlayerSnapshot> },
    Players { players: Vec<PlayerSnapshot> },
}

struct Room {
    events: broadcast::Sender<ServerMessage>,
    players: RwLock<HashMap<String, PlayerSnapshot>>,
}

impl Room {
    fn new() -> Self {
        let (events, _) = broadcast::channel(64);
        Self { events, players: RwLock::new(HashMap::new()) }
    }

    async fn snapshot(&self) -> Vec<PlayerSnapshot> {
        let players = self.players.read().await;
        let mut result: Vec<_> = players.values().cloned().collect();
        result.sort_by(|left, right| left.id.cmp(&right.id));
        result
    }
}

#[derive(Default)]
struct RoomHub {
    rooms: RwLock<HashMap<String, Arc<Room>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JoinError {
    RoomLimit,
    Full,
}

impl RoomHub {
    async fn join(
        &self,
        room_name: &str,
        player_id: String,
    ) -> Result<(Arc<Room>, Vec<PlayerSnapshot>), JoinError> {
        let mut rooms = self.rooms.write().await;
        if !rooms.contains_key(room_name) && rooms.len() >= MAX_ROOMS {
            return Err(JoinError::RoomLimit);
        }
        let room =
            Arc::clone(rooms.entry(room_name.to_owned()).or_insert_with(|| Arc::new(Room::new())));
        let mut players = room.players.write().await;
        if players.len() >= MAX_PLAYERS_PER_ROOM {
            return Err(JoinError::Full);
        }
        players.insert(
            player_id.clone(),
            PlayerSnapshot { id: player_id, x: 160.0, y: 320.0, avatar: default_avatar() },
        );
        let mut snapshot: Vec<_> = players.values().cloned().collect();
        snapshot.sort_by(|left, right| left.id.cmp(&right.id));
        drop(players);
        drop(rooms);
        let _ = room.events.send(ServerMessage::Players { players: snapshot.clone() });
        Ok((room, snapshot))
    }

    async fn update(&self, room: &Room, player_id: &str, input: PlayerInput) {
        if !input.is_valid() {
            return;
        }
        let mut players = room.players.write().await;
        if let Some(player) = players.get_mut(player_id) {
            player.x = input.x;
            player.y = input.y;
            player.avatar = input.avatar;
        }
        drop(players);
        let _ = room.events.send(ServerMessage::Players { players: room.snapshot().await });
    }

    async fn leave(&self, room_name: &str, room: &Arc<Room>, player_id: &str) {
        let mut rooms = self.rooms.write().await;
        let Some(current) = rooms.get(room_name).cloned() else { return };
        if !Arc::ptr_eq(&current, room) {
            return;
        }
        let mut players = current.players.write().await;
        players.remove(player_id);
        let mut snapshot: Vec<_> = players.values().cloned().collect();
        snapshot.sort_by(|left, right| left.id.cmp(&right.id));
        if players.is_empty() {
            drop(players);
            rooms.remove(room_name);
        } else {
            drop(players);
            let _ = current.events.send(ServerMessage::Players { players: snapshot });
        }
    }
}

fn default_avatar() -> Avatar {
    Avatar {
        name: "Patrouilleur".to_owned(),
        race: "saiyan".to_owned(),
        hairstyle: "spiky".to_owned(),
        skin: "#f0c19a".to_owned(),
        hair: "#242b46".to_owned(),
        outfit: "#63e6ff".to_owned(),
    }
}

fn valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_room_name(name: &str) -> bool {
    (1..=MAX_ROOM_LENGTH).contains(&name.len())
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else { return false };
    let configured = std::env::var("DRAGON_PIXEL_ALLOWED_ORIGINS").unwrap_or_default();
    configured
        .split(',')
        .map(str::trim)
        .chain(["http://127.0.0.1:4317", "http://localhost:4317"])
        .any(|allowed| !allowed.is_empty() && allowed == origin)
}

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ws/{room}", get(websocket))
        .with_state(Arc::new(RoomHub::default()))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "service": "dragon-pixel" }))
}

async fn websocket(
    ws: WebSocketUpgrade,
    Path(room_name): Path<String>,
    State(hub): State<Arc<RoomHub>>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get(ORIGIN);
    if !origin.is_some_and(allowed_origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !valid_room_name(&room_name) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let player_id = Uuid::new_v4().to_string();
    let (room, players) = match hub.join(&room_name, player_id.clone()).await {
        Ok(joined) => joined,
        Err(JoinError::Full) => return StatusCode::CONFLICT.into_response(),
        Err(JoinError::RoomLimit) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ws.max_message_size(MAX_CLIENT_MESSAGE_BYTES)
        .max_frame_size(MAX_CLIENT_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, hub, room_name, room, player_id, players))
}

async fn handle_socket(
    socket: WebSocket,
    hub: Arc<RoomHub>,
    room_name: String,
    room: Arc<Room>,
    player_id: String,
    players: Vec<PlayerSnapshot>,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut events = room.events.subscribe();
    let joined = ServerMessage::Joined { player_id: player_id.clone(), players };
    if sender
        .send(Message::Text(serde_json::to_string(&joined).unwrap_or_default().into()))
        .await
        .is_err()
    {
        hub.leave(&room_name, &room, &player_id).await;
        return;
    }
    let mut last_update = Instant::now() - Duration::from_secs(1);
    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    loop {
        tokio::select! {
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else { break };
                match message {
                    Message::Text(text) if text.len() <= MAX_CLIENT_MESSAGE_BYTES => {
                        if last_update.elapsed() < UPDATE_INTERVAL { continue; }
                        let Ok(ClientMessage::Update { player }) = serde_json::from_str::<ClientMessage>(&text) else {
                            continue;
                        };
                        last_update = Instant::now();
                        hub.update(&room, &player_id, player).await;
                    }
                    Message::Ping(payload) => {
                        if sender.send(Message::Pong(payload)).await.is_err() { break; }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                let message = match event {
                    Ok(message) => message,
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        ServerMessage::Players { players: room.snapshot().await }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                let payload = serde_json::to_string(&message).unwrap_or_default();
                if sender.send(Message::Text(payload.into())).await.is_err() { break; }
            }
            _ = heartbeat.tick() => {
                if sender.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            }
        }
    }
    hub.leave(&room_name, &room, &player_id).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::{Message as ClientFrame, client::IntoClientRequest};

    #[test]
    fn room_names_and_color_values_are_bounded() {
        assert!(valid_room_name("lobby-1"));
        assert!(!valid_room_name("room/other"));
        assert!(!valid_room_name(""));
        assert!(valid_color("#63e6ff"));
        assert!(!valid_color("red"));
    }

    #[tokio::test]
    async fn rooms_limit_players_and_remove_empty_rooms() {
        let hub = RoomHub::default();
        let mut players = Vec::new();
        let mut room = None;
        for index in 0..MAX_PLAYERS_PER_ROOM {
            let (joined_room, snapshot) =
                hub.join("lobby", format!("player-{index}")).await.unwrap();
            assert_eq!(snapshot.len(), index + 1);
            room = Some(joined_room);
            players.push(format!("player-{index}"));
        }
        assert!(matches!(hub.join("lobby", "too-many".to_owned()).await, Err(JoinError::Full)));
        let room = room.unwrap();
        for player in players {
            hub.leave("lobby", &room, &player).await;
        }
        assert!(hub.rooms.read().await.is_empty());
    }

    #[tokio::test]
    async fn player_updates_reject_out_of_bounds_and_accept_avatar_state() {
        let hub = RoomHub::default();
        let (room, _) = hub.join("lobby", "p1".to_owned()).await.unwrap();
        let invalid = PlayerInput { x: f32::NAN, y: 10.0, avatar: default_avatar() };
        hub.update(&room, "p1", invalid).await;
        let snapshot = room.snapshot().await;
        assert_eq!(snapshot[0].x, 160.0);
        let valid = PlayerInput { x: 700.0, y: 120.0, avatar: default_avatar() };
        hub.update(&room, "p1", valid).await;
        let snapshot = room.snapshot().await;
        assert_eq!((snapshot[0].x, snapshot[0].y), (700.0, 120.0));
    }

    #[tokio::test]
    async fn websocket_clients_receive_room_updates() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router()).await.unwrap();
        });
        let mut first_request =
            format!("ws://{address}/ws/test-room").into_client_request().unwrap();
        first_request
            .headers_mut()
            .insert(ORIGIN, HeaderValue::from_static("http://127.0.0.1:4317"));
        let (mut first, _) = tokio_tungstenite::connect_async(first_request).await.unwrap();
        let Some(Ok(ClientFrame::Text(first_message))) = first.next().await else {
            panic!("expected first room join notification");
        };
        let first_join: ServerMessage = serde_json::from_str(first_message.as_str()).unwrap();
        let first_id = match first_join {
            ServerMessage::Joined { player_id, .. } => player_id,
            ServerMessage::Players { .. } => panic!("expected joined message"),
        };
        let mut second_request =
            format!("ws://{address}/ws/test-room").into_client_request().unwrap();
        second_request
            .headers_mut()
            .insert(ORIGIN, HeaderValue::from_static("http://127.0.0.1:4317"));
        let (mut second, _) = tokio_tungstenite::connect_async(second_request).await.unwrap();
        let Some(Ok(ClientFrame::Text(second_message))) = second.next().await else {
            panic!("expected second room join notification");
        };
        let second_join: ServerMessage = serde_json::from_str(second_message.as_str()).unwrap();
        let (second_id, existing_player_count) = match second_join {
            ServerMessage::Joined { player_id, players } => (player_id, players.len()),
            ServerMessage::Players { .. } => panic!("expected joined message"),
        };
        assert_ne!(first_id, second_id);
        assert_eq!(existing_player_count, 2);
        let update = ClientMessage::Update {
            player: PlayerInput { x: 500.0, y: 160.0, avatar: default_avatar() },
        };
        first
            .send(ClientFrame::Text(serde_json::to_string(&update).unwrap().into()))
            .await
            .unwrap();
        let mut updated = false;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let Ok(Some(Ok(ClientFrame::Text(message)))) =
                tokio::time::timeout(Duration::from_millis(250), second.next()).await
            else {
                continue;
            };
            let message: ServerMessage = serde_json::from_str(message.as_str()).unwrap();
            if let ServerMessage::Players { players } = message {
                updated = players
                    .iter()
                    .any(|player| player.id == first_id && player.x == 500.0 && player.y == 160.0);
                if updated {
                    break;
                }
            }
        }
        assert!(updated, "the other player receives the authoritative room snapshot");
        first.close(None).await.unwrap();
        second.close(None).await.unwrap();
        server.abort();
    }
}
