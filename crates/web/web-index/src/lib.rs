//! `bxc-index`: approximate nearest-neighbour search for BXC.
//!
//! * HNSW graph (Malkov & Yashunin) with heuristic neighbour selection (Algorithm 4 with
//!   `keepPrunedConnections`), `M0 = 2M` on layer 0.
//! * Cosine (dot product on L2-normalised vectors) or squared L2.
//! * Symmetric scalar int8 quantisation (one scale per vector) used for graph traversal, AVX2
//!   kernels with a portable auto-vectorised fallback, and optional exact f32 rescoring of the
//!   final candidate pool.
//! * External `u64` keys, upserts, tombstone deletes, `compact()`.
//! * Parallel batch construction with `std::thread::scope`.
//! * Versioned, checksummed, memory-mapped persistence (see [`persist`]).
//!
//! ```

// Internal modules expose crate-wide implementation details through `pub`
// while the stable external surface is re-exported below.
#![allow(unreachable_pub)]
//! use aphrody_web_index::{Index, IndexParams};
//! let index = Index::new(IndexParams::new(3)).unwrap();
//! index.add(7, &[1.0, 0.0, 0.0]).unwrap();
//! index.add(8, &[0.0, 1.0, 0.0]).unwrap();
//! let hits = index.search(&[0.9, 0.1, 0.0], 1, None).unwrap();
//! assert_eq!(hits[0].0, 7);
//! ```

mod buf;
pub mod error;
pub mod ffi_api;
mod graph;
mod index;
pub mod kernels;
pub mod params;
pub mod persist;
pub mod rng;
mod space;
pub mod synth;
mod visited;

pub use error::{IndexError, Result};
pub use index::{INSERT_CHUNK, Index, IndexStats, MAX_SLOTS};
pub use params::{IndexParams, MAX_DIM, MAX_LEVEL, Metric, Quantization, SearchOptions};

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn index_is_send_sync() {
        assert_send_sync::<Index>();
        assert_send_sync::<ffi_api::Handle>();
    }
}
