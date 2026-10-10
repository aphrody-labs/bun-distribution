// SPDX-License-Identifier: Apache-2.0
//! Session-scoped goal checkpoint contract. Independent of any UI or provider.

use serde::{Deserialize, Serialize};

/// Maximum Unicode scalar values in a completion condition.
pub const MAX_GOAL_CONDITION_CHARS: usize = 4096;

/// Persisted lifecycle; interruption preserves an active goal for explicit resume.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// More work is required.
    #[default]
    Active,
    /// An evaluator returned a valid, affirmative verdict.
    Achieved,
}

/// A goal belongs to the session's existing rollout, never a separate store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalState {
    /// Evidence-based completion condition supplied by the caller.
    pub condition: String,
    /// Completed work turns, excluding evaluator invocations.
    #[serde(default)]
    pub turns: u32,
    /// Unix seconds supplied by the host; the contract has no clock dependency.
    #[serde(default)]
    pub started_at: u64,
    /// Most recent evaluator reason.
    #[serde(default)]
    pub last_reason: String,
    /// Lifecycle status.
    #[serde(default)]
    pub status: GoalStatus,
}

impl GoalState {
    /// Validate without truncating away part of the caller's completion condition.
    ///
    /// # Errors
    /// Empty or oversized conditions are rejected.
    pub fn new(condition: &str, started_at: u64) -> Result<Self, &'static str> {
        let condition = condition.trim();
        if condition.is_empty() {
            return Err("goal condition must not be empty");
        }
        if condition.chars().count() > MAX_GOAL_CONDITION_CHARS {
            return Err("goal condition exceeds 4096 characters");
        }
        Ok(Self {
            condition: condition.to_owned(),
            turns: 0,
            started_at,
            last_reason: String::new(),
            status: GoalStatus::Active,
        })
    }
}
