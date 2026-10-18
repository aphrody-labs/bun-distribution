// SPDX-License-Identifier: Apache-2.0
//! [`GameVfs`]: one mounted view over an install. Containers and loose files are mounted in
//! profile rank order and the first mounted path wins; later duplicates are counted as
//! shadowed. Inazuma Eleven: Victory Road delegates to its owner, `aphrody-nie-formats::vfs`,
//! so its listing and bytes are those of the NIE readers.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::Serialize;

use super::{
    AssetError, AssetResult, Keys,
    archive::{self, Archive, ArchiveKind},
    classify::{self, Kind},
    engine::{self, DetectLimits, EngineReport, WalkEvent},
    normalize_path,
    profile::{self, MountMode, Profile},
    source::FileSource,
};

/// One mounted file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VfsEntry {
    /// Normalised path.
    pub path: String,
    /// Uncompressed size (0 when the owner does not report it).
    pub size: u64,
    /// Container label, or `loose`.
    pub container: String,
    /// Asset kind from the extension (magic sniffing is opt-in, see [`GameVfs::sniff`]).
    pub kind: Kind,
    /// Format id (extension or sniffed magic).
    pub format: String,
    #[serde(skip)]
    unit: u32,
    #[serde(skip)]
    index: u32,
}

/// A container that was mounted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedContainer {
    /// Label (path relative to the root).
    pub label: String,
    /// Container family.
    pub format: String,
    /// Entries listed by the container.
    pub entries: usize,
    /// Entries shadowed by a higher-priority container.
    pub shadowed: usize,
    /// Container metadata.
    pub info: serde_json::Value,
    /// Time to open and index the container.
    pub millis: u128,
}

/// A container that was found but not mounted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedContainer {
    /// Label.
    pub label: String,
    /// Reason (missing user key, unsupported layout, ...).
    pub reason: String,
}

/// What a mount did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountReport {
    /// Selected profile id.
    pub profile: &'static str,
    /// Key policy of the profile.
    pub key_policy: profile::KeyPolicy,
    /// Engine detection.
    pub engine: EngineReport,
    /// Mounted containers in mount order.
    pub mounted: Vec<MountedContainer>,
    /// Containers left unmounted.
    pub refused: Vec<RefusedContainer>,
    /// Loose files mounted.
    pub loose: usize,
    /// Visible entries.
    pub entries: usize,
    /// Entries hidden by first-wins resolution.
    pub shadowed: usize,
    /// Owner statistics (IEVR: `assetCount`, `cpkCount`, `extraCount`, `looseCount`).
    pub owner: serde_json::Value,
    /// Detection time.
    pub detect_millis: u128,
    /// Total mount time.
    pub mount_millis: u128,
}

/// Mount options.
#[derive(Debug, Clone, Default)]
pub struct MountOptions {
    /// User-provided keys.
    pub keys: Keys,
    /// Explicit profile (otherwise selected from the detection report).
    pub profile: Option<&'static Profile>,
    /// Detection bounds.
    pub limits: Option<DetectLimits>,
    /// Do not mount loose files.
    pub skip_loose: bool,
    /// Only mount containers whose label matches one of these globs.
    pub only: Vec<String>,
}

enum Unit {
    Archive(Box<dyn Archive>),
    Loose(PathBuf),
    #[cfg(not(target_arch = "wasm32"))]
    Level5(Box<aphrody_nie_formats::vfs::Vfs>),
}

/// The mounted view of one install.
pub struct GameVfs {
    root: PathBuf,
    profile: &'static Profile,
    units: Vec<Unit>,
    entries: Vec<VfsEntry>,
    by_path: HashMap<String, usize>,
    report: MountReport,
}

enum Pending {
    Archive(engine::FoundArchive),
    Loose(Vec<(String, u64)>),
}

fn key(path: &str) -> String {
    path.to_ascii_lowercase()
}

impl GameVfs {
    /// Detect, select a profile and mount `root`.
    ///
    /// # Errors
    /// The root cannot be listed, or the delegated owner refuses the install.
    #[allow(clippy::too_many_lines)]
    pub fn mount(root: &Path, options: &MountOptions) -> AssetResult<Self> {
        let started = Instant::now();
        let limits = options.limits.unwrap_or_default();
        let report = engine::detect(root, limits)?;
        let detect_millis = started.elapsed().as_millis();
        let profile = options.profile.unwrap_or_else(|| profile::select(&report));
        let mut vfs = Self {
            root: root.to_path_buf(),
            profile,
            units: Vec::new(),
            entries: Vec::new(),
            by_path: HashMap::new(),
            report: MountReport {
                profile: profile.id,
                key_policy: profile.keys,
                engine: report,
                mounted: Vec::new(),
                refused: Vec::new(),
                loose: 0,
                entries: 0,
                shadowed: 0,
                owner: serde_json::Value::Null,
                detect_millis,
                mount_millis: 0,
            },
        };
        let keys = match profile.keys {
            profile::KeyPolicy::UserProvided => options.keys.clone(),
            _ => Keys::default(),
        };

        let mut pending: Vec<(usize, String, Pending)> = Vec::new();
        if profile.mode == MountMode::Level5Ievr {
            vfs.mount_level5()?;
        } else {
            for found in vfs.report.engine.archives.clone() {
                if !options.only.is_empty()
                    && !options
                        .only
                        .iter()
                        .any(|glob| profile::glob_match(glob, &found.path))
                {
                    continue;
                }
                pending.push((
                    profile.rank(&found.path),
                    found.path.clone(),
                    Pending::Archive(found),
                ));
            }
        }
        if !options.skip_loose {
            let archives: std::collections::HashSet<String> = vfs
                .report
                .engine
                .archives
                .iter()
                .map(|a| key(&a.path))
                .collect();
            let mut groups: std::collections::BTreeMap<usize, Vec<(String, u64)>> =
                std::collections::BTreeMap::new();
            engine::walk(root, limits, |event| {
                if let WalkEvent::File { rel, size, .. } = event {
                    let lower = key(rel);
                    let name = lower.rsplit('/').next().unwrap_or_default();
                    if archives.contains(&lower)
                        || lower.ends_with(".ucas")
                        || engine::ANTI_CHEAT_FILES.contains(&name)
                        || !profile.loose_allowed(rel)
                    {
                        return;
                    }
                    let rank = profile.rank(rel);
                    let rank = if rank < profile.order.len() {
                        rank
                    } else {
                        usize::MAX
                    };
                    groups
                        .entry(rank)
                        .or_default()
                        .push((rel.to_string(), size));
                }
            })?;
            for (rank, files) in groups {
                pending.push((rank, String::new(), Pending::Loose(files)));
            }
        }
        pending.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        let loose_unit = u32::try_from(vfs.units.len()).unwrap_or(u32::MAX);
        vfs.units.push(Unit::Loose(root.to_path_buf()));
        for (_, _, item) in pending {
            match item {
                Pending::Loose(files) => {
                    for (index, (rel, size)) in files.into_iter().enumerate() {
                        if vfs.insert(&rel, size, "loose", loose_unit, index) {
                            vfs.report.loose += 1;
                        }
                    }
                }
                Pending::Archive(found) => vfs.mount_archive(&found, &keys),
            }
        }
        vfs.report.entries = vfs.entries.len();
        vfs.report.mount_millis = started.elapsed().as_millis();
        Ok(vfs)
    }

    fn insert(&mut self, path: &str, size: u64, container: &str, unit: u32, index: usize) -> bool {
        let normalized = normalize_path(path);
        let lookup = key(&normalized);
        if self.by_path.contains_key(&lookup) {
            self.report.shadowed += 1;
            return false;
        }
        let (kind, format) = classify::classify(&normalized, None);
        self.by_path.insert(lookup, self.entries.len());
        self.entries.push(VfsEntry {
            path: normalized,
            size,
            container: container.to_string(),
            kind,
            format,
            unit,
            index: u32::try_from(index).unwrap_or(u32::MAX),
        });
        true
    }

    fn mount_archive(&mut self, found: &engine::FoundArchive, keys: &Keys) {
        let started = Instant::now();
        if matches!(found.kind, ArchiveKind::SevenZip | ArchiveKind::Vpk) {
            self.report.refused.push(RefusedContainer {
                label: found.path.clone(),
                reason: format!("{:?} is detected but not mounted", found.kind),
            });
            return;
        }
        match archive::open(
            found.kind,
            &self.root.join(&found.path),
            found.path.clone(),
            keys,
        ) {
            Ok(Some(container)) => {
                let unit = u32::try_from(self.units.len()).unwrap_or(u32::MAX);
                let listed: Vec<(String, u64)> = container
                    .entries()
                    .iter()
                    .map(|e| (e.path.clone(), e.size))
                    .collect();
                let shadowed_before = self.report.shadowed;
                for (index, (path, size)) in listed.iter().enumerate() {
                    self.insert(path, *size, &found.path, unit, index);
                }
                self.report.mounted.push(MountedContainer {
                    label: found.path.clone(),
                    format: container.format().to_string(),
                    entries: listed.len(),
                    shadowed: self.report.shadowed - shadowed_before,
                    info: container.info(),
                    millis: started.elapsed().as_millis(),
                });
                self.units.push(Unit::Archive(container));
            }
            Ok(None) => {}
            Err(error) => self.report.refused.push(RefusedContainer {
                label: found.path.clone(),
                reason: error.to_string(),
            }),
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn mount_level5(&mut self) -> AssetResult<()> {
        Err(AssetError::Format {
            format: "level5-ievr",
            details: "the IEVR archive mount reads the filesystem and is unavailable on wasm32"
                .to_owned(),
        })
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn mount_level5(&mut self) -> AssetResult<()> {
        let started = Instant::now();
        let data = self.root.join("data");
        let mut owner = aphrody_nie_formats::vfs::Vfs::new();
        owner.init(&data).map_err(|error| AssetError::Format {
            format: "level5-ievr",
            details: format!("{}: {error}", data.display()),
        })?;
        // The owner caches pack TOCs only (entry bytes are positioned reads), so a mount over a
        // network share never pulls a pack whole.
        let unit = u32::try_from(self.units.len()).unwrap_or(u32::MAX);
        let mut listed: Vec<(String, u64, String)> = owner
            .iter_all()
            .map(|entry| {
                let container = if entry.cpk.is_empty() {
                    "loose".into()
                } else {
                    entry.cpk.to_string()
                };
                (entry.path.to_string(), entry.size, container)
            })
            .collect();
        listed.sort_by(|a, b| a.0.cmp(&b.0));
        for (index, (path, size, container)) in listed.iter().enumerate() {
            self.insert(path, *size, container, unit, index);
        }
        self.report.owner = serde_json::json!({
            "owner": "aphrody-nie-formats::vfs",
            "assetCount": owner.asset_count(),
            "cpkCount": owner.cpk_count(),
            "extraCount": owner.extra_count(),
            "looseCount": owner.loose_count(),
        });
        self.report.mounted.push(MountedContainer {
            label: "data/cpk_list.cfg.bin".into(),
            format: "level5-ievr".into(),
            entries: listed.len(),
            shadowed: 0,
            info: self.report.owner.clone(),
            millis: started.elapsed().as_millis(),
        });
        self.units.push(Unit::Level5(Box::new(owner)));
        Ok(())
    }

    /// The selected profile.
    #[must_use]
    pub fn profile(&self) -> &'static Profile {
        self.profile
    }

    /// Install root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Mount report.
    #[must_use]
    pub fn report(&self) -> &MountReport {
        &self.report
    }

    /// Visible entries in mount order.
    #[must_use]
    pub fn entries(&self) -> &[VfsEntry] {
        &self.entries
    }

    /// Entry by path (case-insensitive).
    #[must_use]
    pub fn find(&self, path: &str) -> Option<&VfsEntry> {
        self.by_path
            .get(&key(&normalize_path(path)))
            .map(|index| &self.entries[*index])
    }

    /// Entry with the same directory and stem as `path` and extension `ext`.
    #[must_use]
    pub fn sibling(&self, path: &str, ext: &str) -> Option<&VfsEntry> {
        let normalized = normalize_path(path);
        let stem = normalized
            .rsplit_once('.')
            .map_or(normalized.as_str(), |(stem, _)| stem);
        self.find(&format!("{stem}.{ext}"))
    }

    /// Read a file.
    ///
    /// # Errors
    /// Unknown path, container errors, missing user key.
    pub fn read(&self, path: &str) -> AssetResult<Vec<u8>> {
        let entry = self
            .find(path)
            .ok_or_else(|| AssetError::NotFound(path.to_string()))?;
        self.read_entry(entry)
    }

    /// Read a listed entry.
    ///
    /// # Errors
    /// Container errors, missing user key.
    pub fn read_entry(&self, entry: &VfsEntry) -> AssetResult<Vec<u8>> {
        match &self.units[entry.unit as usize] {
            Unit::Archive(container) => container.read(entry.index as usize),
            Unit::Loose(root) => {
                let source = FileSource::open(&root.join(&entry.path))?;
                source.read_at(0, source.len())
            }
            #[cfg(not(target_arch = "wasm32"))]
            Unit::Level5(owner) => owner.read(&entry.path).map_err(|error| AssetError::Format {
                format: "level5-ievr",
                details: format!("{}: {error}", entry.path),
            }),
        }
    }

    /// Refine the kind and format of an entry from its first bytes.
    ///
    /// # Errors
    /// Read errors.
    pub fn sniff(&self, entry: &VfsEntry) -> AssetResult<(Kind, String)> {
        let head = match &self.units[entry.unit as usize] {
            Unit::Loose(root) => FileSource::open(&root.join(&entry.path))?.read_clamped(0, 64)?,
            _ => {
                let mut data = self.read_entry(entry)?;
                data.truncate(64);
                data
            }
        };
        Ok(classify::classify(&entry.path, Some(&head)))
    }

    /// Counts per kind, per container family and per extension (top 40).
    #[must_use]
    pub fn stats(&self) -> serde_json::Value {
        let mut kinds: std::collections::BTreeMap<&str, (usize, u64)> = Default::default();
        let mut exts: HashMap<&str, usize> = HashMap::new();
        let mut containers: std::collections::BTreeMap<&str, usize> = Default::default();
        for entry in &self.entries {
            let slot = kinds.entry(entry.kind.as_str()).or_default();
            slot.0 += 1;
            slot.1 += entry.size;
            *exts.entry(entry.format.as_str()).or_default() += 1;
            let family = match &self.units[entry.unit as usize] {
                Unit::Archive(container) => container.format(),
                Unit::Loose(_) => "loose",
                #[cfg(not(target_arch = "wasm32"))]
                Unit::Level5(_) => "level5-ievr",
            };
            *containers.entry(family).or_default() += 1;
        }
        let mut top: Vec<(&str, usize)> = exts.into_iter().collect();
        top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        top.truncate(40);
        serde_json::json!({
            "entries": self.entries.len(),
            "bytes": self.entries.iter().map(|e| e.size).sum::<u64>(),
            "kinds": kinds.iter().map(|(k, (n, b))| (k.to_string(), serde_json::json!({"files": n, "bytes": b}))).collect::<serde_json::Map<_, _>>(),
            "containers": containers,
            "extensions": top.into_iter().map(|(e, n)| serde_json::json!([e, n])).collect::<Vec<_>>(),
        })
    }
}

#[cfg(test)]
mod tests {
    use aphrody_nie_formats::cpk_encode::{CpkWriteEntry, encode_cpk};

    use super::*;

    fn cpk(entries: &[(&str, &[u8])]) -> Vec<u8> {
        encode_cpk(
            &entries
                .iter()
                .map(|(name, data)| CpkWriteEntry {
                    filename: (*name).to_string(),
                    directory: "chara".into(),
                    data: data.to_vec(),
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    #[test]
    fn first_mounted_path_wins_in_profile_order() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("cpk")).unwrap();
        std::fs::write(
            dir.path().join("cpk/data.cpk"),
            cpk(&[("a.emd", b"base"), ("b.emb", b"only")]),
        )
        .unwrap();
        std::fs::write(
            dir.path().join("cpk/data2.cpk"),
            cpk(&[("a.emd", b"patch")]),
        )
        .unwrap();
        std::fs::write(dir.path().join("readme.txt"), b"loose").unwrap();
        let options = MountOptions {
            profile: profile::by_id("dbxv2"),
            ..MountOptions::default()
        };
        let vfs = GameVfs::mount(dir.path(), &options).unwrap();
        assert_eq!(vfs.read("chara/a.emd").unwrap(), b"patch");
        assert_eq!(vfs.read("CHARA/B.EMB").unwrap(), b"only");
        assert_eq!(vfs.read("readme.txt").unwrap(), b"loose");
        assert_eq!(vfs.report().shadowed, 1);
        assert_eq!(vfs.report().mounted[0].label, "cpk/data2.cpk");
        assert_eq!(vfs.find("chara/a.emd").unwrap().kind, Kind::Model);
    }
}
