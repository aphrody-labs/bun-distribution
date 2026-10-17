// SPDX-License-Identifier: Apache-2.0
//! Shell-free executable discovery.

use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
};

use crate::{ResolveError, Toolchain};

/// Where a resolved executable came from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinarySource {
    /// `APHRODY_<TOOL>_BIN`.
    Override,
    /// A `PATH` entry.
    Path,
    /// The tool's standard per-user install directory.
    UserInstall,
}

impl BinarySource {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Override => "override",
            Self::Path => "path",
            Self::UserInstall => "user-install",
        }
    }
}

/// A located executable.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Discovered {
    pub path: PathBuf,
    pub source: BinarySource,
}

pub(crate) fn discover(
    tool: Toolchain,
    override_value: Option<OsString>,
    path_var: Option<OsString>,
) -> Result<Discovered, ResolveError> {
    if let Some(value) = override_value.filter(|v| !v.is_empty()) {
        let path = PathBuf::from(value);
        return if path.is_file() {
            Ok(Discovered {
                path,
                source: BinarySource::Override,
            })
        } else {
            Err(ResolveError::BadOverride {
                env: tool.executable_env(),
                path,
            })
        };
    }
    if let Some(path_var) = path_var {
        for dir in env::split_paths(&path_var) {
            if let Some(path) = find_in(&dir, tool.executable_name()) {
                return Ok(Discovered {
                    path,
                    source: BinarySource::Path,
                });
            }
        }
    }
    for dir in user_install_dirs(tool) {
        if let Some(path) = find_in(&dir, tool.executable_name()) {
            return Ok(Discovered {
                path,
                source: BinarySource::UserInstall,
            });
        }
    }
    Err(ResolveError::NotFound {
        tool,
        env: tool.executable_env(),
        name: tool.executable_name(),
    })
}

/// Standard per-user install locations (`bun.sh/install`, the uv installer, `cargo install nu`).
fn user_install_dirs(tool: Toolchain) -> Vec<PathBuf> {
    let Some(home) = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    match tool {
        Toolchain::Bun => vec![home.join(".bun").join("bin")],
        Toolchain::Uv => vec![
            home.join(".local").join("bin"),
            home.join(".cargo").join("bin"),
        ],
        Toolchain::Nu => vec![
            home.join(".cargo").join("bin"),
            home.join(".local").join("bin"),
        ],
    }
}

/// Find `name` in `dir`, honouring `PATHEXT` on Windows.
pub(crate) fn find_in(dir: &Path, name: &str) -> Option<PathBuf> {
    if dir.as_os_str().is_empty() {
        return None;
    }
    candidates(name)
        .into_iter()
        .map(|file| dir.join(file))
        .find(|p| p.is_file())
}

fn candidates(name: &str) -> Vec<String> {
    if cfg!(windows) {
        let exts = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
        // Prefer a real executable over script shims (`bun.cmd` from npm wrappers).
        let mut list = vec![format!("{name}.exe")];
        list.extend(
            exts.split(';')
                .map(str::trim)
                .filter(|e| !e.is_empty() && !e.eq_ignore_ascii_case(".exe"))
                .map(|e| format!("{name}{}", e.to_ascii_lowercase())),
        );
        list
    } else {
        vec![name.to_owned()]
    }
}
