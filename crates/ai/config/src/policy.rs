// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Approval policy for tool execution and shell commands.
///
/// Mirrors `openai/codex` `codex-rs/protocol/src/protocol.rs` `AskForApproval`
/// (~L986) at the shape aphrody targets for interface parity: `untrusted`,
/// `on-failure`, `on-request`, `never`. Upstream has since grown a
/// `Granular(GranularApprovalConfig)` variant; aphrody does not mirror it
/// (see `docs/plans/codex-oss.md`, doctrine: approval is never the mechanism
/// that decides outcomes here, so a granular human-routing config has no
/// referent in aphrody's model). Per the No-Human-In-The-Loop doctrine
/// (CLAUDE.md §0.1, `docs/plans/codex-oss.md` doctrine section) the *default*
/// resolved policy is [`AskForApproval::Never`], not upstream's
/// `on-request` — the other variants are kept only so app-server clients that
/// request them over the wire are not rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum AskForApproval {
    /// Commands require approval unless an explicit policy rule allows them.
    Untrusted,
    /// Prompt only when a command or tool fails.
    OnFailure,
    /// The model decides when to ask for approval.
    OnRequest,
    /// Never ask for approval; failures are returned to the model directly.
    /// aphrody's resolved default.
    #[default]
    Never,
}

impl AskForApproval {
    /// Returns the canonical `config.toml` string for this policy.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Untrusted => "untrusted",
            Self::OnFailure => "on-failure",
            Self::OnRequest => "on-request",
            Self::Never => "never",
        }
    }
}

impl std::fmt::Display for AskForApproval {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for AskForApproval {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for AskForApproval {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        match raw.as_str() {
            "untrusted" => Ok(Self::Untrusted),
            "on-failure" => Ok(Self::OnFailure),
            "on-request" => Ok(Self::OnRequest),
            "never" => Ok(Self::Never),
            other => Err(serde::de::Error::unknown_variant(
                other,
                &["untrusted", "on-failure", "on-request", "never"],
            )),
        }
    }
}

/// Filesystem/process sandbox mode.
///
/// Mirrors `openai/codex` `codex-rs/protocol/src/config_types.rs` `SandboxMode`
/// (~L104). Per the No-Human-In-The-Loop doctrine the resolved default is
/// [`SandboxMode::WorkspaceWrite`] (matching upstream's own default, but
/// aphrody pairs it with `AskForApproval::Never` rather than upstream's
/// `on-request`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SandboxMode {
    /// Read-only filesystem access; no process may write.
    ReadOnly,
    /// Read-write confined to the resolved workspace roots. aphrody's
    /// resolved default.
    #[default]
    WorkspaceWrite,
    /// No sandbox boundary at all.
    DangerFullAccess,
}

impl SandboxMode {
    /// Returns the canonical `config.toml` string for this mode.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::DangerFullAccess => "danger-full-access",
        }
    }
}

impl std::fmt::Display for SandboxMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for SandboxMode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SandboxMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        match raw.as_str() {
            "read-only" => Ok(Self::ReadOnly),
            "workspace-write" => Ok(Self::WorkspaceWrite),
            "danger-full-access" => Ok(Self::DangerFullAccess),
            other => Err(serde::de::Error::unknown_variant(
                other,
                &["read-only", "workspace-write", "danger-full-access"],
            )),
        }
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod policy_tests;
