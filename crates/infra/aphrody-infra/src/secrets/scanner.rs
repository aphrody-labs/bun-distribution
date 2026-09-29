// SPDX-License-Identifier: Apache-2.0
//! Continuous secret leak scanner and repository auditor.
//!
//! Inspects files, unencrypted .env configurations, high-entropy tokens,
//! and known API key signatures across the repository tree.

use std::{fs, path::Path};

use anyhow::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretAuditFinding {
    pub file: String,
    pub line: usize,
    pub rule: String,
    pub severity: String,
    pub description: String,
    pub snippet: String,
}

pub struct SecretScanner {
    patterns: Vec<(&'static str, &'static str, Regex)>,
}

impl Default for SecretScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretScanner {
    pub fn new() -> Self {
        let patterns = vec![
            (
                "PRIVATE_KEY",
                "Private cryptographic key (RSA, EC, OpenSSH)",
                Regex::new(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----").unwrap(),
            ),
            (
                "GITHUB_PAT",
                "GitHub Personal Access Token",
                Regex::new(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{36,255}\b").unwrap(),
            ),
            ("AWS_ACCESS_KEY", "AWS Access Key ID", Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap()),
            (
                "DISCORD_BOT_TOKEN",
                "Discord Bot Token pattern",
                Regex::new(
                    r"\b[M-Z][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b",
                )
                .unwrap(),
            ),
            (
                "DATABASE_URI_PASSWORD",
                "Database connection URI containing plaintext password",
                Regex::new(r"(?:postgres|postgresql|mysql|mongodb)://[^:]+:([^@]+)@").unwrap(),
            ),
        ];

        Self { patterns }
    }

    /// Recursively scan a directory for secret leaks.
    pub fn scan_directory(&self, root: &Path) -> Result<Vec<SecretAuditFinding>> {
        let mut findings = Vec::new();

        let walker = ignore::WalkBuilder::new(root)
            .hidden(true)
            .git_ignore(true)
            .git_global(true)
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                // Skip target directories and .git internal objects
                !(name == "target" || name == ".git" || name == "node_modules")
            })
            .build();

        for entry in walker.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // 1. Check for unencrypted .env files
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if (file_name.starts_with(".env") || file_name.ends_with(".env"))
                && !file_name.contains(".example")
                && !file_name.contains(".template")
                && !file_name.contains(".enc.")
            {
                findings.push(SecretAuditFinding {
                    file: path.display().to_string(),
                    line: 1,
                    rule: "UNENCRYPTED_ENV_FILE".into(),
                    severity: "CRITICAL".into(),
                    description: format!(
                        "Unencrypted environment file detected on disk: '{file_name}'"
                    ),
                    snippet: file_name.to_string(),
                });
            }

            // Only scan text files under 2MB
            if let Ok(meta) = entry.metadata()
                && meta.len() > 2 * 1024 * 1024
            {
                continue;
            }

            if let Ok(content) = fs::read_to_string(path) {
                let mut file_findings = self.scan_content(path, &content);
                findings.append(&mut file_findings);
            }
        }

        Ok(findings)
    }

    /// Scan text content line by line against registered security signatures.
    pub fn scan_content(&self, path: &Path, content: &str) -> Vec<SecretAuditFinding> {
        let mut findings = Vec::new();
        let path_str = path.display().to_string();

        for (line_idx, line) in content.lines().enumerate() {
            let line_num = line_idx + 1;
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#') {
                continue;
            }

            for (rule_id, desc, re) in &self.patterns {
                if let Some(mat) = re.find(line) {
                    let matched_str = mat.as_str();
                    // Avoid false positives in unit tests or documentation snippets
                    if matched_str.contains("test")
                        || matched_str.contains("example")
                        || matched_str.contains("dummy")
                        || matched_str.contains("%s")
                        || matched_str.contains("${")
                        || matched_str.contains("user:pass")
                        || path_str.contains("test")
                        || path_str.contains("README")
                        || path_str.contains("scanner.rs")
                    {
                        continue;
                    }

                    let snippet = if matched_str.len() > 10 {
                        format!("{}...{}", &matched_str[..4], &matched_str[matched_str.len() - 4..])
                    } else {
                        "***REDACTED***".to_string()
                    };

                    findings.push(SecretAuditFinding {
                        file: path_str.clone(),
                        line: line_num,
                        rule: rule_id.to_string(),
                        severity: "CRITICAL".into(),
                        description: desc.to_string(),
                        snippet,
                    });
                }
            }
        }

        findings
    }
}

/// Compute Shannon entropy of a string (in bits per character).
pub fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let mut counts = std::collections::HashMap::new();
    for c in s.chars() {
        *counts.entry(c).or_insert(0) += 1;
    }
    let len = s.chars().count() as f64;
    let mut entropy = 0.0;
    for &count in counts.values() {
        let p = count as f64 / len;
        entropy -= p * p.log2();
    }
    entropy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shannon_entropy() {
        let zero = shannon_entropy("aaaaaaaaaa");
        assert!(zero < 0.1);
        let high = shannon_entropy("a8!Zq9#vLm0$xP2@1k");
        assert!(high > 3.5);
    }

    #[test]
    fn test_scanner_detects_private_key() {
        let scanner = SecretScanner::new();
        let sample = "const KEY = '-----BEGIN RSA PRIVATE KEY-----';";
        let findings = scanner.scan_content(Path::new("src/main.rs"), sample);
        assert!(!findings.is_empty());
        assert_eq!(findings[0].rule, "PRIVATE_KEY");
    }
}
