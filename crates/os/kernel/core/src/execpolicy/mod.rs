// SPDX-License-Identifier: Apache-2.0
//! Codex-compatible execution policy engine for aphrody.
//!
//! Provides prefix-based command decision rules, severity ordering (`Allow < Prompt < Forbidden`),
//! `.codexpolicy` rule parsing with example validation, and No-HITL deterministic
//! `Prompt` -> `Forbidden` transformation with structured feedback.

pub mod decision;
pub mod error;
pub mod parser;
pub mod policy;
pub mod rule;

pub use decision::Decision;
pub use error::{Error, Result};
pub use parser::PolicyParser;
pub use policy::{ApprovalPolicy, Policy, PolicyEvaluation};
pub use rule::{PatternToken, PrefixPattern, PrefixRule, RuleMatch};
