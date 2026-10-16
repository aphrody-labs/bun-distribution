// SPDX-License-Identifier: Apache-2.0
//! Rule patterns and matching against command argvs.

use serde::{Deserialize, Serialize};

use crate::execpolicy::{
    decision::Decision,
    error::{Error, Result},
};

/// Matches a single command token, either an exact string or one of several alternatives.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum PatternToken {
    /// Exact match token.
    Single(String),
    /// Matches if the token equals any one of the alternatives.
    Alts(Vec<String>),
}

impl PatternToken {
    /// Checks if a command token satisfies this pattern token.
    #[must_use]
    pub fn matches(&self, token: &str) -> bool {
        match self {
            Self::Single(expected) => expected == token,
            Self::Alts(alts) => alts.iter().any(|alt| alt == token),
        }
    }
}

/// A prefix pattern composed of a fixed first token and subsequent pattern tokens.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PrefixPattern {
    /// The primary program or command name (e.g. "git", "ls", "rm").
    pub first: String,
    /// Subsequent tokens that must match in order.
    pub rest: Vec<PatternToken>,
}

impl PrefixPattern {
    /// Create a prefix pattern from a slice of string tokens.
    pub fn from_tokens(tokens: &[String]) -> Result<Self> {
        let Some((first, rest_tokens)) = tokens.split_first() else {
            return Err(Error::EmptyPattern);
        };

        let rest: Vec<PatternToken> =
            rest_tokens.iter().map(|t| PatternToken::Single(t.clone())).collect();

        Ok(Self { first: first.clone(), rest })
    }

    /// Tests if `cmd` matches this prefix pattern.
    /// Returns `Some(matched_tokens)` if matched, `None` otherwise.
    #[must_use]
    pub fn matches_prefix(&self, cmd: &[String]) -> Option<Vec<String>> {
        let pattern_len = self.rest.len() + 1;
        if cmd.len() < pattern_len {
            return None;
        }

        // Compare first token (handle possible .exe extension on Windows)
        let first_cmd = cmd[0].strip_suffix(".exe").unwrap_or(&cmd[0]);
        let first_pat = self.first.strip_suffix(".exe").unwrap_or(&self.first);
        if first_cmd != first_pat {
            return None;
        }

        // Compare rest tokens
        for (pat_token, cmd_token) in self.rest.iter().zip(&cmd[1..pattern_len]) {
            if !pat_token.matches(cmd_token) {
                return None;
            }
        }

        Some(cmd[..pattern_len].to_vec())
    }
}

/// A prefix rule defining a decision and optional rationale.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PrefixRule {
    /// The prefix pattern to match.
    pub pattern: PrefixPattern,
    /// Decision rendered when matched.
    pub decision: Decision,
    /// Human or agent explanation for this rule.
    pub justification: Option<String>,
    /// Validated positive test examples.
    pub match_examples: Vec<Vec<String>>,
    /// Validated negative test examples.
    pub not_match_examples: Vec<Vec<String>>,
}

impl PrefixRule {
    /// Create a new prefix rule.
    pub fn new(pattern: PrefixPattern, decision: Decision, justification: Option<String>) -> Self {
        Self {
            pattern,
            decision,
            justification,
            match_examples: Vec::new(),
            not_match_examples: Vec::new(),
        }
    }

    /// Validate the attached `match` and `not_match` examples against the pattern.
    pub fn validate_examples(&self) -> Result<()> {
        let pattern_tokens: Vec<String> = std::iter::once(self.pattern.first.to_string())
            .chain(self.pattern.rest.iter().map(|p| match p {
                PatternToken::Single(s) => s.clone(),
                PatternToken::Alts(a) => format!("({})", a.join("|")),
            }))
            .collect();

        for example in &self.match_examples {
            if self.pattern.matches_prefix(example).is_none() {
                return Err(Error::MatchExampleFailed {
                    pattern: pattern_tokens,
                    example: example.clone(),
                });
            }
        }

        for example in &self.not_match_examples {
            if self.pattern.matches_prefix(example).is_some() {
                return Err(Error::NotMatchExampleMatched {
                    pattern: pattern_tokens,
                    example: example.clone(),
                });
            }
        }

        Ok(())
    }
}

/// Result of matching a rule against a command argv.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleMatch {
    /// Prefix slice that triggered the match.
    pub matched_prefix: Vec<String>,
    /// Decision associated with the rule.
    pub decision: Decision,
    /// Justification provided by the rule.
    pub justification: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefix_pattern_matching() {
        let pattern = PrefixPattern::from_tokens(&[
            "git".to_string(),
            "reset".to_string(),
            "--hard".to_string(),
        ])
        .unwrap();

        let cmd1 = vec![
            "git".to_string(),
            "reset".to_string(),
            "--hard".to_string(),
            "HEAD~1".to_string(),
        ];
        assert_eq!(
            pattern.matches_prefix(&cmd1),
            Some(vec!["git".to_string(), "reset".to_string(), "--hard".to_string()])
        );

        let cmd2 = vec!["git".to_string(), "reset".to_string(), "--soft".to_string()];
        assert_eq!(pattern.matches_prefix(&cmd2), None);

        let cmd_short = vec!["git".to_string(), "reset".to_string()];
        assert_eq!(pattern.matches_prefix(&cmd_short), None);
    }

    #[test]
    fn test_pattern_token_alts() {
        let pattern = PrefixPattern {
            first: "git".to_string(),
            rest: vec![PatternToken::Alts(vec!["checkout".to_string(), "switch".to_string()])],
        };

        assert!(pattern.matches_prefix(&["git".to_string(), "checkout".to_string()]).is_some());
        assert!(pattern.matches_prefix(&["git".to_string(), "switch".to_string()]).is_some());
        assert!(pattern.matches_prefix(&["git".to_string(), "status".to_string()]).is_none());
    }

    #[test]
    fn test_rule_example_validation() {
        let pattern = PrefixPattern::from_tokens(&["ls".to_string()]).unwrap();
        let mut rule = PrefixRule::new(pattern, Decision::Allow, None);
        rule.match_examples.push(vec!["ls".to_string(), "-la".to_string()]);
        rule.not_match_examples.push(vec!["cat".to_string(), "file".to_string()]);

        assert!(rule.validate_examples().is_ok());

        // Introduce failing match
        rule.match_examples.push(vec!["pwd".to_string()]);
        assert!(rule.validate_examples().is_err());
    }
}
