//! Allowlisted disk reclamation on a remote target (`tools/config/disk-reclaim.json`).

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub targets: BTreeMap<String, Target>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub ssh_alias: String,
    pub paths: Vec<Entry>,
    pub tmp: Option<Tmp>,
}

#[derive(Debug, Deserialize)]
pub struct Entry {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tmp {
    pub older_than_minutes: u32,
    pub keep_name_patterns: Vec<String>,
}

pub fn load(root: &Path) -> Result<Config> {
    let path = root.join("tools/config/disk-reclaim.json");
    let text = fs::read_to_string(&path).with_context(|| format!("lecture {}", path.display()))?;
    serde_json::from_str(&text).context("tools/config/disk-reclaim.json invalide")
}

fn safe_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '*' | '@'))
}

fn check_path(path: &str) -> Result<()> {
    if path.starts_with('/') || path.split('/').any(|part| part == ".." || part.is_empty()) {
        bail!("chemin refusé (absolu, vide ou '..'): {path}");
    }
    if !safe_token(path) || path.contains('*') {
        bail!("chemin refusé (caractères hors allowlist): {path}");
    }
    Ok(())
}

/// Build the POSIX shell script run on the target. Prints `<bytes>\t<label>` per entry.
pub fn script(target: &Target, apply: bool) -> Result<String> {
    let mut out = String::from("set -u\ncd \"$HOME\" || exit 1\n");
    for entry in &target.paths {
        check_path(&entry.path)?;
        let p = &entry.path;
        out.push_str(&format!(
            "if [ -e '{p}' ]; then printf '%s\t%s\n' \"$(du -sb '{p}' 2>/dev/null | cut -f1)\" '{p}';"
        ));
        if apply {
            out.push_str(&format!(" rm -rf -- '{p}';"));
        }
        out.push_str(" fi\n");
    }
    if let Some(tmp) = &target.tmp {
        let mut filter =
            format!("-mindepth 1 -maxdepth 1 -user \"$(id -u)\" -mmin +{}", tmp.older_than_minutes);
        for pattern in &tmp.keep_name_patterns {
            if !safe_token(pattern) || pattern.contains('/') {
                bail!("motif /tmp refusé: {pattern}");
            }
            filter.push_str(&format!(" ! -name '{pattern}'"));
        }
        out.push_str(&format!(
            "printf '%s\t%s\n' \"$(find /tmp {filter} -exec du -sb {{}} + 2>/dev/null | awk '{{s+=$1}} END {{print s+0}}')\" '/tmp (tmpfs, RAM)'\n"
        ));
        if apply {
            out.push_str(&format!(
                "find /tmp {filter} -exec rm -rf -- {{}} + 2>/dev/null || true\n"
            ));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(path: &str) -> Target {
        Target {
            ssh_alias: "t".into(),
            paths: vec![Entry { path: path.into(), reason: "r".into() }],
            tmp: Some(Tmp {
                older_than_minutes: 60,
                keep_name_patterns: vec!["systemd-private-*".into()],
            }),
        }
    }

    #[test]
    fn plan_never_deletes() {
        let plan = script(&target("iecode/target"), false).unwrap();
        assert!(!plan.contains("rm -rf"), "{plan}");
        assert!(plan.contains("du -sb 'iecode/target'"));
    }

    #[test]
    fn apply_deletes_only_allowlisted_paths() {
        let apply = script(&target("iecode/target"), true).unwrap();
        assert!(apply.contains("rm -rf -- 'iecode/target'"));
        assert!(apply.contains("! -name 'systemd-private-*'"));
        assert!(apply.contains("-user \"$(id -u)\""));
    }

    #[test]
    fn rejects_dangerous_paths() {
        for bad in ["/etc", "../x", "a//b", "a/../b", "", "x;rm", "a b", "*"] {
            assert!(script(&target(bad), false).is_err(), "{bad}");
        }
    }

    #[test]
    fn repository_config_is_valid() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        for target in load(&root).unwrap().targets.values() {
            script(target, true).unwrap();
        }
    }
}
