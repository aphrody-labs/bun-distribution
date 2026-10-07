// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! What a job *is*: its identity, its payload, and the states it moves through.

use chrono::{DateTime, Utc};

/// Lifecycle of a job.
///
/// `Running` is the only state that can be reached without an explicit
/// transition — a worker claims a queued job — and the only one a crash can
/// leave stale. Recovery is therefore defined entirely in terms of this state
/// plus the claim's lease deadline (see [`crate::store::JobStore::recover`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobState {
    /// Waiting for a worker. `run_after` may hold it back.
    Queued,
    /// Claimed by a worker holding a lease.
    Running,
    /// Finished successfully; `result` carries the handler's output.
    Succeeded,
    /// Out of attempts; `last_error` says why.
    Failed,
    /// Cancelled by a caller. A running job is not killed mid-flight — the
    /// cancellation is observed at the next heartbeat, which keeps the state
    /// machine honest about what actually stopped.
    Cancelled,
}

impl JobState {
    /// Wire representation, also what is written to `SQLite`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parse the stored form.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }

    /// Whether no further transition is possible.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

impl core::fmt::Display for JobState {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Placement constraint using existing catalog host identities.
/// Connectivity and authentication remain the network owner's responsibility.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "mode", content = "hosts", rename_all = "kebab-case")]
pub enum HostAffinity {
    /// Any host with the required handler may claim the job.
    #[default]
    Any,
    /// Only one of these catalog host identities may claim the job.
    /// The queue never grants connectivity or authentication to a host.
    Hosts(Vec<String>),
}

/// Handler arguments and scheduling requirements, persisted before execution.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JobSpec {
    /// Handler name, e.g. `transcribe`.
    pub kind: String,
    /// Handler-specific arguments.
    pub payload: serde_json::Value,
    /// How many times the job may run in total. `1` means no retry.
    pub max_attempts: u32,
    /// Highest first. Ties break on submission order, so equal-priority work
    /// stays FIFO.
    pub priority: i64,
    /// Do not start before this instant.
    pub run_after: Option<DateTime<Utc>>,
    /// Placement is explicit; old requests without the field remain portable.
    #[serde(default)]
    pub host_affinity: HostAffinity,
    /// Stable caller intent key; retries after a lost acknowledgement reuse the same job.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

impl JobSpec {
    /// A job of `kind` carrying `payload`, run once, at default priority.
    pub fn new(kind: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            kind: kind.into(),
            payload,
            max_attempts: 1,
            priority: 0,
            run_after: None,
            host_affinity: HostAffinity::Any,
            idempotency_key: None,
        }
    }

    /// Deduplicate remote submission retries for the same durable caller intent.
    #[must_use]
    pub fn with_idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency_key = Some(key.into());
        self
    }

    /// Set an optional caller key without changing the unkeyed submission contract.
    #[must_use]
    pub fn with_optional_idempotency_key(mut self, key: Option<String>) -> Self {
        self.idempotency_key = key;
        self
    }

    /// Allow up to `attempts` total runs.
    ///
    /// Clamped to at least 1: a job that may run zero times would sit queued
    /// forever while looking scheduled.
    #[must_use]
    pub const fn with_max_attempts(mut self, attempts: u32) -> Self {
        self.max_attempts = if attempts == 0 { 1 } else { attempts };
        self
    }

    /// Set the priority; higher runs first.
    #[must_use]
    pub const fn with_priority(mut self, priority: i64) -> Self {
        self.priority = priority;
        self
    }

    /// Hold the job until `when`.
    #[must_use]
    pub const fn run_after(mut self, when: DateTime<Utc>) -> Self {
        self.run_after = Some(when);
        self
    }

    /// Restrict execution to declared host identities; does not move private inputs between domains.
    #[must_use]
    pub fn with_host_affinity(mut self, affinity: HostAffinity) -> Self {
        self.host_affinity = affinity;
        self
    }
}

/// A job as the store knows it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Job {
    /// Stable identifier, assigned at submission.
    pub id: String,
    /// Handler name.
    pub kind: String,
    /// Handler arguments.
    pub payload: serde_json::Value,
    /// Current state.
    pub state: JobState,
    /// Runs started so far, including the one in flight.
    pub attempts: u32,
    /// Ceiling on `attempts`.
    pub max_attempts: u32,
    /// Higher runs first.
    pub priority: i64,
    /// When it was submitted.
    pub created_at: DateTime<Utc>,
    /// Last state change.
    pub updated_at: DateTime<Utc>,
    /// Earliest start.
    pub run_after: Option<DateTime<Utc>>,
    /// While `Running`: the instant after which the claim is considered lost.
    pub lease_expires_at: Option<DateTime<Utc>>,
    /// Identifier of the worker holding the claim.
    pub worker: Option<String>,
    /// Handler output on success.
    pub result: Option<serde_json::Value>,
    /// Message from the most recent failure, kept even after a later success
    /// so a flaky job is visible rather than silently self-healing.
    pub last_error: Option<String>,
    /// Durable placement restriction; execution always also requires a registered handler.
    #[serde(default)]
    pub host_affinity: HostAffinity,
    /// Stable caller intent key; retries after a lost acknowledgement reuse the same job.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

impl Job {
    /// Whether another run is allowed after the current one fails.
    #[must_use]
    pub const fn has_attempts_left(&self) -> bool {
        self.attempts < self.max_attempts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_round_trips_through_its_stored_form() {
        for state in [
            JobState::Queued,
            JobState::Running,
            JobState::Succeeded,
            JobState::Failed,
            JobState::Cancelled,
        ] {
            assert_eq!(JobState::parse(state.as_str()), Some(state));
        }
        assert_eq!(JobState::parse("garbage"), None);
    }

    #[test]
    fn only_the_three_end_states_are_terminal() {
        assert!(!JobState::Queued.is_terminal());
        assert!(!JobState::Running.is_terminal());
        assert!(JobState::Succeeded.is_terminal());
        assert!(JobState::Failed.is_terminal());
        assert!(JobState::Cancelled.is_terminal());
    }

    #[test]
    fn zero_max_attempts_is_clamped_to_one() {
        // Otherwise the job is queued but can never run: scheduled-looking work
        // that never moves is worse than a rejected submission.
        let spec = JobSpec::new("noop", serde_json::json!({})).with_max_attempts(0);
        assert_eq!(spec.max_attempts, 1);
    }

    #[test]
    fn a_spec_round_trips_through_json() {
        let spec = JobSpec::new("transcribe", serde_json::json!({ "input": "a.wav" }))
            .with_max_attempts(3)
            .with_priority(5);
        let raw = serde_json::to_string(&spec).unwrap();
        assert_eq!(serde_json::from_str::<JobSpec>(&raw).unwrap(), spec);
    }
}
