// SPDX-License-Identifier: Apache-2.0
//! Protected startup environment; values are never included in diagnostics.

use std::{collections::BTreeSet, fs::File, io::Read, path::Path};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Read a complete explicit environment before the MCP runtime starts threads.
/// Reuse the capability owner's dotenv syntax, with strict file/key validation.
pub(crate) fn read_private_environment(path: &Path) -> Result<Vec<(String, String)>, &'static str> {
    if !path.is_absolute() {
        return Err("MCP environment file must be absolute");
    }
    let link = std::fs::symlink_metadata(path).map_err(|_| "MCP environment file unavailable")?;
    if !link.is_file() || link.is_symlink() {
        return Err("MCP environment file must be a regular file");
    }
    let mut file = File::open(path).map_err(|_| "MCP environment file unavailable")?;
    let metadata = file.metadata().map_err(|_| "MCP environment metadata unavailable")?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("MCP environment file exceeds its size bound");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0
            || metadata.dev() != link.dev()
            || metadata.ino() != link.ino()
        {
            return Err("MCP environment file must be private and stable");
        }
    }
    let mut contents = String::new();
    file.by_ref()
        .take(MAX_BYTES + 1)
        .read_to_string(&mut contents)
        .map_err(|_| "MCP environment file is not bounded UTF-8")?;
    if contents.len() as u64 > MAX_BYTES || contents.contains('\0') {
        return Err("MCP environment file exceeds its content bound");
    }
    let values = if path.extension().is_some_and(|extension| extension == "json") {
        serde_json::from_str::<std::collections::BTreeMap<String, String>>(&contents)
            .map_err(|_| "MCP environment JSON must map names to strings")?
            .into_iter()
            .collect()
    } else {
        let lines = contents
            .lines()
            .filter(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with('#')
            })
            .count();
        let values = aphrody_a2a_server::parse_dotenv(&contents);
        if lines != values.len() {
            return Err("MCP environment file has invalid entries");
        }
        values
    };
    let mut keys = BTreeSet::new();
    for (key, value) in &values {
        let mut bytes = key.bytes();
        if !bytes.next().is_some_and(|byte| byte == b'_' || byte.is_ascii_alphabetic())
            || !bytes.all(|byte| byte == b'_' || byte.is_ascii_alphanumeric())
            || !keys.insert(key)
            || value.contains('\0')
        {
            return Err("MCP environment file has invalid or duplicate keys");
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom, Write};

    #[test]
    fn protected_environment_uses_owner_parser_and_never_reports_values() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "# fixture\nTOKEN='fixture-only'\nENDPOINT=https://example.test\nEMPTY=")
            .unwrap();
        let values = read_private_environment(file.path()).unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(values[0], ("TOKEN".into(), "fixture-only".into()));
        for content in
            ["TOKEN=fixture-only\nTOKEN=second\n", "not an assignment\n", "1KEY=fixture-only\n"]
        {
            file.as_file_mut().set_len(0).unwrap();
            file.as_file_mut().seek(SeekFrom::Start(0)).unwrap();
            write!(file, "{content}").unwrap();
            let error = read_private_environment(file.path()).unwrap_err();
            assert!(!error.contains("fixture-only"));
        }
    }

    #[test]
    fn private_json_preserves_quoted_credentials_without_shell_expansion() {
        let mut file = tempfile::Builder::new().suffix(".json").tempfile().unwrap();
        file.write_all(br#"{"TOKEN":"fixture with \"quotes\" and $literal","ENDPOINT":"https://example.test/#fragment"}"#).unwrap();
        let values = read_private_environment(file.path()).unwrap();
        assert_eq!(values[1].1, "fixture with \"quotes\" and $literal");
        file.as_file_mut().set_len(0).unwrap();
        file.as_file_mut().seek(SeekFrom::Start(0)).unwrap();
        file.write_all(br#"{"TOKEN":12}"#).unwrap();
        assert_eq!(
            read_private_environment(file.path()).unwrap_err(),
            "MCP environment JSON must map names to strings"
        );
    }

    #[cfg(unix)]
    #[test]
    fn public_files_and_symlinks_are_refused_without_permission_changes() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "TOKEN=fixture-only").unwrap();
        file.as_file().set_permissions(std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_private_environment(file.path()).is_err());
        assert_eq!(file.as_file().metadata().unwrap().mode() & 0o777, 0o644);
        let root = tempfile::tempdir().unwrap();
        let alias = root.path().join("env");
        symlink(file.path(), &alias).unwrap();
        assert!(read_private_environment(&alias).is_err());
        assert!(read_private_environment(Path::new("relative.env")).is_err());
    }
}
