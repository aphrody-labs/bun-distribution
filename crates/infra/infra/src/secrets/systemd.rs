// SPDX-License-Identifier: Apache-2.0
//! Safe systemd EnvironmentFile and credential provisioning with strict permissions.

use anyhow::{Context, Result};
use std::{collections::BTreeMap, fs, path::Path};

use super::redaction::SecretString;

/// Parse a standard .env / key=value file into a map.
pub fn parse_env_file(path: &Path) -> Result<BTreeMap<String, String>> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read env file at {:?}", path))?;

    let mut map = BTreeMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let stripped = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        if let Some((k, v)) = stripped.split_once('=') {
            let key = k.trim().to_string();
            let val = v.trim().trim_matches('"').trim_matches('\'').trim().to_string();
            map.insert(key, val);
        }
    }

    Ok(map)
}

/// Safely write decrypted secrets to a host environment file with strict permissions (0400 / 0600).
pub fn render_env_file(
    secrets: &BTreeMap<String, SecretString>,
    dest_path: &Path,
    apply: bool,
) -> Result<String> {
    let mut buffer = String::new();
    buffer.push_str("# Aphrody Infrastructure Protected Environment — Auto-generated\n");
    buffer.push_str("# DO NOT EDIT DIRECTLY ON HOST. Managed by aphrody-infra.\n\n");

    for (k, v) in secrets {
        let escaped = v.expose_secret().replace('"', "\\\"");
        buffer.push_str(&format!("{k}=\"{escaped}\"\n"));
    }

    if !apply {
        return Ok(format!(
            "[PLAN] Would write {} secrets to {:?} (0400 read-only permissions)",
            secrets.len(),
            dest_path
        ));
    }

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Atomic write to avoid partial file state
    let temp_path = dest_path.with_extension("tmp");
    fs::write(&temp_path, &buffer)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o400);
        let _ = fs::set_permissions(&temp_path, perms);
    }

    fs::rename(&temp_path, dest_path)?;

    Ok(format!("Successfully provisioned {:?} with {} secrets", dest_path, secrets.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_env_file_format() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let sample = "DATABASE_URL=\"postgres://user:pass@localhost:5432/db\"\n# Comment\nJWT_SECRET=superjwttoken\n";
        fs::write(temp.path(), sample).unwrap();

        let parsed = parse_env_file(temp.path()).unwrap();
        assert_eq!(parsed.get("DATABASE_URL").unwrap(), "postgres://user:pass@localhost:5432/db");
        assert_eq!(parsed.get("JWT_SECRET").unwrap(), "superjwttoken");
    }
}
