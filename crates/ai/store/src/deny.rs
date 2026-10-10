// SPDX-License-Identifier: Apache-2.0
//! Hard deny list of the ingestion pipeline: credentials, cookies, secrets, databases and
//! weights are never scanned, fingerprinted, chunked or indexed, whatever the source root.

/// Directories denied under every root (VCS metadata, dependency trees, key stores).
const COMMON_DIRS: &[&str] = &[".ssh", ".gnupg", ".aws", "node_modules", "target", ".git"];

/// Directories that hold secrets or heavy private state when the root is an agent home
/// (`~/.aphrody`); they are ordinary source folders in a repository (`crates/os/ostd/secrets`).
const HOME_DIRS: &[&str] =
    &["cookies", "credentials", "secrets", "private", "models", "services", "drive-sync", "ocr"];

const DENY_EXTENSIONS: &[&str] = &[
    "sqlite", "sqlite3", "db", "db-wal", "db-shm", "lance", "pem", "key", "p12", "pfx", "kdbx",
    "gguf", "safetensors", "onnx", "bin", "pt", "ckpt",
];

const DENY_NAMES: &[&str] = &[
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "google-cookies.json",
    "google.json",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "credentials.json",
    "token.json",
];

/// Root kind the deny rules are evaluated for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenyPolicy {
    /// A source repository or documentation tree.
    Repo,
    /// An agent home (`~/.aphrody` or a domain home): also denies the secret and private stores.
    Home,
}

fn dir_denied(lower: &str, policy: DenyPolicy) -> bool {
    COMMON_DIRS.contains(&lower) || (policy == DenyPolicy::Home && HOME_DIRS.contains(&lower))
}

/// Whether a source-relative path (either separator) must never enter the pipeline.
#[must_use]
pub fn is_denied(rel_path: &str, policy: DenyPolicy) -> bool {
    let normalized = rel_path.replace('\\', "/");
    let mut components = normalized.split('/').filter(|c| !c.is_empty()).peekable();
    while let Some(component) = components.next() {
        let lower = component.to_ascii_lowercase();
        let is_last = components.peek().is_none();
        if !is_last && dir_denied(&lower, policy) {
            return true;
        }
        if is_last {
            if lower == ".env" || lower.starts_with(".env.") || DENY_NAMES.contains(&lower.as_str()) {
                return true;
            }
            if let Some((_, ext)) = lower.rsplit_once('.')
                && DENY_EXTENSIONS.contains(&ext)
            {
                return true;
            }
            // A deny directory given as the final component is denied as well.
            if dir_denied(&lower, policy) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_databases_and_weights_are_denied_under_every_root() {
        for path in [
            ".env",
            ".env.local",
            "google-cookies.json",
            "memory/memory.sqlite",
            "models/qwen.gguf",
            "node_modules/x/index.js",
            "id_rsa",
            "x.pem",
            ".git/config",
            "a\\.ssh\\config",
        ] {
            assert!(is_denied(path, DenyPolicy::Repo), "{path} must be denied in a repo");
            assert!(is_denied(path, DenyPolicy::Home), "{path} must be denied in a home");
        }
    }

    #[test]
    fn home_secret_stores_are_denied_only_in_a_home() {
        for path in [
            "cookies/google.txt",
            "credentials/x.json",
            "sub/secrets/a.txt",
            "private/backups/a",
            "services/supabase/x",
            "models",
        ] {
            assert!(is_denied(path, DenyPolicy::Home), "{path} must be denied in a home");
        }
        assert!(!is_denied("crates/os/ostd/secrets/src/lib.rs", DenyPolicy::Repo));
        assert!(!is_denied("crates/ai/models/src/store.rs", DenyPolicy::Repo));
    }

    #[test]
    fn ordinary_sources_are_allowed() {
        for path in [
            "crates/ai/rag/src/store.rs",
            "docs/plans/agent-home-pipeline/PLAN.md",
            "README.md",
            "src/environment.ts",
            "docs/privacy.md",
            "apps/models.rs",
        ] {
            assert!(!is_denied(path, DenyPolicy::Repo), "{path} must be allowed");
            assert!(!is_denied(path, DenyPolicy::Home), "{path} must be allowed");
        }
    }
}
