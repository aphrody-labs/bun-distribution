// SPDX-License-Identifier: Apache-2.0
//! Cryptographic verification for Discord Interactions webhooks (Ed25519).

use ring::signature::{ED25519, UnparsedPublicKey};

/// Verifies a Discord Interaction HTTP webhook request using Ed25519.
///
/// * `public_key_hex` - 32-byte hex string (Discord application public key).
/// * `signature_hex` - 64-byte hex string from `X-Signature-Ed25519` header.
/// * `timestamp` - value of `X-Signature-Timestamp` header.
/// * `body` - raw request body bytes.
pub fn verify_interaction_signature(
    public_key_hex: &str,
    signature_hex: &str,
    timestamp: &str,
    body: &[u8],
) -> bool {
    let public_key_bytes = match hex::decode(public_key_hex.trim()) {
        Ok(bytes) if bytes.len() == 32 => bytes,
        _ => return false,
    };

    let signature_bytes = match hex::decode(signature_hex.trim()) {
        Ok(bytes) if bytes.len() == 64 => bytes,
        _ => return false,
    };

    let peer_public_key = UnparsedPublicKey::new(&ED25519, public_key_bytes);

    // Discord message to verify is timestamp bytes concatenated with raw body bytes
    let mut message = Vec::with_capacity(timestamp.len() + body.len());
    message.extend_from_slice(timestamp.as_bytes());
    message.extend_from_slice(body);

    peer_public_key.verify(&message, &signature_bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_signature_length() {
        assert!(!verify_interaction_signature(
            "aabb", "ccdd", "12345", b"test"
        ));
    }

    #[test]
    fn test_invalid_hex() {
        assert!(!verify_interaction_signature(
            "not_hex", "not_hex", "12345", b"test"
        ));
    }
}
