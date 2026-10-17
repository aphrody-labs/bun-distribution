// SPDX-License-Identifier: Apache-2.0
//! Merge one Agent Home into another, and two-way sync.
//!
//! ## Rules (explicit, applied per content file; see [`crate::revision`] for the content set)
//!
//! | Situation | Action |
//! | --- | --- |
//! | file only in the source | [`MergeAction::Add`]: copied, source mtime preserved |
//! | identical bytes | [`MergeAction::Identical`]: nothing |
//! | file only in the target | untouched (a merge never deletes) |
//! | both differ, memory file, `memory_union` on, both UTF-8 | paragraph union, no memory lost: target already holds every source paragraph -> [`MergeAction::KeepTarget`]; source holds every target paragraph -> [`MergeAction::Update`]; otherwise [`MergeAction::Append`] of the missing source paragraphs in source order |
//! | both differ, [`ConflictPolicy::LastWriterWins`] | the newer mtime wins ([`MergeAction::Update`] or [`MergeAction::KeepTarget`]); a tie keeps the target |
//! | both differ, [`ConflictPolicy::KeepTarget`] | [`MergeAction::KeepTarget`] |
//! | both differ, [`ConflictPolicy::TakeSource`] | [`MergeAction::Update`] |
//!
//! Memory files are `MEMORY.md` and everything under `memory/`.
//!
//! ## Safety
//!
//! Dry run by default ([`MergeOptions::apply`] is `false`): the plan is
//! returned and nothing is written. With `apply`, when the plan changes
//! anything, a backup of the whole target content set is written first
//! (default `<target>/.aphrody/backups/merge-<stamp>/files`, with a
//! `manifest.json`) and **verified**: the `sha256-v1` revision of the backup
//! must equal the target revision the plan was computed on, otherwise nothing
//! is applied. Each file is then replaced atomically. After the merge,
//! `updated_at` in the target `USER.md` is stamped. [`restore_backup`] puts a
//! verified backup back.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};

use crate::{
    HomeError,
    filenames::{MEMORY_DIRNAME, MEMORY_FILENAME, USER_FILENAME, WORKSPACE_STATE_DIRNAME},
    fsutil::{sha256_hex, write_atomic, write_atomic_with_mtime},
    revision::{ContentFile, FileDigest, HomeRevision, content_files, home_revision},
    user::UserProfile,
};

/// How a conflicting (non-memory) file is resolved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictPolicy {
    /// The most recently modified side wins; a tie keeps the target.
    #[default]
    LastWriterWins,
    /// The target always wins.
    KeepTarget,
    /// The source always wins.
    TakeSource,
}

/// What happens to one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MergeAction {
    /// Copied from the source (absent in the target).
    Add,
    /// Target replaced by the source.
    Update,
    /// Missing source paragraphs appended to the target.
    Append,
    /// Target kept.
    KeepTarget,
    /// Same bytes on both sides.
    Identical,
}

impl MergeAction {
    /// Whether the action writes to the target.
    #[must_use]
    pub fn writes(self) -> bool {
        matches!(self, Self::Add | Self::Update | Self::Append)
    }
}

/// One planned file action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeEntry {
    /// Home-relative path.
    pub path: String,
    /// Planned action.
    pub action: MergeAction,
    /// Rule that decided it.
    pub reason: String,
    /// Source SHA-256.
    pub source_sha256: String,
    /// Target SHA-256 before the merge (`None` when absent).
    pub target_sha256: Option<String>,
}

/// Options for [`merge_homes`].
#[derive(Debug, Clone)]
pub struct MergeOptions {
    /// Home read from.
    pub source: PathBuf,
    /// Home written to.
    pub target: PathBuf,
    /// Conflict policy for non-memory files.
    pub policy: ConflictPolicy,
    /// Union-append memory files instead of applying the policy.
    pub memory_union: bool,
    /// Write (otherwise dry run).
    pub apply: bool,
    /// Backup directory (default under `<target>/.aphrody/backups/`).
    pub backup_dir: Option<PathBuf>,
}

impl MergeOptions {
    /// Dry-run, last-writer-wins, memory union.
    #[must_use]
    pub fn new(source: impl Into<PathBuf>, target: impl Into<PathBuf>) -> Self {
        Self {
            source: source.into(),
            target: target.into(),
            policy: ConflictPolicy::default(),
            memory_union: true,
            apply: false,
            backup_dir: None,
        }
    }
}

/// A verified backup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    /// Backup directory (`files/` + `manifest.json`).
    pub path: PathBuf,
    /// Revision of the backed-up content (equal to the target before merge).
    pub revision: String,
    /// Number of files.
    pub files: usize,
}

/// Outcome of [`merge_homes`].
#[derive(Debug, Clone, Serialize)]
pub struct MergeReport {
    /// Source home.
    pub source: PathBuf,
    /// Target home.
    pub target: PathBuf,
    /// Policy used.
    pub policy: ConflictPolicy,
    /// Whether changes were written.
    pub applied: bool,
    /// Planned actions (target-only files are not listed).
    pub entries: Vec<MergeEntry>,
    /// Number of entries that write.
    pub changes: usize,
    /// Source revision.
    pub source_revision: String,
    /// Target revision the plan was computed on.
    pub target_revision_before: String,
    /// Target revision after applying.
    pub target_revision_after: Option<String>,
    /// Verified backup taken before applying.
    pub backup: Option<BackupRecord>,
}

fn is_memory(path: &str) -> bool {
    path == MEMORY_FILENAME || path.starts_with(&format!("{MEMORY_DIRNAME}/"))
}

/// Split Markdown into paragraphs (blocks separated by blank lines), trimmed.
fn paragraphs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                out.push(current.join("\n").trim_end().to_string());
                current.clear();
            }
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        out.push(current.join("\n").trim_end().to_string());
    }
    out
}

/// Union of two memory documents: the target, then each source paragraph the
/// target does not already contain. `None` when nothing is missing.
#[must_use]
pub fn union_append(target: &str, source: &str) -> Option<String> {
    let existing = paragraphs(target);
    let missing: Vec<String> = paragraphs(source)
        .into_iter()
        .filter(|p| !existing.contains(p))
        .collect();
    if missing.is_empty() {
        return None;
    }
    let mut out = target.trim_end().to_string();
    for p in missing {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&p);
    }
    out.push('\n');
    Some(out)
}

struct Side {
    file: ContentFile,
    bytes: Vec<u8>,
    sha: String,
}

fn load_side(root: &Path) -> Result<BTreeMap<String, Side>, HomeError> {
    let mut map = BTreeMap::new();
    for file in content_files(root)? {
        let bytes = std::fs::read(&file.abs).map_err(|e| HomeError::io(&file.abs, e))?;
        let sha = sha256_hex(&bytes);
        map.insert(file.path.clone(), Side { file, bytes, sha });
    }
    Ok(map)
}

fn revision_of(side: &BTreeMap<String, Side>) -> String {
    let digests: Vec<FileDigest> = side
        .values()
        .map(|s| FileDigest {
            path: s.file.path.clone(),
            size: s.bytes.len() as u64,
            sha256: s.sha.clone(),
        })
        .collect();
    crate::revision::manifest_revision(&digests)
}

/// Planned write: entry + bytes + mtime to set (`None` = now).
struct Planned {
    entry: MergeEntry,
    bytes: Option<Vec<u8>>,
    mtime: Option<SystemTime>,
}

fn plan(
    source: &BTreeMap<String, Side>,
    target: &BTreeMap<String, Side>,
    opts: &MergeOptions,
) -> Vec<Planned> {
    let mut out = Vec::new();
    for (path, src) in source {
        let entry = |action, reason: &str, target_sha: Option<&String>| MergeEntry {
            path: path.clone(),
            action,
            reason: reason.to_string(),
            source_sha256: src.sha.clone(),
            target_sha256: target_sha.cloned(),
        };
        let Some(dst) = target.get(path) else {
            out.push(Planned {
                entry: entry(MergeAction::Add, "only in source", None),
                bytes: Some(src.bytes.clone()),
                mtime: Some(src.file.modified),
            });
            continue;
        };
        if dst.sha == src.sha {
            out.push(Planned {
                entry: entry(MergeAction::Identical, "same content", Some(&dst.sha)),
                bytes: None,
                mtime: None,
            });
            continue;
        }
        if opts.memory_union
            && is_memory(path)
            && let (Ok(t), Ok(s)) = (
                std::str::from_utf8(&dst.bytes),
                std::str::from_utf8(&src.bytes),
            )
        {
            let (tp, sp) = (paragraphs(t), paragraphs(s));
            let target_covers = sp.iter().all(|p| tp.contains(p));
            let source_covers = tp.iter().all(|p| sp.contains(p));
            let planned = match union_append(t, s) {
                _ if target_covers => Planned {
                    entry: entry(
                        MergeAction::KeepTarget,
                        "memory union: target already contains source",
                        Some(&dst.sha),
                    ),
                    bytes: None,
                    mtime: None,
                },
                _ if source_covers => Planned {
                    entry: entry(
                        MergeAction::Update,
                        "memory union: source contains target",
                        Some(&dst.sha),
                    ),
                    bytes: Some(src.bytes.clone()),
                    mtime: Some(src.file.modified),
                },
                Some(merged) => Planned {
                    entry: entry(MergeAction::Append, "memory union", Some(&dst.sha)),
                    bytes: Some(merged.into_bytes()),
                    mtime: None,
                },
                None => Planned {
                    entry: entry(
                        MergeAction::KeepTarget,
                        "memory union: target already contains source",
                        Some(&dst.sha),
                    ),
                    bytes: None,
                    mtime: None,
                },
            };
            out.push(planned);
            continue;
        }
        let take_source = match opts.policy {
            ConflictPolicy::TakeSource => true,
            ConflictPolicy::KeepTarget => false,
            ConflictPolicy::LastWriterWins => src.file.modified > dst.file.modified,
        };
        let reason = match (opts.policy, take_source) {
            (ConflictPolicy::LastWriterWins, true) => "last writer wins: source is newer",
            (ConflictPolicy::LastWriterWins, false) => "last writer wins: target is newer or tied",
            (ConflictPolicy::TakeSource, _) => "policy take-source",
            (ConflictPolicy::KeepTarget, _) => "policy keep-target",
        };
        out.push(if take_source {
            Planned {
                entry: entry(MergeAction::Update, reason, Some(&dst.sha)),
                bytes: Some(src.bytes.clone()),
                mtime: Some(src.file.modified),
            }
        } else {
            Planned {
                entry: entry(MergeAction::KeepTarget, reason, Some(&dst.sha)),
                bytes: None,
                mtime: None,
            }
        });
    }
    out
}

/// Write a verified backup of the content set of `home` into `dir`.
///
/// # Errors
/// [`HomeError::BackupVerification`] when the copy does not reproduce
/// `expected_revision`, [`HomeError::Io`] on filesystem failure.
pub fn backup_home(
    home: &Path,
    dir: &Path,
    expected_revision: &str,
) -> Result<BackupRecord, HomeError> {
    let files_dir = dir.join("files");
    std::fs::create_dir_all(&files_dir).map_err(|e| HomeError::io(&files_dir, e))?;
    let files = content_files(home)?;
    for f in &files {
        let to = files_dir.join(&f.path);
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p).map_err(|e| HomeError::io(p, e))?;
        }
        std::fs::copy(&f.abs, &to).map_err(|e| HomeError::io(&to, e))?;
    }
    let copy: HomeRevision = home_revision(&files_dir)?;
    if copy.revision != expected_revision {
        return Err(HomeError::BackupVerification(format!(
            "backup {} has {}, expected {expected_revision}",
            dir.display(),
            copy.revision
        )));
    }
    let manifest = serde_json::to_vec_pretty(&copy)?;
    write_atomic(&dir.join("manifest.json"), &manifest)?;
    Ok(BackupRecord {
        path: dir.to_path_buf(),
        revision: copy.revision,
        files: copy.files.len(),
    })
}

/// Restore a backup written by [`backup_home`] into `home`: the backup is
/// re-verified against its manifest, then every backed-up file is written
/// back atomically. Files created after the backup are left in place.
///
/// # Errors
/// [`HomeError::BackupVerification`] when the backup no longer matches its
/// manifest, [`HomeError::Io`] / [`HomeError::Json`] otherwise.
pub fn restore_backup(backup: &Path, home: &Path) -> Result<HomeRevision, HomeError> {
    let manifest_path = backup.join("manifest.json");
    let raw = std::fs::read(&manifest_path).map_err(|e| HomeError::io(&manifest_path, e))?;
    let manifest: HomeRevision = serde_json::from_slice(&raw)?;
    let files_dir = backup.join("files");
    let actual = home_revision(&files_dir)?;
    if actual.revision != manifest.revision {
        return Err(HomeError::BackupVerification(format!(
            "backup {} has {}, manifest says {}",
            backup.display(),
            actual.revision,
            manifest.revision
        )));
    }
    for f in &actual.files {
        let bytes = std::fs::read(files_dir.join(&f.path))
            .map_err(|e| HomeError::io(files_dir.join(&f.path), e))?;
        write_atomic(&home.join(&f.path), &bytes)?;
    }
    Ok(actual)
}

/// Merge `opts.source` into `opts.target` (see module docs).
///
/// # Errors
/// [`HomeError::HomeNotFound`] for a missing home, [`HomeError::Concurrent`]
/// when the target changes between planning and applying, backup and
/// filesystem errors otherwise.
pub fn merge_homes(opts: &MergeOptions) -> Result<MergeReport, HomeError> {
    for home in [&opts.source, &opts.target] {
        if !home.is_dir() {
            return Err(HomeError::HomeNotFound(home.clone()));
        }
    }
    let source = load_side(&opts.source)?;
    let target = load_side(&opts.target)?;
    let source_revision = revision_of(&source);
    let target_revision_before = revision_of(&target);
    let planned = plan(&source, &target, opts);
    let changes = planned.iter().filter(|p| p.entry.action.writes()).count();
    let mut report = MergeReport {
        source: opts.source.clone(),
        target: opts.target.clone(),
        policy: opts.policy,
        applied: false,
        entries: planned.iter().map(|p| p.entry.clone()).collect(),
        changes,
        source_revision,
        target_revision_before: target_revision_before.clone(),
        target_revision_after: None,
        backup: None,
    };
    if !opts.apply {
        return Ok(report);
    }
    if changes == 0 {
        report.applied = true;
        report.target_revision_after = Some(target_revision_before);
        return Ok(report);
    }
    let dir = opts.backup_dir.clone().unwrap_or_else(|| {
        opts.target
            .join(WORKSPACE_STATE_DIRNAME)
            .join("backups")
            .join(format!("merge-{}", crate::time::file_stamp()))
    });
    let backup = backup_home(&opts.target, &dir, &target_revision_before)?;
    // The backup reproduced the planned revision, so the target did not move
    // between planning and the copy.
    report.backup = Some(backup);

    for p in planned {
        let Some(bytes) = p.bytes else { continue };
        let path = opts.target.join(&p.entry.path);
        match p.mtime {
            Some(mtime) => write_atomic_with_mtime(&path, &bytes, mtime)?,
            None => write_atomic(&path, &bytes)?,
        }
    }
    if opts.target.join(USER_FILENAME).is_file() {
        let mut profile = UserProfile::load(&opts.target)?;
        profile.write_profile_fields(&opts.target)?;
    }
    report.applied = true;
    report.target_revision_after = Some(home_revision(&opts.target)?.revision);
    Ok(report)
}

/// Outcome of [`sync_homes`].
#[derive(Debug, Clone, Serialize)]
pub struct SyncReport {
    /// `a` merged into `b`.
    pub a_to_b: MergeReport,
    /// `b` merged into `a` (after `a_to_b` when applying).
    pub b_to_a: MergeReport,
}

/// Two-way sync: merge `a` into `b`, then `b` into `a`, with the same policy
/// (last-writer-wins by default), memory union, dry run unless `apply`, and a
/// verified backup of each side before it is written.
///
/// # Errors
/// See [`merge_homes`].
pub fn sync_homes(
    a: &Path,
    b: &Path,
    policy: ConflictPolicy,
    apply: bool,
) -> Result<SyncReport, HomeError> {
    let forward = MergeOptions {
        policy,
        apply,
        ..MergeOptions::new(a, b)
    };
    let a_to_b = merge_homes(&forward)?;
    let back = MergeOptions {
        policy,
        apply,
        ..MergeOptions::new(b, a)
    };
    let b_to_a = merge_homes(&back)?;
    Ok(SyncReport { a_to_b, b_to_a })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn write_at(root: &Path, rel: &str, body: &str, secs: u64) {
        let when = SystemTime::UNIX_EPOCH + Duration::from_secs(secs);
        write_atomic_with_mtime(&root.join(rel), body.as_bytes(), when).unwrap();
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    fn action(r: &MergeReport, path: &str) -> MergeAction {
        r.entries.iter().find(|e| e.path == path).unwrap().action
    }

    fn fixture() -> (tempfile::TempDir, tempfile::TempDir) {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        write_at(a.path(), "SOUL.md", "soul A new\n", 2_000);
        write_at(b.path(), "SOUL.md", "soul B old\n", 1_000);
        write_at(a.path(), "TOOLS.md", "tools A old\n", 1_000);
        write_at(b.path(), "TOOLS.md", "tools B new\n", 2_000);
        write_at(a.path(), "skills/only-a.md", "a\n", 1_000);
        write_at(b.path(), "only-b.md", "b\n", 1_000);
        write_at(a.path(), "AGENTS.md", "same\n", 1_000);
        write_at(b.path(), "AGENTS.md", "same\n", 5_000);
        write_at(a.path(), "memory/2026-10-06.md", "first\n\nfrom a\n", 1_000);
        write_at(b.path(), "memory/2026-10-06.md", "first\n\nfrom b\n", 9_000);
        (a, b)
    }

    #[test]
    fn dry_run_plans_every_rule_and_writes_nothing() {
        let (a, b) = fixture();
        let before = home_revision(b.path()).unwrap().revision;
        let r = merge_homes(&MergeOptions::new(a.path(), b.path())).unwrap();
        assert!(!r.applied && r.backup.is_none());
        assert_eq!(action(&r, "SOUL.md"), MergeAction::Update);
        assert_eq!(action(&r, "TOOLS.md"), MergeAction::KeepTarget);
        assert_eq!(action(&r, "skills/only-a.md"), MergeAction::Add);
        assert_eq!(action(&r, "AGENTS.md"), MergeAction::Identical);
        assert_eq!(action(&r, "memory/2026-10-06.md"), MergeAction::Append);
        assert!(r.entries.iter().all(|e| e.path != "only-b.md"));
        assert_eq!(r.changes, 3);
        assert_eq!(home_revision(b.path()).unwrap().revision, before);
    }

    #[test]
    fn apply_takes_a_verified_backup_then_merges() {
        let (a, b) = fixture();
        let before = home_revision(b.path()).unwrap().revision;
        let r = merge_homes(&MergeOptions {
            apply: true,
            ..MergeOptions::new(a.path(), b.path())
        })
        .unwrap();
        let backup = r.backup.clone().unwrap();
        assert_eq!(backup.revision, before);
        assert_eq!(read(b.path(), "SOUL.md"), "soul A new\n");
        assert_eq!(read(b.path(), "TOOLS.md"), "tools B new\n");
        assert_eq!(read(b.path(), "skills/only-a.md"), "a\n");
        assert_eq!(read(b.path(), "only-b.md"), "b\n");
        assert_eq!(
            read(b.path(), "memory/2026-10-06.md"),
            "first\n\nfrom b\n\nfrom a\n"
        );
        // LWW stays stable: the copied file carries the source mtime.
        assert_eq!(
            crate::fsutil::modified(&b.path().join("SOUL.md")).unwrap(),
            SystemTime::UNIX_EPOCH + Duration::from_secs(2_000)
        );
        // The backup lives in excluded state and does not change the revision.
        assert_eq!(
            r.target_revision_after.clone().unwrap(),
            home_revision(b.path()).unwrap().revision
        );
        // Restoring brings back the pre-merge bytes of every backed-up file.
        restore_backup(&backup.path, b.path()).unwrap();
        assert_eq!(read(b.path(), "SOUL.md"), "soul B old\n");
        assert_eq!(read(b.path(), "memory/2026-10-06.md"), "first\n\nfrom b\n");
    }

    #[test]
    fn policies_override_last_writer_wins() {
        let (a, b) = fixture();
        let keep = merge_homes(&MergeOptions {
            policy: ConflictPolicy::KeepTarget,
            memory_union: false,
            ..MergeOptions::new(a.path(), b.path())
        })
        .unwrap();
        assert_eq!(action(&keep, "SOUL.md"), MergeAction::KeepTarget);
        assert_eq!(
            action(&keep, "memory/2026-10-06.md"),
            MergeAction::KeepTarget
        );
        let take = merge_homes(&MergeOptions {
            policy: ConflictPolicy::TakeSource,
            ..MergeOptions::new(a.path(), b.path())
        })
        .unwrap();
        assert_eq!(action(&take, "TOOLS.md"), MergeAction::Update);
    }

    #[test]
    fn tampered_backup_is_rejected() {
        let (a, b) = fixture();
        let dir = b.path().join(".aphrody/backups/manual");
        let rev = home_revision(b.path()).unwrap().revision;
        let rec = backup_home(b.path(), &dir, &rev).unwrap();
        std::fs::write(rec.path.join("files/SOUL.md"), "tampered").unwrap();
        assert!(matches!(
            restore_backup(&rec.path, b.path()),
            Err(HomeError::BackupVerification(_))
        ));
        assert!(matches!(
            backup_home(a.path(), &b.path().join(".aphrody/backups/other"), &rev),
            Err(HomeError::BackupVerification(_))
        ));
    }

    #[test]
    fn two_way_sync_converges() {
        let (a, b) = fixture();
        let r = sync_homes(a.path(), b.path(), ConflictPolicy::LastWriterWins, true).unwrap();
        assert!(r.a_to_b.applied && r.b_to_a.applied);
        let ra = home_revision(a.path()).unwrap();
        let rb = home_revision(b.path()).unwrap();
        let strip = |r: &HomeRevision| {
            r.files
                .iter()
                .filter(|f| f.path != "USER.md")
                .cloned()
                .collect::<Vec<_>>()
        };
        assert_eq!(strip(&ra), strip(&rb));
        assert_eq!(read(a.path(), "TOOLS.md"), "tools B new\n");
        assert_eq!(read(a.path(), "only-b.md"), "b\n");
        // A second sync has nothing left to do.
        let again = sync_homes(a.path(), b.path(), ConflictPolicy::LastWriterWins, false).unwrap();
        assert_eq!(again.a_to_b.changes + again.b_to_a.changes, 0);
    }

    #[test]
    fn union_append_keeps_order_and_skips_known_paragraphs() {
        assert_eq!(
            union_append("a\n\nb\n", "b\n\nc\n").unwrap(),
            "a\n\nb\n\nc\n"
        );
        assert!(union_append("a\n\nb\n", "b\n").is_none());
        assert_eq!(union_append("", "x\n").unwrap(), "x\n");
    }
}
