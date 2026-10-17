// SPDX-License-Identifier: Apache-2.0
//! Resolve A2A authentication without persisting credentials in tool requests.
use std::{io::Read, path::Path};

fn checked(value: String) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty() || value.len() > 4096 || value.bytes().any(|byte| !byte.is_ascii_graphic())
    {
        return Err("Invalid A2A bearer credential");
    }
    Ok(value.to_owned())
}

fn from_file(path: &Path) -> Result<String, &'static str> {
    let file = std::fs::File::open(path).map_err(|_| "A2A credential file unavailable")?;
    let metadata = file
        .metadata()
        .map_err(|_| "A2A credential file unavailable")?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err("Invalid A2A credential file");
    }
    let mut value = String::new();
    file.take(4097)
        .read_to_string(&mut value)
        .map_err(|_| "A2A credential file unreadable")?;
    checked(value)
}

pub(super) fn token() -> Result<Option<String>, &'static str> {
    if let Some(path) = std::env::var_os("APHRODY_A2A_TOKEN_FILE") {
        return from_file(Path::new(&path)).map(Some);
    }
    for name in ["APHRODY_A2A_TOKEN", "APHRODY_A2A_COORD_TOKEN"] {
        if let Ok(value) = std::env::var(name) {
            return checked(value).map(Some);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_files_support_rotation_and_reject_invalid_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bearer");
        assert!(from_file(&path).is_err());
        std::fs::write(&path, "first\n").unwrap();
        assert_eq!(from_file(&path).unwrap(), "first");
        std::fs::write(&path, "replacement\n").unwrap();
        assert_eq!(from_file(&path).unwrap(), "replacement");
        for value in [
            "",
            "Bearer secret",
            "secret\nsecond",
            "non-ascii-🛑",
            &"x".repeat(4097),
        ] {
            std::fs::write(&path, value).unwrap();
            assert!(from_file(&path).is_err());
        }
        assert!(from_file(dir.path()).is_err());
    }
}
