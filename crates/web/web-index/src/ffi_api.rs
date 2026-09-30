//! Plain Rust façade shaped for the C ABI bridge. Every function takes a
//! `&Handle` (the bridge boxes it and passes a raw pointer), plain slices and
//! scalars, and returns `Result`/`String`/`bool` so that the `extern "C"`
//! wrappers stay trivial. No `extern "C"` lives here.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{
    error::{IndexError, Result},
    index::{Index, IndexStats},
    params::IndexParams,
};

/// An open index bound to its file path.
pub struct Handle {
    index: Index,
    path: PathBuf,
}

impl Handle {
    pub fn index(&self) -> &Index {
        &self.index
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Load `path` if it exists, otherwise create an empty index.
///
/// * `dim`: required when creating; when loading, `0` accepts any dimension and a non-zero value
///   must match the stored one.
/// * `params_json`: optional partial [`IndexParams`] object (`""` or `"{}"` for defaults), ignored
///   when loading an existing file.
pub fn open_or_create(path: impl AsRef<Path>, dim: usize, params_json: &str) -> Result<Handle> {
    let path = path.as_ref().to_path_buf();
    if path.exists() {
        let index = Index::load(&path)?;
        if dim != 0 && index.dim() != dim {
            return Err(IndexError::DimensionMismatch { expected: index.dim(), got: dim });
        }
        return Ok(Handle { index, path });
    }
    create(path, dim, params_json)
}

/// Create an empty index bound to `path`, ignoring any existing file there
/// (it is atomically replaced on the next `save`). Use this to rebuild after
/// `open_or_create` reported a corrupt file ([`IndexError::is_corrupt_file`]).
pub fn create(path: impl AsRef<Path>, dim: usize, params_json: &str) -> Result<Handle> {
    let mut params: IndexParams = if params_json.trim().is_empty() {
        IndexParams::default()
    } else {
        serde_json::from_str(params_json)?
    };
    if dim != 0 {
        params.dim = dim;
    }
    let index = Index::new(params)?;
    Ok(Handle { index, path: path.as_ref().to_path_buf() })
}

/// Number of live vectors (lock-free).
pub fn len(handle: &Handle) -> usize {
    handle.index.len()
}

/// Vector dimension (lock-free).
pub fn dim(handle: &Handle) -> usize {
    handle.index.dim()
}

/// Insert or replace one vector (upsert by key).
pub fn add(handle: &Handle, key: u64, vector: &[f32]) -> Result<()> {
    handle.index.add(key, vector)
}

/// Insert or replace `keys.len()` vectors laid out row-major in `flat`
/// (`flat.len() == keys.len() * dim`), linked in parallel.
pub fn add_batch_flat(handle: &Handle, keys: &[u64], flat: &[f32]) -> Result<()> {
    handle.index.add_batch_flat(keys, flat)
}

#[derive(Serialize)]
struct Hit {
    key: u64,
    score: f32,
}

/// Search and serialise hits as `[{"key":..,"score":..}]`. `ef == 0` uses the
/// index default. Keys above 2^53 lose precision in JavaScript `JSON.parse`.
pub fn search_json(handle: &Handle, query: &[f32], k: usize, ef: usize) -> Result<String> {
    let ef = (ef > 0).then_some(ef);
    let hits: Vec<Hit> = handle
        .index
        .search(query, k, ef)?
        .into_iter()
        .map(|(key, score)| Hit { key, score })
        .collect();
    Ok(serde_json::to_string(&hits)?)
}

/// Tombstone a key; `false` if it was absent.
pub fn remove(handle: &Handle, key: u64) -> bool {
    handle.index.remove(key)
}

pub fn compact(handle: &Handle) -> Result<()> {
    handle.index.compact()
}

/// Save to the handle's path (atomic replace). Safe while searches run.
pub fn save(handle: &Handle) -> Result<()> {
    handle.index.save(&handle.path)
}

/// Release the handle (unmaps the file). Equivalent to dropping it; does not
/// save.
pub fn close(handle: Handle) {
    drop(handle);
}

#[derive(Serialize)]
struct StatsWithPath<'a> {
    path: &'a str,
    #[serde(flatten)]
    stats: IndexStats,
}

/// `{"path", "count", "slots", "tombstones", "dim", "memory_bytes",
/// "mapped_bytes", "mapped", "max_level", "kernels", "params"}`.
pub fn stats_json(handle: &Handle) -> String {
    let path = handle.path.to_string_lossy();
    let stats = StatsWithPath { path: &path, stats: handle.index.stats() };
    serde_json::to_string(&stats).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facade_round_trip() {
        let dir = std::env::temp_dir().join(format!("bxc-index-ffi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ffi.bxcidx");
        let _ = std::fs::remove_file(&path);

        let h = open_or_create(&path, 4, r#"{"m": 8, "ef_search": 32}"#).unwrap();
        add(&h, 1, &[1.0, 0.0, 0.0, 0.0]).unwrap();
        add_batch_flat(&h, &[2, 3], &[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]).unwrap();
        let json = search_json(&h, &[0.9, 0.1, 0.0, 0.0], 2, 0).unwrap();
        let hits: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(hits[0]["key"], 1);
        assert!(remove(&h, 3));
        save(&h).unwrap();
        let stats: serde_json::Value = serde_json::from_str(&stats_json(&h)).unwrap();
        assert_eq!(stats["count"], 2);
        assert_eq!(stats["tombstones"], 1);
        assert_eq!(stats["params"]["m"], 8);

        assert_eq!((len(&h), dim(&h)), (2, 4));
        close(h);
        let reopened = open_or_create(&path, 0, "").unwrap();
        assert_eq!(reopened.index().len(), 2);
        assert!(matches!(open_or_create(&path, 5, ""), Err(IndexError::DimensionMismatch { .. })));
        assert!(open_or_create(dir.join("bad.bxcidx"), 4, "{not json").is_err());
        close(reopened);

        // Corrupt file: open fails with a corrupt-file error, create rebuilds.
        let mut bytes = std::fs::read(&path).unwrap();
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0xFF;
        std::fs::write(&path, bytes).unwrap();
        let err = open_or_create(&path, 4, "").err().unwrap();
        assert!(err.is_corrupt_file(), "{err}");
        let rebuilt = create(&path, 4, "").unwrap();
        add(&rebuilt, 9, &[0.0, 0.0, 0.0, 1.0]).unwrap();
        save(&rebuilt).unwrap();
        close(rebuilt);
        assert_eq!(len(&open_or_create(&path, 4, "").unwrap()), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
