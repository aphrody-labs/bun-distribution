// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/crates/file-opening-linux/src/lib.rs), adopted as the
// Aphrody Drive file explorer.
//! Linux: the file MIME type comes from `xdg-mime query filetype`, the applications from the
//! freedesktop desktop entries (`$XDG_DATA_HOME/applications`, `$XDG_DATA_DIRS/*/applications`)
//! whose `MimeType=` lists it. `gtk-launch <entry>` opens a file with one of them and the
//! `open` crate (xdg-open and friends) with the default.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Command,
};

use super::{FileOpener, OpenResult, OpenWithApp};

/// The fields of a desktop entry the "Open with" list needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DesktopEntry {
    pub(super) name: String,
    pub(super) mime_types: Vec<String>,
    pub(super) hidden: bool,
}

/// Parse the `[Desktop Entry]` group of a `.desktop` file; `None` when it is not an application.
pub(super) fn parse_desktop_entry(text: &str) -> Option<DesktopEntry> {
    let mut in_group = false;
    let mut name = None;
    let mut mime_types = Vec::new();
    let mut hidden = false;
    let mut is_application = false;
    let mut has_exec = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_group = line == "[Desktop Entry]";
            continue;
        }
        if !in_group || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match (key.trim(), value.trim()) {
            ("Name", value) => name = Some(value.to_string()),
            ("MimeType", value) => {
                mime_types = value
                    .split(';')
                    .filter(|mime| !mime.is_empty())
                    .map(str::to_string)
                    .collect();
            }
            ("Type", value) => is_application = value == "Application",
            ("Exec", value) => has_exec = !value.is_empty(),
            ("NoDisplay" | "Hidden", "true") => hidden = true,
            _ => {}
        }
    }
    (is_application && has_exec).then(|| DesktopEntry {
        name: name.unwrap_or_default(),
        mime_types,
        hidden,
    })
}

/// The `applications` directories in XDG precedence order.
pub(super) fn application_dirs(
    data_home: Option<PathBuf>,
    data_dirs: Option<&str>,
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = data_home {
        dirs.push(home.join("applications"));
    }
    let data_dirs = data_dirs
        .filter(|value| !value.is_empty())
        .unwrap_or("/usr/local/share:/usr/share");
    dirs.extend(
        data_dirs
            .split(':')
            .filter(|dir| !dir.is_empty())
            .map(|dir| Path::new(dir).join("applications")),
    );
    dirs
}

/// Desktop entry ID of a file under an applications directory (`kde/foo.desktop` →
/// `kde-foo.desktop`).
pub(super) fn desktop_id(root: &Path, file: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let parts: Vec<_> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("-"))
}

/// Applications (id, name) handling `mime` in the given directories; the first ID wins.
pub(super) fn apps_for_mime(dirs: &[PathBuf], mime: &str) -> Vec<OpenWithApp> {
    let mut seen = HashSet::new();
    let mut apps = Vec::new();
    for root in dirs {
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
                    continue;
                }
                let Some(id) = desktop_id(root, &path) else {
                    continue;
                };
                // A higher-precedence directory shadows the same ID, even when it hides it.
                if !seen.insert(id.clone()) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let Some(entry) = parse_desktop_entry(&text) else {
                    continue;
                };
                if entry.hidden || !entry.mime_types.iter().any(|candidate| candidate == mime) {
                    continue;
                }
                let name = if entry.name.is_empty() {
                    id.trim_end_matches(".desktop").to_string()
                } else {
                    entry.name
                };
                apps.push(OpenWithApp {
                    id,
                    name,
                    icon: None,
                });
            }
        }
    }
    apps
}

/// The MIME type of a file according to the desktop's shared MIME database.
fn mime_type(path: &Path) -> Option<String> {
    let output = Command::new("xdg-mime")
        .args(["query", "filetype"])
        .arg(path)
        .output()
        .ok()?;
    let mime = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !mime.is_empty()).then_some(mime)
}

pub(super) struct LinuxFileOpener;

impl FileOpener for LinuxFileOpener {
    fn get_apps_for_file(&self, path: &Path) -> Result<Vec<OpenWithApp>, String> {
        let Some(mime) = mime_type(path) else {
            return Ok(Vec::new());
        };
        let dirs = application_dirs(
            dirs::data_dir(),
            std::env::var("XDG_DATA_DIRS").ok().as_deref(),
        );
        let mut apps = apps_for_mime(&dirs, &mime);
        apps.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(apps)
    }

    fn open_with_default(&self, path: &Path) -> Result<OpenResult, String> {
        if !path.exists() {
            return Ok(OpenResult::not_found(path));
        }
        Ok(match open::that(path) {
            Ok(()) => OpenResult::Success,
            Err(error) => OpenResult::PlatformError {
                message: error.to_string(),
            },
        })
    }

    fn open_with_app(&self, path: &Path, app_id: &str) -> Result<OpenResult, String> {
        if !path.exists() {
            return Ok(OpenResult::not_found(path));
        }
        let output = Command::new("gtk-launch")
            .arg(app_id)
            .arg(path)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            Ok(OpenResult::Success)
        } else {
            Ok(OpenResult::PlatformError {
                message: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entries_are_parsed() {
        let entry = parse_desktop_entry(
            "[Desktop Entry]\nType=Application\nName=Image Viewer\nExec=eog \
             %U\nMimeType=image/png;image/jpeg;\n[Desktop Action New]\nName=Other\n",
        )
        .unwrap();
        assert_eq!(entry.name, "Image Viewer");
        assert_eq!(entry.mime_types, vec!["image/png", "image/jpeg"]);
        assert!(!entry.hidden);
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Link\nURL=x\n").is_none());
        assert!(
            parse_desktop_entry("[Desktop Entry]\nType=Application\nNoDisplay=true\nExec=x\n")
                .unwrap()
                .hidden
        );
    }

    #[test]
    fn directories_follow_xdg_precedence() {
        let dirs = application_dirs(Some(PathBuf::from("/home/u/.local/share")), Some("/a:/b"));
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/home/u/.local/share/applications"),
                PathBuf::from("/a/applications"),
                PathBuf::from("/b/applications")
            ]
        );
        assert_eq!(application_dirs(None, None).len(), 2);
    }

    #[test]
    fn apps_are_found_by_mime_and_shadowed_by_id() {
        let root = tempfile::tempdir().unwrap();
        let user = root.path().join("user");
        let system = root.path().join("system");
        std::fs::create_dir_all(user.join("kde")).unwrap();
        std::fs::create_dir_all(&system).unwrap();
        let viewer =
            "[Desktop Entry]\nType=Application\nName=Viewer\nExec=v\nMimeType=image/png;\n";
        std::fs::write(user.join("kde").join("viewer.desktop"), viewer).unwrap();
        // The user hides the system editor.
        std::fs::write(
            user.join("editor.desktop"),
            "[Desktop Entry]\nType=Application\nHidden=true\nExec=e\n",
        )
        .unwrap();
        std::fs::write(
            system.join("editor.desktop"),
            "[Desktop Entry]\nType=Application\nName=Editor\nExec=e\nMimeType=image/png;\n",
        )
        .unwrap();
        let apps = apps_for_mime(&[user, system], "image/png");
        assert_eq!(
            apps,
            vec![OpenWithApp {
                id: "kde-viewer.desktop".into(),
                name: "Viewer".into(),
                icon: None
            }]
        );
    }
}
