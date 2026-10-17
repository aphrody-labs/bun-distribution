// SPDX-License-Identifier: Apache-2.0
//! Resolution of the local kernel endpoint.
//!
//! The kernel server and every client must agree on the endpoint name, so this module is the
//! single owner of the rule: `aphrody_kernel::transport::default_endpoint` delegates here. The
//! rule is a pure function of an injected environment, which keeps every branch testable on any
//! host without mutating the process environment (`std::env::set_var` is `unsafe` in edition
//! 2024).
//!
//! Resolution order:
//!
//! 1. `APHRODY_OS_SOCKET`: an explicit endpoint, used verbatim (an empty value counts as unset).
//! 2. Windows: the named pipe `\\.\pipe\aphrody-os-<user>`.
//! 3. Elsewhere: `$XDG_RUNTIME_DIR/aphrody-os.sock`, else `/tmp/aphrody-os-<user>.sock`.
//!
//! `<user>` is `USERNAME`, else `USER`, else `user`, reduced to ASCII letters, digits, `-` and
//! `_`. The `/tmp` fallback is deliberately fixed: it is short enough for every `sun_path`
//! limit and present on every Unix host; `APHRODY_OS_SOCKET` and `XDG_RUNTIME_DIR` relocate it.

use std::{ffi::OsString, path::Path};

/// Environment lookup injected into [`endpoint_from`]; the process environment is
/// `&|key| std::env::var_os(key)`.
pub type EnvLookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;

/// The environment variable that selects an explicit endpoint.
pub const ENDPOINT_ENV: &str = "APHRODY_OS_SOCKET";

/// The endpoint for `env` on a Windows (`windows == true`) or a Unix-like host.
#[must_use]
pub fn endpoint_from(env: EnvLookup<'_>, windows: bool) -> String {
    if let Some(endpoint) = env(ENDPOINT_ENV).filter(|value| !value.is_empty()) {
        return endpoint.to_string_lossy().into_owned();
    }
    // `std::env::var` semantics: a value that is not valid Unicode counts as absent.
    let text = |key: &str| env(key).and_then(|value| value.into_string().ok());
    let user: String = text("USERNAME")
        .or_else(|| text("USER"))
        .unwrap_or_else(|| "user".into())
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect();
    if windows {
        return format!(r"\\.\pipe\aphrody-os-{user}");
    }
    match env("XDG_RUNTIME_DIR").filter(|directory| !directory.is_empty()) {
        Some(directory) => Path::new(&directory)
            .join("aphrody-os.sock")
            .to_string_lossy()
            .into_owned(),
        None => format!("/tmp/aphrody-os-{user}.sock"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| OsString::from(*value))
        }
    }

    #[test]
    fn an_explicit_endpoint_wins_everywhere() {
        let env = table(&[
            ("APHRODY_OS_SOCKET", "/custom/socket.path"),
            ("XDG_RUNTIME_DIR", "/run/user/1000"),
            ("USER", "someone"),
        ]);
        for windows in [false, true] {
            assert_eq!(endpoint_from(&env, windows), "/custom/socket.path");
        }
        let pipe = table(&[("APHRODY_OS_SOCKET", r"\\.\pipe\custom")]);
        assert_eq!(endpoint_from(&pipe, true), r"\\.\pipe\custom");
    }

    #[test]
    fn an_empty_explicit_endpoint_counts_as_unset() {
        let env = table(&[("APHRODY_OS_SOCKET", ""), ("USER", "someone")]);
        assert_eq!(endpoint_from(&env, false), "/tmp/aphrody-os-someone.sock");
    }

    #[test]
    fn windows_uses_a_per_user_named_pipe() {
        let env = table(&[
            ("USERNAME", "Some One"),
            ("USER", "ignored"),
            ("XDG_RUNTIME_DIR", "/x"),
        ]);
        // The user name keeps only ASCII letters, digits, `-` and `_`.
        assert_eq!(endpoint_from(&env, true), r"\\.\pipe\aphrody-os-SomeOne");
        let user_only = table(&[("USER", "someone")]);
        assert_eq!(
            endpoint_from(&user_only, true),
            r"\\.\pipe\aphrody-os-someone"
        );
    }

    #[test]
    fn unix_prefers_the_runtime_directory() {
        let env = table(&[("XDG_RUNTIME_DIR", "/run/user/1000"), ("USER", "someone")]);
        let expected = Path::new("/run/user/1000").join("aphrody-os.sock");
        assert_eq!(endpoint_from(&env, false), expected.to_string_lossy());
    }

    #[test]
    fn unix_falls_back_to_a_per_user_name_in_tmp() {
        for runtime_dir in [None, Some("")] {
            let pairs: Vec<(&str, &str)> = runtime_dir
                .map(|dir| ("XDG_RUNTIME_DIR", dir))
                .into_iter()
                .chain([("USER", "some-one_1")])
                .collect();
            assert_eq!(
                endpoint_from(&table(&pairs), false),
                "/tmp/aphrody-os-some-one_1.sock"
            );
        }
    }

    #[test]
    fn the_user_name_defaults_and_is_sanitised() {
        let none = table(&[]);
        assert_eq!(endpoint_from(&none, false), "/tmp/aphrody-os-user.sock");
        assert_eq!(endpoint_from(&none, true), r"\\.\pipe\aphrody-os-user");
        // Path separators and dots cannot escape the socket directory or the pipe namespace.
        let hostile = table(&[("USER", "../../etc/pass wd")]);
        assert_eq!(
            endpoint_from(&hostile, false),
            "/tmp/aphrody-os-etcpasswd.sock"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_user_name_that_is_not_unicode_counts_as_absent() {
        use std::{ffi::OsStr, os::unix::ffi::OsStrExt};

        let invalid = OsStr::from_bytes(b"bad\xffname");
        let env = move |key: &str| match key {
            "USERNAME" => Some(invalid.to_os_string()),
            "USER" => Some(OsString::from("fallback")),
            _ => None,
        };
        assert_eq!(endpoint_from(&env, false), "/tmp/aphrody-os-fallback.sock");
    }
}
