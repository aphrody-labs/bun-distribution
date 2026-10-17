// SPDX-License-Identifier: Apache-2.0
//! Read-only installation inventory compatible with the dbxv2 `map` report.
//!
//! Only small `.exe` and `.dll` files are read, to compute SHA-256. Other files contribute
//! path, extension, and size metadata only. Symlinks are skipped so traversal stays under root.

use std::{
    fmt::Write as _,
    fs::{self, File},
    io::Read,
    path::Path,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::game::{ReError, Result};

const HASH_EXTENSIONS: [&str; 2] = ["exe", "dll"];
const HASH_MAX_BYTES: u64 = 60 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInventory {
    pub game: InventoryGame,
    pub scan: InventoryStats,
    pub files: Vec<InventoryFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryGame {
    pub title: &'static str,
    pub steam_app_id: u32,
    pub root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryStats {
    pub file_count: usize,
    pub total_bytes: u64,
    pub total_gib: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryFile {
    pub path: String,
    pub ext: String,
    pub size_bytes: u64,
    pub sha256: Option<String>,
}

/// Inventory an explicitly selected DBXV2 installation directory without copying its contents.
pub fn inventory_install(root: &Path) -> Result<InstallInventory> {
    if !root.is_dir() {
        return Err(ReError::ParseError {
            context: "install_inventory",
            details: format!("installation root is not a directory: {}", root.display()),
        });
    }

    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut total_bytes = 0u64;

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
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let size_bytes = entry.metadata()?.len();
            total_bytes =
                total_bytes
                    .checked_add(size_bytes)
                    .ok_or_else(|| ReError::ParseError {
                        context: "install_inventory",
                        details: "total file size overflow".into(),
                    })?;
            let ext = path
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let sha256 = if size_bytes < HASH_MAX_BYTES && HASH_EXTENSIONS.contains(&ext.as_str()) {
                Some(sha256_file(&path)?)
            } else {
                None
            };
            files.push(InventoryFile {
                path: relative_path(root, &path)?,
                ext,
                size_bytes,
                sha256,
            });
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    let total_gib = ((total_bytes as f64 / 1_073_741_824.0) * 100.0).round() / 100.0;
    Ok(InstallInventory {
        game: InventoryGame {
            title: "DRAGON BALL XENOVERSE 2",
            steam_app_id: 454650,
            root: root.to_string_lossy().into_owned(),
        },
        scan: InventoryStats {
            file_count: files.len(),
            total_bytes,
            total_gib,
        },
        files,
    })
}

fn relative_path(root: &Path, path: &Path) -> Result<String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|error| ReError::ParseError {
            context: "install_inventory",
            details: error.to_string(),
        })
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let digest = hasher.finalize();
    let mut result = String::with_capacity(64);
    for byte in digest {
        write!(&mut result, "{byte:02x}").expect("writing to String is infallible");
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::inventory_install;

    #[test]
    fn inventory_is_sorted_and_hashes_only_small_binaries() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("game");
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/DBXV2.EXE"), b"synthetic executable").unwrap();
        fs::write(root.join("data.cpk"), b"synthetic archive data").unwrap();

        let inventory = inventory_install(&root).unwrap();
        assert_eq!(inventory.game.steam_app_id, 454650);
        assert_eq!(inventory.scan.file_count, 2);
        assert_eq!(inventory.scan.total_bytes, 42);
        assert_eq!(inventory.files[0].path, "bin/DBXV2.EXE");
        assert_eq!(inventory.files[0].ext, "exe");
        assert_eq!(
            inventory.files[0].sha256.as_deref(),
            Some("eb4ffe43c9edcf310dc3513998df4fa1700fc6570c6c46e32dd3af9e028fe720")
        );
        assert_eq!(inventory.files[1].path, "data.cpk");
        assert!(inventory.files[1].sha256.is_none());
        assert_eq!(inventory.scan.total_gib, 0.0);
    }

    #[test]
    fn non_directory_roots_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        assert!(inventory_install(Path::new(&missing)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed_or_included() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("game");
        let external = temp.path().join("outside.bin");
        fs::create_dir(&root).unwrap();
        fs::write(&external, b"outside").unwrap();
        symlink(&external, root.join("external.bin")).unwrap();
        assert!(inventory_install(&root).unwrap().files.is_empty());
    }
}
