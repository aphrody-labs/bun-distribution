//! Where the shell reads and writes: the Bun OS checkout, its `usr/` root (bep layout) and the
//! shell state under `usr/var/lib/bep/shell`.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    /// Bun OS checkout (holds `packages/`, `crates/`, `usr/`).
    pub repo: PathBuf,
    /// bep root (`usr/`, or `BEP_ROOT`).
    pub usr: PathBuf,
    /// `usr/var/lib/bep`: library.db, local.db and the shell database.
    pub bep: PathBuf,
    /// `usr/var/lib/bep/shell`: suspend states, thumbnails and captures.
    pub shell: PathBuf,
}

fn is_repo(dir: &Path) -> bool {
    dir.join("packages").join("bun-engine").is_dir() && dir.join("crates").is_dir()
}

fn find_repo() -> Option<PathBuf> {
    if let Some(root) = std::env::var_os("BUN_OS_ROOT") {
        return Some(PathBuf::from(root));
    }
    let starts = [std::env::current_exe().ok(), std::env::current_dir().ok()];
    for start in starts.into_iter().flatten() {
        for dir in start.ancestors() {
            if is_repo(dir) {
                return Some(dir.to_path_buf());
            }
        }
    }
    None
}

impl Paths {
    pub fn discover() -> Self {
        let repo = find_repo().unwrap_or_else(|| PathBuf::from("."));
        let usr = std::env::var_os("BEP_ROOT").map_or_else(|| repo.join("usr"), PathBuf::from);
        let bep = usr.join("var").join("lib").join("bep");
        let shell = bep.join("shell");
        for dir in [&shell, &shell.join("states"), &shell.join("captures")] {
            let _ = std::fs::create_dir_all(dir);
        }
        Self {
            repo,
            usr,
            bep,
            shell,
        }
    }

    pub fn states(&self) -> PathBuf {
        self.shell.join("states")
    }

    pub fn captures(&self) -> PathBuf {
        self.shell.join("captures")
    }

    pub fn database(&self) -> PathBuf {
        self.bep.join("shell.db")
    }

    /// File-name-safe form of a game key (`steam:730` -> `steam-730`).
    pub fn slug(key: &str) -> String {
        key.chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect()
    }
}
