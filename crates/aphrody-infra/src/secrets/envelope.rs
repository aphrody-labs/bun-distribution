// SPDX-License-Identifier: Apache-2.0
//! SOPS-style encrypted manifest where keys remain readable for git diffing
//! and values are authenticated AEAD ciphertexts.

use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::{
    crypto::{
        DEFAULT_ITERATIONS, SALT_LEN, decrypt_aes_gcm, derive_key, encrypt_aes_gcm,
        generate_random_bytes,
    },
    redaction::SecretString,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoMeta {
    pub algorithm: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedManifest {
    pub version: u32,
    pub service: String,
    pub encrypted_at: String,
    pub crypto: CryptoMeta,
    pub data: BTreeMap<String, String>,
}

impl EncryptedManifest {
    /// Encrypt a map of plaintext key-values into an EncryptedManifest.
    pub fn encrypt(
        service: &str,
        values: &BTreeMap<String, String>,
        passphrase: &str,
    ) -> Result<Self> {
        let salt = generate_random_bytes(SALT_LEN)?;
        let key = derive_key(passphrase, &salt, DEFAULT_ITERATIONS);

        let mut data = BTreeMap::new();
        for (k, v) in values {
            let (ciphertext, iv, tag) = encrypt_aes_gcm(&key, v.as_bytes())?;
            let enc_val = format!(
                "ENC[AES256_GCM,data:{},iv:{},tag:{}]",
                B64.encode(&ciphertext),
                B64.encode(iv),
                B64.encode(tag),
            );
            data.insert(k.clone(), enc_val);
        }

        Ok(Self {
            version: 1,
            service: service.to_string(),
            encrypted_at: Utc::now().to_rfc3339(),
            crypto: CryptoMeta {
                algorithm: "AES-256-GCM".into(),
                kdf: "PBKDF2-HMAC-SHA256".into(),
                iterations: DEFAULT_ITERATIONS,
                salt: B64.encode(&salt),
            },
            data,
        })
    }

    /// Decrypt all secret values inside the manifest into protected SecretStrings.
    pub fn decrypt(&self, passphrase: &str) -> Result<BTreeMap<String, SecretString>> {
        let salt = B64
            .decode(&self.crypto.salt)
            .context("failed to decode crypto salt")?;
        let key = derive_key(passphrase, &salt, self.crypto.iterations);

        let mut out = BTreeMap::new();
        for (k, v) in &self.data {
            let decrypted_bytes = decrypt_value_string(&key, v)?;
            let decrypted_str = String::from_utf8(decrypted_bytes)
                .with_context(|| format!("secret '{k}' is not valid utf-8"))?;
            out.insert(k.clone(), SecretString::new(decrypted_str));
        }

        Ok(out)
    }
}

/// Parse and decrypt a single value formatted like:
/// `ENC[AES256_GCM,data:<b64>,iv:<b64>,tag:<b64>]`
fn decrypt_value_string(key: &[u8; 32], enc_str: &str) -> Result<Vec<u8>> {
    let trimmed = enc_str.trim();
    if !trimmed.starts_with("ENC[AES256_GCM,") || !trimmed.ends_with(']') {
        bail!("unsupported or malformed encrypted value envelope");
    }

    let payload = &trimmed["ENC[AES256_GCM,".len()..trimmed.len() - 1];
    let mut data_b64 = None;
    let mut iv_b64 = None;
    let mut tag_b64 = None;

    for part in payload.split(',') {
        if let Some((k, v)) = part.split_once(':') {
            match k.trim() {
                "data" => data_b64 = Some(v.trim()),
                "iv" => iv_b64 = Some(v.trim()),
                "tag" => tag_b64 = Some(v.trim()),
                _ => {}
            }
        }
    }

    let data = B64
        .decode(data_b64.context("missing 'data' in encrypted token")?)
        .context("invalid base64 for ciphertext")?;
    let iv_raw = B64
        .decode(iv_b64.context("missing 'iv' in encrypted token")?)
        .context("invalid base64 for iv")?;
    let tag_raw = B64
        .decode(tag_b64.context("missing 'tag' in encrypted token")?)
        .context("invalid base64 for tag")?;

    if iv_raw.len() != 12 {
        bail!("expected 12-byte IV for AES-256-GCM, got {}", iv_raw.len());
    }
    if tag_raw.len() != 16 {
        bail!(
            "expected 16-byte tag for AES-256-GCM, got {}",
            tag_raw.len()
        );
    }

    let mut iv = [0u8; 12];
    iv.copy_from_slice(&iv_raw);

    let mut tag = [0u8; 16];
    tag.copy_from_slice(&tag_raw);

    decrypt_aes_gcm(key, &data, &iv, &tag)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_envelope_encryption_and_decryption_cycle() {
        let mut raw = BTreeMap::new();
        raw.insert("DB_PASS".to_string(), "AphrodySuperPass123!".to_string());
        raw.insert("API_KEY".to_string(), "ak_live_9988776655".to_string());

        let manifest =
            EncryptedManifest::encrypt("rg-api", &raw, "correct-horse-battery-staple").unwrap();
        assert_eq!(manifest.service, "rg-api");
        assert!(manifest.data["DB_PASS"].starts_with("ENC[AES256_GCM,"));

        let decrypted = manifest.decrypt("correct-horse-battery-staple").unwrap();
        assert_eq!(decrypted["DB_PASS"].expose_secret(), "AphrodySuperPass123!");
        assert_eq!(decrypted["API_KEY"].expose_secret(), "ak_live_9988776655");

        let bad_pass = manifest.decrypt("wrong-password");
        assert!(bad_pass.is_err());
    }
}
