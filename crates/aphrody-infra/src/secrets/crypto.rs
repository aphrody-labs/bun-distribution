// SPDX-License-Identifier: Apache-2.0
//! Authenticated AES-256-GCM encryption, decryption, and PBKDF2 key derivation using `ring`.

use anyhow::{Result, bail};
use ring::{
    aead::{
        AES_256_GCM, Aad, BoundKey, NONCE_LEN, Nonce, NonceSequence, OpeningKey, SealingKey,
        UnboundKey,
    },
    pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use std::num::NonZeroU32;

pub const DEFAULT_ITERATIONS: u32 = 100_000;
pub const SALT_LEN: usize = 16;
pub const TAG_LEN: usize = 16;

struct OneNonce(Option<Nonce>);

impl NonceSequence for OneNonce {
    fn advance(&mut self) -> Result<Nonce, ring::error::Unspecified> {
        self.0.take().ok_or(ring::error::Unspecified)
    }
}

/// Derive a 256-bit symmetric key from a passphrase and salt using PBKDF2-HMAC-SHA256.
pub fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    let non_zero_iter =
        NonZeroU32::new(iterations).unwrap_or(NonZeroU32::new(DEFAULT_ITERATIONS).unwrap());
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        non_zero_iter,
        salt,
        passphrase.as_bytes(),
        &mut key,
    );
    key
}

/// Generate cryptographically secure random bytes.
pub fn generate_random_bytes(len: usize) -> Result<Vec<u8>> {
    let rng = SystemRandom::new();
    let mut buf = vec![0u8; len];
    rng.fill(&mut buf)
        .map_err(|_| anyhow::anyhow!("failed to generate secure random bytes"))?;
    Ok(buf)
}

/// Encrypt plaintext with AES-256-GCM.
/// Returns (ciphertext, iv, tag).
pub fn encrypt_aes_gcm(
    key: &[u8; 32],
    plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; NONCE_LEN], [u8; TAG_LEN])> {
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| anyhow::anyhow!("failed to generate AES nonce"))?;

    let nonce = Nonce::try_assume_unique_for_key(&nonce_bytes)
        .map_err(|_| anyhow::anyhow!("invalid nonce length"))?;

    let unbound_key = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| anyhow::anyhow!("invalid key for AES-256-GCM"))?;

    let mut sealing_key = SealingKey::new(unbound_key, OneNonce(Some(nonce)));

    let mut in_out = plaintext.to_vec();
    sealing_key
        .seal_in_place_append_tag(Aad::empty(), &mut in_out)
        .map_err(|_| anyhow::anyhow!("AES-256-GCM encryption failed"))?;

    // in_out now has ciphertext followed by 16-byte authentication tag
    if in_out.len() < TAG_LEN {
        bail!("ciphertext buffer too short");
    }
    let tag_start = in_out.len() - TAG_LEN;
    let mut tag = [0u8; TAG_LEN];
    tag.copy_from_slice(&in_out[tag_start..]);
    in_out.truncate(tag_start);

    Ok((in_out, nonce_bytes, tag))
}

/// Decrypt ciphertext with AES-256-GCM given ciphertext, iv and tag.
pub fn decrypt_aes_gcm(
    key: &[u8; 32],
    ciphertext: &[u8],
    iv: &[u8; NONCE_LEN],
    tag: &[u8; TAG_LEN],
) -> Result<Vec<u8>> {
    let nonce = Nonce::try_assume_unique_for_key(iv)
        .map_err(|_| anyhow::anyhow!("invalid nonce length"))?;

    let unbound_key = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| anyhow::anyhow!("invalid key for AES-256-GCM"))?;

    let mut opening_key = OpeningKey::new(unbound_key, OneNonce(Some(nonce)));

    let mut in_out = Vec::with_capacity(ciphertext.len() + TAG_LEN);
    in_out.extend_from_slice(ciphertext);
    in_out.extend_from_slice(tag);

    let decrypted = opening_key
        .open_in_place(Aad::empty(), &mut in_out)
        .map_err(|_| {
            anyhow::anyhow!("AES-256-GCM decryption or authentication tag verification failed")
        })?;

    Ok(decrypted.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes_gcm_encrypt_decrypt_roundtrip() {
        let salt = generate_random_bytes(SALT_LEN).unwrap();
        let key = derive_key("master-vault-password", &salt, 10_000);

        let secret_data = b"DATABASE_URL=postgres://user:pass@127.0.0.1:5432/aphrody";
        let (ciphertext, iv, tag) = encrypt_aes_gcm(&key, secret_data).unwrap();

        assert_ne!(ciphertext, secret_data);

        let decrypted = decrypt_aes_gcm(&key, &ciphertext, &iv, &tag).unwrap();
        assert_eq!(decrypted, secret_data);
    }

    #[test]
    fn test_aes_gcm_tampered_tag_fails() {
        let key = [42u8; 32];
        let (ciphertext, iv, mut tag) = encrypt_aes_gcm(&key, b"hello").unwrap();
        tag[0] ^= 0xFF; // Tamper with tag
        let res = decrypt_aes_gcm(&key, &ciphertext, &iv, &tag);
        assert!(res.is_err());
    }
}
