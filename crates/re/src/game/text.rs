// SPDX-License-Identifier: Apache-2.0
//! Localized string extraction compatible with dbxv2's UTF-16LE MSG text pass.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MsgText {
    pub file: String,
    pub count: usize,
    pub strings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MsgBatchManifest {
    pub msg_files: usize,
    pub converted: usize,
}

/// Extract runs of at least three printable Latin-1 UTF-16LE code units.
///
/// This matches dbxv2's permissive text pass, which scans raw bytes rather than relying on a
/// particular MSG table layout. Non-ASCII scripts are intentionally omitted just like upstream.
#[must_use]
pub fn extract_utf16_strings(bytes: &[u8]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut cursor = 0;

    while cursor + 1 < bytes.len() {
        if is_printable_latin_utf16(bytes[cursor], bytes[cursor + 1]) {
            let start = cursor;
            let mut units = Vec::new();
            while cursor + 1 < bytes.len()
                && is_printable_latin_utf16(bytes[cursor], bytes[cursor + 1])
            {
                units.push(u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]));
                cursor += 2;
            }
            if units.len() >= 3
                && let Ok(text) = String::from_utf16(&units)
                && !text.trim().is_empty()
            {
                strings.push(text.trim_matches('\0').to_owned());
            }
            debug_assert!(cursor > start);
        } else {
            cursor += 1;
        }
    }
    strings
}

/// Wrap extracted strings in the JSON shape written by dbxv2's `text` command.
#[must_use]
pub fn extract_msg_text(path: &Path, bytes: &[u8]) -> MsgText {
    let strings = extract_utf16_strings(bytes);
    MsgText {
        file: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        count: strings.len(),
        strings,
    }
}

/// Convert every regular `.msg` file in `root` to a separate JSON file below a new destination.
/// The source tree is read-only; symlinks are skipped and an existing destination is rejected.
pub fn extract_msg_tree(root: &Path, destination: &Path) -> crate::game::Result<MsgBatchManifest> {
    if !root.is_dir() {
        return Err(crate::game::ReError::ParseError {
            context: "msg_tree",
            details: format!("input root is not a directory: {}", root.display()),
        });
    }
    if destination.exists() {
        return Err(crate::game::ReError::ParseError {
            context: "msg_tree",
            details: format!("destination already exists: {}", destination.display()),
        });
    }

    let mut inputs = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file()
                && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("msg"))
            {
                inputs.push(path);
            }
        }
    }
    inputs.sort();

    fs::create_dir(destination)?;
    for input in &inputs {
        let relative = input.strip_prefix(root).map_err(|error| crate::game::ReError::ParseError {
            context: "msg_tree",
            details: error.to_string(),
        })?;
        let output = destination.join(relative).with_extension("msg.json");
        let parent = output.parent().ok_or_else(|| crate::game::ReError::ParseError {
            context: "msg_tree",
            details: "output path has no parent".into(),
        })?;
        fs::create_dir_all(parent)?;
        let bytes = fs::read(input)?;
        let report = extract_msg_text(input, &bytes);
        let json = serde_json::to_vec_pretty(&report).map_err(|error| {
            crate::game::ReError::ParseError { context: "msg_tree", details: error.to_string() }
        })?;
        OpenOptions::new().write(true).create_new(true).open(&output)?.write_all(&json)?;
    }

    let manifest = MsgBatchManifest { msg_files: inputs.len(), converted: inputs.len() };
    let manifest_path: PathBuf = destination.join("text_manifest.json");
    let json = serde_json::to_vec_pretty(&manifest).map_err(|error| {
        crate::game::ReError::ParseError { context: "msg_tree", details: error.to_string() }
    })?;
    OpenOptions::new().write(true).create_new(true).open(manifest_path)?.write_all(&json)?;
    Ok(manifest)
}

fn is_printable_latin_utf16(low: u8, high: u8) -> bool {
    (0x20..=0xff).contains(&low) && high == 0
}

#[cfg(test)]
mod tests {
    use super::extract_utf16_strings;

    #[test]
    fn extracts_printable_runs_of_three_or_more_latin_code_units() {
        let mut bytes = vec![0, 0];
        bytes.extend("One".encode_utf16().flat_map(u16::to_le_bytes));
        bytes.extend([0, 0]);
        bytes.extend("Hi".encode_utf16().flat_map(u16::to_le_bytes));
        bytes.extend([0, 0]);
        bytes.extend("Kamehameha".encode_utf16().flat_map(u16::to_le_bytes));
        bytes.extend([0, 0]);
        bytes.extend("日文".encode_utf16().flat_map(u16::to_le_bytes));

        assert_eq!(extract_utf16_strings(&bytes), ["One", "Kamehameha"]);
    }

    #[test]
    fn empty_and_odd_length_buffers_are_safe() {
        assert!(extract_utf16_strings(&[]).is_empty());
        assert!(extract_utf16_strings(&[b'A', 0, b'B']).is_empty());
    }
}
