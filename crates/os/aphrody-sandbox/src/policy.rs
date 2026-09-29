// SPDX-License-Identifier: Apache-2.0
//! Sandbox execution policies and filesystem permissions.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Mode determining how filesystem and process restrictions are enforced.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    /// Sandboxing is disabled; commands run with parent process permissions.
    Disabled,
    /// Complete read-only filesystem view: no disk writes allowed anywhere.
    ReadOnly,
    /// Default Codex / aphrody mode: file writes are strictly confined to the
    /// designated workspace roots, excluding sensitive subpaths like `.git` or `.aphrody`.
    #[default]
    WorkspaceWrite,
    /// Explicit override bypassing all protection (e.g. for user scripts or tests).
    DangerouslyBypass,
}

impl SandboxMode {
    /// Returns true if this mode allows writes to at least the workspace roots.
    #[must_use]
    pub const fn allows_workspace_writes(self) -> bool {
        matches!(self, Self::WorkspaceWrite | Self::DangerouslyBypass)
    }

    /// Returns true if this mode forbids any disk writes unconditionally.
    #[must_use]
    pub const fn is_read_only(self) -> bool {
        matches!(self, Self::ReadOnly)
    }
}

/// Network access policy for sandboxed executions.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkPolicy {
    /// Network egress is blocked in sandbox.
    #[default]
    Denied,
    /// Network access is allowed for commands.
    Allowed,
}

/// Configuration defining the sandbox boundaries for an execution turn or tool call.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SandboxPolicy {
    /// Active sandbox mode.
    pub mode: SandboxMode,
    /// Directories where write operations are permitted (when mode is `WorkspaceWrite`).
    pub writable_roots: Vec<PathBuf>,
    /// Subpaths under writable roots that must remain strictly read-only
    /// (e.g. `.git`, `.aphrody`, credentials stores).
    pub read_only_subpaths: Vec<PathBuf>,
    /// Network egress policy.
    pub network: NetworkPolicy,
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self {
            mode: SandboxMode::WorkspaceWrite,
            writable_roots: Vec::new(),
            read_only_subpaths: vec![PathBuf::from(".git"), PathBuf::from(".aphrody")],
            network: NetworkPolicy::Denied,
        }
    }
}

impl SandboxPolicy {
    /// Create a new policy with the given mode and default protected subpaths.
    #[must_use]
    pub fn new(mode: SandboxMode) -> Self {
        Self {
            mode,
            writable_roots: Vec::new(),
            read_only_subpaths: vec![PathBuf::from(".git"), PathBuf::from(".aphrody")],
            network: NetworkPolicy::Denied,
        }
    }

    /// Convenience constructor for standard `workspace-write` sandboxing rooted at
    /// `workspace_root`.
    #[must_use]
    pub fn workspace_write(workspace_root: impl AsRef<Path>) -> Self {
        let root = workspace_root.as_ref().to_path_buf();
        Self {
            mode: SandboxMode::WorkspaceWrite,
            writable_roots: vec![root],
            read_only_subpaths: vec![PathBuf::from(".git"), PathBuf::from(".aphrody")],
            network: NetworkPolicy::Denied,
        }
    }

    /// Convenience constructor for strict `read-only` execution.
    #[must_use]
    pub fn read_only() -> Self {
        Self::new(SandboxMode::ReadOnly)
    }

    /// Convenience constructor for dangerously bypassing sandboxing.
    #[must_use]
    pub fn dangerously_bypass() -> Self {
        let mut policy = Self::new(SandboxMode::DangerouslyBypass);
        policy.network = NetworkPolicy::Allowed;
        policy
    }

    /// Builder method to add an authorized writable root directory.
    #[must_use]
    pub fn with_writable_root(mut self, path: impl AsRef<Path>) -> Self {
        self.writable_roots.push(path.as_ref().to_path_buf());
        self
    }

    /// Builder method to add a protected read-only subpath.
    #[must_use]
    pub fn with_read_only_subpath(mut self, path: impl AsRef<Path>) -> Self {
        self.read_only_subpaths.push(path.as_ref().to_path_buf());
        self
    }

    /// Builder method to set the network access policy.
    #[must_use]
    pub fn with_network(mut self, allowed: bool) -> Self {
        self.network = if allowed { NetworkPolicy::Allowed } else { NetworkPolicy::Denied };
        self
    }

    /// Checks whether network access is authorized under this policy.
    #[must_use]
    pub const fn is_network_allowed(&self) -> bool {
        matches!(self.network, NetworkPolicy::Allowed)
    }

    /// Validates whether writing to `target_path` is permitted by this policy.
    ///
    /// Rules:
    /// - `DangerouslyBypass`: always permitted (`true`).
    /// - `ReadOnly`: always denied (`false`).
    /// - `Disabled`: always permitted (`true`).
    /// - `WorkspaceWrite`:
    ///   1. If path matches or lies within any `read_only_subpaths` (e.g. `.git`), denied.
    ///   2. If path lies within at least one authorized `writable_roots`, permitted.
    ///   3. Otherwise denied.
    #[must_use]
    pub fn is_path_writable(&self, target_path: impl AsRef<Path>) -> bool {
        match self.mode {
            SandboxMode::Disabled | SandboxMode::DangerouslyBypass => true,
            SandboxMode::ReadOnly => false,
            SandboxMode::WorkspaceWrite => {
                let target = target_path.as_ref();
                let normalized_target = normalize_path(target);

                // 1. Check if it matches any protected subpath.
                for subpath in &self.read_only_subpaths {
                    for root in &self.writable_roots {
                        let protected = normalize_path(&root.join(subpath));
                        if normalized_target.starts_with(&protected) {
                            return false;
                        }
                    }
                    // Also check if relative or component matches
                    if target.components().any(|c| c.as_os_str() == subpath.as_os_str()) {
                        return false;
                    }
                }

                // 2. Must be contained in at least one writable root
                if self.writable_roots.is_empty() {
                    return false;
                }

                self.writable_roots.iter().any(|root| {
                    let normalized_root = normalize_path(root);
                    normalized_target.starts_with(&normalized_root)
                })
            },
        }
    }
}

/// Normalizes path components without resolving symlinks on disk.
fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {},
            Component::ParentDir => {
                out.pop();
            },
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_defaults() {
        let policy = SandboxPolicy::default();
        assert_eq!(policy.mode, SandboxMode::WorkspaceWrite);
        assert_eq!(policy.network, NetworkPolicy::Denied);
        assert!(!policy.is_network_allowed());
    }

    #[test]
    fn test_path_writability_workspace_write() {
        let root = if cfg!(windows) {
            PathBuf::from(r"C:\workspace\project")
        } else {
            PathBuf::from("/workspace/project")
        };

        let policy = SandboxPolicy::workspace_write(&root);

        // Allowed inside workspace
        let inside = root.join("src").join("main.rs");
        assert!(policy.is_path_writable(&inside));

        // Denied in protected .git directory
        let git_dir = root.join(".git").join("config");
        assert!(!policy.is_path_writable(&git_dir));

        // Denied in protected .aphrody directory
        let aphrody_dir = root.join(".aphrody").join("secrets.json");
        assert!(!policy.is_path_writable(&aphrody_dir));

        // Denied outside workspace
        let outside = if cfg!(windows) {
            PathBuf::from(r"C:\Windows\System32\cmd.exe")
        } else {
            PathBuf::from("/etc/passwd")
        };
        assert!(!policy.is_path_writable(&outside));
    }

    #[test]
    fn test_read_only_and_bypass() {
        let path = PathBuf::from("some/file.txt");

        let ro = SandboxPolicy::read_only();
        assert!(!ro.is_path_writable(&path));

        let bypass = SandboxPolicy::dangerously_bypass();
        assert!(bypass.is_path_writable(&path));
        assert!(bypass.is_network_allowed());
    }
}
