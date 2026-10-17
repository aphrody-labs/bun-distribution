//! Platform locations: the Bun OS checkout, the platform package and the `usr/` root (same layout
//! as `packages/bun-os-platform/src/paths.ts`).

use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    /// Bun OS checkout.
    pub repo: PathBuf,
    /// `packages/bun-os-platform`: base catalogs, themes and the Bun service.
    pub package: PathBuf,
    /// `usr/` (`BUN_OS_USR`, `BEP_ROOT`, or `<repo>/usr`).
    pub usr: PathBuf,
}

fn is_repo(dir: &Path) -> bool {
    dir.join("packages").join("bun-os-platform").is_dir() && dir.join("crates").is_dir()
}

impl Paths {
    pub fn discover() -> Self {
        let repo = std::env::var_os("BUN_OS_ROOT")
            .map(PathBuf::from)
            .or_else(|| {
                [std::env::current_exe().ok(), std::env::current_dir().ok()]
                    .into_iter()
                    .flatten()
                    .find_map(|start| start.ancestors().find(|d| is_repo(d)).map(Path::to_path_buf))
            })
            .unwrap_or_else(|| PathBuf::from("."));
        let usr = std::env::var_os("BUN_OS_USR")
            .or_else(|| std::env::var_os("BEP_ROOT"))
            .map_or_else(|| repo.join("usr"), PathBuf::from);
        Self {
            package: repo.join("packages").join("bun-os-platform"),
            repo,
            usr,
        }
    }

    /// Catalog directories in override order: base, installed, plugins (`usr/lib/bun-os/plugins/*/locales`).
    pub fn locale_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![
            self.package.join("locales"),
            self.usr.join("share").join("bun-os").join("locale"),
        ];
        dirs.extend(self.plugin_dirs().into_iter().map(|p| p.join("locales")));
        dirs
    }

    /// Theme directories: base, installed, plugins.
    pub fn theme_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![
            self.package.join("themes"),
            self.usr.join("share").join("bun-os").join("themes"),
        ];
        dirs.extend(self.plugin_dirs().into_iter().map(|p| p.join("themes")));
        dirs
    }

    /// Plugin directories whose static data (catalogs, themes) may be read: the built-ins, and
    /// installed plugins whose digest matches `usr/etc/bun-os/plugins.lock.json` (same digest as
    /// `pluginDigest` in packages/bun-os-platform/src/plugins). Signed-only plugins are reached
    /// through the sidecar.
    pub fn plugin_dirs(&self) -> Vec<PathBuf> {
        let lock: serde_json::Value = std::fs::read_to_string(self.usr.join("etc").join("bun-os").join("plugins.lock.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut out = Vec::new();
        for (root, builtin) in [
            (self.package.join("plugins"), true),
            (self.usr.join("lib").join("bun-os").join("plugins"), false),
        ] {
            let Ok(entries) = std::fs::read_dir(&root) else { continue };
            let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.join("plugin.json").is_file()).collect();
            dirs.sort();
            for dir in dirs {
                let trusted = builtin || {
                    let name = std::fs::read_to_string(dir.join("plugin.json"))
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .and_then(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string));
                    name.and_then(|n| lock["plugins"][n.as_str()]["sha256"].as_str().map(str::to_string))
                        .is_some_and(|pinned| pinned == plugin_digest(&dir))
                };
                if trusted {
                    out.push(dir);
                }
            }
        }
        out
    }

    pub fn settings(&self) -> PathBuf {
        self.usr.join("etc").join("bun-os").join("settings.json")
    }
}

/// sha256 over `<relative path>\0<bytes>` of every file but `plugin.sig` and `node_modules`,
/// directories walked in sorted order (hex).
pub fn plugin_digest(dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    fn walk(root: &Path, dir: &Path, hash: &mut Sha256) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut names: Vec<String> = entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in names {
            if name == "node_modules" || name == "plugin.sig" {
                continue;
            }
            let path = dir.join(&name);
            if path.is_dir() {
                walk(root, &path, hash);
            } else if let Ok(bytes) = std::fs::read(&path) {
                let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                hash.update(rel.as_bytes());
                hash.update([0u8]);
                hash.update(&bytes);
            }
        }
    }
    let mut hash = Sha256::new();
    walk(dir, dir, &mut hash);
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// `usr/etc/bun-os/settings.json` (shared with the Bun side).
#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(default)]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contrast: Option<String>,
    #[serde(flatten)]
    pub other: serde_json::Map<String, serde_json::Value>,
}

impl Settings {
    pub fn read(paths: &Paths) -> Self {
        std::fs::read_to_string(paths.settings())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn write(&self, paths: &Paths) -> std::io::Result<()> {
        let file = paths.settings();
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(self).unwrap_or_default();
        std::fs::write(file, text + "\n")
    }
}
