// SPDX-License-Identifier: Apache-2.0
//! # `HnswBackend`
//!
//! In-process approximate nearest-neighbour memory backend. Records live in a
//! `BTreeMap<String, MemoryRecord>`; embeddings are indexed by
//! [`aphrody_web_index::Index`] (HNSW, cosine, full-precision vectors), one
//! index per embedding dimension.
//!
//! Records without an embedding, or whose embedding is empty, non-finite or
//! all zeros, are stored and listed but never returned by `search`.
//!
//! ## Persistence
//!
//! The records are serialised to `<root>/index.bin` as newline-delimited JSON
//! `(key, MemoryRecord)` pairs on every `put`, `put_many` and `delete`. The
//! HNSW graph is rebuilt from that file on `open`.

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};

use aphrody_web_index::{Index, IndexParams, MAX_DIM, Quantization};
use async_trait::async_trait;
use serde_json::Deserializer;
use tokio::fs;
use tracing::{debug, trace};

use crate::{Embedding, MemoryBackend, MemoryError, MemoryRecord};

/// Filename inside `root` where the records are persisted.
const INDEX_FILE: &str = "index.bin";

/// Minimum HNSW candidate list size at query time.
const EF_SEARCH: usize = 128;

fn indexable(v: &[f32]) -> bool {
    !v.is_empty()
        && v.len() <= MAX_DIM
        && v.iter().all(|x| x.is_finite())
        && v.iter().any(|x| *x != 0.0)
}

fn index_error(e: aphrody_web_index::IndexError) -> MemoryError {
    MemoryError::Internal {
        message: format!("vector index: {e}"),
    }
}

/// Key bookkeeping between string record keys and the `u64` keys of the
/// per-dimension HNSW indexes.
#[derive(Default)]
struct Ann {
    by_dim: HashMap<usize, Index>,
    slots: HashMap<String, (usize, u64)>,
    keys: HashMap<u64, String>,
    next: u64,
}

impl Ann {
    fn index_for(&mut self, dim: usize) -> Result<&Index, MemoryError> {
        if let std::collections::hash_map::Entry::Vacant(entry) = self.by_dim.entry(dim) {
            let params = IndexParams {
                quantization: Quantization::None,
                ..IndexParams::new(dim)
            };
            entry.insert(Index::new(params).map_err(index_error)?);
        }
        Ok(&self.by_dim[&dim])
    }

    fn remove(&mut self, key: &str) {
        let Some((dim, id)) = self.slots.remove(key) else {
            return;
        };
        self.keys.remove(&id);
        if let Some(index) = self.by_dim.get(&dim) {
            index.remove(id);
            if index.tombstone_count() > index.len().max(64) {
                // A failed compaction leaves the tombstones in place; search stays correct.
                let _ = index.compact();
            }
        }
    }

    /// Index every embeddable record of `batch`, replacing earlier entries for
    /// the same keys. Vectors of one dimension are linked in a single batch.
    fn insert_all<'a>(
        &mut self,
        batch: impl IntoIterator<Item = (&'a str, Option<&'a [f32]>)>,
    ) -> Result<(), MemoryError> {
        let mut groups: HashMap<usize, Vec<(u64, Vec<f32>)>> = HashMap::new();
        for (key, embedding) in batch {
            self.remove(key);
            let Some(v) = embedding.filter(|v| indexable(v)) else {
                continue;
            };
            let id = self.next;
            self.next += 1;
            self.slots.insert(key.to_owned(), (v.len(), id));
            self.keys.insert(id, key.to_owned());
            groups.entry(v.len()).or_default().push((id, v.to_vec()));
        }
        for (dim, items) in groups {
            self.index_for(dim)?
                .add_batch(&items)
                .map_err(index_error)?;
        }
        Ok(())
    }

    fn search(&self, query: &[f32], top_k: usize) -> Result<Vec<(&str, f32)>, MemoryError> {
        let Some(index) = self.by_dim.get(&query.len()) else {
            return Ok(Vec::new());
        };
        let hits = index
            .search(query, top_k, Some(top_k.max(EF_SEARCH)))
            .map_err(index_error)?;
        Ok(hits
            .into_iter()
            .filter_map(|(id, score)| self.keys.get(&id).map(|k| (k.as_str(), score)))
            .collect())
    }
}

/// In-process nearest-neighbour memory backend (HNSW via `aphrody-web-index`).
pub struct HnswBackend {
    root: PathBuf,
    /// Records by key.
    index: BTreeMap<String, MemoryRecord>,
    ann: Ann,
}

impl HnswBackend {
    /// Open (or create) an `HnswBackend` rooted at `root`.
    ///
    /// If `<root>/index.bin` exists its records are loaded and indexed.
    ///
    /// # Errors
    ///
    /// Returns [`MemoryError::Io`] if the directory cannot be created or read,
    /// and [`MemoryError::Serde`] if the index file is malformed.
    pub async fn open(root: impl AsRef<Path>) -> Result<Self, MemoryError> {
        let root = root.as_ref().to_owned();
        fs::create_dir_all(&root).await?;

        let index_path = root.join(INDEX_FILE);
        let mut index = BTreeMap::new();
        if index_path.exists() {
            debug!(path = %index_path.display(), "loading hnsw index");
            let bytes = fs::read(&index_path).await?;
            for result in Deserializer::from_slice(&bytes).into_iter::<(String, MemoryRecord)>() {
                let (key, record) = result?;
                trace!(key, "loaded hnsw record");
                index.insert(key, record);
            }
        }

        let mut ann = Ann::default();
        ann.insert_all(
            index
                .iter()
                .map(|(k, r)| (k.as_str(), r.embedding.as_deref())),
        )?;
        Ok(Self { root, index, ann })
    }

    /// Flush every record to `<root>/index.bin` as newline-delimited JSON.
    async fn flush(&self) -> Result<(), MemoryError> {
        let index_path = self.root.join(INDEX_FILE);
        let tmp_path = self.root.join(format!(".{INDEX_FILE}.tmp"));

        let mut lines = Vec::with_capacity(self.index.len());
        for (key, record) in &self.index {
            let pair = (key.as_str(), record);
            lines.push(serde_json::to_string(&pair)?);
        }

        let content = if lines.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines.join("\n"))
        };

        fs::write(&tmp_path, content.as_bytes()).await?;
        fs::rename(&tmp_path, &index_path).await?;
        debug!(
            path = %index_path.display(),
            records = self.index.len(),
            "flushed hnsw index"
        );
        Ok(())
    }

    /// Insert `batch` records, link their vectors in one pass and flush
    /// **once** at the end.
    ///
    /// # Errors
    ///
    /// Surfaces a single [`MemoryError::Io`] / [`MemoryError::Serde`] from
    /// the final flush; partial inserts before the failure remain in memory
    /// but are not persisted.
    pub async fn put_many(
        &mut self,
        batch: Vec<(String, MemoryRecord)>,
    ) -> Result<(), MemoryError> {
        self.ann.insert_all(
            batch
                .iter()
                .map(|(k, r)| (k.as_str(), r.embedding.as_deref())),
        )?;
        for (key, value) in batch {
            self.index.insert(key, value);
        }
        self.flush().await
    }
}

#[async_trait]
impl MemoryBackend for HnswBackend {
    async fn put(&mut self, key: &str, value: MemoryRecord) -> Result<(), MemoryError> {
        self.ann.insert_all([(key, value.embedding.as_deref())])?;
        self.index.insert(key.to_owned(), value);
        self.flush().await
    }

    async fn get(&self, key: &str) -> Result<Option<MemoryRecord>, MemoryError> {
        Ok(self.index.get(key).cloned())
    }

    async fn search(
        &self,
        query: &Embedding,
        top_k: usize,
    ) -> Result<Vec<(MemoryRecord, f32)>, MemoryError> {
        if top_k == 0 {
            return Ok(vec![]);
        }
        if query.is_empty() {
            return Err(MemoryError::InvalidArgument {
                message: "query embedding must not be empty".into(),
            });
        }
        // A zero-magnitude query has no direction: nothing to rank.
        if !indexable(query) {
            return Ok(vec![]);
        }
        Ok(self
            .ann
            .search(query, top_k)?
            .into_iter()
            .filter_map(|(key, score)| self.index.get(key).map(|r| (r.clone(), score)))
            .collect())
    }

    async fn delete(&mut self, key: &str) -> Result<(), MemoryError> {
        self.ann.remove(key);
        self.index.remove(key);
        self.flush().await
    }

    async fn list(&self, prefix: &str, limit: usize) -> Result<Vec<MemoryRecord>, MemoryError> {
        let records: Vec<MemoryRecord> = self
            .index
            .iter()
            .filter(|(k, _)| k.starts_with(prefix))
            .take(limit)
            .map(|(_, v)| v.clone())
            .collect();
        Ok(records)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MemoryRecord;

    async fn make_backend() -> (HnswBackend, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let backend = HnswBackend::open(dir.path()).await.expect("open");
        (backend, dir)
    }

    #[tokio::test]
    async fn put_then_get_round_trip() {
        let (mut b, _dir) = make_backend().await;
        let rec = MemoryRecord::new("hnsw-test", "hello from hnsw");
        let key = format!("{}/{}", rec.ns, rec.id);
        b.put(&key, rec.clone()).await.expect("put");
        let fetched = b.get(&key).await.expect("get").expect("record present");
        assert_eq!(fetched.id, rec.id);
        assert_eq!(fetched.content, "hello from hnsw");
    }

    #[tokio::test]
    async fn delete_is_idempotent() {
        let (mut b, _dir) = make_backend().await;
        let rec = MemoryRecord::new("del", "delete me").with_embedding(vec![1.0, 0.0]);
        let key = format!("{}/{}", rec.ns, rec.id);
        b.put(&key, rec).await.unwrap();
        b.delete(&key).await.unwrap();
        b.delete(&key).await.unwrap();
        assert!(b.get(&key).await.unwrap().is_none());
        assert!(b.search(&vec![1.0, 0.0], 5).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn search_top_k_ordering() {
        let (mut b, _dir) = make_backend().await;

        let near = MemoryRecord::new("vec", "near").with_embedding(vec![1.0, 0.0, 0.0]);
        let mid = MemoryRecord::new("vec", "mid").with_embedding(vec![0.7, 0.7, 0.0]);
        let far = MemoryRecord::new("vec", "far").with_embedding(vec![0.0, 1.0, 0.0]);

        b.put(&format!("vec/{}", near.id), near).await.unwrap();
        b.put(&format!("vec/{}", mid.id), mid).await.unwrap();
        b.put(&format!("vec/{}", far.id), far).await.unwrap();

        let query = vec![1.0_f32, 0.0, 0.0];
        let results = b.search(&query, 3).await.unwrap();

        assert_eq!(results.len(), 3);
        for w in results.windows(2) {
            assert!(
                w[0].1 >= w[1].1,
                "results not sorted: {} < {}",
                w[0].1,
                w[1].1
            );
        }
        assert_eq!(results[0].0.content, "near");
    }

    #[tokio::test]
    async fn search_top_k_truncates() {
        let (mut b, _dir) = make_backend().await;
        for i in 0..5u8 {
            let r = MemoryRecord::new("vec", format!("r{i}")).with_embedding(vec![i as f32, 1.0]);
            b.put(&format!("vec/{}", r.id), r).await.unwrap();
        }
        let results = b.search(&[1.0_f32, 0.0].to_vec(), 2).await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn search_skips_unembedded_records() {
        let (mut b, _dir) = make_backend().await;
        let bare = MemoryRecord::new("vec", "no embedding");
        let emb = MemoryRecord::new("vec", "has embedding").with_embedding(vec![1.0, 0.0]);
        b.put(&format!("vec/{}", bare.id), bare).await.unwrap();
        b.put(&format!("vec/{}", emb.id), emb).await.unwrap();
        let results = b.search(&[1.0_f32, 0.0].to_vec(), 10).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn put_replaces_embedding() {
        let (mut b, _dir) = make_backend().await;
        let rec = MemoryRecord::new("vec", "moved").with_embedding(vec![1.0, 0.0]);
        let key = format!("vec/{}", rec.id);
        b.put(&key, rec.clone()).await.unwrap();
        b.put(&key, rec.with_embedding(vec![0.0, 1.0]))
            .await
            .unwrap();
        let results = b.search(&vec![0.0, 1.0], 10).await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(
            (results[0].1 - 1.0).abs() < 1e-5,
            "stale vector served: {}",
            results[0].1
        );
    }

    #[tokio::test]
    async fn list_prefix_and_limit() {
        let (mut b, _dir) = make_backend().await;
        for i in 0..4u8 {
            let r = MemoryRecord::new("ns-a", format!("item {i}"));
            b.put(&format!("ns-a/{}", r.id), r).await.unwrap();
        }
        let r_b = MemoryRecord::new("ns-b", "other");
        b.put(&format!("ns-b/{}", r_b.id), r_b).await.unwrap();

        let a_all = b.list("ns-a/", 100).await.unwrap();
        assert_eq!(a_all.len(), 4);
        let limited = b.list("ns-a/", 2).await.unwrap();
        assert_eq!(limited.len(), 2);
        let b_only = b.list("ns-b/", 100).await.unwrap();
        assert_eq!(b_only.len(), 1);
    }

    #[tokio::test]
    async fn persist_across_open() {
        let dir = tempfile::tempdir().expect("tempdir");
        let key = {
            let mut b = HnswBackend::open(dir.path()).await.unwrap();
            let rec =
                MemoryRecord::new("persist", "durable content").with_embedding(vec![0.5, 0.5]);
            let k = format!("{}/{}", rec.ns, rec.id);
            b.put(&k, rec).await.unwrap();
            k
        };
        let b2 = HnswBackend::open(dir.path()).await.unwrap();
        let fetched = b2.get(&key).await.unwrap().expect("must survive reopen");
        assert_eq!(fetched.content, "durable content");
        assert!(fetched.embedding.is_some());
        let hits = b2.search(&vec![1.0, 1.0], 1).await.unwrap();
        assert_eq!(hits.len(), 1, "vector index must be rebuilt on open");
    }

    /// Top-10 recall of the HNSW search against exact cosine ranking.
    #[tokio::test]
    async fn recall_matches_exact_search() {
        const N: usize = 500;
        const DIM: usize = 32;
        const K: usize = 10;
        let mut state = 0x9E37_79B9_7F4A_7C15_u64;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 40) as f32 / (1u64 << 24) as f32 - 0.5
        };
        let (mut b, _dir) = make_backend().await;
        let batch: Vec<(String, MemoryRecord)> = (0..N)
            .map(|i| {
                let v: Vec<f32> = (0..DIM).map(|_| next()).collect();
                (
                    format!("r/{i:04}"),
                    MemoryRecord::new("r", format!("{i}")).with_embedding(v),
                )
            })
            .collect();
        let corpus: Vec<(String, Vec<f32>)> = batch
            .iter()
            .map(|(k, r)| (k.clone(), r.embedding.clone().expect("embedded")))
            .collect();
        b.put_many(batch).await.unwrap();

        let (mut found, mut total) = (0usize, 0usize);
        for _ in 0..20 {
            let q: Vec<f32> = (0..DIM).map(|_| next()).collect();
            let mut exact: Vec<(f32, &str)> = corpus
                .iter()
                .map(|(k, v)| (crate::cosine_similarity(&q, v), k.as_str()))
                .collect();
            exact.sort_by(|a, b| b.0.total_cmp(&a.0));
            let truth: Vec<&str> = exact[..K].iter().map(|(_, k)| *k).collect();
            let got = b.search(&q, K).await.unwrap();
            assert_eq!(got.len(), K);
            for w in got.windows(2) {
                assert!(w[0].1 >= w[1].1);
            }
            for (rec, _) in &got {
                let key = format!("r/{:04}", rec.content.parse::<usize>().unwrap());
                found += usize::from(truth.contains(&key.as_str()));
            }
            total += K;
        }
        let recall = found as f64 / total as f64;
        assert!(recall >= 0.98, "recall@{K} = {recall}");
    }

    #[tokio::test]
    async fn zero_query_returns_empty() {
        let (mut b, _dir) = make_backend().await;
        let r = MemoryRecord::new("vec", "x").with_embedding(vec![1.0, 2.0, 3.0]);
        b.put(&format!("vec/{}", r.id), r).await.unwrap();
        let results = b.search(&vec![0.0_f32, 0.0, 0.0], 5).await.unwrap();
        assert!(
            results.is_empty(),
            "zero query must rank nothing, got {results:?}"
        );
    }

    #[tokio::test]
    async fn empty_query_returns_error() {
        let (b, _dir) = make_backend().await;
        let err = b.search(&vec![], 5).await.unwrap_err();
        assert!(
            matches!(err, MemoryError::InvalidArgument { .. }),
            "expected InvalidArgument, got {err:?}"
        );
    }
}
