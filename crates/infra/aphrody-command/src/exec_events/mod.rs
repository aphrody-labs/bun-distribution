// SPDX-License-Identifier: Apache-2.0
//! Top-level JSONL thread and item events emitted by `aphrody exec (--experimental-json)`.
//!
//! Provides the strict contract expected by the OpenAI Codex TypeScript SDK.

pub mod events;

pub use events::*;
