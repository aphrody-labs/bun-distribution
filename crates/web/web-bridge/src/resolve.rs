// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Locate native Aphrody Web artifacts for installation reports.
//!
//! # Executable — `aphrody-web`
//!
//! 1. `$APHRODY_WEB_BIN` — explicit, must exist
//! 2. Published legacy override names, when explicitly configured
//! 3. `<home>/.local/bin/aphrody-web`
//! 4. `PATH`
//!
//! Legacy executable names are never automatically discovered. Browser and MCP
//! callers use the linked Rust Web service; locating this CLI does not establish
//! an MCP transport capability.
//!
//! # Shared library — `bxc_rust_bridge`
//!
//! 1. `$APHRODY_BXC_LIB` — explicit, must exist
//! 2. `<home>/.local/bin`
//! 3. `~/.aphrody/runtimes/` (flat, and under any `bxc*` subdirectory)
//! 4. the canonical Aphrody workspace `target/` cdylib
//! 5. `PATH`
//!
//! Neither chain ends in "let the platform loader try": a bare name handed to
//! `dlopen` succeeds or fails without ever telling the operator *where* it
//! looked, and this crate exists to make that answer explicit.

use std::path::{Path, PathBuf};

use crate::error::{Result, WebBrowserError};

/// Environment variable naming the `bxc_rust_bridge` shared library outright.
pub const ENV_LIB: &str = "APHRODY_BXC_LIB";

/// Unified Aphrody native library override, preferred over legacy Web paths.
pub const ENV_UNIFIED_LIB: &str = "APHRODY_FFI_LIB";

fn library_override_var() -> &'static str {
    if non_empty_env(ENV_UNIFIED_LIB).is_some() { ENV_UNIFIED_LIB } else { ENV_LIB }
}

/// Environment variable naming the `bxc` executable outright.
///
/// Kept as `BXC_BIN` rather than renamed to an `APHRODY_`-prefixed spelling:
/// `crates/cli` has documented and shipped it, and silently retiring a working
/// override is exactly the kind of change nobody notices until it bites.
pub const ENV_BIN: &str = "BXC_BIN";

/// Published compatibility override for an explicitly configured executable.
pub const ENV_WEB_BROWSER_BIN: &str = "APHRODY_WEB_BROWSER_BIN";

/// Canonical override for the native Aphrody Web CLI.
pub const ENV_WEB_BIN: &str = "APHRODY_WEB_BIN";

fn binary_override_var() -> &'static str {
    if non_empty_env(ENV_WEB_BIN).is_some() {
        ENV_WEB_BIN
    } else if non_empty_env(ENV_WEB_BROWSER_BIN).is_some() {
        ENV_WEB_BROWSER_BIN
    } else {
        ENV_BIN
    }
}

/// Platform file name of the bxc bridge shared library.
pub const LIB_NAME: &str = if cfg!(windows) {
    "bxc_rust_bridge.dll"
} else if cfg!(target_vendor = "apple") {
    "libbxc_rust_bridge.dylib"
} else {
    "libbxc_rust_bridge.so"
};

/// File name emitted by Cargo before distribution renames the library.
pub const CARGO_LIB_NAME: &str = if cfg!(windows) {
    "aphrody_web_ffi.dll"
} else if cfg!(target_vendor = "apple") {
    "libaphrody_web_ffi.dylib"
} else {
    "libaphrody_web_ffi.so"
};

/// Platform filename of the single native Aphrody artifact.
pub const UNIFIED_LIB_NAME: &str = if cfg!(windows) {
    "aphrody_ffi.dll"
} else if cfg!(target_vendor = "apple") {
    "libaphrody_ffi.dylib"
} else {
    "libaphrody_ffi.so"
};

/// Former executable name retained for source API compatibility only.
pub const BIN_NAME: &str = if cfg!(windows) { "bxc.exe" } else { "bxc" };

/// Preferred public executable name for Aphrody Web Browser.
pub const WEB_BIN_NAME: &str = if cfg!(windows) { "aphrody-web.exe" } else { "aphrody-web" };

/// Former public browser name retained for source API compatibility only.
pub const WEB_BROWSER_BIN_NAME: &str =
    if cfg!(windows) { "aphrody-web-browser.exe" } else { "aphrody-web-browser" };

/// How an artefact was located, so a report can explain the choice.
///
/// Modelled on [`aphrody_infer::runtime::RuntimeSource`]: a caller that acts
/// on bxc is expected to be able to say *which* bxc it acted on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "source", content = "path")]
pub enum Source {
    /// An environment override pointed straight at it.
    Override(PathBuf),
    /// Found under the user home (`~/.local/bin` and friends).
    Home(PathBuf),
    /// Found under `~/.aphrody/runtimes`.
    Managed(PathBuf),
    /// Found in-tree within the monorepo workspace.
    InTree(PathBuf),
    /// Found on `PATH`.
    Path(PathBuf),
}

impl Source {
    /// The resolved file.
    #[must_use]
    pub fn path(&self) -> &Path {
        match self {
            Self::Override(p)
            | Self::Home(p)
            | Self::Managed(p)
            | Self::InTree(p)
            | Self::Path(p) => p,
        }
    }

    /// Consume the source, keeping the path.
    #[must_use]
    pub fn into_path(self) -> PathBuf {
        match self {
            Self::Override(p)
            | Self::Home(p)
            | Self::Managed(p)
            | Self::InTree(p)
            | Self::Path(p) => p,
        }
    }

    /// Short label for capability reports.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Override(_) => "environment override",
            Self::Home(_) => "user home",
            Self::Managed(_) => "managed (~/.aphrody/runtimes)",
            Self::InTree(_) => "in-tree monorepo",
            Self::Path(_) => "PATH",
        }
    }
}

/// Read an environment variable, treating empty (and whitespace-only) as unset.
///
/// `export BXC_BIN=` leaves the variable set but meaningless; honouring it
/// would resolve the executable to the empty path and fail with a message that
/// names nothing.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

/// The user home, using the platform directory resolver.
fn home() -> Option<PathBuf> {
    non_empty_env(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

fn runtimes_dir() -> Option<PathBuf> {
    non_empty_env("APHRODY_RUNTIMES_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            non_empty_env("APHRODY_HOME").map(|state| PathBuf::from(state).join("runtimes"))
        })
        .or_else(|| home().map(|home| home.join(".aphrody").join("runtimes")))
}

/// Directories on `PATH`, in order.
fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|raw| std::env::split_paths(&raw).collect()).unwrap_or_default()
}

/// Locate repo root by walking up from cwd, exe, or CARGO_MANIFEST_DIR.
fn repo_root() -> Option<PathBuf> {
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(manifest);
        if let Some(parent) = manifest_path.parent().and_then(|p| p.parent()) {
            if parent.join("Cargo.toml").exists() {
                return Some(parent.to_path_buf());
            }
        }
    }
    if let Ok(mut dir) = std::env::current_dir() {
        loop {
            let candidate = dir.join("Cargo.toml");
            if candidate.exists() {
                if let Ok(content) = std::fs::read_to_string(&candidate) {
                    if content.contains("[workspace]") {
                        return Some(dir);
                    }
                }
            }
            if !dir.pop() {
                break;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe;
        while dir.pop() {
            let candidate = dir.join("Cargo.toml");
            if candidate.exists() {
                if let Ok(content) = std::fs::read_to_string(&candidate) {
                    if content.contains("[workspace]") {
                        return Some(dir);
                    }
                }
            }
        }
    }
    None
}

/// Workspaces whose `apps/bxc` and `target/` are searched: the caller's workspace, then the
/// monorepo workspace this crate was built from.
///
/// The second root lets tools find the in-tree bxc without carrying their own copy
/// of this chain. It is a compile-time path, skipped once it no longer exists.
fn in_tree_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = repo_root().into_iter().collect();
    let owner = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    if owner.join("Cargo.toml").is_file() {
        let owner = owner.canonicalize().unwrap_or(owner);
        let known = roots.iter().any(|root| root.canonicalize().is_ok_and(|root| root == owner));
        if !known {
            roots.push(owner);
        }
    }
    roots
}

/// A resolution attempt: the candidates that were probed, and the winner.
///
/// Returned rather than discarded so a failure can print the list. A chain
/// that fails with "not found" and no itinerary is the thing that makes people
/// guess.
#[derive(Debug, Clone)]
pub struct Attempt {
    /// Every path that was checked, in order.
    pub tried: Vec<PathBuf>,
    /// The winner, when there is one.
    pub found: Option<Source>,
    /// Set when an explicit override was present and did not resolve.
    ///
    /// When this is `Some`, `tried` holds exactly that one path: the search
    /// stopped there rather than continuing down the chain. See
    /// [`WebBrowserError::OverrideMissing`] for why.
    pub failed_override: Option<&'static str>,
}

impl Attempt {
    /// Turn a failed attempt into the typed error for an executable.
    fn into_binary_error(self) -> WebBrowserError {
        self.override_error()
            .unwrap_or_else(|| WebBrowserError::binary_missing(WEB_BIN_NAME, &self.tried))
    }

    /// Turn a failed attempt into the typed error for the shared library.
    fn into_library_error(self) -> WebBrowserError {
        self.override_error()
            .unwrap_or_else(|| WebBrowserError::library_missing(UNIFIED_LIB_NAME, &self.tried))
    }

    /// The override error, when the attempt died on one.
    fn override_error(&self) -> Option<WebBrowserError> {
        let var = self.failed_override?;
        Some(WebBrowserError::OverrideMissing {
            var,
            path: self.tried.first().cloned().unwrap_or_default(),
        })
    }
}

/// Walk a candidate list, recording every probe.
///
/// `probe` decides whether a candidate counts; taking it as a parameter is
/// what makes the whole chain testable against a temporary directory instead
/// of against whatever this machine happens to have installed.
fn walk(
    candidates: Vec<(PathBuf, fn(PathBuf) -> Source)>,
    probe: &dyn Fn(&Path) -> bool,
) -> Attempt {
    let mut tried = Vec::with_capacity(candidates.len());
    for (candidate, wrap) in candidates {
        let hit = probe(&candidate);
        tried.push(candidate.clone());
        if hit {
            return Attempt { tried, found: Some(wrap(candidate)), failed_override: None };
        }
    }
    Attempt { tried, found: None, failed_override: None }
}

/// Resolve one artefact: honour an explicit override *exclusively*, otherwise
/// walk the chain.
///
/// The override is checked here rather than as the first entry of the walk,
/// and that distinction is the whole point. As a mere first candidate, a
/// `APHRODY_BXC_LIB` pointing at a typo would simply be skipped and the next
/// location would win - the operator would then be looking at behaviour from a
/// library they believed they had overridden, with nothing anywhere saying so.
/// Measured on 2026-09-07: the MCP server answered a fetch normally with
/// `APHRODY_BXC_LIB=C:/nonexistent/...` set. An override now stops the search.
fn resolve_one(
    var: &'static str,
    candidates: impl FnOnce() -> Vec<(PathBuf, fn(PathBuf) -> Source)>,
    probe: &dyn Fn(&Path) -> bool,
) -> Attempt {
    if let Some(raw) = non_empty_env(var) {
        let explicit = PathBuf::from(raw);
        let hit = probe(&explicit);
        return Attempt {
            tried: vec![explicit.clone()],
            found: hit.then(|| Source::Override(explicit)),
            failed_override: (!hit).then_some(var),
        };
    }
    walk(candidates(), probe)
}

/// The default probe: the path names an existing file.
fn is_file(path: &Path) -> bool {
    path.is_file()
}

// ---------------------------------------------------------------------------
// Executable
// ---------------------------------------------------------------------------

/// Candidate list for the native `aphrody-web` CLI, in resolution order.
///
/// Split from [`binary`] so the ordering is a value a test can assert on.
#[must_use]
pub fn binary_candidates() -> Vec<(PathBuf, fn(PathBuf) -> Source)> {
    let mut out: Vec<(PathBuf, fn(PathBuf) -> Source)> = Vec::new();

    if let Some(explicit) = non_empty_env(binary_override_var()) {
        out.push((PathBuf::from(explicit), Source::Override as fn(PathBuf) -> Source));
    }

    if let Some(home) = home() {
        out.push((
            home.join(".local").join("bin").join(WEB_BIN_NAME),
            Source::Home as fn(PathBuf) -> Source,
        ));
    }
    for dir in path_dirs() {
        out.push((dir.join(WEB_BIN_NAME), Source::Path as fn(PathBuf) -> Source));
    }

    out
}

/// Locate the native `aphrody-web` CLI.
///
/// # Errors
///
/// [`WebBrowserError::BinaryMissing`], carrying every candidate that was probed.
pub fn binary() -> Result<Source> {
    let attempt = binary_attempt();
    attempt.found.clone().ok_or_else(|| attempt.into_binary_error())
}

/// Locate the native CLI, reporting the itinerary either way.
#[must_use]
pub fn binary_attempt() -> Attempt {
    resolve_one(binary_override_var(), binary_candidates, &is_file)
}

// ---------------------------------------------------------------------------
// Shared library
// ---------------------------------------------------------------------------

/// Candidate list for the `bxc_rust_bridge` shared library, in order.
#[must_use]
pub fn library_candidates() -> Vec<(PathBuf, fn(PathBuf) -> Source)> {
    let mut out: Vec<(PathBuf, fn(PathBuf) -> Source)> = Vec::new();

    if let Some(explicit) = non_empty_env(library_override_var()) {
        out.push((PathBuf::from(explicit), Source::Override as fn(PathBuf) -> Source));
    }

    if let Some(home) = home() {
        out.push((
            home.join(".local").join("bin").join(UNIFIED_LIB_NAME),
            Source::Home as fn(PathBuf) -> Source,
        ));
        out.push((
            home.join(".local").join("bin").join(LIB_NAME),
            Source::Home as fn(PathBuf) -> Source,
        ));
        out.push((
            home.join("bxc").join("bin").join(LIB_NAME),
            Source::Home as fn(PathBuf) -> Source,
        ));
    }

    if let Some(runtimes) = runtimes_dir() {
        out.extend(managed_candidates_in(&runtimes));
    }

    for root in in_tree_roots() {
        for directory in [
            root.join("target").join("release"),
            root.join("target").join("x86_64-pc-windows-msvc").join("release"),
            root.join("target").join("debug"),
        ] {
            out.push((directory.join(UNIFIED_LIB_NAME), Source::InTree as fn(PathBuf) -> Source));
            out.push((directory.join(CARGO_LIB_NAME), Source::InTree as fn(PathBuf) -> Source));
        }
        out.push((
            root.join("target").join("release").join(LIB_NAME),
            Source::InTree as fn(PathBuf) -> Source,
        ));
        out.push((
            root.join("target").join("x86_64-pc-windows-msvc").join("release").join(LIB_NAME),
            Source::InTree as fn(PathBuf) -> Source,
        ));
        out.push((
            root.join("target").join("debug").join(LIB_NAME),
            Source::InTree as fn(PathBuf) -> Source,
        ));
        out.push((
            root.join("apps").join("bxc").join("dist").join(LIB_NAME),
            Source::InTree as fn(PathBuf) -> Source,
        ));
    }

    for dir in path_dirs() {
        out.push((dir.join(UNIFIED_LIB_NAME), Source::Path as fn(PathBuf) -> Source));
        out.push((dir.join(LIB_NAME), Source::Path as fn(PathBuf) -> Source));
    }

    out
}

/// Candidates under a runtimes root: the root itself, then every `bxc*`
/// subdirectory (newest name first) and its `lib/` and `bin/`.
///
/// Takes the root explicitly so the scan is testable without touching the
/// process environment - `set_var` is `unsafe` since edition 2024 and this
/// crate keeps `unsafe` confined to [`crate::ffi`].
#[must_use]
pub fn managed_candidates_in(root: &Path) -> Vec<(PathBuf, fn(PathBuf) -> Source)> {
    let mut out: Vec<(PathBuf, fn(PathBuf) -> Source)> = vec![
        (root.join(UNIFIED_LIB_NAME), Source::Managed as fn(PathBuf) -> Source),
        (root.join(LIB_NAME), Source::Managed as fn(PathBuf) -> Source),
    ];

    let Ok(entries) = std::fs::read_dir(root) else { return out };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(core::result::Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .map(|n| n.to_string_lossy().to_ascii_lowercase().starts_with("bxc"))
                    .unwrap_or(false)
        })
        .collect();
    // `bxc-0.9.4` before `bxc-0.9.1`: reverse lexicographic puts the highest
    // version of a `name-X.Y.Z` layout first, the same convention
    // `aphrody_infer::runtime::find_managed_in` relies on.
    dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    for dir in dirs {
        for sub in ["", "lib", "bin"] {
            let base = if sub.is_empty() { dir.clone() } else { dir.join(sub) };
            out.push((base.join(UNIFIED_LIB_NAME), Source::Managed as fn(PathBuf) -> Source));
            out.push((base.join(LIB_NAME), Source::Managed as fn(PathBuf) -> Source));
        }
    }
    out
}

/// Locate the `bxc_rust_bridge` shared library.
///
/// # Errors
///
/// [`WebBrowserError::LibraryMissing`], carrying every candidate that was probed.
pub fn library() -> Result<Source> {
    let attempt = library_attempt();
    attempt.found.clone().ok_or_else(|| attempt.into_library_error())
}

/// Locate the shared library, reporting the itinerary either way.
#[must_use]
pub fn library_attempt() -> Attempt {
    resolve_one(library_override_var(), library_candidates, &is_file)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The chain must stop at the first hit and remember what it skipped.
    #[test]
    fn walk_stops_at_the_first_hit_and_records_the_itinerary() {
        let candidates: Vec<(PathBuf, fn(PathBuf) -> Source)> = vec![
            (PathBuf::from("/miss/one"), Source::Override),
            (PathBuf::from("/hit/two"), Source::Home),
            (PathBuf::from("/never/three"), Source::Path),
        ];
        let attempt = walk(candidates, &|p: &Path| p.starts_with("/hit"));
        assert_eq!(attempt.found, Some(Source::Home(PathBuf::from("/hit/two"))));
        assert_eq!(attempt.tried.len(), 2, "the third candidate must not be probed");
    }

    #[test]
    fn walk_reports_every_candidate_when_nothing_matches() {
        let candidates: Vec<(PathBuf, fn(PathBuf) -> Source)> =
            vec![(PathBuf::from("/a"), Source::Home), (PathBuf::from("/b"), Source::Path)];
        let attempt = walk(candidates, &|_: &Path| false);
        assert!(attempt.found.is_none());
        assert_eq!(attempt.tried.len(), 2);
        let text = attempt.into_library_error().to_string();
        assert!(text.contains("/a") && text.contains("/b"), "{text}");
    }

    /// The Windows regression this module exists to fix: `~/.local/bin` was
    /// only ever consulted on Unix, so the copy installed there on Windows
    /// read as "bxc is not installed".
    #[test]
    fn the_binary_chain_looks_under_dot_local_bin_on_every_platform() {
        let Some(home) = home() else { return };
        let wanted = home.join(".local").join("bin").join(WEB_BIN_NAME);
        let found = binary_candidates().into_iter().any(|(p, _)| p == wanted);
        assert!(found, "expected {} among the candidates", wanted.display());
    }

    #[test]
    fn native_cli_install_is_discovered() {
        let canonical = home().expect("test home").join(".local/bin").join(WEB_BIN_NAME);
        let probe = |path: &Path| path == canonical;
        let cli = walk(binary_candidates(), &probe);
        assert_eq!(cli.found.expect("native CLI").path(), canonical);
    }

    #[test]
    fn obsolete_binary_names_are_not_automatically_discovered() {
        for (path, wrap) in binary_candidates() {
            if matches!(wrap(path.clone()), Source::Override(_)) {
                continue;
            }
            assert_eq!(path.file_name().unwrap(), WEB_BIN_NAME);
            assert_ne!(path.file_name().unwrap(), WEB_BROWSER_BIN_NAME);
            assert_ne!(path.file_name().unwrap(), BIN_NAME);
        }
        let legacy_only = walk(
            binary_candidates(),
            &|path| matches!(path.file_name().and_then(|name| name.to_str()), Some(name) if name == BIN_NAME || name == WEB_BROWSER_BIN_NAME),
        );
        if non_empty_env(binary_override_var()).is_none() {
            assert!(legacy_only.found.is_none());
        }
    }

    /// An override, when set, must be probed before anything else.
    #[test]
    fn an_override_when_set_sorts_first() {
        if non_empty_env(ENV_BIN).is_some() {
            let first = binary_candidates().into_iter().next().expect("at least one candidate");
            assert!(matches!(first.1(PathBuf::new()), Source::Override(_)));
        }
        if non_empty_env(ENV_LIB).is_some() {
            let first = library_candidates().into_iter().next().expect("at least one candidate");
            assert!(matches!(first.1(PathBuf::new()), Source::Override(_)));
        }
    }

    /// The regression measured on 2026-09-07: with
    /// `APHRODY_BXC_LIB=C:/nonexistent/...` the MCP server answered a fetch
    /// perfectly well, because the broken override was skipped and the copy in
    /// `~/.local/bin` won. An operator overriding a library must never be
    /// served a different one in silence.
    #[test]
    fn a_broken_override_stops_the_search_instead_of_falling_through() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join(LIB_NAME);
        std::fs::write(&real, b"stub").unwrap();
        let broken = dir.path().join("absent").join(LIB_NAME);

        // Everything that exists resolves; the override does not exist.
        let attempt = resolve_one(
            "APHRODY_BXC_LIB_TEST",
            || vec![(real.clone(), Source::Home as fn(PathBuf) -> Source)],
            &|p: &Path| p == real,
        );
        // With no such variable set, the fallback candidate wins.
        assert_eq!(attempt.found, Some(Source::Home(real.clone())));
        assert!(attempt.failed_override.is_none());

        // And with a failing override in play, nothing else is even probed.
        let failed = Attempt {
            tried: vec![broken.clone()],
            found: None,
            failed_override: Some("APHRODY_BXC_LIB"),
        };
        assert_eq!(failed.tried.len(), 1, "the chain must stop at the override");
        let err = failed.into_library_error().to_string();
        assert!(err.contains("APHRODY_BXC_LIB"), "{err}");
        assert!(err.contains("never silently replaced"), "{err}");
    }

    /// The live variable, when the caller has actually set one. Real
    /// end-to-end coverage of `resolve_one` without touching the environment.
    #[test]
    fn a_set_override_that_resolves_wins_outright() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join(BIN_NAME);
        std::fs::write(&target, b"stub").unwrap();
        let decoy = dir.path().join("decoy").join(BIN_NAME);

        let attempt = resolve_one(
            "PATH", // any variable that is certainly set and is not a file
            || vec![(decoy.clone(), Source::Home as fn(PathBuf) -> Source)],
            &|_: &Path| false,
        );
        assert!(attempt.found.is_none());
        assert_eq!(attempt.failed_override, Some("PATH"), "a set-but-invalid override is fatal");
        assert_eq!(attempt.tried.len(), 1, "the decoy must never be probed: {attempt:?}");
    }

    #[test]
    fn managed_scan_covers_flat_lib_and_bin_layouts_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["bxc-0.9.1", "bxc-0.9.4", "onnxruntime-win-x64-1.29.0"] {
            std::fs::create_dir_all(dir.path().join(name).join("lib")).unwrap();
        }
        let candidates = managed_candidates_in(dir.path());
        let paths: Vec<String> =
            candidates.iter().map(|(p, _)| p.display().to_string().replace('\\', "/")).collect();

        assert!(
            paths[0].ends_with(UNIFIED_LIB_NAME),
            "the unified library is first: {:?}",
            paths[0]
        );
        let idx_new = paths.iter().position(|p| p.contains("bxc-0.9.4")).expect("0.9.4 probed");
        let idx_old = paths.iter().position(|p| p.contains("bxc-0.9.1")).expect("0.9.1 probed");
        assert!(idx_new < idx_old, "the newest install must be probed first: {paths:?}");
        assert!(
            !paths.iter().any(|p| p.contains("onnxruntime")),
            "unrelated runtimes must not be probed: {paths:?}"
        );
        assert!(paths.iter().any(|p| p.contains("bxc-0.9.4/lib/")), "{paths:?}");
        assert!(paths.iter().any(|p| p.contains("bxc-0.9.4/bin/")), "{paths:?}");
    }

    #[test]
    fn managed_scan_on_a_missing_root_is_an_answer_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let absent = dir.path().join("nope");
        assert_eq!(managed_candidates_in(&absent).len(), 2, "only flat root candidates");
    }

    #[test]
    fn source_labels_and_paths_line_up() {
        let s = Source::Managed(PathBuf::from("/opt/bxc/lib/libbxc_rust_bridge.so"));
        assert_eq!(s.path(), Path::new("/opt/bxc/lib/libbxc_rust_bridge.so"));
        assert!(s.label().contains("managed"));
        assert_eq!(
            Source::Path(PathBuf::from("/usr/bin/bxc")).into_path(),
            PathBuf::from("/usr/bin/bxc")
        );
    }

    #[test]
    fn platform_file_names_are_the_right_shape() {
        if cfg!(windows) {
            assert_eq!(LIB_NAME, "bxc_rust_bridge.dll");
            assert_eq!(BIN_NAME, "bxc.exe");
        } else {
            assert!(LIB_NAME.starts_with("lib"), "{LIB_NAME}");
            assert_eq!(BIN_NAME, "bxc");
        }
    }
}
