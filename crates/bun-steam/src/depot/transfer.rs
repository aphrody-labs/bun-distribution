// SPDX-License-Identifier: Apache-2.0
//! Couche de transfert des chunks : cache disque adressé par contenu, limiteur de débit
//! partagé et compteurs atomiques, posés autour du `CdnChunkFetcher` de `steamroom-client`.
//!
//! * **Cache** : les chunks CDN (chiffrés, donc identiques pour un depot donné) sont rangés dans
//!   `<dir>/<depot>/<ab>/<chunk_id>.chunk`. Une reprise, une vérification qui échoue, un second
//!   dossier d'installation ou un autre branche ne retéléchargent rien de déjà vu.
//! * **Débit** : un jeton global (`max_rate_bytes_per_sec`) étale les octets *réseau* de toutes
//!   les tâches, sans jamais freiner les lectures du cache.
//! * **Statistiques** : succès de cache, octets réseau et octets servis par le cache.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use bytes::Bytes;
use steamroom::depot::{ChunkId, DepotId};
use steamroom_client::download::{BoxError, ChunkFetcher};
use tokio::sync::Mutex;
use tokio::time::Instant;

/// Compteurs partagés par tous les depots d'un téléchargement.
#[derive(Debug, Default)]
pub struct TransferStats {
    pub cache_hits: AtomicU64,
    pub cache_bytes: AtomicU64,
    pub network_chunks: AtomicU64,
    pub network_bytes: AtomicU64,
}

impl TransferStats {
    /// Instantané lisible : `(hits, octets cache, chunks réseau, octets réseau)`.
    pub fn snapshot(&self) -> (u64, u64, u64, u64) {
        (
            self.cache_hits.load(Ordering::Relaxed),
            self.cache_bytes.load(Ordering::Relaxed),
            self.network_chunks.load(Ordering::Relaxed),
            self.network_bytes.load(Ordering::Relaxed),
        )
    }
}

/// Limiteur de débit à créneaux : chaque transfert réserve `n / rate` secondes sur une horloge
/// commune, puis dort jusqu'au début de son créneau.
#[derive(Debug)]
pub struct RateLimiter {
    bytes_per_sec: u64,
    next_free: Mutex<Instant>,
}

impl RateLimiter {
    pub fn new(bytes_per_sec: u64) -> Option<Arc<Self>> {
        (bytes_per_sec > 0).then(|| {
            Arc::new(Self {
                bytes_per_sec,
                next_free: Mutex::new(Instant::now()),
            })
        })
    }

    pub async fn throttle(&self, bytes: u64) {
        let slot = Duration::from_secs_f64(bytes as f64 / self.bytes_per_sec as f64);
        let start = {
            let mut next = self.next_free.lock().await;
            let start = (*next).max(Instant::now());
            *next = start + slot;
            start
        };
        tokio::time::sleep_until(start).await;
    }
}

/// Chemin du cache de chunks par défaut (`~/.aphrody/cache/steam/chunks`).
pub fn default_chunk_cache_dir() -> PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aphrody")
        .join("cache")
        .join("steam")
        .join("chunks")
}

/// `ChunkFetcher` décorateur : cache disque → réseau → écriture atomique dans le cache.
pub struct CachedFetcher<F> {
    inner: F,
    cache_dir: Option<PathBuf>,
    limiter: Option<Arc<RateLimiter>>,
    stats: Arc<TransferStats>,
}

impl<F> CachedFetcher<F> {
    pub fn new(
        inner: F,
        cache_dir: Option<PathBuf>,
        limiter: Option<Arc<RateLimiter>>,
        stats: Arc<TransferStats>,
    ) -> Self {
        Self {
            inner,
            cache_dir,
            limiter,
            stats,
        }
    }

    fn chunk_path(&self, depot: DepotId, chunk: &ChunkId) -> Option<PathBuf> {
        let dir = self.cache_dir.as_ref()?;
        let hex = hex::encode(chunk.0);
        Some(
            dir.join(depot.0.to_string())
                .join(&hex[..2])
                .join(format!("{hex}.chunk")),
        )
    }
}

impl<F: ChunkFetcher> ChunkFetcher for CachedFetcher<F> {
    async fn fetch_chunk(&self, depot_id: DepotId, chunk_id: &ChunkId) -> Result<Bytes, BoxError> {
        let path = self.chunk_path(depot_id, chunk_id);
        if let Some(path) = &path
            && let Ok(data) = tokio::fs::read(path).await
            && !data.is_empty()
        {
            self.stats.cache_hits.fetch_add(1, Ordering::Relaxed);
            self.stats
                .cache_bytes
                .fetch_add(data.len() as u64, Ordering::Relaxed);
            return Ok(Bytes::from(data));
        }

        let data = self.inner.fetch_chunk(depot_id, chunk_id).await?;
        self.stats.network_chunks.fetch_add(1, Ordering::Relaxed);
        self.stats
            .network_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);

        if let Some(path) = path {
            // Écriture atomique ; une erreur de cache ne doit jamais échouer le téléchargement.
            let copy = data.clone();
            tokio::spawn(async move {
                if let Some(parent) = path.parent()
                    && tokio::fs::create_dir_all(parent).await.is_err()
                {
                    return;
                }
                let tmp = path.with_extension(format!("tmp{}", std::process::id()));
                if tokio::fs::write(&tmp, &copy).await.is_ok()
                    && tokio::fs::rename(&tmp, &path).await.is_err()
                {
                    let _ = tokio::fs::remove_file(&tmp).await;
                }
            });
        }

        if let Some(limiter) = &self.limiter {
            limiter.throttle(data.len() as u64).await;
        }
        Ok(data)
    }
}
