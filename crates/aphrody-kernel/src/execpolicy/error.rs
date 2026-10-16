// SPDX-License-Identifier: Apache-2.0
//! Errors for execpolicy evaluation and rule parsing.

use thiserror::Error;

/// Result type alias for execpolicy operations.
pub type Result<T> = std::result::Result<T, Error>;

/// Execution policy error conditions.
#[derive(Debug, Error)]
pub enum Error {
    #[error("Invalid decision: '{0}', expected 'allow', 'prompt', or 'forbidden'")]
    InvalidDecision(String),

    #[error("Parse error at line {line}: {message}")]
    ParseError { line: usize, message: String },

    #[error(
        "Rule validation failed for pattern '{pattern:?}': match example '{example:?}' did not \
         match"
    )]
    MatchExampleFailed { pattern: Vec<String>, example: Vec<String> },

    #[error(
        "Rule validation failed for pattern '{pattern:?}': not_match example '{example:?}' \
         matched unexpectedly"
    )]
    NotMatchExampleMatched { pattern: Vec<String>, example: Vec<String> },

    #[error("Empty pattern in prefix_rule")]
    EmptyPattern,
}
