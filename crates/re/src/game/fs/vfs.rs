// SPDX-License-Identifier: Apache-2.0
//! Virtual File System (VFS) for Dragon Ball Xenoverse 2 (DBXV2).
//!
//! Adapts the multi-tier CPK mounting, loose file overlay, and bounded LRU archive caching
//! architecture from `aphrody-nie-formats` / `aphrody-nie-core` specifically for DBXV2.
//!
//! ## Priority Layering
//! DBXV2 resolves files with the following precedence:
//! 1. Loose `data/` directory (XV2Patcher modding overrides and loose extracted files).
//! 2. `data2.cpk` (Main character models `chara/`, UI `ui/`, scripts, skill files).
//! 3. `data.cpk` (Base game systems, sounds, stages).
//! 4. `data_d*.cpk` (DLC packs: `data_d1_1_xv1.cpk`, `data_d2_*.cpk` in order).
//! 5. `movie_*.cpk` (CRI Sofdec USM video cutscenes).
//!
//! ## Zero-Copy Streaming & LRU Caching
//! Uncompressed files in CPK archives are sliced zero-copy via memory mapping or shared buffers.
//! CRILAYLA-compressed files are decompressed transparently on demand.
//! Archive instances are kept in a bounded LRU cache with configurable budget (default 2 GiB).

use crate::game::error::{ReError, Result};
use crate::game::fs::cpk::CpkArchive;
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Default cache budget for Xenoverse CPK archives (2 GiB).
pub const DEFAULT_XENOVERSE_CACHE_BUDGET: usize = 2 * 1024 * 1024 * 1024;

/// Observable statistics of the CPK archive cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CacheCpkStats {
    /// Total bytes currently held in memory by cached archives.
    pub bytes_used: usize,
    /// Number of CPK archives currently in the cache.
    pub entries_count: usize,
    /// Maximum cache memory budget before LRU eviction triggers.
    pub budget_bytes: usize,
}

/// Loaded CPK archive with its underlying byte storage (mmap or memory buffer).
pub struct LoadedCpk {
    pub name: String,
    pub archive: CpkArchive,
    pub storage: CpkStorage,
}

impl LoadedCpk {
    /// Archive bytes, whatever the storage of the target.
    #[inline]
    pub fn bytes(&self) -> &[u8] {
        self.storage.as_bytes()
    }
}

pub enum CpkStorage {
    Buffer(Vec<u8>),
}

impl CpkStorage {
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Buffer(v) => v.as_slice(),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.as_bytes().len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.as_bytes().is_empty()
    }
}

/// Thread-safe bounded LRU archive cache.
struct CpkLruCache {
    map: HashMap<String, Arc<LoadedCpk>>,
    order: VecDeque<String>,
    bytes_used: usize,
    budget_bytes: usize,
}

impl CpkLruCache {
    fn new(budget_bytes: usize) -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), bytes_used: 0, budget_bytes }
    }

    fn get(&mut self, key: &str) -> Option<Arc<LoadedCpk>> {
        let loaded = self.map.get(key)?.clone();
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
        }
        self.order.push_back(key.to_string());
        Some(loaded)
    }

    fn insert(&mut self, key: String, loaded: Arc<LoadedCpk>) {
        let size = loaded.storage.len();
        if let Some(old) = self.map.insert(key.clone(), loaded) {
            self.bytes_used = self.bytes_used.saturating_sub(old.storage.len());
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }
        self.bytes_used += size;
        self.order.push_back(key);
        self.evict_if_needed();
    }

    fn evict_if_needed(&mut self) {
        while self.bytes_used > self.budget_bytes && self.order.len() > 1 {
            if let Some(old_key) = self.order.pop_front()
                && let Some(old) = self.map.remove(&old_key)
            {
                self.bytes_used = self.bytes_used.saturating_sub(old.storage.len());
            }
        }
    }

    fn stats(&self) -> CacheCpkStats {
        CacheCpkStats {
            bytes_used: self.bytes_used,
            entries_count: self.map.len(),
            budget_bytes: self.budget_bytes,
        }
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
        self.bytes_used = 0;
    }
}

/// Metadata entry for a file located in the Xenoverse VFS.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct XenoverseVfsEntry {
    /// Normalized virtual path (e.g. `chara/GOK/GOK.emd`).
    pub virtual_path: String,
    /// Origin archive filename (e.g. `data2.cpk`), or `"loose"` if from disk overlay.
    pub source_archive: String,
    /// File size in bytes.
    pub file_size: u64,
    /// Uncompressed extracted size in bytes.
    pub extract_size: u64,
    /// Whether file is CRILAYLA-compressed.
    pub is_compressed: bool,
    /// Physical path if loose on disk.
    pub physical_path: Option<PathBuf>,
}

/// Xenoverse 2 Virtual File System with CPK mounting and loose file priority.
pub struct XenoverseVfs {
    game_dir: Option<PathBuf>,
    loose_overlay_dir: Option<PathBuf>,
    mounted_cpks: Vec<PathBuf>,
    index: HashMap<String, XenoverseVfsEntry>,
    cache: Mutex<CpkLruCache>,
}

impl Default for XenoverseVfs {
    fn default() -> Self {
        Self::new()
    }
}

impl XenoverseVfs {
    /// Creates an empty Xenoverse VFS with default 2 GiB LRU budget.
    #[must_use]
    pub fn new() -> Self {
        Self::with_budget(DEFAULT_XENOVERSE_CACHE_BUDGET)
    }

    /// Creates an empty Xenoverse VFS with a custom LRU budget in bytes.
    #[must_use]
    pub fn with_budget(budget_bytes: usize) -> Self {
        Self {
            game_dir: None,
            loose_overlay_dir: None,
            mounted_cpks: Vec::new(),
            index: HashMap::new(),
            cache: Mutex::new(CpkLruCache::new(budget_bytes)),
        }
    }

    /// Mounts a Dragon Ball Xenoverse 2 game directory.
    ///
    /// Automatically detects and mounts:
    /// - `data/` loose directory if present (XV2Patcher modding overrides)
    /// - `data2.cpk`, `data.cpk`
    /// - DLC packs matching `data_d*.cpk`
    /// - Movie archives `movie_*.cpk`
    pub fn mount_game_dir<P: AsRef<Path>>(&mut self, path: P) -> Result<usize> {
        let game_dir = path.as_ref().to_path_buf();
        if !game_dir.is_dir() {
            return Err(ReError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Game directory not found: {}", game_dir.display()),
            )));
        }

        self.game_dir = Some(game_dir.clone());
        self.clear();

        // 1. Mount loose data/ directory overlay
        let loose_dir = game_dir.join("data");
        if loose_dir.is_dir() {
            self.mount_loose_directory(&loose_dir)?;
        }

        // 2. Discover CPKs in priority order
        let mut cpk_candidates = Vec::new();

        // data2.cpk (Highest CPK priority)
        let data2 = game_dir.join("data2.cpk");
        if data2.is_file() {
            cpk_candidates.push(data2);
        }

        // data.cpk (Base game CPK)
        let data = game_dir.join("data.cpk");
        if data.is_file() {
            cpk_candidates.push(data);
        }

        // DLC packs: data_d*.cpk
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            let mut dlc_cpks = Vec::new();
            for entry in entries.flatten() {
                let p = entry.path();
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    let lower = name.to_ascii_lowercase();
                    if lower.starts_with("data_d") && lower.ends_with(".cpk") {
                        dlc_cpks.push(p);
                    }
                }
            }
            dlc_cpks.sort();
            cpk_candidates.extend(dlc_cpks);
        }

        // Movie packs: movie_*.cpk
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            let mut movie_cpks = Vec::new();
            for entry in entries.flatten() {
                let p = entry.path();
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    let lower = name.to_ascii_lowercase();
                    if lower.starts_with("movie") && lower.ends_with(".cpk") {
                        movie_cpks.push(p);
                    }
                }
            }
            movie_cpks.sort();
            cpk_candidates.extend(movie_cpks);
        }

        // Mount each discovered CPK
        for cpk_path in cpk_candidates {
            let _ = self.mount_cpk_file(&cpk_path);
        }

        Ok(self.index.len())
    }

    /// Mounts a loose directory as an overlay (overriding matching CPK entries).
    pub fn mount_loose_directory<P: AsRef<Path>>(&mut self, dir_path: P) -> Result<usize> {
        let dir = dir_path.as_ref().to_path_buf();
        if !dir.is_dir() {
            return Err(ReError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Loose directory not found: {}", dir.display()),
            )));
        }

        self.loose_overlay_dir = Some(dir.clone());
        let mut count = 0;
        self.scan_loose_recursive(&dir, &dir, &mut count)?;
        Ok(count)
    }

    fn scan_loose_recursive(
        &mut self,
        root: &Path,
        current: &Path,
        count: &mut usize,
    ) -> Result<()> {
        let entries = match std::fs::read_dir(current) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                self.scan_loose_recursive(root, &path, count)?;
            } else if path.is_file()
                && let Ok(rel) = path.strip_prefix(root)
            {
                let norm = normalize_virtual_path(rel.to_string_lossy().as_ref());
                let meta = std::fs::metadata(&path).ok();
                let len = meta.map(|m| m.len()).unwrap_or(0);

                self.index.insert(
                    norm.clone(),
                    XenoverseVfsEntry {
                        virtual_path: norm,
                        source_archive: "loose".to_string(),
                        file_size: len,
                        extract_size: len,
                        is_compressed: false,
                        physical_path: Some(path),
                    },
                );
                *count += 1;
            }
        }
        Ok(())
    }

    /// Mounts an individual CPK archive from disk.
    pub fn mount_cpk_file<P: AsRef<Path>>(&mut self, path: P) -> Result<usize> {
        let cpk_path = path.as_ref().to_path_buf();
        let archive_name = cpk_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "archive.cpk".into());

        let (archive, storage) = {
            let bytes = std::fs::read(&cpk_path).map_err(ReError::Io)?;
            let archive = CpkArchive::parse(&bytes)?;
            (archive, CpkStorage::Buffer(bytes))
        };

        let loaded = Arc::new(LoadedCpk { name: archive_name.clone(), archive, storage });

        // Add to mounted paths
        self.mounted_cpks.push(cpk_path);

        // Index entries (only if not already in index from higher-priority source)
        let mut added = 0;
        for entry in &loaded.archive.entries {
            let full_name = match &entry.dir_name {
                Some(dir) => format!("{}/{}", dir.trim_end_matches('/'), entry.name),
                None => entry.name.clone(),
            };
            let norm = normalize_virtual_path(&full_name);

            // Insert if absent (preserves higher priority: loose or prior CPKs)
            if !self.index.contains_key(&norm) {
                self.index.insert(
                    norm.clone(),
                    XenoverseVfsEntry {
                        virtual_path: norm,
                        source_archive: archive_name.clone(),
                        file_size: entry.file_size,
                        extract_size: entry.extract_size,
                        is_compressed: entry.is_compressed,
                        physical_path: None,
                    },
                );
                added += 1;
            }
        }

        // Add to LRU cache
        self.cache.lock().unwrap().insert(archive_name, loaded);

        Ok(added)
    }

    /// Mounts an in-memory CPK buffer under a logical archive name.
    pub fn mount_cpk_memory(&mut self, name: &str, bytes: Vec<u8>) -> Result<usize> {
        let archive = CpkArchive::parse(&bytes)?;
        let storage = CpkStorage::Buffer(bytes);

        let loaded = Arc::new(LoadedCpk { name: name.to_string(), archive, storage });

        let mut added = 0;
        for entry in &loaded.archive.entries {
            let full_name = match &entry.dir_name {
                Some(dir) => format!("{}/{}", dir.trim_end_matches('/'), entry.name),
                None => entry.name.clone(),
            };
            let norm = normalize_virtual_path(&full_name);

            if !self.index.contains_key(&norm) {
                self.index.insert(
                    norm.clone(),
                    XenoverseVfsEntry {
                        virtual_path: norm,
                        source_archive: name.to_string(),
                        file_size: entry.file_size,
                        extract_size: entry.extract_size,
                        is_compressed: entry.is_compressed,
                        physical_path: None,
                    },
                );
                added += 1;
            }
        }

        self.cache.lock().unwrap().insert(name.to_string(), loaded);
        Ok(added)
    }

    /// Reads an entire file by virtual path, transparently decompressing CRILAYLA if required.
    pub fn read_file(&self, virtual_path: &str) -> Result<Vec<u8>> {
        let norm = normalize_virtual_path(virtual_path);
        let entry = self.index.get(&norm).ok_or_else(|| ReError::ParseError {
            context: "vfs_read_file",
            details: format!("Virtual path not found: {virtual_path}"),
        })?;

        // 1. Loose file on disk
        if let Some(phys) = &entry.physical_path {
            return std::fs::read(phys).map_err(ReError::Io);
        }

        // 2. CPK archive read
        let loaded = self.get_or_load_cpk(&entry.source_archive)?;
        loaded.archive.extract(loaded.bytes(), &entry.virtual_path)
    }

    /// Reads a file with zero-copy Cow slice when uncompressed, or owned Vec when decompressed.
    pub fn read_file_cow<'a>(&'a self, virtual_path: &str) -> Result<Cow<'a, [u8]>> {
        let norm = normalize_virtual_path(virtual_path);
        let entry = self.index.get(&norm).ok_or_else(|| ReError::ParseError {
            context: "vfs_read_file_cow",
            details: format!("Virtual path not found: {virtual_path}"),
        })?;

        if let Some(phys) = &entry.physical_path {
            let bytes = std::fs::read(phys).map_err(ReError::Io)?;
            return Ok(Cow::Owned(bytes));
        }

        let loaded = self.get_or_load_cpk(&entry.source_archive)?;
        let bytes = loaded.bytes();

        if !entry.is_compressed {
            // Attempt zero-copy slice
            if let Ok(slice) = loaded.archive.extract_slice(bytes, &entry.virtual_path) {
                return Ok(Cow::Owned(slice.to_vec()));
            }
        }

        let decompressed = loaded.archive.extract(bytes, &entry.virtual_path)?;
        Ok(Cow::Owned(decompressed))
    }

    /// Retrieves an archive from LRU cache or reloads it from disk if evicted.
    fn get_or_load_cpk(&self, archive_name: &str) -> Result<Arc<LoadedCpk>> {
        // Fast path: cache hit
        if let Some(loaded) = self.cache.lock().unwrap().get(archive_name) {
            return Ok(loaded);
        }

        // Cache miss: reload from mounted_cpks
        let found_path = self
            .mounted_cpks
            .iter()
            .find(|p| p.file_name().map(|n| n.to_string_lossy() == archive_name).unwrap_or(false));

        if let Some(path) = found_path {
            let (archive, storage) = {
                let bytes = std::fs::read(path).map_err(ReError::Io)?;
                let archive = CpkArchive::parse(&bytes)?;
                (archive, CpkStorage::Buffer(bytes))
            };

            let loaded = Arc::new(LoadedCpk { name: archive_name.to_string(), archive, storage });

            self.cache.lock().unwrap().insert(archive_name.to_string(), loaded.clone());
            return Ok(loaded);
        }

        Err(ReError::ParseError {
            context: "vfs_get_cpk",
            details: format!("Archive `{archive_name}` could not be reloaded"),
        })
    }

    /// Checks if a virtual path exists in the VFS index.
    pub fn exists(&self, virtual_path: &str) -> bool {
        let norm = normalize_virtual_path(virtual_path);
        self.index.contains_key(&norm)
    }

    /// Returns the metadata entry for a given virtual path.
    pub fn get_entry(&self, virtual_path: &str) -> Option<&XenoverseVfsEntry> {
        let norm = normalize_virtual_path(virtual_path);
        self.index.get(&norm)
    }

    /// Lists all virtual file paths registered in the VFS index.
    pub fn list_files(&self) -> Vec<String> {
        let mut list: Vec<String> = self.index.keys().cloned().collect();
        list.sort();
        list
    }

    /// Finds files by extension (e.g. `".emd"`, `".emb"`, `".bac"`, `".cus"`).
    pub fn find_by_extension(&self, extension: &str) -> Vec<&XenoverseVfsEntry> {
        let ext = if extension.starts_with('.') {
            extension.to_ascii_lowercase()
        } else {
            format!(".{}", extension.to_ascii_lowercase())
        };

        self.index
            .values()
            .filter(|e| e.virtual_path.to_ascii_lowercase().ends_with(&ext))
            .collect()
    }

    /// Finds files by path prefix (e.g. `"chara/GOK/"`).
    pub fn find_by_prefix(&self, prefix: &str) -> Vec<&XenoverseVfsEntry> {
        let norm_prefix = normalize_virtual_path(prefix);
        self.index.values().filter(|e| e.virtual_path.starts_with(&norm_prefix)).collect()
    }

    /// Returns a list of distinct 3-letter character folder codes (e.g. `GOK`, `VEG`, `PIC`).
    pub fn list_character_codes(&self) -> Vec<String> {
        let mut codes = std::collections::BTreeSet::new();
        for key in self.index.keys() {
            if let Some(rest) = key.strip_prefix("chara/")
                && let Some(code) = rest.split('/').next()
                && code.len() == 3
                && code.chars().all(|c| c.is_ascii_alphanumeric())
            {
                codes.insert(code.to_ascii_uppercase());
            }
        }
        codes.into_iter().collect()
    }

    /// Total number of indexed files.
    #[inline]
    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// Returns true if the index is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    /// Returns current CPK LRU cache statistics.
    pub fn cache_stats(&self) -> CacheCpkStats {
        self.cache.lock().unwrap().stats()
    }

    /// Clears cache and index.
    pub fn clear(&mut self) {
        self.index.clear();
        self.mounted_cpks.clear();
        self.cache.lock().unwrap().clear();
    }
}

/// Normalizes a virtual path:
/// - Converts Windows backslashes `\` to Unix slashes `/`
/// - Strips leading `./`, `/`, and `data/` prefixes
/// - Converts to clean canonical virtual path
pub fn normalize_virtual_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let mut trimmed = replaced.trim();

    while let Some(stripped) = trimmed.strip_prefix("./") {
        trimmed = stripped;
    }
    while let Some(stripped) = trimmed.strip_prefix('/') {
        trimmed = stripped;
    }
    if let Some(stripped) = trimmed.strip_prefix("data/") {
        trimmed = stripped;
    }

    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_virtual_path() {
        assert_eq!(normalize_virtual_path("data\\chara\\GOK\\GOK.emd"), "chara/GOK/GOK.emd");
        assert_eq!(normalize_virtual_path("./data/chara/VEG/VEG.emb"), "chara/VEG/VEG.emb");
        assert_eq!(
            normalize_virtual_path("/data/system/custom_skill.cus"),
            "system/custom_skill.cus"
        );
        assert_eq!(normalize_virtual_path("chara/PIC/PIC.esk"), "chara/PIC/PIC.esk");
    }

    #[test]
    fn test_vfs_memory_cpk_mount_and_priority() {
        let mut vfs = XenoverseVfs::new();

        // 1. Create base CPK (data.cpk) with Goku model and system file
        let cpk_data = CpkArchive::create_mock(&[
            ("chara/GOK/GOK.emd", b"EMD_GOKU_V1"),
            ("system/custom_skill.cus", b"CUS_SKILLS_V1"),
        ]);
        vfs.mount_cpk_memory("data.cpk", cpk_data).expect("mount data.cpk");

        assert_eq!(vfs.len(), 2);
        assert!(vfs.exists("chara/GOK/GOK.emd"));
        assert_eq!(vfs.read_file("chara/GOK/GOK.emd").unwrap(), b"EMD_GOKU_V1");

        // 2. Create patch CPK (data2.cpk) overriding Goku model and adding Vegeta
        let cpk_data2 = CpkArchive::create_mock(&[
            ("chara/GOK/GOK.emd", b"EMD_GOKU_V2_OVERRIDE"),
            ("chara/VEG/VEG.emd", b"EMD_VEGETA_V2"),
        ]);
        // Notice: in DBXV2, data2 is mounted before data so it takes precedence.
        // If we reset and mount data2 then data:
        let mut vfs_prioritized = XenoverseVfs::new();
        vfs_prioritized.mount_cpk_memory("data2.cpk", cpk_data2).unwrap();
        let cpk_data_base = CpkArchive::create_mock(&[
            ("chara/GOK/GOK.emd", b"EMD_GOKU_V1_OLD"),
            ("system/custom_skill.cus", b"CUS_SKILLS_V1"),
        ]);
        vfs_prioritized.mount_cpk_memory("data.cpk", cpk_data_base).unwrap();

        assert_eq!(vfs_prioritized.len(), 3);
        assert_eq!(
            vfs_prioritized.read_file("chara/GOK/GOK.emd").unwrap(),
            b"EMD_GOKU_V2_OVERRIDE"
        );
        assert_eq!(vfs_prioritized.read_file("chara/VEG/VEG.emd").unwrap(), b"EMD_VEGETA_V2");
        assert_eq!(vfs_prioritized.read_file("system/custom_skill.cus").unwrap(), b"CUS_SKILLS_V1");

        let char_codes = vfs_prioritized.list_character_codes();
        assert!(char_codes.contains(&"GOK".to_string()));
        assert!(char_codes.contains(&"VEG".to_string()));
    }
}
