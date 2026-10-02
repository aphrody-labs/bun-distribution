// SPDX-License-Identifier: Apache-2.0
//! `aphrody-engine-mistralrs` — in-process inference backend for Aphrody over mistral.rs.
//!
//! Provides a `ModelClient` (text, vision, tool calls, streaming) and an embedder over the
//! `mistralrs` crate for safetensors, GGUF and UQFF weights.
//!
//! All heavy dependencies sit behind the off-by-default `engine` feature. Without it,
//! this crate is a small shell that compiles on every target (wasm32 included) and reports
//! `Unavailable`. `README.md` has the layout, a configuration example and the build weight.

#![forbid(unsafe_code)]

pub mod config;
pub mod error;

// The two pure translation layers import `aphrody_model_client`, which is host-only. They are
// compiled when the `engine` driver uses them, and for their own unit tests, so a default build
// carries no code that nothing calls.
#[cfg(all(not(target_arch = "wasm32"), any(test, feature = "engine")))]
pub(crate) mod events;
#[cfg(all(not(target_arch = "wasm32"), any(test, feature = "engine")))]
pub(crate) mod plan;

pub use config::{EmbedderConfig, EngineConfig, ModelSource, RuntimeOptions};
pub use error::{EngineError, UnavailableReason};

#[cfg(not(target_arch = "wasm32"))]
mod client;
// Everything that names a `mistralrs` type.
#[cfg(all(not(target_arch = "wasm32"), feature = "engine"))]
mod driver;

#[cfg(not(target_arch = "wasm32"))]
pub use client::{MistralRsClient, MistralRsEmbedder};
