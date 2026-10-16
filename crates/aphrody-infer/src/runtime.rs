// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Locating the ONNX Runtime shared library.
//
// aphrody deliberately does NOT let `ort` download its own runtime
// (`download-binaries` is off in the workspace manifest): that feature fetches
// a CPU-only build over native-tls, and this project is rustls-only and wants
// the CUDA build. Instead the runtime is installed once under
// `~/.aphrody/runtimes/` and discovered here.
//
// Why `load-dynamic` at all: aphrody forces `+crt-static` on MSVC while every
// prebuilt ONNX Runtime is `/MD`. Statically linking the two is irreconcilable
// (CLAUDE.md §7), so the library is loaded at runtime through `libloading`,
// which also makes the CUDA build swappable without a rebuild.
//
// Resolution order:
//   1. $APHRODY_ORT_DYLIB        — explicit override, used verbatim
//   2. $ORT_DYLIB_PATH           — the variable `ort` itself documents
//   3. a system package (/usr/lib, /usr/local/lib; Bun OS: extra/onnxruntime-cpu)
//   4. ~/.aphrody/runtimes/onnxruntime-*/lib/<dylib>  — newest match wins
//   5. the loader's own search path (system install)

use std::path::{Path, PathBuf};

use crate::error::{InferError, Result};

/// Platform file name of the ONNX Runtime shared library.
pub const DYLIB_NAME: &str = if cfg!(windows) {
    "onnxruntime.dll"
} else if cfg!(target_vendor = "apple") {
    "libonnxruntime.dylib"
} else {
    "libonnxruntime.so"
};

/// Where a runtime was found, so a report can explain the choice.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case", tag = "source", content = "path")]
pub enum RuntimeSource {
    /// `$APHRODY_ORT_DYLIB`.
    Override(PathBuf),
    /// `$ORT_DYLIB_PATH`.
    OrtEnv(PathBuf),
    /// Installed by the distribution in a system library directory.
    System(PathBuf),
    /// Installed under `~/.aphrody/runtimes`.
    Managed(PathBuf),
    /// Left to the platform loader; no explicit path.
    SystemSearchPath,
}

impl RuntimeSource {
    /// The resolved path, when the choice names one.
    #[must_use]
    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::Override(p) | Self::OrtEnv(p) | Self::System(p) | Self::Managed(p) => Some(p),
            Self::SystemSearchPath => None,
        }
    }

    /// Short label for reports.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Override(_) => "APHRODY_ORT_DYLIB",
            Self::OrtEnv(_) => "ORT_DYLIB_PATH",
            Self::System(_) => "system package",
            Self::Managed(_) => "managed (~/.aphrody/runtimes)",
            Self::SystemSearchPath => "system search path",
        }
    }
}

/// Root of the managed runtime directory: `~/.aphrody/runtimes`.
///
/// # Errors
///
/// [`InferError::NoStateDir`] when no home directory can be resolved.
pub fn runtimes_dir() -> Result<PathBuf> {
    // Delegates to `aphrody_models::paths`, the single authority for the
    // on-disk layout. This function used to carry its own copy of the
    // resolution chain; `aphrody-voice` carried a third one that consulted
    // `HOME` before `USERPROFILE`, so under Git Bash on Windows the two
    // crates looked for runtimes in different trees.
    #[cfg(not(target_arch = "wasm32"))]
    {
        aphrody_models::paths::runtimes_dir().map_err(|_| InferError::NoStateDir)
    }
    // A browser has no state directory: `aphrody_models::paths` is host-only.
    #[cfg(target_arch = "wasm32")]
    {
        Err(InferError::NoStateDir)
    }
}

/// Locate the ONNX Runtime shared library.
///
/// Never fails: falling through to [`RuntimeSource::SystemSearchPath`] is a
/// legitimate answer on a machine with a system-wide install, and letting the
/// loader try is more useful than refusing up front.
#[must_use]
pub fn discover() -> RuntimeSource {
    for (var, wrap) in [
        ("APHRODY_ORT_DYLIB", RuntimeSource::Override as fn(PathBuf) -> RuntimeSource),
        ("ORT_DYLIB_PATH", RuntimeSource::OrtEnv as fn(PathBuf) -> RuntimeSource),
    ] {
        if let Ok(raw) = std::env::var(var)
            && !raw.is_empty()
        {
            return wrap(PathBuf::from(raw));
        }
    }

    if let Some(found) = crate::llama::SYSTEM_LIB_DIRS
        .iter()
        .map(|dir| Path::new(dir).join(DYLIB_NAME))
        .find(|path| path.is_file())
    {
        return RuntimeSource::System(found);
    }

    if let Some(found) = find_managed() {
        return RuntimeSource::Managed(found);
    }

    RuntimeSource::SystemSearchPath
}

/// Scan `~/.aphrody/runtimes/*/lib/<dylib>` and pick the best candidate.
///
/// Directory names carry the flavour and version
/// (`onnxruntime-win-x64-gpu_cuda13-1.29.0`), and a GPU build is preferred
/// over a CPU one because a CPU-only library silently makes every CUDA request
/// fall back — the exact failure this whole module exists to avoid. Ties break
/// on the directory name in reverse order, which puts the highest version
/// first for the `name-X.Y.Z` convention upstream uses.
fn find_managed() -> Option<PathBuf> {
    find_managed_in(&runtimes_dir().ok()?)
}

/// The scan itself, against an explicit root.
///
/// Split out from [`find_managed`] so it is testable without writing to the
/// process environment — `set_var` is `unsafe` since edition 2024, and this
/// crate forbids `unsafe`.
#[must_use]
pub fn find_managed_in(root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(core::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();

    candidates.sort_by_key(|path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        // `false` sorts first, so negate the GPU test to rank GPU builds ahead.
        (!is_gpu_build(&name), core::cmp::Reverse(name))
    });

    candidates.into_iter().find_map(|dir| {
        let lib = dir.join("lib").join(DYLIB_NAME);
        if lib.is_file() {
            return Some(lib);
        }
        // Some distributions drop the library at the top level.
        let flat = dir.join(DYLIB_NAME);
        flat.is_file().then_some(flat)
    })
}

/// Whether a runtime directory name denotes a GPU-capable build.
#[must_use]
pub fn is_gpu_build(dir_name: &str) -> bool {
    let lower = dir_name.to_ascii_lowercase();
    lower.contains("gpu") || lower.contains("cuda") || lower.contains("tensorrt")
}

/// CUDA major version encoded in a runtime directory name
/// (`onnxruntime-win-x64-gpu_cuda13-1.29.0` is 13). `None` when the name
/// carries no version, as in the older `...-cuda-1.22.0` builds.
#[must_use]
pub fn cuda_major(dir_name: &str) -> Option<u32> {
    let lower = dir_name.to_ascii_lowercase();
    let rest = &lower[lower.find("cuda")? + "cuda".len()..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Windows file names of the CUDA libraries the ONNX Runtime CUDA provider of
/// `major` imports. The CUDA 13 build imports cuBLAS and cuBLASLt but not
/// cuDNN (checked with `llvm-readobj --coff-imports`), plus the CUDA runtime.
#[must_use]
pub fn cuda_library_names(major: u32) -> [String; 3] {
    [
        format!("cublas64_{major}.dll"),
        format!("cublasLt64_{major}.dll"),
        format!("cudart64_{major}.dll"),
    ]
}

/// Directories that may hold the CUDA libraries, most authoritative first: the
/// toolkit named by `CUDA_PATH` (`bin/x64` since 13.x, `bin` before), then
/// every runtime under `runtimes_root` (llama.cpp CUDA builds ship them flat),
/// then redistributable archives unpacked under `runtimes_root/cache`.
#[must_use]
pub fn cuda_library_sources(runtimes_root: &Path) -> Vec<PathBuf> {
    fn child_dirs(root: &Path) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)
            .map(|entries| {
                entries
                    .filter_map(core::result::Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| path.is_dir())
                    .collect()
            })
            .unwrap_or_default();
        dirs.sort();
        dirs
    }

    let mut sources = Vec::new();
    if let Some(toolkit) = std::env::var_os("CUDA_PATH").map(PathBuf::from) {
        sources.push(toolkit.join("bin").join("x64"));
        sources.push(toolkit.join("bin"));
    }
    sources.extend(child_dirs(runtimes_root));
    for cached in child_dirs(&runtimes_root.join("cache")) {
        for archive in child_dirs(&cached) {
            sources.push(archive.join("bin").join("x64"));
            sources.push(archive.join("bin"));
        }
    }
    sources
}

/// Make the CUDA libraries a CUDA build of ONNX Runtime imports resolvable from
/// its own directory.
///
/// ONNX Runtime loads its CUDA provider by full path, and Windows resolves that
/// provider's imports from the provider's directory before `PATH`. Without the
/// toolkit on `PATH` (or once it is uninstalled) the provider fails to load and
/// every CUDA request ends on the CPU. Each missing library is hard-linked, or
/// copied across volumes, from the first directory in `sources` holding it.
/// Returns the libraries placed; libraries already present are left alone.
pub fn colocate_cuda_libraries(
    ort_lib_dir: &Path,
    major: u32,
    sources: &[PathBuf],
) -> Vec<PathBuf> {
    let mut placed = Vec::new();
    for name in cuda_library_names(major) {
        let target = ort_lib_dir.join(&name);
        if target.is_file() {
            continue;
        }
        let Some(source) = sources.iter().map(|dir| dir.join(&name)).find(|path| path.is_file())
        else {
            tracing::debug!(library = %name, "CUDA library not found in any known location");
            continue;
        };
        let outcome = std::fs::hard_link(&source, &target)
            .or_else(|_| std::fs::copy(&source, &target).map(drop));
        match outcome {
            Ok(()) => {
                tracing::info!(
                    library = %name,
                    from = %source.display(),
                    "CUDA library placed beside ONNX Runtime"
                );
                placed.push(target);
            },
            Err(error) => {
                tracing::warn!(library = %name, %error, "could not place CUDA library beside ONNX Runtime");
            },
        }
    }
    placed
}

/// [`colocate_cuda_libraries`] for a discovered runtime library. A no-op off
/// Windows and for runtimes whose directory names no CUDA major version.
pub fn prepare_cuda(dylib: &Path) -> Vec<PathBuf> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let Some(lib_dir) = dylib.parent() else {
        return Vec::new();
    };
    let major = lib_dir
        .ancestors()
        .take(2)
        .filter_map(Path::file_name)
        .find_map(|name| cuda_major(&name.to_string_lossy()));
    let (Some(major), Ok(root)) = (major, runtimes_dir()) else {
        return Vec::new();
    };
    colocate_cuda_libraries(lib_dir, major, &cuda_library_sources(&root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dylib_name_matches_the_platform() {
        if cfg!(windows) {
            assert_eq!(DYLIB_NAME, "onnxruntime.dll");
        } else if cfg!(target_vendor = "apple") {
            assert_eq!(DYLIB_NAME, "libonnxruntime.dylib");
        } else {
            assert_eq!(DYLIB_NAME, "libonnxruntime.so");
        }
    }

    #[test]
    fn cuda_major_is_read_from_the_runtime_directory_name() {
        assert_eq!(cuda_major("onnxruntime-win-x64-gpu_cuda13-1.29.0"), Some(13));
        assert_eq!(cuda_major("onnxruntime-win-x64-gpu_CUDA12-1.22.0"), Some(12));
        assert_eq!(cuda_major("onnxruntime-linux-x64-cuda-1.22.0"), None);
        assert_eq!(cuda_major("onnxruntime-win-x64-1.29.0"), None);
    }

    #[test]
    fn missing_cuda_libraries_are_placed_beside_the_runtime_once() {
        let dir = tempfile::tempdir().unwrap();
        let ort_lib = dir.path().join("onnxruntime-win-x64-gpu_cuda13-1.29.0").join("lib");
        let empty = dir.path().join("empty");
        let llama = dir.path().join("llama-b1");
        for path in [&ort_lib, &empty, &llama] {
            std::fs::create_dir_all(path).unwrap();
        }
        for name in cuda_library_names(13) {
            std::fs::write(llama.join(&name), name.as_bytes()).unwrap();
        }
        std::fs::write(ort_lib.join("cudart64_13.dll"), b"already here").unwrap();

        let sources = [empty, llama];
        let placed = colocate_cuda_libraries(&ort_lib, 13, &sources);
        assert_eq!(placed.len(), 2, "{placed:?}");
        assert_eq!(std::fs::read(ort_lib.join("cublas64_13.dll")).unwrap(), b"cublas64_13.dll");
        assert_eq!(std::fs::read(ort_lib.join("cudart64_13.dll")).unwrap(), b"already here");
        assert!(colocate_cuda_libraries(&ort_lib, 13, &sources).is_empty());
    }

    #[test]
    fn cuda_sources_cover_flat_runtimes_and_cached_archives() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("llama-b1")).unwrap();
        std::fs::create_dir_all(dir.path().join("cache/cuda-13/libcublas-archive/bin/x64"))
            .unwrap();
        let sources = cuda_library_sources(dir.path());
        assert!(sources.contains(&dir.path().join("llama-b1")));
        assert!(sources.contains(&dir.path().join("cache/cuda-13/libcublas-archive/bin/x64")));
    }

    #[test]
    fn gpu_builds_are_recognised_by_directory_name() {
        assert!(is_gpu_build("onnxruntime-win-x64-gpu_cuda13-1.29.0"));
        assert!(is_gpu_build("onnxruntime-linux-x64-cuda-1.22.0"));
        assert!(is_gpu_build("onnxruntime-win-x64-TensorRT-1.20.0"));
        assert!(!is_gpu_build("onnxruntime-win-x64-1.29.0"));
        assert!(!is_gpu_build("onnxruntime-linux-aarch64-1.22.0"));
    }

    #[test]
    fn source_labels_and_paths_line_up() {
        let managed = RuntimeSource::Managed(PathBuf::from("/opt/ort/lib/libonnxruntime.so"));
        assert_eq!(managed.path(), Some(Path::new("/opt/ort/lib/libonnxruntime.so")));
        assert!(managed.label().contains("managed"));
        assert_eq!(RuntimeSource::SystemSearchPath.path(), None);
        assert_eq!(RuntimeSource::SystemSearchPath.label(), "system search path");
    }

    #[test]
    fn discovery_never_panics_and_always_answers() {
        // Whatever this machine holds, discovery must produce a usable answer
        // rather than an error: the loader gets the last word.
        let source = discover();
        if let Some(path) = source.path() {
            assert!(!path.as_os_str().is_empty());
        }
    }

    #[test]
    fn managed_scan_prefers_a_gpu_build_over_a_cpu_one() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["onnxruntime-win-x64-1.29.0", "onnxruntime-win-x64-gpu_cuda13-1.29.0"] {
            let lib = dir.path().join(name).join("lib");
            std::fs::create_dir_all(&lib).unwrap();
            std::fs::write(lib.join(DYLIB_NAME), b"stub").unwrap();
        }

        let found = find_managed_in(dir.path()).expect("a runtime should be found");
        assert!(
            is_gpu_build(&found.to_string_lossy()),
            "picked the CPU build over the GPU one: {}",
            found.display()
        );
    }

    #[test]
    fn managed_scan_picks_the_highest_version_among_equals() {
        let dir = tempfile::tempdir().unwrap();
        for name in
            ["onnxruntime-win-x64-gpu_cuda13-1.27.1", "onnxruntime-win-x64-gpu_cuda13-1.29.0"]
        {
            let lib = dir.path().join(name).join("lib");
            std::fs::create_dir_all(&lib).unwrap();
            std::fs::write(lib.join(DYLIB_NAME), b"stub").unwrap();
        }

        let found = find_managed_in(dir.path()).unwrap();
        assert!(found.to_string_lossy().contains("1.29.0"), "{}", found.display());
    }

    #[test]
    fn a_library_at_the_top_level_is_accepted_too() {
        let dir = tempfile::tempdir().unwrap();
        let flat = dir.path().join("onnxruntime-flat-1.29.0");
        std::fs::create_dir_all(&flat).unwrap();
        std::fs::write(flat.join(DYLIB_NAME), b"stub").unwrap();
        assert_eq!(find_managed_in(dir.path()), Some(flat.join(DYLIB_NAME)));
    }

    #[test]
    fn managed_scan_returns_none_when_nothing_is_installed() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_managed_in(dir.path()).is_none());
        // A directory that does not exist is the same answer, not a panic.
        assert!(find_managed_in(&dir.path().join("absent")).is_none());
    }
}
