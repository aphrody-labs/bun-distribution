// SPDX-License-Identifier: Apache-2.0
//! Workspace seeding (AH-4).
//!
//! Port of `var/openclaw/src/agents/workspace.ts::ensureAgentWorkspace`, but
//! with the templates embedded via `include_str!` (no runtime template-dir
//! resolution, no `Missing workspace template` failure mode — the binary
//! always carries its own seeds) and with explicit `--skip-bootstrap` /
//! `--force` ergonomics.
//!
//! Seeds the canonical file-map (AGENTS / SOUL / IDENTITY / USER / TOOLS /
//! HEARTBEAT / BOOT and the one-shot BOOTSTRAP), records `bootstrapSeededAt`
//! in the workspace state, and deletes `BOOTSTRAP.md` once first-run setup is
//! marked complete (openclaw `reconcileWorkspaceBootstrapCompletion`).

use std::path::{Path, PathBuf};

use crate::{
    HomeError,
    cache::WorkspaceState,
    filenames::{
        AGENTS_FILENAME, BOOT_FILENAME, BOOTSTRAP_FILENAME, BootstrapFile, HEARTBEAT_FILENAME,
        IDENTITY_FILENAME, MEMORY_DIRNAME, SKILLS_DIRNAME, SOUL_FILENAME, TOOLS_FILENAME,
        USER_FILENAME,
    },
};

/// Embedded workspace templates (compiled into the binary from plugins/aphrody/home).
pub const AGENTS_TEMPLATE: &str = include_str!("../templates/AGENTS.md");
/// Embedded `SOUL.md` template.
pub const SOUL_TEMPLATE: &str = include_str!("../templates/SOUL.md");
/// Embedded `IDENTITY.md` template.
pub const IDENTITY_TEMPLATE: &str = include_str!("../templates/IDENTITY.md");
/// Embedded `USER.md` template.
pub const USER_TEMPLATE: &str = include_str!("../templates/USER.md");
/// Embedded `TOOLS.md` template.
pub const TOOLS_TEMPLATE: &str = include_str!("../templates/TOOLS.md");
/// Embedded `HEARTBEAT.md` template.
pub const HEARTBEAT_TEMPLATE: &str = include_str!("../templates/HEARTBEAT.md");
/// Embedded `BOOT.md` template.
pub const BOOT_TEMPLATE: &str = include_str!("../templates/BOOT.md");
/// Embedded `BOOTSTRAP.md` template.
pub const BOOTSTRAP_TEMPLATE: &str = include_str!("../templates/BOOTSTRAP.md");

/// Options controlling [`seed_workspace`].
#[derive(Debug, Clone)]
pub struct OnboardOptions {
    /// Workspace root to seed.
    pub workspace: PathBuf,
    /// Skip the optional persona files (SOUL / IDENTITY / USER / HEARTBEAT /
    /// BOOT). AGENTS.md and TOOLS.md are always written.
    pub skip_bootstrap: bool,
    /// Overwrite files that already exist (otherwise existing files are kept).
    pub force: bool,
}

impl OnboardOptions {
    /// Construct with default flags (no skip, no force).
    #[must_use]
    pub fn new(workspace: impl Into<PathBuf>) -> Self {
        Self { workspace: workspace.into(), skip_bootstrap: false, force: false }
    }
}

/// Result of a seeding pass: which files were written / kept.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SeedReport {
    /// Files newly created this run (workspace-relative names).
    pub created: Vec<String>,
    /// Files that already existed and were kept (no `--force`).
    pub kept: Vec<String>,
    /// Files that existed and were overwritten (`--force`).
    pub overwritten: Vec<String>,
}

/// Strip a leading `---` frontmatter block from a template before writing it,
/// matching openclaw `stripFrontMatter` (templates carry frontmatter for the
/// authoring docs, but the seeded files start at the body).
fn strip_frontmatter(content: &str) -> &str {
    let (_fm, body) = crate::frontmatter::split(content);
    body
}

fn template_for(file: BootstrapFile) -> Option<&'static str> {
    Some(match file {
        BootstrapFile::Agents => AGENTS_TEMPLATE,
        BootstrapFile::Soul => SOUL_TEMPLATE,
        BootstrapFile::Identity => IDENTITY_TEMPLATE,
        BootstrapFile::User => USER_TEMPLATE,
        BootstrapFile::Tools => TOOLS_TEMPLATE,
        BootstrapFile::Heartbeat => HEARTBEAT_TEMPLATE,
        BootstrapFile::Boot => BOOT_TEMPLATE,
        BootstrapFile::Bootstrap => BOOTSTRAP_TEMPLATE,
        // MEMORY.md is never seeded; it is user-curated.
        BootstrapFile::Memory => return None,
    })
}

/// Whether a freshly-created workspace has no prior user content (so we should
/// seed the one-shot BOOTSTRAP ritual). Mirrors openclaw `isBrandNewWorkspace`.
fn is_brand_new(workspace: &Path) -> bool {
    let candidates = [
        AGENTS_FILENAME,
        SOUL_FILENAME,
        TOOLS_FILENAME,
        IDENTITY_FILENAME,
        USER_FILENAME,
        HEARTBEAT_FILENAME,
        BOOT_FILENAME,
    ];
    for name in candidates {
        if workspace.join(name).exists() {
            return false;
        }
    }
    !workspace.join(MEMORY_DIRNAME).exists()
        && !workspace.join(".git").exists()
        && !workspace.join("MEMORY.md").exists()
}

/// Seed the workspace file-map under `opts.workspace`.
///
/// Creates the workspace directory, the `memory/` and `skills/` subdirectories,
/// writes each template (respecting `skip_bootstrap` / `force`), seeds the
/// one-shot `BOOTSTRAP.md` for a brand-new workspace, and records
/// `bootstrapSeededAt` in the workspace state.
///
/// # Errors
/// [`HomeError::Io`] on any filesystem failure, [`HomeError::Json`] on state
/// serialization failure.
pub fn seed_workspace(opts: &OnboardOptions) -> Result<SeedReport, HomeError> {
    let ws = &opts.workspace;
    std::fs::create_dir_all(ws).map_err(|e| HomeError::io(ws, e))?;

    // Decide "brand new" BEFORE creating the `memory/` indicator dir — that
    // directory is itself one of the brand-new indicators, so creating it
    // first would always mark the workspace as established.
    let brand_new = is_brand_new(ws);

    for sub in [MEMORY_DIRNAME, SKILLS_DIRNAME] {
        let p = ws.join(sub);
        std::fs::create_dir_all(&p).map_err(|e| HomeError::io(&p, e))?;
    }

    let mut report = SeedReport::default();

    for file in crate::sync::sync_defaults()? {
        if opts.skip_bootstrap && file.is_optional() {
            continue;
        }
        let Some(template) = template_for(file) else {
            continue;
        };
        write_seed(ws, file.filename(), strip_frontmatter(template), opts.force, &mut report)?;
    }

    // Load (or default) the workspace state and seed the one-shot ritual only
    // for a brand-new workspace that has not completed setup.
    let mut state = WorkspaceState::load(ws)?;
    let mut state_dirty = false;

    if brand_new && !state.is_setup_completed() && state.bootstrap_seeded_at.is_none() {
        let bootstrap_path = ws.join(BOOTSTRAP_FILENAME);
        let existed = bootstrap_path.exists();
        write_seed(
            ws,
            BOOTSTRAP_FILENAME,
            strip_frontmatter(BOOTSTRAP_TEMPLATE),
            opts.force,
            &mut report,
        )?;
        if !existed || opts.force {
            state.bootstrap_seeded_at = Some(now_iso8601());
            state_dirty = true;
        }
    }

    if state_dirty {
        state.save(ws)?;
    }
    Ok(report)
}

/// Write a single seed file, honouring `force`. Records the action in `report`.
fn write_seed(
    workspace: &Path,
    name: &str,
    body: &str,
    force: bool,
    report: &mut SeedReport,
) -> Result<(), HomeError> {
    let path = workspace.join(name);
    let exists = path.exists();
    if exists && !force {
        report.kept.push(name.to_string());
        return Ok(());
    }
    let content = ensure_trailing_newline(body);
    std::fs::write(&path, content.as_bytes()).map_err(|e| HomeError::io(&path, e))?;
    if exists {
        report.overwritten.push(name.to_string());
    } else {
        report.created.push(name.to_string());
    }
    Ok(())
}

fn ensure_trailing_newline(s: &str) -> std::borrow::Cow<'_, str> {
    if s.ends_with('\n') {
        std::borrow::Cow::Borrowed(s)
    } else {
        std::borrow::Cow::Owned(format!("{s}\n"))
    }
}

/// Mark first-run setup complete and delete the one-shot `BOOTSTRAP.md`
/// (openclaw `reconcileWorkspaceBootstrapCompletion`). Idempotent.
///
/// # Errors
/// [`HomeError::Io`] / [`HomeError::Json`] on filesystem / state failure.
pub fn complete_bootstrap(workspace: &Path) -> Result<bool, HomeError> {
    let mut state = WorkspaceState::load(workspace)?;
    if state.is_setup_completed() {
        // Already complete; ensure the ritual file is gone but do not error.
        let bootstrap_path = workspace.join(BOOTSTRAP_FILENAME);
        let _ = std::fs::remove_file(bootstrap_path);
        return Ok(false);
    }
    state.setup_completed_at = Some(now_iso8601());
    if state.bootstrap_seeded_at.is_none() {
        state.bootstrap_seeded_at = Some(now_iso8601());
    }
    state.save(workspace)?;
    let bootstrap_path = workspace.join(BOOTSTRAP_FILENAME);
    match std::fs::remove_file(&bootstrap_path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(HomeError::io(bootstrap_path, e)),
    }
}

/// Options controlling [`upgrade_workspace`].
#[derive(Debug, Clone)]
pub struct UpgradeOptions {
    /// Workspace root to upgrade.
    pub workspace: PathBuf,
    /// Whether to create a backup file before overwriting any modified template.
    pub backup: bool,
    /// Overwrite user-personalized files (like USER.md) as well.
    pub force: bool,
}

impl UpgradeOptions {
    /// Construct with default options (backup = true, force = false).
    #[must_use]
    pub fn new(workspace: impl Into<PathBuf>) -> Self {
        Self { workspace: workspace.into(), backup: true, force: false }
    }
}

/// Result of an upgrade pass: which files were created, upgraded, or kept,
/// along with any backup files written.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UpgradeReport {
    /// Files newly created because they were missing.
    pub created: Vec<String>,
    /// Files updated to the latest yolo templates.
    pub upgraded: Vec<String>,
    /// Files kept unchanged (already up to date or protected).
    pub kept: Vec<String>,
    /// Backup file paths created during the upgrade.
    pub backups: Vec<PathBuf>,
}

/// Upgrade an existing workspace to match the latest embedded yolo templates.
///
/// For each canonical bootstrap file:
/// - If missing, creates it with the latest template.
/// - If present and identical (ignoring trailing whitespace/newlines), keeps it.
/// - If present and different:
///   - `USER.md` is preserved by default to protect user customizations unless `force` is true.
///   - For other bootstrap files, backs up the existing content to `<filename>.bak` (or
///     `<filename>.<timestamp>.bak` if that exists) when `opts.backup` is true, then overwrites
///     with the latest template.
///
/// Also ensures required subdirectories (`memory/`, `skills/`) exist.
///
/// # Errors
/// [`HomeError::Io`] on filesystem read/write failures.
pub fn upgrade_workspace(opts: &UpgradeOptions) -> Result<UpgradeReport, HomeError> {
    let ws = &opts.workspace;
    std::fs::create_dir_all(ws).map_err(|e| HomeError::io(ws, e))?;

    for sub in [MEMORY_DIRNAME, SKILLS_DIRNAME] {
        let p = ws.join(sub);
        std::fs::create_dir_all(&p).map_err(|e| HomeError::io(&p, e))?;
    }

    let mut report = UpgradeReport::default();

    for file in crate::sync::sync_defaults()? {
        let Some(template) = template_for(file) else {
            continue;
        };
        let target_body = ensure_trailing_newline(strip_frontmatter(template));
        let path = ws.join(file.filename());

        if !path.exists() {
            std::fs::write(&path, target_body.as_bytes()).map_err(|e| HomeError::io(&path, e))?;
            report.created.push(file.filename().to_string());
            continue;
        }

        let existing_bytes = std::fs::read(&path).map_err(|e| HomeError::io(&path, e))?;
        let existing_str = String::from_utf8_lossy(&existing_bytes);

        if existing_str.trim() == target_body.trim() {
            report.kept.push(file.filename().to_string());
            continue;
        }

        if file == BootstrapFile::User && !opts.force {
            report.kept.push(file.filename().to_string());
            continue;
        }

        if opts.backup {
            let backup_path = make_backup_path(&path);
            std::fs::write(&backup_path, &existing_bytes)
                .map_err(|e| HomeError::io(&backup_path, e))?;
            report.backups.push(backup_path);
        }

        std::fs::write(&path, target_body.as_bytes()).map_err(|e| HomeError::io(&path, e))?;
        report.upgraded.push(file.filename().to_string());
    }

    Ok(report)
}

fn make_backup_path(path: &Path) -> PathBuf {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("md");
    let primary = path.with_extension(format!("{ext}.bak"));
    if !primary.exists() {
        return primary;
    }
    let ts = now_iso8601().replace([':', '-'], "");
    path.with_extension(format!("{ext}.{ts}.bak"))
}

fn now_iso8601() -> String {
    crate::time::now_iso8601()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn seeds_full_file_map() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        let report = seed_workspace(&OnboardOptions::new(&ws)).unwrap();
        for name in [
            AGENTS_FILENAME,
            SOUL_FILENAME,
            IDENTITY_FILENAME,
            USER_FILENAME,
            TOOLS_FILENAME,
            HEARTBEAT_FILENAME,
            BOOT_FILENAME,
            BOOTSTRAP_FILENAME,
        ] {
            assert!(ws.join(name).exists(), "missing seeded file {name}");
        }
        assert!(ws.join(MEMORY_DIRNAME).is_dir());
        assert!(ws.join(SKILLS_DIRNAME).is_dir());
        assert!(report.created.contains(&AGENTS_FILENAME.to_string()));
        // State recorded the seed.
        let state = WorkspaceState::load(&ws).unwrap();
        assert!(state.bootstrap_seeded_at.is_some());
    }

    #[test]
    fn seeded_files_have_no_frontmatter() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        seed_workspace(&OnboardOptions::new(&ws)).unwrap();
        let soul = std::fs::read_to_string(ws.join(SOUL_FILENAME)).unwrap();
        // The body should NOT start with the YAML frontmatter delimiter; the
        // frontmatter is stripped at seed time.
        assert!(!soul.trim_start().starts_with("---"), "frontmatter not stripped:\n{soul}");
        assert!(soul.contains("agent d'ingénierie souverain"));
    }

    #[test]
    fn skip_bootstrap_omits_optional_files() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        let opts = OnboardOptions { workspace: ws.clone(), skip_bootstrap: true, force: false };
        seed_workspace(&opts).unwrap();
        // Required files present.
        assert!(ws.join(AGENTS_FILENAME).exists());
        assert!(ws.join(TOOLS_FILENAME).exists());
        // Optional persona files skipped.
        assert!(!ws.join(SOUL_FILENAME).exists());
        assert!(!ws.join(IDENTITY_FILENAME).exists());
        assert!(!ws.join(USER_FILENAME).exists());
    }

    #[test]
    fn does_not_overwrite_without_force() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(ws.join(SOUL_FILENAME), "MY CUSTOM SOUL").unwrap();
        let report = seed_workspace(&OnboardOptions::new(&ws)).unwrap();
        assert_eq!(std::fs::read_to_string(ws.join(SOUL_FILENAME)).unwrap(), "MY CUSTOM SOUL");
        assert!(report.kept.contains(&SOUL_FILENAME.to_string()));
    }

    #[test]
    fn force_overwrites_existing() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(ws.join(SOUL_FILENAME), "OLD").unwrap();
        let opts = OnboardOptions { workspace: ws.clone(), skip_bootstrap: false, force: true };
        let report = seed_workspace(&opts).unwrap();
        assert_ne!(std::fs::read_to_string(ws.join(SOUL_FILENAME)).unwrap(), "OLD");
        assert!(report.overwritten.contains(&SOUL_FILENAME.to_string()));
    }

    #[test]
    fn complete_bootstrap_removes_ritual_and_marks_state() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        seed_workspace(&OnboardOptions::new(&ws)).unwrap();
        assert!(ws.join(BOOTSTRAP_FILENAME).exists());
        let removed = complete_bootstrap(&ws).unwrap();
        assert!(removed);
        assert!(!ws.join(BOOTSTRAP_FILENAME).exists());
        let state = WorkspaceState::load(&ws).unwrap();
        assert!(state.is_setup_completed());
        // Idempotent second call.
        assert!(!complete_bootstrap(&ws).unwrap());
    }

    #[test]
    fn no_bootstrap_ritual_for_non_brand_new_workspace() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        std::fs::create_dir_all(ws.join(MEMORY_DIRNAME)).unwrap();
        // memory/ present => not brand new => no BOOTSTRAP.md.
        seed_workspace(&OnboardOptions::new(&ws)).unwrap();
        assert!(!ws.join(BOOTSTRAP_FILENAME).exists());
    }

    #[test]
    fn upgrade_workspace_upgrades_diverged_templates_with_backup() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        std::fs::create_dir_all(&ws).unwrap();

        // Simulate an old workspace seeded with previous templates
        let old_soul = "Tu es Aphrody, avec la personnalité de Byron Love...";
        let custom_user = "preferences:\n  - Langue: Français\n\nCustom user notes.";
        std::fs::write(ws.join(SOUL_FILENAME), old_soul).unwrap();
        std::fs::write(ws.join(USER_FILENAME), custom_user).unwrap();

        let opts = UpgradeOptions::new(&ws);
        let report = upgrade_workspace(&opts).unwrap();

        // Missing canonical files were created
        assert!(report.created.contains(&AGENTS_FILENAME.to_string()));
        assert!(report.created.contains(&TOOLS_FILENAME.to_string()));

        // SOUL.md diverged from current template -> upgraded with backup
        assert!(report.upgraded.contains(&SOUL_FILENAME.to_string()));
        assert_eq!(report.backups.len(), 1);
        let backup_content = std::fs::read_to_string(&report.backups[0]).unwrap();
        assert_eq!(backup_content, old_soul);

        let new_soul = std::fs::read_to_string(ws.join(SOUL_FILENAME)).unwrap();
        assert!(new_soul.contains("agent d'ingénierie souverain"));

        // USER.md was preserved without force
        assert!(report.kept.contains(&USER_FILENAME.to_string()));
        assert_eq!(std::fs::read_to_string(ws.join(USER_FILENAME)).unwrap(), custom_user);

        // Second run is idempotent: everything kept, no new backups or upgrades
        let second_report = upgrade_workspace(&opts).unwrap();
        assert!(second_report.upgraded.is_empty());
        assert!(second_report.created.is_empty());
        assert!(second_report.backups.is_empty());
        assert!(second_report.kept.contains(&SOUL_FILENAME.to_string()));
        assert!(second_report.kept.contains(&AGENTS_FILENAME.to_string()));
        assert!(second_report.kept.contains(&USER_FILENAME.to_string()));
    }

    #[test]
    fn upgrade_workspace_force_overwrites_user_md() {
        let td = tempdir().unwrap();
        let ws = td.path().join("workspace");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(ws.join(USER_FILENAME), "OLD USER DATA").unwrap();

        let mut opts = UpgradeOptions::new(&ws);
        opts.force = true;
        let report = upgrade_workspace(&opts).unwrap();

        assert!(report.upgraded.contains(&USER_FILENAME.to_string()));
        let new_user = std::fs::read_to_string(ws.join(USER_FILENAME)).unwrap();
        assert_ne!(new_user, "OLD USER DATA");
    }
}
