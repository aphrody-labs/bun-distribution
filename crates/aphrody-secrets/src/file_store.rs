// SPDX-License-Identifier: Apache-2.0
//! File-backed stores: plaintext JSON and the AES-256-GCM + Argon2id envelope. Host-only: they
//! write through `tokio::fs`, which no wasm32 target has.

use std::{
    collections::BTreeMap,
    fmt,
    path::{Path, PathBuf},
};

use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce, aead::Aead};
use argon2::{Algorithm, Argon2, Params, Version};
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rand::RngExt as _;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{SecretStore, SecretValue, SecretsError, SecretsResult};

// ---------------------------------------------------------------------------
// FileSecretStore (plaintext JSON)
// ---------------------------------------------------------------------------

/// On-disk JSON map: `{ "key": "<base64-of-bytes>", ... }`.
///
/// Atomic write via tmp-file + rename.
#[derive(Debug, Clone)]
pub struct FileSecretStore {
    path: PathBuf,
    lock: std::sync::Arc<tokio::sync::Mutex<()>>,
}

impl FileSecretStore {
    /// Create a new store rooted at `path` (file does not need to exist yet).
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Public accessor — useful for tests and tooling.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    async fn load(&self) -> SecretsResult<BTreeMap<String, String>> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let bytes = tokio::fs::read(&self.path).await?;
        if bytes.is_empty() {
            return Ok(BTreeMap::new());
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn save(&self, map: &BTreeMap<String, String>) -> SecretsResult<()> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_vec_pretty(map)?;
        let tmp = self.path.with_extension("json.tmp");
        tokio::fs::write(&tmp, json).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

#[async_trait]
impl SecretStore for FileSecretStore {
    fn name(&self) -> &'static str {
        "file"
    }

    async fn get(&self, key: &str) -> SecretsResult<Option<SecretValue>> {
        let _g = self.lock.lock().await;
        let map = self.load().await?;
        match map.get(key) {
            None => Ok(None),
            Some(b64) => {
                let raw = B64
                    .decode(b64.as_bytes())
                    .map_err(|e| SecretsError::InvalidFormat(format!("base64: {e}")))?;
                Ok(Some(SecretValue::from_bytes(raw)))
            }
        }
    }

    async fn set(&self, key: &str, value: SecretValue) -> SecretsResult<()> {
        let _g = self.lock.lock().await;
        let mut map = self.load().await?;
        let encoded = B64.encode(value.expose_bytes());
        map.insert(key.to_owned(), encoded);
        self.save(&map).await
    }

    async fn delete(&self, key: &str) -> SecretsResult<()> {
        let _g = self.lock.lock().await;
        let mut map = self.load().await?;
        map.remove(key);
        self.save(&map).await
    }

    async fn list_keys(&self) -> SecretsResult<Vec<String>> {
        let _g = self.lock.lock().await;
        let map = self.load().await?;
        Ok(map.keys().cloned().collect())
    }
}

// ---------------------------------------------------------------------------
// EncryptedFileSecretStore (AES-256-GCM + Argon2id)
// ---------------------------------------------------------------------------

/// On-disk envelope:
///
/// ```json
/// {
///   "version": 1,
///   "kdf": { "algo": "argon2id", "salt_b64": "..." , "m_cost": 19456, "t_cost": 2, "p_cost": 1 },
///   "nonce_b64": "...",
///   "ciphertext_b64": "..."
/// }
/// ```
///
/// Ciphertext content is `serde_json::to_vec(&BTreeMap<String,String>)` where
/// values are base64-encoded raw secret bytes (same shape as
/// [`FileSecretStore`]).
#[derive(Debug, Serialize, Deserialize)]
struct EncryptedEnvelope {
    version: u32,
    kdf: KdfParams,
    nonce_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct KdfParams {
    algo: String,
    salt_b64: String,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // OWASP 2024 baseline: Argon2id m=19 MiB, t=2, p=1.
        Self {
            algo: "argon2id".to_string(),
            salt_b64: String::new(),
            m_cost: 19_456,
            t_cost: 2,
            p_cost: 1,
        }
    }
}

/// Passphrase-protected secret store backed by a single JSON envelope file.
#[derive(Clone)]
pub struct EncryptedFileSecretStore {
    path: PathBuf,
    passphrase: SecretValue,
    lock: std::sync::Arc<tokio::sync::Mutex<()>>,
}

impl std::fmt::Debug for EncryptedFileSecretStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EncryptedFileSecretStore")
            .field("path", &self.path)
            .field("passphrase", &"***REDACTED***")
            .finish()
    }
}

impl EncryptedFileSecretStore {
    /// Construct from a path and a passphrase.  The passphrase is moved into
    /// the store and zeroed alongside it on drop.
    #[must_use]
    pub fn new(path: impl Into<PathBuf>, passphrase: SecretValue) -> Self {
        Self {
            path: path.into(),
            passphrase,
            lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Public accessor (tests + tooling).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Derive a 32-byte AES-256-GCM key from the passphrase + salt with
    /// Argon2id at the supplied cost parameters.
    fn derive_key(
        passphrase: &[u8],
        salt: &[u8],
        params: &KdfParams,
    ) -> SecretsResult<Zeroizing<[u8; 32]>> {
        if params.algo != "argon2id" {
            return Err(SecretsError::InvalidFormat(format!(
                "unknown kdf algorithm: {}",
                params.algo
            )));
        }
        let argon = Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            Params::new(params.m_cost, params.t_cost, params.p_cost, Some(32))
                .map_err(|e| SecretsError::Crypto(format!("argon2 params: {e}")))?,
        );
        let mut key = Zeroizing::new([0u8; 32]);
        argon
            .hash_password_into(passphrase, salt, key.as_mut())
            .map_err(|e| SecretsError::Crypto(format!("argon2 derive: {e}")))?;
        Ok(key)
    }

    async fn load_map(&self) -> SecretsResult<BTreeMap<String, String>> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = tokio::fs::read(&self.path).await?;
        if raw.is_empty() {
            return Ok(BTreeMap::new());
        }
        let env: EncryptedEnvelope = serde_json::from_slice(&raw)?;
        if env.version != 1 {
            return Err(SecretsError::InvalidFormat(format!(
                "unsupported envelope version {}",
                env.version
            )));
        }
        let salt = B64
            .decode(env.kdf.salt_b64.as_bytes())
            .map_err(|e| SecretsError::InvalidFormat(format!("salt b64: {e}")))?;
        let nonce_bytes = B64
            .decode(env.nonce_b64.as_bytes())
            .map_err(|e| SecretsError::InvalidFormat(format!("nonce b64: {e}")))?;
        let ciphertext = B64
            .decode(env.ciphertext_b64.as_bytes())
            .map_err(|e| SecretsError::InvalidFormat(format!("ciphertext b64: {e}")))?;
        if nonce_bytes.len() != 12 {
            return Err(SecretsError::InvalidFormat(format!(
                "nonce must be 12 bytes, got {}",
                nonce_bytes.len()
            )));
        }
        let key = Self::derive_key(self.passphrase.expose_bytes(), &salt, &env.kdf)?;
        let key = Key::<Aes256Gcm>::try_from(key.as_ref())
            .map_err(|_| SecretsError::Crypto("derived key is not 32 bytes".into()))?;
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::try_from(nonce_bytes.as_slice())
            .map_err(|_| SecretsError::InvalidFormat("nonce must be 12 bytes".into()))?;
        let plaintext = cipher
            .decrypt(&nonce, ciphertext.as_ref())
            .map_err(|_| SecretsError::BadPassphrase)?;
        let map: BTreeMap<String, String> = serde_json::from_slice(&plaintext)?;
        Ok(map)
    }

    async fn save_map(&self, map: &BTreeMap<String, String>) -> SecretsResult<()> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            tokio::fs::create_dir_all(parent).await?;
        }
        // Fresh salt + nonce every write (deterministic ones would defeat AEAD).
        let mut salt = [0u8; 16];
        rand::rng().fill(&mut salt);
        let mut nonce_bytes = [0u8; 12];
        // The nonce comes from the thread RNG (OS-seeded), not from an aes-gcm helper, so it is auditable here.
        rand::rng().fill(&mut nonce_bytes);

        let kdf = KdfParams {
            algo: "argon2id".to_string(),
            salt_b64: B64.encode(salt),
            ..KdfParams::default()
        };
        let key = Self::derive_key(self.passphrase.expose_bytes(), &salt, &kdf)?;
        let key = Key::<Aes256Gcm>::try_from(key.as_ref())
            .map_err(|_| SecretsError::Crypto("derived key is not 32 bytes".into()))?;
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::from(nonce_bytes);
        let plaintext = serde_json::to_vec(map)?;
        let ciphertext = cipher
            .encrypt(&nonce, plaintext.as_ref())
            .map_err(|e| SecretsError::Crypto(format!("aes-gcm encrypt: {e}")))?;
        let envelope = EncryptedEnvelope {
            version: 1,
            kdf,
            nonce_b64: B64.encode(nonce_bytes),
            ciphertext_b64: B64.encode(&ciphertext),
        };
        let json = serde_json::to_vec_pretty(&envelope)?;
        let tmp = self.path.with_extension("enc.tmp");
        tokio::fs::write(&tmp, json).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

#[async_trait]
impl SecretStore for EncryptedFileSecretStore {
    fn name(&self) -> &'static str {
        "encrypted-file"
    }

    async fn get(&self, key: &str) -> SecretsResult<Option<SecretValue>> {
        let _g = self.lock.lock().await;
        let map = self.load_map().await?;
        match map.get(key) {
            None => Ok(None),
            Some(b64) => {
                let raw = B64
                    .decode(b64.as_bytes())
                    .map_err(|e| SecretsError::InvalidFormat(format!("base64: {e}")))?;
                Ok(Some(SecretValue::from_bytes(raw)))
            }
        }
    }

    async fn set(&self, key: &str, value: SecretValue) -> SecretsResult<()> {
        let _g = self.lock.lock().await;
        let mut map = self.load_map().await?;
        map.insert(key.to_owned(), B64.encode(value.expose_bytes()));
        self.save_map(&map).await
    }

    async fn delete(&self, key: &str) -> SecretsResult<()> {
        let _g = self.lock.lock().await;
        let mut map = self.load_map().await?;
        map.remove(key);
        self.save_map(&map).await
    }

    async fn list_keys(&self) -> SecretsResult<Vec<String>> {
        let _g = self.lock.lock().await;
        let map = self.load_map().await?;
        Ok(map.keys().cloned().collect())
    }
}
