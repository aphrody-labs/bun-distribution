// SPDX-License-Identifier: Apache-2.0
//! Policy decision outcomes and severity ranking.

use serde::{Deserialize, Serialize};

use crate::execpolicy::error::{Error, Result};

/// Outcome of evaluating a command against an execution policy.
///
/// Decisions are strictly ordered by severity:
/// `Allow < Prompt < Forbidden`.
/// Multiple applicable rules combine via `max(severity)`.
#[derive(
    Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    /// Command may execute without prompting or restriction.
    Allow,
    /// Command requires explicit user confirmation.
    /// Under `approval_policy="never"`, this is deterministically upgraded to `Forbidden`.
    #[default]
    Prompt,
    /// Command is blocked unconditionally.
    Forbidden,
}

impl Decision {
    /// Parse a decision from string representation.
    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "allow" => Ok(Self::Allow),
            "prompt" => Ok(Self::Prompt),
            "forbidden" => Ok(Self::Forbidden),
            other => Err(Error::InvalidDecision(other.to_string())),
        }
    }

    /// True if the decision allows execution without prompt.
    #[must_use]
    pub const fn is_allowed(self) -> bool {
        matches!(self, Self::Allow)
    }

    /// True if the decision requires prompting.
    #[must_use]
    pub const fn is_prompt(self) -> bool {
        matches!(self, Self::Prompt)
    }

    /// True if the decision forbids execution.
    #[must_use]
    pub const fn is_forbidden(self) -> bool {
        matches!(self, Self::Forbidden)
    }
}

impl std::fmt::Display for Decision {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Allow => write!(f, "allow"),
            Self::Prompt => write!(f, "prompt"),
            Self::Forbidden => write!(f, "forbidden"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decision_severity_ordering() {
        assert!(Decision::Allow < Decision::Prompt);
        assert!(Decision::Prompt < Decision::Forbidden);
        assert!(Decision::Allow < Decision::Forbidden);

        let decisions = [Decision::Allow, Decision::Forbidden, Decision::Prompt];
        assert_eq!(decisions.into_iter().max(), Some(Decision::Forbidden));
    }

    #[test]
    fn test_decision_parsing() {
        assert_eq!(Decision::parse("allow").unwrap(), Decision::Allow);
        assert_eq!(Decision::parse("prompt").unwrap(), Decision::Prompt);
        assert_eq!(Decision::parse("forbidden").unwrap(), Decision::Forbidden);
        assert!(Decision::parse("unknown").is_err());
    }
}
