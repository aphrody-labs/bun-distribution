// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// llama.cpp backend discovery.
//
// GGUF models (the `llama-cpp` backend in the catalog: dots.ocr,
// granite-docling, SmolVLM) run through llama.cpp rather than ONNX Runtime.
// aphrody does NOT link llama.cpp: it drives the upstream binaries, exactly as
// `gemini-runtime` drives the Gemini CLI.
//
// That choice is deliberate. Linking `llama-cpp-2` would pin one build of a
// fast-moving C++ project into aphrody's own build, drag a CUDA toolchain into
// every compile, and fight the `+crt-static` posture on MSVC (CLAUDE.md §7).
// Spawning the upstream release binary keeps the CUDA build swappable, keeps
// aphrody's build hermetic, and means a llama.cpp bump is a download rather
// than a recompile.
//
// Since the native-integration work there is a second, in-process way to run
// the same GGUF files: `aphrody-llama-server` (feature `in-process`) drives
// `aphrody-llama`, which loads `libllama` / `libmtmd` at RUNTIME through
// `libloading`, so the hermetic-build argument above still holds (nothing is
// linked). This module stays the one owner of "where is llama.cpp on this
// machine", for both worlds: `resolve` finds the release binaries, and
// `resolve_library` finds the directory holding the shared libraries the
// in-process engine loads. `aphrody-llama-server` does the loading; this crate
// stays `forbid(unsafe_code)`.
//
// Resolution order mirrors `gemini_runtime::resolve_bin`:
//   1. $APHRODY_LLAMA_BIN        — explicit path to one executable
//   2. $APHRODY_LLAMA_DIR        — a directory holding the release binaries
//   3. ~/.aphrody/runtimes/llama-*/  — newest install wins
//   4. PATH

use std::path::{Path, PathBuf};

/// The llama.cpp tools aphrody knows how to drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[non_exhaustive]
pub enum LlamaTool {
    /// One-shot / interactive generation (`llama-cli`).
    Cli,
    /// OpenAI-compatible HTTP server (`llama-server`), which is how a batch
    /// pipeline keeps a vision model resident across many images.
    Server,
    /// Throughput benchmark (`llama-bench`).
    Bench,
    /// Multimodal one-shot (`llama-mtmd-cli`) — the entry point for a GGUF
    /// vision model plus its mmproj projector.
    Multimodal,
}

impl LlamaTool {
    /// Executable stem, without the platform extension.
    #[must_use]
    pub const fn stem(self) -> &'static str {
        match self {
            Self::Cli => "llama-cli",
            Self::Server => "llama-server",
            Self::Bench => "llama-bench",
            Self::Multimodal => "llama-mtmd-cli",
        }
    }

    /// Platform file name.
    #[must_use]
    pub fn file_name(self) -> String {
        if cfg!(windows) { format!("{}.exe", self.stem()) } else { self.stem().to_owned() }
    }

    /// Every tool, in declaration order.
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::Cli, Self::Server, Self::Bench, Self::Multimodal]
    }
}

impl core::fmt::Display for LlamaTool {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.stem())
    }
}

/// Where a llama.cpp binary came from.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "source", content = "path")]
pub enum LlamaSource {
    /// `$APHRODY_LLAMA_BIN` pointed straight at it.
    Override(PathBuf),
    /// Found in `$APHRODY_LLAMA_DIR`.
    EnvDir(PathBuf),
    /// Found under `~/.aphrody/runtimes/llama-*`.
    Managed(PathBuf),
    /// Found on `PATH`.
    Path(PathBuf),
}

impl LlamaSource {
    /// The resolved executable.
    #[must_use]
    pub fn path(&self) -> &Path {
        match self {
            Self::Override(p) | Self::EnvDir(p) | Self::Managed(p) | Self::Path(p) => p,
        }
    }

    /// Short label for reports.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Override(_) => "APHRODY_LLAMA_BIN",
            Self::EnvDir(_) => "APHRODY_LLAMA_DIR",
            Self::Managed(_) => "managed (~/.aphrody/runtimes)",
            Self::Path(_) => "PATH",
        }
    }
}

/// Locate one llama.cpp tool.
///
/// Returns `None` when llama.cpp is not installed, which is a normal state:
/// the ONNX backend covers OCR on its own, and only the GGUF catalog entries
/// need this.
#[must_use]
pub fn resolve(tool: LlamaTool) -> Option<LlamaSource> {
    // An explicit binary override only answers for the tool it names; pointing
    // `$APHRODY_LLAMA_BIN` at llama-cli must not make llama-server resolve to
    // it, or a server request would silently run the wrong program.
    if let Some(explicit) = non_empty_env("APHRODY_LLAMA_BIN") {
        let path = PathBuf::from(explicit);
        if path.file_stem().is_some_and(|stem| stem == tool.stem()) && path.is_file() {
            return Some(LlamaSource::Override(path));
        }
        // Treat its directory as a search root — a user who set the variable
        // meant "my llama.cpp lives here".
        if let Some(dir) = path.parent()
            && let Some(found) = in_dir(dir, tool)
        {
            return Some(LlamaSource::EnvDir(found));
        }
    }

    if let Some(dir) = non_empty_env("APHRODY_LLAMA_DIR")
        && let Some(found) = in_dir(Path::new(&dir), tool)
    {
        return Some(LlamaSource::EnvDir(found));
    }

    if let Some(found) = find_managed(tool) {
        return Some(LlamaSource::Managed(found));
    }

    which_on_path(&tool.file_name()).map(LlamaSource::Path)
}

/// Which tools are available, for a capability report.
#[must_use]
pub fn available() -> Vec<(LlamaTool, LlamaSource)> {
    LlamaTool::all().iter().filter_map(|tool| resolve(*tool).map(|src| (*tool, src))).collect()
}

fn non_empty_env(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.is_empty())
}

fn in_dir(dir: &Path, tool: LlamaTool) -> Option<PathBuf> {
    let candidate = dir.join(tool.file_name());
    candidate.is_file().then_some(candidate)
}

/// Scan `~/.aphrody/runtimes/llama-*` for a tool, newest directory first.
fn find_managed(tool: LlamaTool) -> Option<PathBuf> {
    find_managed_in(&crate::runtime::runtimes_dir().ok()?, tool)
}

/// The scan against an explicit root, split out so it is testable without
/// writing to the process environment.
#[must_use]
pub fn find_managed_in(root: &Path, tool: LlamaTool) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(core::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path.file_name().is_some_and(|name| name.to_string_lossy().starts_with("llama-"))
        })
        .collect();

    // llama.cpp tags are monotonically increasing build numbers (`b10549`),
    // so reverse lexicographic order puts the newest build first for any two
    // tags of equal width — which they are, in practice, for years at a time.
    candidates.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    candidates
        .into_iter()
        .find_map(|dir| in_dir(&dir, tool).or_else(|| in_dir(&dir.join("bin"), tool)))
}

/// Minimal `which`: walk `PATH` looking for an executable file.
fn which_on_path(file_name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(file_name);
        candidate.is_file().then_some(candidate)
    })
}

// ---------------------------------------------------------------------------
// Shared libraries: what the in-process engine (`aphrody-llama-server`,
// feature `in-process`) loads instead of spawning a binary.
// ---------------------------------------------------------------------------

/// Platform file name of the llama.cpp core shared library.
pub const LIBRARY_NAME: &str = if cfg!(windows) {
    "llama.dll"
} else if cfg!(target_vendor = "apple") {
    "libllama.dylib"
} else {
    "libllama.so"
};

/// Platform file name of the llama.cpp multimodal (mtmd) shared library.
pub const MTMD_LIBRARY_NAME: &str = if cfg!(windows) {
    "mtmd.dll"
} else if cfg!(target_vendor = "apple") {
    "libmtmd.dylib"
} else {
    "libmtmd.so"
};

/// Subdirectories of an install root that may hold the shared libraries, in
/// the order they are tried. Release archives unpack to the root, to `bin/`,
/// to `lib/` or to `build/bin/` depending on the platform and the packager.
const LIBRARY_SUBDIRS: [&str; 4] = ["", "bin", "lib", "build/bin"];

/// Where a llama.cpp library directory came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LibraryOrigin {
    /// `$APHRODY_LLAMA_LIB_DIR`: an explicit directory, asserted by the user.
    LibDirEnv,
    /// `$APHRODY_LLAMA_DIR`: the directory holding the release binaries.
    EnvDir,
    /// The directory of `$APHRODY_LLAMA_BIN`.
    BinEnv,
    /// Found under `~/.aphrody/runtimes/llama-*`.
    Managed,
}

impl LibraryOrigin {
    /// Short label for reports.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::LibDirEnv => "APHRODY_LLAMA_LIB_DIR",
            Self::EnvDir => "APHRODY_LLAMA_DIR",
            Self::BinEnv => "APHRODY_LLAMA_BIN (directory)",
            Self::Managed => "managed (~/.aphrody/runtimes)",
        }
    }
}

/// A directory holding the llama.cpp shared libraries.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LlamaLibrary {
    /// The directory that contains [`LIBRARY_NAME`].
    pub dir: PathBuf,
    /// The llama.cpp build number read from the install's directory name
    /// (`llama-b10903` is build `10903`), when the name carries one. The
    /// in-process engine is compiled against the headers of one specific
    /// build, so this is what decides whether a library is safe to load.
    pub build: Option<u32>,
    /// Whether the multimodal library sits beside the core one.
    pub mtmd: bool,
    /// How it was found.
    pub origin: LibraryOrigin,
}

impl LlamaLibrary {
    /// Path of the core library.
    #[must_use]
    pub fn library_path(&self) -> PathBuf {
        self.dir.join(LIBRARY_NAME)
    }
}

/// The llama.cpp build number in a release directory or archive name.
///
/// Release tags are `b<number>`; installs are unpacked as `llama-b10903` or
/// `llama-b10903-bin-ubuntu-x64`. Returns `None` for a name without a tag
/// segment (`llama-latest`, `bin`, `build`).
#[must_use]
pub fn parse_build(name: &str) -> Option<u32> {
    name.split(['-', '_']).find_map(|segment| {
        let digits = segment.strip_prefix('b')?;
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        digits.parse().ok()
    })
}

/// The build number carried by `dir` or one of its nearest ancestors
/// (`.../llama-b10903/build/bin` still reads `10903`).
fn build_of(dir: &Path) -> Option<u32> {
    dir.ancestors()
        .take(4)
        .filter_map(|ancestor| ancestor.file_name())
        .find_map(|name| parse_build(&name.to_string_lossy()))
}

/// The directory under `root` (or `root` itself) that holds the core library.
fn library_dir_in(root: &Path) -> Option<PathBuf> {
    LIBRARY_SUBDIRS
        .iter()
        .map(|sub| if sub.is_empty() { root.to_path_buf() } else { root.join(sub) })
        .find(|dir| dir.join(LIBRARY_NAME).is_file())
}

/// A [`LlamaLibrary`] for `root`, when it holds the core library.
#[must_use]
pub fn library_in(root: &Path, origin: LibraryOrigin) -> Option<LlamaLibrary> {
    let dir = library_dir_in(root)?;
    Some(LlamaLibrary {
        build: build_of(&dir),
        mtmd: dir.join(MTMD_LIBRARY_NAME).is_file(),
        dir,
        origin,
    })
}

/// Scan `root` (normally `~/.aphrody/runtimes`) for `llama-*` installs that
/// hold the shared libraries, newest build first.
#[must_use]
pub fn find_managed_library_in(root: &Path) -> Option<LlamaLibrary> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(core::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path.file_name().is_some_and(|name| name.to_string_lossy().starts_with("llama-"))
        })
        .collect();
    // Same ordering argument as `find_managed_in`: build numbers only grow.
    candidates.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    candidates.into_iter().find_map(|dir| library_in(&dir, LibraryOrigin::Managed))
}

/// Locate a directory holding the llama.cpp shared libraries.
///
/// Resolution order, first hit wins:
///   1. `$APHRODY_LLAMA_LIB_DIR` — explicit, used as given
///   2. `$APHRODY_LLAMA_DIR`     — the directory of the release binaries
///   3. `$APHRODY_LLAMA_BIN`     — the directory of that executable
///   4. `~/.aphrody/runtimes/llama-*/` — newest build wins
///
/// Returns `None` when no install carries the libraries, which is a normal
/// state: the in-process engine then provisions its own copy, or reports
/// itself unavailable, and the external `llama-server` path keeps working.
#[must_use]
pub fn resolve_library() -> Option<LlamaLibrary> {
    if let Some(dir) = non_empty_env("APHRODY_LLAMA_LIB_DIR")
        && let Some(found) = library_in(Path::new(&dir), LibraryOrigin::LibDirEnv)
    {
        return Some(found);
    }
    if let Some(dir) = non_empty_env("APHRODY_LLAMA_DIR")
        && let Some(found) = library_in(Path::new(&dir), LibraryOrigin::EnvDir)
    {
        return Some(found);
    }
    if let Some(bin) = non_empty_env("APHRODY_LLAMA_BIN")
        && let Some(parent) = Path::new(&bin).parent()
        && let Some(found) = library_in(parent, LibraryOrigin::BinEnv)
    {
        return Some(found);
    }
    find_managed_library_in(&crate::runtime::runtimes_dir().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"stub").unwrap();
    }

    #[test]
    fn tool_file_names_follow_the_platform() {
        if cfg!(windows) {
            assert_eq!(LlamaTool::Server.file_name(), "llama-server.exe");
        } else {
            assert_eq!(LlamaTool::Server.file_name(), "llama-server");
        }
        assert_eq!(LlamaTool::Multimodal.stem(), "llama-mtmd-cli");
        assert_eq!(LlamaTool::Cli.to_string(), "llama-cli");
    }

    #[test]
    fn managed_scan_finds_a_tool_and_prefers_the_newest_build() {
        let dir = tempfile::tempdir().unwrap();
        for build in ["llama-b10000", "llama-b10549"] {
            touch(&dir.path().join(build).join(LlamaTool::Server.file_name()));
        }
        let found = find_managed_in(dir.path(), LlamaTool::Server).unwrap();
        assert!(found.to_string_lossy().contains("b10549"), "{}", found.display());
    }

    #[test]
    fn managed_scan_also_looks_in_a_bin_subdirectory() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("llama-b1").join("bin").join(LlamaTool::Cli.file_name()));
        assert!(find_managed_in(dir.path(), LlamaTool::Cli).is_some());
    }

    #[test]
    fn managed_scan_ignores_unrelated_directories() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("onnxruntime-win-x64-1.29.0").join(LlamaTool::Cli.file_name()));
        assert!(find_managed_in(dir.path(), LlamaTool::Cli).is_none());
    }

    #[test]
    fn a_missing_tool_in_an_existing_install_is_none_not_a_wrong_binary() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("llama-b1").join(LlamaTool::Cli.file_name()));
        // The install exists but has no server binary: resolving the server
        // must NOT hand back llama-cli.
        assert!(find_managed_in(dir.path(), LlamaTool::Server).is_none());
    }

    #[test]
    fn scanning_an_absent_root_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_managed_in(&dir.path().join("nope"), LlamaTool::Cli).is_none());
    }

    #[test]
    fn source_labels_name_their_origin() {
        let managed = LlamaSource::Managed(PathBuf::from("/x/llama-cli"));
        assert!(managed.label().contains("managed"));
        assert_eq!(managed.path(), Path::new("/x/llama-cli"));
        assert_eq!(LlamaSource::Path(PathBuf::from("/usr/bin/llama-cli")).label(), "PATH");
    }

    #[test]
    fn resolution_never_panics_on_this_machine() {
        for tool in LlamaTool::all() {
            if let Some(source) = resolve(*tool) {
                assert!(source.path().is_file(), "{tool} resolved to a non-file");
            }
        }
    }

    #[test]
    fn build_numbers_are_read_from_release_names() {
        assert_eq!(parse_build("llama-b10903"), Some(10903));
        assert_eq!(parse_build("llama-b10903-bin-ubuntu-x64"), Some(10903));
        assert_eq!(parse_build("b1"), Some(1));
        // No tag segment: not a build.
        for name in ["llama-latest", "bin", "build", "llama-b", "llama-bx10", "llama-b10x"] {
            assert_eq!(parse_build(name), None, "{name}");
        }
    }

    #[test]
    fn a_library_directory_is_found_in_the_root_or_its_usual_subdirectories() {
        for sub in ["", "bin", "lib", "build/bin"] {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("llama-b10903");
            touch(&root.join(sub).join(LIBRARY_NAME));
            let found = library_in(&root, LibraryOrigin::Managed).expect(sub);
            assert!(found.dir.ends_with(if sub.is_empty() { "llama-b10903" } else { sub }));
            assert_eq!(found.build, Some(10903), "{sub}: the build is read through ancestors");
            assert!(!found.mtmd, "{sub}: no multimodal library was written");
        }
    }

    #[test]
    fn the_multimodal_library_is_reported_when_present() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join(LIBRARY_NAME));
        touch(&dir.path().join(MTMD_LIBRARY_NAME));
        let found = library_in(dir.path(), LibraryOrigin::LibDirEnv).unwrap();
        assert!(found.mtmd);
        assert_eq!(found.build, None, "a temp directory name carries no build");
        assert_eq!(found.library_path(), dir.path().join(LIBRARY_NAME));
    }

    #[test]
    fn a_binary_only_install_has_no_library() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("llama-b1").join(LlamaTool::Server.file_name()));
        assert!(find_managed_library_in(dir.path()).is_none());
        assert!(library_in(&dir.path().join("llama-b1"), LibraryOrigin::EnvDir).is_none());
    }

    #[test]
    fn the_managed_library_scan_prefers_the_newest_build() {
        let dir = tempfile::tempdir().unwrap();
        for build in ["llama-b10000", "llama-b10903"] {
            touch(&dir.path().join(build).join(LIBRARY_NAME));
        }
        touch(&dir.path().join("onnxruntime-1.29").join(LIBRARY_NAME));
        let found = find_managed_library_in(dir.path()).unwrap();
        assert_eq!(found.build, Some(10903));
        assert_eq!(found.origin, LibraryOrigin::Managed);
        assert!(find_managed_library_in(&dir.path().join("absent")).is_none());
    }

    #[test]
    fn library_resolution_never_panics_on_this_machine() {
        if let Some(found) = resolve_library() {
            assert!(found.library_path().is_file());
        }
    }
}
