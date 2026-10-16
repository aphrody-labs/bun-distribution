// SPDX-License-Identifier: Apache-2.0
//! Unified runtime layer for the three non-Rust toolchains Aphrody launches:
//! Bun (TS/JS), uv (Python) and Nushell (scripts).
//!
//! Every caller goes through the same three steps instead of re-implementing
//! them with `Command::new("bun").no_window()`:
//!
//! 1. **Discovery** ([`Toolchain::discover`]) — `APHRODY_<TOOL>_BIN` override,
//!    then `PATH` (with `PATHEXT` on Windows), then the tool's standard per-user
//!    install directory. No shell is ever involved.
//! 2. **Version pin** ([`Toolchain::pinned_version`]) — read from the nearest
//!    repository file (`.bun-version`, `package.json#packageManager`,
//!    `uv.toml`/`pyproject.toml#tool.uv.required-version`, `.nu-version`,
//!    `mise.toml#tools`), walking up from the project directory.
//! 3. **Launch** ([`Runtime::command`]) — a [`Command`] rooted at the project
//!    directory with a consistent environment: the resolved binary directory
//!    first on `PATH` and `APHRODY_<TOOL>_BIN` exported, so nested launches
//!    resolve the very same executable.
//!
//! [`Toolchain::resolve`] combines the three and reports whether the installed
//! version satisfies the pin. The upstream Bun and uv source trees stay
//! independent submodules (`third_party/`); this crate never builds them.

mod discover;
mod pin;

use aphrody_proc::NoWindow as _;
use std::{
    env,
    ffi::{OsStr, OsString},
    fmt, io,
    path::{Path, PathBuf},
    process::{Command, Output},
};

pub use discover::{BinarySource, Discovered};
pub use pin::Pin;

/// A toolchain managed by the unified runtime layer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum Toolchain {
    Bun,
    Uv,
    Nu,
}

/// Failure to resolve a runtime.
#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    #[error("{tool} not found (set {env} or put `{name}` on PATH)")]
    NotFound { tool: Toolchain, env: &'static str, name: &'static str },
    #[error("{env} points to a missing file: {}", path.display())]
    BadOverride { env: &'static str, path: PathBuf },
    #[error("failed to read {}: {message}", path.display())]
    PinFile { path: PathBuf, message: String },
    #[error("failed to run `{} --version`: {source}", path.display())]
    Probe { path: PathBuf, source: io::Error },
    #[error("unrecognised `--version` output from {}: {output:?}", path.display())]
    UnparsedVersion { path: PathBuf, output: String },
    #[error("{tool} {installed} at {} does not match the pin {pin} from {}", path.display(), pin_source.display())]
    VersionMismatch {
        tool: Toolchain,
        installed: String,
        pin: String,
        path: PathBuf,
        pin_source: PathBuf,
    },
}

impl fmt::Display for Toolchain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.executable_name())
    }
}

impl Toolchain {
    /// Every managed toolchain, in a stable order.
    pub const ALL: [Self; 3] = [Self::Bun, Self::Uv, Self::Nu];

    /// Parse a user-facing name (`bun`, `uv`, `nu`/`nushell`).
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "bun" => Some(Self::Bun),
            "uv" => Some(Self::Uv),
            "nu" | "nushell" => Some(Self::Nu),
            _ => None,
        }
    }

    /// Environment variable that overrides discovery with an explicit executable.
    #[must_use]
    pub const fn executable_env(self) -> &'static str {
        match self {
            Self::Bun => "APHRODY_BUN_BIN",
            Self::Uv => "APHRODY_UV_BIN",
            Self::Nu => "APHRODY_NU_BIN",
        }
    }

    /// Executable stem looked up on `PATH`.
    #[must_use]
    pub const fn executable_name(self) -> &'static str {
        match self {
            Self::Bun => "bun",
            Self::Uv => "uv",
            Self::Nu => "nu",
        }
    }

    /// Pinned upstream source tree inside this repository, when one is vendored.
    #[must_use]
    pub const fn source_relative_path(self) -> Option<&'static str> {
        match self {
            Self::Bun => Some("third_party/bun"),
            Self::Uv => Some("third_party/uv"),
            Self::Nu => None,
        }
    }

    /// Absolute path of the vendored upstream source tree, when one exists.
    #[must_use]
    pub fn source_root(self) -> Option<PathBuf> {
        self.source_relative_path()
            .map(|rel| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../apps/aphrody/crates/compat").join(rel))
    }

    /// Locate the executable (override, `PATH`, standard install dir).
    ///
    /// # Errors
    /// [`ResolveError::BadOverride`] when the override names a missing file,
    /// [`ResolveError::NotFound`] when nothing matches.
    pub fn discover(self) -> Result<Discovered, ResolveError> {
        discover::discover(self, env::var_os(self.executable_env()), env::var_os("PATH"))
    }

    /// The version pinned for `project_dir` by the nearest repository file.
    ///
    /// # Errors
    /// [`ResolveError::PinFile`] when a candidate file exists but cannot be parsed.
    pub fn pinned_version(self, project_dir: &Path) -> Result<Option<Pin>, ResolveError> {
        pin::find(self, project_dir)
    }

    /// Discover the executable, read the pin for `project_dir`, probe the
    /// installed version and check it against the pin.
    ///
    /// # Errors
    /// Any discovery, pin or probe failure, and [`ResolveError::VersionMismatch`]
    /// when the installed version does not satisfy the pin.
    pub fn resolve(self, project_dir: &Path) -> Result<Runtime, ResolveError> {
        let runtime = self.resolve_unchecked(project_dir)?;
        runtime.check_pin()?;
        Ok(runtime)
    }

    /// Like [`Self::resolve`] but reports a pin mismatch through
    /// [`Runtime::satisfies_pin`] instead of failing.
    ///
    /// # Errors
    /// Discovery, pin file or version probe failures.
    pub fn resolve_unchecked(self, project_dir: &Path) -> Result<Runtime, ResolveError> {
        let binary = self.discover()?;
        let pin = self.pinned_version(project_dir)?;
        let version = probe_version(self, &binary.path)?;
        Ok(Runtime { tool: self, binary, pin, version, project_dir: project_dir.to_path_buf() })
    }

    /// Executable to run without resolution (override or bare name). Kept for
    /// callers that only need a best-effort command.
    #[must_use]
    pub fn executable(self) -> OsString {
        env::var_os(self.executable_env()).unwrap_or_else(|| OsString::from(self.executable_name()))
    }

    /// A best-effort command (no resolution, no pin check).
    pub fn command<I, S>(self, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = Command::new(self.executable()).no_window();
        command.args(args);
        command
    }

    /// A best-effort command rooted at `directory` (uv discovers `pyproject.toml`,
    /// `uv.lock` and `.venv` from the working directory upward).
    pub fn command_in<I, S, P>(self, directory: P, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
        P: AsRef<Path>,
    {
        let mut command = self.command(args);
        command.current_dir(directory);
        command
    }

    /// Run `--version` on the best-effort executable.
    ///
    /// # Errors
    /// Spawn failure.
    pub fn version(self) -> io::Result<Output> {
        self.command(["--version"]).output()
    }

    /// Run the best-effort executable to completion.
    ///
    /// # Errors
    /// Spawn failure.
    pub fn run<I, S>(self, args: I) -> io::Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command(args).output()
    }

    /// Run the best-effort executable from `directory` to completion.
    ///
    /// # Errors
    /// Spawn failure.
    pub fn run_in<I, S, P>(self, directory: P, args: I) -> io::Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
        P: AsRef<Path>,
    {
        self.command_in(directory, args).output()
    }
}

/// A resolved toolchain for one project directory.
#[derive(Clone, Debug)]
pub struct Runtime {
    tool: Toolchain,
    binary: Discovered,
    pin: Option<Pin>,
    version: String,
    project_dir: PathBuf,
}

impl Runtime {
    #[must_use]
    pub const fn toolchain(&self) -> Toolchain {
        self.tool
    }

    /// The executable that will be launched.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.binary.path
    }

    /// How the executable was found.
    #[must_use]
    pub const fn source(&self) -> BinarySource {
        self.binary.source
    }

    /// Installed version reported by `--version` (e.g. `1.4.2`).
    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    /// The repository pin, if any.
    #[must_use]
    pub const fn pin(&self) -> Option<&Pin> {
        self.pin.as_ref()
    }

    #[must_use]
    pub fn project_dir(&self) -> &Path {
        &self.project_dir
    }

    /// `true` when there is no pin or the installed version satisfies it.
    #[must_use]
    pub fn satisfies_pin(&self) -> bool {
        self.pin.as_ref().is_none_or(|pin| pin.matches(&self.version))
    }

    /// # Errors
    /// [`ResolveError::VersionMismatch`] when the pin is not satisfied.
    pub fn check_pin(&self) -> Result<(), ResolveError> {
        match &self.pin {
            Some(pin) if !pin.matches(&self.version) => Err(ResolveError::VersionMismatch {
                tool: self.tool,
                installed: self.version.clone(),
                pin: pin.version.clone(),
                path: self.binary.path.clone(),
                pin_source: pin.source.clone(),
            }),
            _ => Ok(()),
        }
    }

    /// Environment applied to every launched process: the resolved binary
    /// directory prepended to `PATH`, and the override variable pointing at
    /// the resolved executable so nested launches pick the same binary.
    #[must_use]
    pub fn env(&self) -> Vec<(OsString, OsString)> {
        let mut vars =
            vec![(OsString::from(self.tool.executable_env()), self.binary.path.clone().into())];
        if let Some(dir) = self.binary.path.parent() {
            let mut paths = vec![dir.to_path_buf()];
            if let Some(existing) = env::var_os("PATH") {
                paths.extend(env::split_paths(&existing).filter(|p| p != dir));
            }
            if let Ok(joined) = env::join_paths(paths) {
                vars.push((OsString::from("PATH"), joined));
            }
        }
        vars
    }

    /// A command for the resolved executable, rooted at the project directory,
    /// with [`Self::env`] applied.
    pub fn command<I, S>(&self, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = Command::new(&self.binary.path).no_window();
        command.args(args).current_dir(&self.project_dir).envs(self.env());
        command
    }
}

/// Run `<path> --version` and extract the semantic version.
fn probe_version(tool: Toolchain, path: &Path) -> Result<String, ResolveError> {
    let output = Command::new(path).no_window()
        .arg("--version")
        .output()
        .map_err(|source| ResolveError::Probe { path: path.to_path_buf(), source })?;
    let text = String::from_utf8_lossy(&output.stdout);
    parse_version(tool, &text).ok_or_else(|| ResolveError::UnparsedVersion {
        path: path.to_path_buf(),
        output: text.trim().to_owned(),
    })
}

/// Extract the version from `--version` output:
/// `1.4.2` (bun), `uv 0.12.17 (abc 2026-01-01)` (uv), `0.115.1` (nu).
fn parse_version(tool: Toolchain, text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let token = line
        .split_whitespace()
        .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .or_else(|| line.strip_prefix(tool.executable_name()).map(str::trim))?;
    let token = token.trim_start_matches('v');
    token.split('.').next()?.parse::<u64>().ok()?;
    Some(token.to_owned())
}

#[cfg(test)]
mod tests;
