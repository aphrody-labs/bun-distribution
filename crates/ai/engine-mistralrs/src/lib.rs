// SPDX-License-Identifier: Apache-2.0
//! `aphrody-engine-mistralrs` — in-process inference backend for Aphrody over mistral.rs.
//!
//! Provides a `ModelClient` (text, vision, tool calls, streaming) and an embedder over the
//! `mistralrs` crate for safetensors, GGUF and UQFF weights.
//!
//! All heavy dependencies sit behind the off-by-default `engine` feature. Without it,
//! this crate is a small shell that compiles on every target (wasm32 included) and reports
//! `Unavailable`.

pub mod config;
pub mod error;
pub(crate) mod events;
pub(crate) mod plan;

pub use config::{EmbedderConfig, EngineConfig, ModelSource, RuntimeOptions};
pub use error::{EngineError, UnavailableReason};

#[cfg(not(target_arch = "wasm32"))]
mod client;

#[cfg(not(target_arch = "wasm32"))]
pub use client::{MistralRsClient, MistralRsEmbedder};
