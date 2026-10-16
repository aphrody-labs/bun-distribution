// SPDX-License-Identifier: Apache-2.0
//! Wire types of the Jev System One API (`POST /v1/systemone`).
//!
//! Shapes follow the pinned official SDK 0.6 declarations: a request carries a
//! `state` and named questions; the response carries one typed answer per question.
//! The declaration digest is recorded in the crate's provenance.json.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
/// Text, structured JSON or null, as accepted by the official SDK.
pub type Entry = serde_json::Value;

/// Model alias for the current flagship Jev model.
pub const DEFAULT_MODEL: &str = "jev-latest";
fn default_model() -> String {
    DEFAULT_MODEL.to_owned()
}

/// One typed question. The three variants are the only primitives Jev answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Question {
    /// Yes/no question answered with the probability of "yes".
    Noul {
        /// What is being asked.
        #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
        instructions: Entry,
        /// Optional meaning of `true` / `false`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        criteria: Option<BTreeMap<String, Entry>>,
    },
    /// Pick one option out of an unordered set.
    Choice {
        /// What is being asked.
        #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
        instructions: Entry,
        /// Option name to description.
        criteria: BTreeMap<String, Entry>,
    },
    /// Position along ordered levels, lowest first.
    Score {
        /// What is being asked.
        #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
        instructions: Entry,
        /// Ordered level descriptions.
        criteria: Vec<Entry>,
    },
}

impl Question {
    /// Build a Noul question without criteria.
    pub fn noul(instructions: impl Into<Entry>) -> Self {
        Self::Noul {
            instructions: instructions.into(),
            criteria: None,
        }
    }

    /// Build a Choice question from `(option, description)` pairs.
    pub fn choice<K, V>(
        instructions: impl Into<Entry>,
        options: impl IntoIterator<Item = (K, V)>,
    ) -> Self
    where
        K: Into<String>,
        V: Into<Entry>,
    {
        Self::Choice {
            instructions: instructions.into(),
            criteria: options
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        }
    }

    /// Build a Score question from ordered level descriptions.
    pub fn score<L: Into<Entry>>(
        instructions: impl Into<Entry>,
        levels: impl IntoIterator<Item = L>,
    ) -> Self {
        Self::Score {
            instructions: instructions.into(),
            criteria: levels.into_iter().map(Into::into).collect(),
        }
    }

    /// Primitive name as sent on the wire.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Noul { .. } => "noul",
            Self::Choice { .. } => "choice",
            Self::Score { .. } => "score",
        }
    }
}

/// A decision request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    /// Content to evaluate: plain text or structured JSON.
    pub state: serde_json::Value,
    /// Model id, `jev-latest` by default.
    #[serde(default = "default_model")]
    pub model: String,
    /// Named questions, all answered against the same state.
    pub questions: BTreeMap<String, Question>,
}

impl Request {
    /// Start a request for `state` on the default model.
    pub fn new(state: impl Into<serde_json::Value>) -> Self {
        Self {
            state: state.into(),
            model: DEFAULT_MODEL.to_owned(),
            questions: BTreeMap::new(),
        }
    }

    /// Add a named question.
    #[must_use]
    pub fn question(mut self, name: impl Into<String>, question: Question) -> Self {
        self.questions.insert(name.into(), question);
        self
    }

    /// Rough input size in tokens (four bytes of serialized JSON per token),
    /// used only for routing, never for billing.
    #[must_use]
    pub fn estimated_tokens(&self) -> usize {
        serde_json::to_vec(self).map_or(0, |bytes| bytes.len().div_ceil(4))
    }
}

/// One typed answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Answer {
    /// Probability that the answer is yes.
    Noul {
        /// Probability in `[0, 1]`.
        noul: f64,
    },
    /// Selected option with its distribution.
    Choice {
        /// Selected option, one of the question criteria.
        choice: String,
        /// Confidence in `[0, 1]`.
        confidence: f64,
        /// Probability per option.
        #[serde(default)]
        probabilities: BTreeMap<String, f64>,
    },
    /// Weighted position along the levels; may fall between two levels.
    Score {
        /// Position in `[0, levels - 1]`.
        score: f64,
        /// Confidence in `[0, 1]`.
        confidence: f64,
        /// Level index to description.
        #[serde(default)]
        legend: BTreeMap<String, Entry>,
        /// Probability per level index.
        #[serde(default)]
        probabilities: BTreeMap<String, f64>,
    },
}

impl Answer {
    /// Primitive name as sent on the wire.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Noul { .. } => "noul",
            Self::Choice { .. } => "choice",
            Self::Score { .. } => "score",
        }
    }
}

/// Token accounting reported by the backend.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    /// Input tokens.
    pub input_tokens: u64,
    /// Output tokens.
    pub output_tokens: u64,
}

/// A decision response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    /// Resolved model version, e.g. `jev-1.13.0`.
    pub model: String,
    /// One answer per question name.
    pub answers: BTreeMap<String, Answer>,
    /// Token usage, or explicit null when the backend does not report it.
    #[serde(deserialize_with = "Option::deserialize")]
    pub usage: Option<Usage>,
}
