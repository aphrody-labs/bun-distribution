//! Rose Griffon serverless edge for Vercel Rust Functions.
//!
//! The Discord application posts every interaction to `api/discord.rs`. This
//! library holds the transport-independent rules: Ed25519 request
//! verification, the interaction types, and the response the edge must give
//! when the Bun executor cannot answer within Discord's three-second window.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Value, json};

/// Discord interaction request types.
pub mod interaction_type {
    pub const PING: u64 = 1;
    pub const APPLICATION_COMMAND: u64 = 2;
    pub const MESSAGE_COMPONENT: u64 = 3;
    pub const APPLICATION_COMMAND_AUTOCOMPLETE: u64 = 4;
    pub const MODAL_SUBMIT: u64 = 5;
}

/// Discord interaction callback types.
pub mod callback_type {
    pub const PONG: u64 = 1;
    pub const CHANNEL_MESSAGE_WITH_SOURCE: u64 = 4;
    pub const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: u64 = 5;
    pub const DEFERRED_UPDATE_MESSAGE: u64 = 6;
    pub const APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: u64 = 8;
}

/// `MessageFlags.Ephemeral`.
pub const EPHEMERAL: u64 = 1 << 6;

/// Parsed `DISCORD_PUBLIC_KEY` (32 bytes, hex encoded in the developer portal).
pub fn parse_public_key(hex_key: &str) -> Option<VerifyingKey> {
    let bytes: [u8; 32] = hex::decode(hex_key.trim()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

/// Verifies `X-Signature-Ed25519` over `X-Signature-Timestamp || body`.
pub fn verify_signature(key: &VerifyingKey, signature_hex: &str, timestamp: &str, body: &[u8]) -> bool {
    let Ok(raw) = hex::decode(signature_hex.trim()) else {
        return false;
    };
    let Ok(bytes) = <[u8; 64]>::try_from(raw.as_slice()) else {
        return false;
    };
    let signature = Signature::from_bytes(&bytes);
    let mut message = Vec::with_capacity(timestamp.len() + body.len());
    message.extend_from_slice(timestamp.as_bytes());
    message.extend_from_slice(body);
    key.verify(&message, &signature).is_ok()
}

/// Interaction type of a raw payload, `None` when the body is not an interaction.
pub fn interaction_kind(payload: &Value) -> Option<u64> {
    payload.get("type")?.as_u64()
}

/// Acknowledgement sent when the executor did not answer in time (or asked
/// for one with `202`). The executor keeps working and finishes through the
/// interaction webhook.
pub fn deferred_response(kind: u64) -> Value {
    match kind {
        interaction_type::PING => json!({ "type": callback_type::PONG }),
        interaction_type::MESSAGE_COMPONENT => json!({ "type": callback_type::DEFERRED_UPDATE_MESSAGE }),
        interaction_type::APPLICATION_COMMAND_AUTOCOMPLETE => json!({
            "type": callback_type::APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
            "data": { "choices": [] },
        }),
        _ => json!({ "type": callback_type::DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE }),
    }
}

/// Answer given when the executor is unreachable or rejected the call: the
/// member gets an explicit ephemeral error instead of an endless "thinking".
pub fn unavailable_response(kind: u64) -> Value {
    match kind {
        interaction_type::APPLICATION_COMMAND_AUTOCOMPLETE => deferred_response(kind),
        _ => json!({
            "type": callback_type::CHANNEL_MESSAGE_WITH_SOURCE,
            "data": {
                "content": "Le service Rose Griffon est momentanément indisponible. Réessaie dans un instant.",
                "flags": EPHEMERAL,
            },
        }),
    }
}

/// Whether an executor body is a usable interaction callback (`{ "type": n, ... }`).
pub fn is_callback(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .as_ref()
        .and_then(interaction_kind)
        .is_some()
}
