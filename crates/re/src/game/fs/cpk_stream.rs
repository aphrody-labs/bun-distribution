// SPDX-License-Identifier: Apache-2.0
//! Streaming CRIWARE CPK extraction for the DBXV2 archives (feature `dbxv2`).
//!
//! The `@UTF` header/TOC reader, the table XOR descrambling and CRILAYLA decompression are the
//! canonical `aphrody-nie-formats` implementation; this module only adds the file-backed
//! reader, path validation and the multi-threaded write loop. Archives are never loaded whole:
//! `data.cpk` is 9 GB, so every entry is read with a positioned read of its own range.

use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use aphrody_nie_formats::{
    FormatError,
    cpk::{CpkEntry, CpkReader},
};
use serde::Serialize;

use crate::game::{ReError, Result};

/// One extracted file of a CPK manifest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpkFileRecord {
    /// TOC row index.
    pub id: usize,
    /// Output path relative to the destination, `/`-separated.
    pub file: String,
    pub size_bytes: u64,
}

/// Summary of one archive extraction.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpkExtraction {
    pub archive: String,
    pub entry_count: usize,
    pub total_bytes: u64,
    pub files: Vec<CpkFileRecord>,
}

fn format_error(context: &'static str, error: FormatError) -> ReError {
    ReError::ParseError {
        context,
        details: error.to_string(),
    }
}

fn read_range(
    file: &mut File,
    offset: u64,
    size: usize,
) -> std::result::Result<Vec<u8>, FormatError> {
    let mut buffer = vec![0u8; size];
    file.seek(SeekFrom::Start(offset))
        .and_then(|_| file.read_exact(&mut buffer))
        .map_err(|_| FormatError::TooShort { got: 0, need: size })?;
    Ok(buffer)
}

/// Parse only the header and TOC of a CPK file.
pub fn open_cpk(path: &Path) -> Result<CpkReader> {
    let mut file = File::open(path)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    CpkReader::from_reader(&name, |offset, size| read_range(&mut file, offset, size))
        .map_err(|error| format_error("cpk_open", error))
}

fn is_safe_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && !component.contains(':')
        && !component.chars().any(char::is_control)
}

/// Relative output path of an entry (`DirName/FileName`), rejecting traversal and drive syntax.
pub fn entry_output_path(entry: &CpkEntry) -> Option<PathBuf> {
    let mut output = PathBuf::new();
    for component in entry
        .directory
        .split(['/', '\\'])
        .filter(|value| !value.is_empty())
    {
        if !is_safe_component(component) {
            return None;
        }
        output.push(component);
    }
    if !is_safe_component(&entry.filename) || entry.filename.contains(['/', '\\']) {
        return None;
    }
    output.push(&entry.filename);
    Some(output)
}

/// Extract every entry of `archive` below `destination`.
///
/// `create_new` refuses to replace an existing file (used by the one-archive `cpk` command,
/// which also requires a fresh destination); otherwise files are overwritten like the dbxv2
/// `extract` command does. Entries are written by `threads` workers, each with its own handle.
pub fn extract_cpk(
    archive: &Path,
    destination: &Path,
    create_new: bool,
    threads: usize,
) -> Result<CpkExtraction> {
    let reader = open_cpk(archive)?;
    let mut paths = Vec::with_capacity(reader.entries.len());
    let mut unique = HashSet::with_capacity(reader.entries.len());
    for entry in &reader.entries {
        let path = entry_output_path(entry).ok_or_else(|| ReError::ParseError {
            context: "cpk_extract",
            details: format!("unsafe CPK path: {}/{}", entry.directory, entry.filename),
        })?;
        let key = path
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if !unique.insert(key) {
            return Err(ReError::ParseError {
                context: "cpk_extract",
                details: format!("duplicate CPK output path: {}", path.display()),
            });
        }
        paths.push(path);
    }

    fs::create_dir_all(destination)?;
    let next = AtomicUsize::new(0);
    let failure: Mutex<Option<ReError>> = Mutex::new(None);
    let sizes: Vec<AtomicUsize> = (0..paths.len()).map(|_| AtomicUsize::new(0)).collect();
    std::thread::scope(|scope| {
        for _ in 0..threads.clamp(1, 32) {
            scope.spawn(|| {
                let mut file = match File::open(archive) {
                    Ok(file) => file,
                    Err(error) => {
                        failure.lock().expect("lock").get_or_insert(error.into());
                        return;
                    }
                };
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    if index >= paths.len() || failure.lock().expect("lock").is_some() {
                        return;
                    }
                    let entry = &reader.entries[index];
                    let result = reader
                        .extract_from_reader(entry, |offset, size| {
                            read_range(&mut file, offset, size)
                        })
                        .map_err(|error| ReError::ParseError {
                            context: "cpk_extract",
                            details: format!("{}/{}: {error}", entry.directory, entry.filename),
                        })
                        .and_then(|bytes| {
                            let output = destination.join(&paths[index]);
                            if let Some(parent) = output.parent() {
                                fs::create_dir_all(parent)?;
                            }
                            let mut options = OpenOptions::new();
                            options.write(true);
                            if create_new {
                                options.create_new(true);
                            } else {
                                options.create(true).truncate(true);
                            }
                            options.open(&output)?.write_all(&bytes)?;
                            sizes[index].store(bytes.len(), Ordering::Relaxed);
                            Ok(())
                        });
                    if let Err(error) = result {
                        failure.lock().expect("lock").get_or_insert(error);
                        return;
                    }
                }
            });
        }
    });
    if let Some(error) = failure.into_inner().expect("lock") {
        return Err(error);
    }

    let mut total_bytes = 0u64;
    let files: Vec<CpkFileRecord> = paths
        .iter()
        .zip(&sizes)
        .enumerate()
        .map(|(id, (path, size))| {
            let size_bytes = size.load(Ordering::Relaxed) as u64;
            total_bytes += size_bytes;
            CpkFileRecord {
                id,
                file: path.to_string_lossy().replace('\\', "/"),
                size_bytes,
            }
        })
        .collect();
    Ok(CpkExtraction {
        archive: archive
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        entry_count: files.len(),
        total_bytes,
        files,
    })
}

/// Archive selection of the dbxv2 `extract` command.
#[derive(Debug, Clone, Default)]
pub struct ExtractOptions {
    /// Explicit archive names (`data2.cpk`); when set, only these are extracted.
    pub names: Vec<String>,
    pub all: bool,
    pub include_movies: bool,
    pub max_gib: f64,
    pub skip_existing: bool,
    pub threads: usize,
}

fn tree_file_count(directory: &Path) -> usize {
    let mut count = 0;
    let mut pending = vec![directory.to_path_buf()];
    while let Some(current) = pending.pop() {
        for entry in fs::read_dir(&current).into_iter().flatten().flatten() {
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => pending.push(entry.path()),
                Ok(kind) if kind.is_file() && entry.file_name() != "_cripak.log" => count += 1,
                _ => {}
            }
        }
    }
    count
}

/// `extract`: select the install's CPKs (smallest first) and extract each one to
/// `<out>/cpk/<stem>/`, then write `<out>/reports/extract_manifest.json`.
pub fn extract_install(
    game: &Path,
    out: &Path,
    options: &ExtractOptions,
) -> Result<serde_json::Value> {
    let mut archives: Vec<(PathBuf, u64)> = fs::read_dir(game.join("cpk"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("cpk"))
        })
        .filter_map(|path| fs::metadata(&path).ok().map(|meta| (path, meta.len())))
        .collect();
    archives.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

    let mut selected = Vec::new();
    let mut skipped = Vec::new();
    for (path, size) in archives {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !options.names.is_empty() {
            if options.names.contains(&name) {
                selected.push(path);
            }
            continue;
        }
        if !options.include_movies && name.starts_with("movie") {
            skipped.push(serde_json::json!([name, "movie"]));
            continue;
        }
        if !options.all && size as f64 / 1_073_741_824.0 > options.max_gib {
            skipped.push(serde_json::json!([
                name,
                format!(">{}GiB", options.max_gib)
            ]));
            continue;
        }
        selected.push(path);
    }

    let destination_root = out.join("cpk");
    fs::create_dir_all(&destination_root)?;
    let mut results = Vec::with_capacity(selected.len());
    for archive in &selected {
        let name = archive
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let stem = archive
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let destination = destination_root.join(&stem);
        if options.skip_existing && destination.exists() {
            let count = tree_file_count(&destination);
            if count > 0 {
                results.push(
                    serde_json::json!({ "cpk": name, "status": "skip-existing", "files": count }),
                );
                continue;
            }
        }
        let start = std::time::Instant::now();
        let (status, files) = match extract_cpk(archive, &destination, false, options.threads) {
            Ok(extraction) => ("ok", extraction.entry_count),
            Err(error) => {
                eprintln!("bunre dbxv2: extract {name} failed: {error}");
                ("err", 0)
            }
        };
        let seconds = (start.elapsed().as_secs_f64() * 10.0).round() / 10.0;
        results.push(
            serde_json::json!({ "cpk": name, "status": status, "files": files, "sec": seconds }),
        );
    }
    let manifest = serde_json::json!({
        "selected": selected.len(),
        "skipped": skipped,
        "results": results,
    });
    let reports = out.join("reports");
    fs::create_dir_all(&reports)?;
    fs::write(
        reports.join("extract_manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use aphrody_nie_formats::cpk::CpkEntry;

    use super::entry_output_path;

    fn entry(directory: &str, filename: &str) -> CpkEntry {
        CpkEntry {
            filename: filename.into(),
            directory: directory.into(),
            offset: 0,
            size: 0,
            extract_size: 0,
            is_compressed: false,
        }
    }

    #[test]
    fn output_paths_reject_traversal_and_drives() {
        assert!(entry_output_path(&entry("data/chara", "GOK.cms")).is_some());
        assert!(entry_output_path(&entry("../x", "a.bin")).is_none());
        assert!(entry_output_path(&entry("C:", "a.bin")).is_none());
        assert!(entry_output_path(&entry("data", "..")).is_none());
    }
}
