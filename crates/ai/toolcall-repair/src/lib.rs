// SPDX-License-Identifier: Apache-2.0
#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
//! `aphrody-toolcall-repair` — weak open-source model tool-calling robustness.
//!
//! Small local models routinely emit tool calls and file edits that are
//! *almost* right: JSON wrapped in markdown fences, single-quoted strings,
//! trailing commas, Python literals, streams cut off mid-value, arguments
//! double-encoded as a JSON string, XML-ish dialects instead of a structured
//! call, unified diffs instead of the Codex patch envelope, and so on. This
//! crate turns that output into something an agent loop can actually use:
//!
//! - [`repair_json`] / [`repair_json_with_report`] — a tolerant JSON repairer that is the identity
//!   on already-valid JSON.
//! - [`extract_inline_tool_calls`] / [`extract_any`] — inline tool-call extraction for the Hermes,
//!   Qwen3-Coder XML, Mistral, and bare-JSON dialects, plus [`strip_tool_calls`] to recover the
//!   surrounding prose.
//! - [`validate_arguments`] / [`coerce_arguments`] / [`corrective_message`] — a JSON-Schema-subset
//!   validator, an unambiguous-fix coercer, and a concise retry message for the model.
//! - [`detect_patch_format`] / [`normalize_to_codex_patch`] — normalise a unified diff, an
//!   aider-style SEARCH/REPLACE block, or a whole-file fenced block into the Codex `*** Begin
//!   Patch` envelope.
//! - [`PromptProfile`] / [`builtin_profiles`] / [`select_profile`] — the per-model-family dialect,
//!   patch format, and harness instructions that keep a given model inside a repairable shape in
//!   the first place.
//!
//! The crate is pure (no I/O, no async runtime) and compiles for
//! `wasm32-unknown-unknown`.

mod extract;
mod patch_normalize;
mod profile;
mod repair;
mod validate;

pub use extract::{
    ExtractedToolCall, ToolDialect, extract_any, extract_inline_tool_calls, strip_tool_calls,
};
pub use patch_normalize::{
    PatchFormat, PatchNormalizeError, detect_patch_format, normalize_to_codex_patch,
};
pub use profile::{GrammarMode, PromptProfile, builtin_profiles, glob_match, select_profile};
pub use repair::{RepairError, RepairKind, RepairReport, repair_json, repair_json_with_report};
pub use validate::{Coercion, Violation, coerce_arguments, corrective_message, validate_arguments};

#[cfg(test)]
mod lib_tests;
