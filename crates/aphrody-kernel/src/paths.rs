// SPDX-License-Identifier: Apache-2.0
//! Portable location rules for the kernel.
//!
//! The kernel ships outside the Aphrody checkout: an agent plugin starts it in any project, on
//! Windows, Linux or WSL. It therefore never assumes the repository, a fixed home layout or a
//! user name. Every rule that locates something on disk is a pure function of an injected
//! `EnvLookup`, so tests pass a fixed table instead of mutating the process environment
//! (`std::env::set_var` is `unsafe` in edition 2024) and one host can exercise the Windows and
//! the Unix branches alike.
//!
//! The vocabulary is the repository-wide one. An empty variable counts as unset (a shell leaves
//! `export NAME=` behind). `APHRODY_HOME` names the Aphrody state directory itself, never the
//! user's home. `aphrody_models::paths` is the authority for that layout; this crate cannot
//! depend on it without inverting the os -> ai layering, so only what the kernel needs is
//! restated here.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

/// Environment lookup injected into the pure resolvers; [`process_env`] is the real one.
pub(crate) type EnvLookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;

/// The process environment, unfiltered: an empty value is returned as such.
pub(crate) fn process_env(key: &str) -> Option<OsString> {
    std::env::var_os(key)
}

/// A variable that is set and not empty.
pub(crate) fn var(env: EnvLookup<'_>, key: &str) -> Option<OsString> {
    env(key).filter(|value| !value.is_empty())
}

/// The home directory from the environment alone.
///
/// `USERPROFILE` is read on Windows only, so a Windows profile leaked into a WSL shell (through
/// `WSLENV`) is never mistaken for a Linux path. `HOME` follows on every platform, which also
/// covers MSYS and Git Bash shells on Windows.
pub(crate) fn home_dir_from(env: EnvLookup<'_>, windows: bool) -> Option<PathBuf> {
    let profile = if windows {
        var(env, "USERPROFILE")
    } else {
        None
    };
    profile.or_else(|| var(env, "HOME")).map(PathBuf::from)
}

/// The user's home directory: the environment first, then the platform account database
/// (`getpwuid_r` on Unix, `GetUserProfileDirectory` on Windows) for a service started without a
/// home variable.
pub(crate) fn home_dir() -> Option<PathBuf> {
    home_dir_from(&process_env, cfg!(windows)).or_else(std::env::home_dir)
}

/// Directories searched for an installed provider binary, first match wins:
///
/// 1. every `PATH` entry, as given;
/// 2. the directory of the running kernel;
/// 3. `<home>/.local/bin`, `$CARGO_HOME/bin` when set, then `<home>/.cargo/bin`;
/// 4. `$APHRODY_HOME/bin` when set (the install directory of the Aphrody release tooling).
///
/// An explicit relocation (`CARGO_HOME`, `APHRODY_HOME`) is searched in addition to the default
/// layout, never instead of it, so a machine that resolved a binary before resolves the same one.
pub(crate) fn binary_search_directories(
    env: EnvLookup<'_>,
    kernel_directory: Option<&Path>,
    home: Option<&Path>,
) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(path) = env("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories.extend(kernel_directory.map(Path::to_path_buf));
    if let Some(home) = home {
        directories.push(home.join(".local").join("bin"));
    }
    directories.extend(var(env, "CARGO_HOME").map(|cargo| PathBuf::from(cargo).join("bin")));
    if let Some(home) = home {
        directories.push(home.join(".cargo").join("bin"));
    }
    directories.extend(var(env, "APHRODY_HOME").map(|state| PathBuf::from(state).join("bin")));
    directories
}

/// An environment lookup that owns its table (see [`table`]).
#[cfg(test)]
pub(crate) type OwnedLookup = Box<dyn Fn(&str) -> Option<OsString>>;

/// A fixed environment table for tests: nothing reads the process environment.
///
/// The result owns its data and borrows nothing from `pairs`, so a test can build it from
/// temporaries (a boxed trait object, because an `impl Fn` return would capture the lifetimes of
/// `K` and `V` and keep those temporaries borrowed).
#[cfg(test)]
pub(crate) fn table<K, V>(pairs: impl IntoIterator<Item = (K, V)>) -> OwnedLookup
where
    K: AsRef<str>,
    V: AsRef<std::ffi::OsStr>,
{
    let map: std::collections::HashMap<String, OsString> = pairs
        .into_iter()
        .map(|(key, value)| (key.as_ref().to_owned(), value.as_ref().to_owned()))
        .collect();
    Box::new(move |key| map.get(key).cloned())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;

    #[test]
    fn empty_values_count_as_unset() {
        let env = table([("A", ""), ("B", "x")]);
        assert_eq!(var(&env, "A"), None);
        assert_eq!(var(&env, "B"), Some(OsString::from("x")));
        assert_eq!(var(&env, "MISSING"), None);
        // The raw lookup keeps the empty value; only `var` applies the rule.
        assert_eq!(env("A"), Some(OsString::new()));
    }

    #[test]
    fn home_reads_userprofile_only_on_windows() {
        let both = table([
            ("USERPROFILE", r"C:\Users\someone"),
            ("HOME", "/home/someone"),
        ]);
        assert_eq!(
            home_dir_from(&both, true),
            Some(PathBuf::from(r"C:\Users\someone"))
        );
        assert_eq!(
            home_dir_from(&both, false),
            Some(PathBuf::from("/home/someone"))
        );

        // A Windows profile leaked into a Linux/WSL environment is never a Linux home.
        let leaked = table([("USERPROFILE", r"C:\Users\someone")]);
        assert_eq!(home_dir_from(&leaked, false), None);
        assert_eq!(
            home_dir_from(&leaked, true),
            Some(PathBuf::from(r"C:\Users\someone"))
        );
    }

    #[test]
    fn windows_without_a_profile_falls_back_to_home() {
        let msys = table([("HOME", "/c/Users/someone")]);
        assert_eq!(
            home_dir_from(&msys, true),
            Some(PathBuf::from("/c/Users/someone"))
        );
        let empty = table([("USERPROFILE", ""), ("HOME", "")]);
        assert_eq!(home_dir_from(&empty, true), None);
        assert_eq!(home_dir_from(&empty, false), None);
    }

    fn path_of(directories: &[&Path]) -> OsString {
        std::env::join_paths(directories).expect("joinable PATH entries")
    }

    #[test]
    fn nothing_configured_keeps_the_default_search_order() {
        let path = path_of(&[Path::new("/bin-a"), Path::new("/bin-b")]);
        let env = table([("PATH", path.as_os_str())]);
        let directories =
            binary_search_directories(&env, Some(Path::new("/opt/kernel")), Some(Path::new("/h")));
        assert_eq!(
            directories,
            [
                PathBuf::from("/bin-a"),
                PathBuf::from("/bin-b"),
                PathBuf::from("/opt/kernel"),
                Path::new("/h").join(".local").join("bin"),
                Path::new("/h").join(".cargo").join("bin"),
            ]
        );
    }

    #[test]
    fn explicit_relocations_extend_the_search_without_displacing_defaults() {
        let env = table([
            ("CARGO_HOME", OsStr::new("/cargo")),
            ("APHRODY_HOME", OsStr::new("/state")),
            ("PATH", OsStr::new("")),
        ]);
        let directories = binary_search_directories(&env, None, Some(Path::new("/h")));
        // An empty PATH is split like the platform does (one empty entry), exactly as before.
        let relocated: Vec<_> = directories
            .iter()
            .skip_while(|path| path.as_os_str().is_empty())
            .collect();
        assert_eq!(
            relocated,
            [
                &Path::new("/h").join(".local").join("bin"),
                &Path::new("/cargo").join("bin"),
                &Path::new("/h").join(".cargo").join("bin"),
                &Path::new("/state").join("bin"),
            ]
        );
    }

    #[test]
    fn empty_relocations_and_missing_home_are_ignored() {
        let env = table([("CARGO_HOME", ""), ("APHRODY_HOME", "")]);
        assert!(binary_search_directories(&env, None, None).is_empty());
        let kernel_only = binary_search_directories(&env, Some(Path::new("/opt/kernel")), None);
        assert_eq!(kernel_only, [PathBuf::from("/opt/kernel")]);
    }
}
