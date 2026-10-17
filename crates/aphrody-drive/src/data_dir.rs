// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/sd-tauri-core/src/lib.rs), adopted as the Aphrody Drive
// file explorer.
//! The explorer data directory (libraries, sidecars, daemon logs, persisted UI state).
//!
//! An explicit override wins. Otherwise an existing library is preferred over an empty directory;
//! conflicting data directories require an explicit choice through `$APHRODY_DRIVE_DATA_DIR`.

use std::path::{Path, PathBuf};

/// Environment override for the data directory.
pub const DATA_DIR_ENV: &str = "APHRODY_DRIVE_DATA_DIR";

/// The data directory relative to the home directory.
pub const DATA_DIR_NAME: [&str; 2] = [".aphrody", "drive"];

/// The upstream Spacedrive data directory relative to the home directory.
pub const LEGACY_DATA_DIR_NAME: &str = ".spacedrive";

/// Regenerable cache subdirectory, ignored when deciding whether a directory holds data.
const CACHE_DIR_NAME: &str = "cache";

#[derive(Clone, Copy, PartialEq, Eq)]
enum DirectoryState {
    Missing,
    Empty,
    Data,
    Library,
}

fn directory_state(path: &Path) -> Result<DirectoryState, String> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DirectoryState::Missing);
        }
        Err(error) => return Err(format!("Cannot inspect {}: {error}", path.display())),
    };
    let mut has_data = false;
    let libraries = path.join("libraries");
    for entry in entries {
        let entry = entry.map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        // `cache/` only holds regenerable indexes (the drive core writes its volume-index snapshot
        // cache under `~/.spacedrive` regardless of the selected directory); it is not user data
        // and must not turn a legacy directory into a conflicting one.
        if entry.file_name() == CACHE_DIR_NAME {
            continue;
        }
        has_data = true;
        if entry.path() == libraries {
            let library_entries = std::fs::read_dir(&libraries)
                .map_err(|error| format!("Cannot inspect {}: {error}", libraries.display()))?;
            for library in library_entries {
                let library = library
                    .map_err(|error| format!("Cannot inspect {}: {error}", libraries.display()))?;
                let library_path = library.path();
                if library_path.is_dir()
                    && library_path
                        .extension()
                        .is_some_and(|extension| extension == "sdlibrary")
                    && library_path.join("library.json").is_file()
                {
                    return Ok(DirectoryState::Library);
                }
            }
        }
    }
    Ok(if has_data {
        DirectoryState::Data
    } else {
        DirectoryState::Empty
    })
}

/// Resolve a data directory without creating or moving data. When both locations hold data,
/// require an explicit override instead of silently hiding one of them.
pub fn resolve_data_dir(
    override_dir: Option<PathBuf>,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(dir) = override_dir.filter(|dir| !dir.as_os_str().is_empty()) {
        return Ok(dir);
    }
    let home = home.ok_or_else(|| "Could not determine home directory".to_string())?;
    let current = home.join(DATA_DIR_NAME[0]).join(DATA_DIR_NAME[1]);
    let legacy = home.join(LEGACY_DATA_DIR_NAME);
    let current_state = directory_state(&current)?;
    let legacy_state = directory_state(&legacy)?;
    match (current_state, legacy_state) {
        (
            DirectoryState::Data | DirectoryState::Library,
            DirectoryState::Data | DirectoryState::Library,
        ) => Err(format!(
            "Both {} and {} contain data; set {DATA_DIR_ENV} to select one explicitly",
            current.display(),
            legacy.display()
        )),
        (
            DirectoryState::Missing | DirectoryState::Empty,
            DirectoryState::Data | DirectoryState::Library,
        ) => Ok(legacy),
        (DirectoryState::Missing | DirectoryState::Empty, DirectoryState::Empty) => Ok(legacy),
        _ => Ok(current),
    }
}

/// Resolve the data directory for this process and create it.
///
/// # Errors
/// When no home directory is known or the directory cannot be created.
pub fn default_data_dir() -> Result<PathBuf, String> {
    let override_dir = std::env::var_os(DATA_DIR_ENV).map(PathBuf::from);
    let dir = resolve_data_dir(override_dir, dirs::home_dir().as_deref())?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create data directory {}: {error}", dir.display()))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_wins_over_everything() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".spacedrive")).unwrap();
        let chosen = resolve_data_dir(Some(PathBuf::from("/data/drive")), Some(home.path()));
        assert_eq!(chosen, Ok(PathBuf::from("/data/drive")));
        // An empty override is ignored.
        let chosen = resolve_data_dir(Some(PathBuf::new()), Some(home.path()));
        assert_eq!(chosen, Ok(home.path().join(".spacedrive")));
    }

    #[test]
    fn fresh_home_uses_the_aphrody_directory() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_data_dir(None, Some(home.path())),
            Ok(home.path().join(".aphrody").join("drive"))
        );
    }

    #[test]
    fn legacy_spacedrive_directory_is_kept_when_it_is_the_only_one() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".spacedrive")).unwrap();
        assert_eq!(
            resolve_data_dir(None, Some(home.path())),
            Ok(home.path().join(".spacedrive"))
        );
        // An empty Aphrody directory must not hide the existing data.
        std::fs::create_dir_all(home.path().join(".aphrody").join("drive")).unwrap();
        assert_eq!(
            resolve_data_dir(None, Some(home.path())),
            Ok(home.path().join(".spacedrive"))
        );
    }

    #[test]
    fn no_home_and_no_override_is_unresolved() {
        assert!(resolve_data_dir(None, None).is_err());
    }

    #[test]
    fn legacy_library_wins_over_empty_aphrody_directory() {
        let home = tempfile::tempdir().unwrap();
        let library = home.path().join(".spacedrive/libraries/Original.sdlibrary");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::write(library.join("library.json"), "{}").unwrap();
        std::fs::create_dir_all(home.path().join(".aphrody/drive")).unwrap();
        assert_eq!(
            resolve_data_dir(None, Some(home.path())),
            Ok(home.path().join(".spacedrive"))
        );
    }

    #[test]
    fn two_data_directories_require_an_explicit_choice() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".spacedrive")).unwrap();
        std::fs::write(home.path().join(".spacedrive/spacedrive.json"), "{}").unwrap();
        let current = home.path().join(".aphrody/drive");
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("spacedrive.json"), "{}").unwrap();
        let error = resolve_data_dir(None, Some(home.path())).unwrap_err();
        assert!(error.contains(DATA_DIR_ENV));
        assert!(error.contains(".spacedrive"));
        assert!(error.contains(".aphrody"));
        assert_eq!(
            resolve_data_dir(Some(current.clone()), Some(home.path())),
            Ok(current)
        );
    }

    #[test]
    fn a_cache_only_legacy_directory_does_not_conflict() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".spacedrive/cache/volume-index")).unwrap();
        let current = home.path().join(".aphrody/drive");
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("spacedrive.json"), "{}").unwrap();
        assert_eq!(resolve_data_dir(None, Some(home.path())), Ok(current));
    }

    #[test]
    fn two_library_directories_are_ambiguous() {
        let home = tempfile::tempdir().unwrap();
        for base in [
            home.path().join(".spacedrive"),
            home.path().join(".aphrody/drive"),
        ] {
            let library = base.join("libraries/Original.sdlibrary");
            std::fs::create_dir_all(&library).unwrap();
            std::fs::write(library.join("library.json"), "{}").unwrap();
        }
        assert!(resolve_data_dir(None, Some(home.path())).is_err());
    }
}
