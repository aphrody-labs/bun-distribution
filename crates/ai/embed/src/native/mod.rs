//! Local sentence embeddings for Aphrody.
//!
//! - [`model_manifest`] lists supported BERT-family models with pinned Hugging Face revisions and
//!   sha256 hashes; [`ensure_model`] installs them under `~/.aphrody/models/<org>--<name>/` (or
//!   `$APHRODY_MODELS_DIR`). Weights are never embedded in the binary.
//! - [`Embedder`] tokenises, sorts inputs by length, runs a padding-free BERT forward pass on a
//!   private thread pool, pools (mean or CLS) and L2-normalises. It is `Send + Sync`.
//! - [`Reranker`] scores (query, passage) pairs with a cross-encoder (`ms-marco-MiniLM-L6-v2` by
//!   default) on the same native encoder.
//! - [`quantize_i8`] shrinks vectors 4x for storage.
//! - [`embed_json`] / [`embed_flat`] / [`rerank_json`] are the flat, process-wide entry points for
//!   the C ABI bridge; they never download (this crate exports no `extern "C"`).
//!
//! ```no_run
//! use aphrody_embed::native::{
//!     default_model, ensure_model, EmbedOptions, Embedder, ModelFiles, TextKind,
//! };
//!
//! let spec = default_model();
//! let dir = ensure_model(&spec, &spec.default_dir())?;
//! let embedder = Embedder::load(&dir, &spec, EmbedOptions::default())?;
//! let vectors = embedder.embed_batch(&["a car", "an automobile"], TextKind::Passage)?;
//! assert_eq!(vectors[0].len(), 384);
//! # Ok::<(), aphrody_embed::native::Error>(())
//! ```

mod bert;
#[cfg(feature = "candle")]
mod candle_backend;
pub mod download;
pub mod embedder;
pub mod error;
pub mod facade;
mod kernels;
pub mod manifest;
pub mod quantize;
pub mod reranker;

pub use download::{ensure_model, is_installed, is_offline, require_installed, verify_model};
pub use embedder::{Backend, EmbedOptions, Embedder, TextKind, cosine, l2_normalize};
pub use error::{Error, Result};
pub use facade::{embed_flat, embed_json, global_embedder, global_reranker, rerank_json};
pub use manifest::{
    DEFAULT_MODEL_ID, DEFAULT_RERANKER_ID, FileSpec, ModelFiles, ModelSpec, Pooling, RerankerSpec,
    ScoreActivation, default_model, default_reranker, find_model, find_reranker, model_dir_name,
    model_manifest, models_root, reranker_manifest,
};
pub use quantize::{dequantize_i8, dot_i8, quantize_i8};
pub use reranker::Reranker;
