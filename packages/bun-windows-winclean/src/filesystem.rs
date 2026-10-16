// SPDX-License-Identifier: Apache-2.0
//! Rust filesystem compatibility handlers for the WinClean catalog.

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const MAX_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub size_bytes: u64,
    pub last_write_utc: String,
    pub creation_utc: String,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub root: String,
    pub entries: Vec<FileInfo>,
    pub count: usize,
    pub truncated: bool,
}

pub fn resolve_path(path: &str) -> io::Result<PathBuf> {
    if path.trim().is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "path must be non-empty"));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return fs::canonicalize(candidate).or_else(|_| Ok(candidate.to_path_buf()));
    }
    let desktop = dirs_desktop().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let joined = desktop.join(candidate);
    fs::canonicalize(&joined).or(Ok(joined))
}

fn dirs_desktop() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    let desktop = PathBuf::from(profile).join("Desktop");
    desktop.is_dir().then_some(desktop)
}

fn info(path: &Path) -> io::Result<FileInfo> {
    let metadata = fs::metadata(path)?;
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_owned();
    let hidden = name.starts_with('.') || {
        #[cfg(windows)]
        {
            metadata.file_attributes() & 0x2 != 0
        }
        #[cfg(not(windows))]
        {
            false
        }
    };
    let stamp = |value: io::Result<std::time::SystemTime>| {
        value
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_default()
    };
    Ok(FileInfo {
        path: path.display().to_string(),
        name,
        is_directory: metadata.is_dir(),
        size_bytes: metadata.len(),
        last_write_utc: stamp(metadata.modified()),
        creation_utc: stamp(metadata.created()),
        is_hidden: hidden,
    })
}

pub fn get_file_info(path: &str) -> io::Result<FileInfo> {
    let resolved = resolve_path(path)?;
    info(&resolved)
}

pub fn list_directory(
    path: &str,
    pattern: Option<&str>,
    recursive: bool,
    show_hidden: bool,
) -> io::Result<DirectoryListing> {
    list_directory_excluding(path, pattern, recursive, show_hidden, &[])
}

/// List directory entries while excluding matching entry names.
///
/// Exclusion globs match basenames using the same ASCII case-insensitive rules as
/// `pattern`. Excluded directories are neither returned nor traversed.
pub fn list_directory_excluding(
    path: &str,
    pattern: Option<&str>,
    recursive: bool,
    show_hidden: bool,
    exclude_patterns: &[String],
) -> io::Result<DirectoryListing> {
    let root = resolve_path(path)?;
    if !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "directory not found"));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    let mut stack = vec![root.clone()];
    while let Some(current) = stack.pop() {
        let read = match fs::read_dir(&current) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in read.flatten() {
            if !exclude_patterns.is_empty() {
                let name = item.file_name();
                let name = name.to_string_lossy();
                if exclude_patterns.iter().any(|pattern| wildcard_match(pattern, &name)) {
                    continue;
                }
            }
            let path = item.path();
            let dto = match info(&path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if !show_hidden && dto.is_hidden {
                continue;
            }
            if pattern.is_none_or(|value| wildcard_match(value, &dto.name)) {
                if entries.len() == MAX_ENTRIES {
                    truncated = true;
                    break;
                }
                entries.push(dto.clone());
            }
            if recursive && dto.is_directory {
                stack.push(path);
            }
        }
        if truncated {
            break;
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    let count = entries.len();
    Ok(DirectoryListing { root: root.display().to_string(), entries, count, truncated })
}

pub fn search_files(path: &str, pattern: &str, recursive: bool) -> io::Result<DirectoryListing> {
    search_files_excluding(path, pattern, recursive, &[])
}

pub fn search_files_excluding(
    path: &str,
    pattern: &str,
    recursive: bool,
    exclude_patterns: &[String],
) -> io::Result<DirectoryListing> {
    let mut listing =
        list_directory_excluding(path, Some(pattern), recursive, true, exclude_patterns)?;
    listing.entries.retain(|entry| !entry.is_directory);
    listing.count = listing.entries.len();
    Ok(listing)
}

/// Use the shared metadata-only SQLite index when explicitly configured.
/// The glob walker remains the compatibility fallback, so callers keep the
/// frozen WinClean contract while large repeated scans can reuse FTS5.
pub fn search_files_indexed(path: &str, query: &str) -> io::Result<Option<DirectoryListing>> {
    let Some(db_path) = std::env::var_os("APHRODY_FSINDEX_DB") else {
        return Ok(None);
    };
    let db_path = PathBuf::from(db_path);
    if !db_path.is_file() {
        return Ok(None);
    }
    let root = resolve_path(path)?;
    let fts = query
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" ");
    if fts.is_empty() {
        return Ok(Some(DirectoryListing {
            root: root.display().to_string(),
            entries: Vec::new(),
            count: 0,
            truncated: false,
        }));
    }
    let connection = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| io::Error::other(error.to_string()))?;
    let mut statement = connection
        .prepare(
            "SELECT f.path FROM files_fts JOIN files f ON f.rowid = files_fts.rowid \
             WHERE files_fts MATCH ?1 AND f.is_dir = 0 ORDER BY bm25(files_fts) LIMIT ?2",
        )
        .map_err(|error| io::Error::other(error.to_string()))?;
    let hits = statement
        .query_map(rusqlite::params![fts, MAX_ENTRIES as i64], |row| row.get::<_, String>(0))
        .map_err(|error| io::Error::other(error.to_string()))?;
    let entries = hits
        .filter_map(Result::ok)
        .filter(|path| Path::new(path).starts_with(&root))
        .filter_map(|path| info(Path::new(&path)).ok())
        .collect::<Vec<_>>();
    let count = entries.len();
    Ok(Some(DirectoryListing {
        root: root.display().to_string(),
        entries,
        count,
        truncated: count >= MAX_ENTRIES,
    }))
}

pub fn read_file(path: &str, offset: usize, limit: usize) -> io::Result<String> {
    let resolved = resolve_path(path)?;
    let content = fs::read_to_string(&resolved)?;
    if offset == 0 && limit == 0 {
        return Ok(format!("Path: {}\nContent:\n{content}", resolved.display()));
    }
    let lines = content.lines().skip(offset);
    let selected =
        if limit == 0 { lines.collect::<Vec<_>>() } else { lines.take(limit).collect::<Vec<_>>() };
    Ok(format!("Path: {}\nContent:\n{}", resolved.display(), selected.join("\n")))
}

pub fn write_file(path: &str, content: &str, append: bool) -> io::Result<String> {
    let resolved = resolve_path(path)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)?;
    }
    if append {
        use std::io::Write;
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&resolved)?
            .write_all(content.as_bytes())?;
    } else {
        fs::write(&resolved, content)?;
    }
    Ok(format!("Wrote {} chars to '{}'.", content.chars().count(), resolved.display()))
}

pub fn delete_path(path: &str, recursive: bool) -> io::Result<String> {
    let resolved = resolve_path(path)?;
    if resolved.is_dir() {
        if recursive {
            fs::remove_dir_all(&resolved)?;
        } else {
            fs::remove_dir(&resolved)?;
        }
        return Ok(format!("Deleted directory '{}'.", resolved.display()));
    }
    if resolved.is_file() {
        fs::remove_file(&resolved)?;
        return Ok(format!("Deleted file '{}'.", resolved.display()));
    }
    Ok(format!("Path not found: '{}'.", resolved.display()))
}

pub fn copy_path(path: &str, destination: &str, overwrite: bool) -> io::Result<String> {
    let source = resolve_path(path)?;
    let target = resolve_path(destination)?;
    if source.is_file() {
        if target.exists() && !overwrite {
            return Ok(format!(
                "Destination exists: '{}'. Set overwrite=true to replace.",
                target.display()
            ));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source, &target)?;
        return Ok(format!("Copied file '{}' -> '{}'.", source.display(), target.display()));
    }
    if source.is_dir() {
        copy_directory(&source, &target, overwrite)?;
        return Ok(format!("Copied directory '{}' -> '{}'.", source.display(), target.display()));
    }
    Ok(format!("Source not found: '{}'.", source.display()))
}

pub fn move_path(path: &str, destination: &str, overwrite: bool) -> io::Result<String> {
    let source = resolve_path(path)?;
    let target = resolve_path(destination)?;
    if !source.exists() {
        return Ok(format!("Source not found: '{}'.", source.display()));
    }
    if target.exists() {
        if !overwrite {
            return Ok(format!(
                "Destination exists: '{}'. Set overwrite=true to replace.",
                target.display()
            ));
        }
        if target.is_dir() {
            fs::remove_dir_all(&target)?;
        } else {
            fs::remove_file(&target)?;
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &target)?;
    let kind = if target.is_dir() { "directory" } else { "file" };
    Ok(format!("Moved {kind} '{}' -> '{}'.", source.display(), target.display()))
}

fn copy_directory(source: &Path, target: &Path, overwrite: bool) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for item in fs::read_dir(source)? {
        let item = item?;
        let destination = target.join(item.file_name());
        if item.path().is_dir() {
            copy_directory(&item.path(), &destination, overwrite)?;
        } else {
            if destination.exists() && !overwrite {
                continue;
            }
            fs::copy(item.path(), destination)?;
        }
    }
    Ok(())
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    let (mut p, mut t, mut star, mut mark) = (0usize, 0usize, None, 0usize);
    let pat = pattern.as_bytes();
    let value = text.as_bytes();
    while t < value.len() {
        if p < pat.len() && (pat[p] == b'?' || pat[p].eq_ignore_ascii_case(&value[t])) {
            p += 1;
            t += 1;
        } else if p < pat.len() && pat[p] == b'*' {
            star = Some(p);
            p += 1;
            mark = t;
        } else if let Some(index) = star {
            p = index + 1;
            mark += 1;
            t = mark;
        } else {
            return false;
        }
    }
    while p < pat.len() && pat[p] == b'*' {
        p += 1;
    }
    p == pat.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excluded_directories_are_not_returned_or_traversed() {
        let root = tempfile::tempdir().expect("temporary root");
        let source = root.path().join("src");
        let dependencies = root.path().join("node_modules");
        let nested_dependencies = source.join("node_modules");
        fs::create_dir_all(&nested_dependencies).expect("nested dependencies");
        fs::create_dir_all(&dependencies).expect("dependencies");
        fs::write(dependencies.join("ignored.js"), "ignored").expect("dependency file");
        fs::write(nested_dependencies.join("ignored.js"), "ignored").expect("nested file");
        fs::write(source.join("main.ts"), "kept").expect("source file");

        let value = crate::dispatch::call_rust(
            "list_directory",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "recursive": true,
                "showHidden": true,
                "exclude": ["node_modules"]
            }),
        )
        .expect("MCP tool dispatch");
        let listing: DirectoryListing = serde_json::from_value(value).expect("listing schema");

        assert!(!listing.entries.iter().any(|entry| entry.name == "node_modules"));
        assert!(listing.entries.iter().any(|entry| entry.name == "main.ts"));
        assert!(!listing.entries.iter().any(|entry| entry.name == "ignored.js"));
        assert!(!listing.truncated);
    }

    #[test]
    fn list_directory_rejects_non_string_exclusion_patterns() {
        let root = tempfile::tempdir().expect("temporary root");
        let invalid_type = crate::dispatch::call_rust(
            "list_directory",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "exclude": [42]
            }),
        );
        assert!(matches!(
            invalid_type,
            Err(crate::SubsystemError::InvalidArguments(_))
        ));

        let empty_pattern = crate::dispatch::call_rust(
            "list_directory",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "exclude": [""]
            }),
        );
        assert!(matches!(
            empty_pattern,
            Err(crate::SubsystemError::InvalidArguments(_))
        ));
    }

    #[test]
    fn exclusion_globs_match_files_and_default_listing_is_unchanged() {
        let root = tempfile::tempdir().expect("temporary root");
        fs::write(root.path().join("cache.tmp"), "ignored").expect("temporary file");
        fs::write(root.path().join("keep.rs"), "kept").expect("source file");
        let path = root.path().to_str().expect("UTF-8 test path");

        let listing = list_directory(path, None, false, true).expect("default listing");
        assert_eq!(listing.count, 2);

        let excludes = vec!["*.tmp".to_owned()];
        let filtered =
            list_directory_excluding(path, None, false, true, &excludes).expect("filtered listing");
        assert_eq!(filtered.count, 1);
        assert_eq!(filtered.entries[0].name, "keep.rs");
    }

    #[test]
    fn search_files_excludes_matching_directories_and_files() {
        let root = tempfile::tempdir().expect("temporary root");
        let source = root.path().join("src");
        let dependencies = source.join("node_modules");
        fs::create_dir_all(&dependencies).expect("dependencies");
        fs::write(source.join("main.js"), "kept").expect("source file");
        fs::write(source.join("ignored.test.js"), "ignored").expect("excluded file");
        fs::write(dependencies.join("dependency.js"), "ignored").expect("dependency file");

        let value = crate::dispatch::call_rust(
            "search_files",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "pattern": "*.js",
                "recursive": true,
                "exclude": ["node_modules", "*.test.js"]
            }),
        )
        .expect("MCP tool dispatch");
        let listing: DirectoryListing = serde_json::from_value(value).expect("listing schema");

        assert_eq!(listing.count, 1);
        assert_eq!(listing.entries[0].name, "main.js");
        assert!(!listing.truncated);
    }

    #[test]
    fn search_files_rejects_invalid_exclusion_patterns() {
        let root = tempfile::tempdir().expect("temporary root");
        let invalid_type = crate::dispatch::call_rust(
            "search_files",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "pattern": "*.js",
                "exclude": [42]
            }),
        );
        assert!(matches!(
            invalid_type,
            Err(crate::SubsystemError::InvalidArguments(_))
        ));

        let empty_pattern = crate::dispatch::call_rust(
            "search_files",
            serde_json::json!({
                "path": root.path().to_str().expect("UTF-8 test path"),
                "pattern": "*.js",
                "exclude": [""]
            }),
        );
        assert!(matches!(
            empty_pattern,
            Err(crate::SubsystemError::InvalidArguments(_))
        ));
    }
}
