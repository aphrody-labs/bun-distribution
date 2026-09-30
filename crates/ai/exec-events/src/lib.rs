// SPDX-License-Identifier: Apache-2.0
//! Top-level JSONL thread and item events emitted by `aphrody exec (--experimental-json)`.
//!
//! Provides the strict contract expected by the OpenAI Codex TypeScript SDK and
//! an [`EventTranslator`] to project [`aphrody_app_protocol::ServerNotification`]s
//! into valid client-facing event streams.

pub mod events;
pub mod translator;

pub use events::*;
pub use translator::EventTranslator;
