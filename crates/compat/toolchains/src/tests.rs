// SPDX-License-Identifier: Apache-2.0
use std::{ffi::OsString, fs, path::Path};

use crate::{BinarySource, Pin, ResolveError, Toolchain, discover::discover, parse_version};

fn write(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("mkdir");
    }
    fs::write(path, text).expect("write");
}

fn fake_exe(dir: &Path, name: &str) -> std::path::PathBuf {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() };
    let path = dir.join(file);
    write(&path, "");
    path
}

#[test]
fn names_and_env_are_stable() {
    assert_eq!(Toolchain::Bun.executable_name(), "bun");
    assert_eq!(Toolchain::Uv.executable_name(), "uv");
    assert_eq!(Toolchain::Nu.executable_name(), "nu");
    assert_eq!(Toolchain::Nu.executable_env(), "APHRODY_NU_BIN");
    assert_eq!(Toolchain::from_name("Nushell"), Some(Toolchain::Nu));
    assert_eq!(Toolchain::from_name("node"), None);
    assert!(Toolchain::Bun.source_root().is_some_and(|p| p.ends_with("third_party/bun")));
    assert_eq!(Toolchain::Nu.source_root(), None);
}

#[test]
fn parses_version_output_of_each_tool() {
    assert_eq!(parse_version(Toolchain::Bun, "1.4.2\n").as_deref(), Some("1.4.2"));
    assert_eq!(
        parse_version(Toolchain::Uv, "uv 0.12.17 (abc123 2026-09-01)\n").as_deref(),
        Some("0.12.17")
    );
    assert_eq!(parse_version(Toolchain::Nu, "0.115.1\n").as_deref(), Some("0.115.1"));
    assert_eq!(parse_version(Toolchain::Bun, "error: nope"), None);
}

#[test]
fn pin_matching_rules() {
    let pin = |v: &str| Pin { version: v.to_owned(), source: "x".into() };
    assert!(pin("1.4.2").matches("1.4.2"));
    assert!(pin("1.4").matches("1.4.9"));
    assert!(pin("==0.12.17").matches("0.12.17"));
    assert!(!pin("1.4.2").matches("1.4.3"));
    assert!(!pin("1.4.2").matches("1.4"));
    assert!(pin(">=0.12").matches("0.12.17"));
    assert!(pin(">=0.12.17").matches("1.0.0"));
    assert!(!pin(">=0.13").matches("0.12.17"));
    assert!(pin("latest").matches("9.9.9"));
    assert!(pin("1.4.2").matches("1.4.2-canary.1"));
}

#[test]
fn nearest_pin_wins_and_dedicated_files_take_precedence() {
    let root = tempfile::tempdir().expect("tempdir");
    write(
        &root.path().join("mise.toml"),
        "[tools]\nbun = \"1.0.0\"\nuv = \"0.11.0\"\nnushell = \"0.115.1\"\n",
    );
    write(&root.path().join("package.json"), r#"{"packageManager":"bun@1.4.2+sha512.abc"}"#);
    let child = root.path().join("apps/site");
    write(&child.join("pyproject.toml"), "[tool.uv]\nrequired-version = \">=0.12\"\n");
    write(&child.join("README.md"), "no pins here");

    let bun = Toolchain::Bun.pinned_version(&child).expect("bun").expect("pinned");
    assert_eq!(bun.version, "1.4.2");
    assert!(bun.source.ends_with("package.json"));

    let uv = Toolchain::Uv.pinned_version(&child).expect("uv").expect("pinned");
    assert_eq!(uv.version, ">=0.12");
    assert!(uv.source.ends_with("pyproject.toml"));

    // The root mise.toml applies where no closer file pins uv.
    let uv_root = Toolchain::Uv.pinned_version(root.path()).expect("uv").expect("pinned");
    assert_eq!(uv_root.version, "0.11.0");

    let nu = Toolchain::Nu.pinned_version(&child).expect("nu").expect("pinned");
    assert_eq!(nu.version, "0.115.1");

    write(&child.join(".bun-version"), "# comment\n1.3.0\n");
    let bun = Toolchain::Bun.pinned_version(&child).expect("bun").expect("pinned");
    assert_eq!(bun.version, "1.3.0");
}

#[test]
fn malformed_pin_file_is_reported() {
    let root = tempfile::tempdir().expect("tempdir");
    write(&root.path().join("uv.toml"), "required-version = ");
    let err = Toolchain::Uv.pinned_version(root.path()).expect_err("parse error");
    assert!(matches!(err, ResolveError::PinFile { .. }));
}

#[test]
fn discovery_order_override_then_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let on_path = fake_exe(&dir.path().join("path"), "nu");
    let pinned = fake_exe(&dir.path().join("override"), "nu");
    let path_var =
        std::env::join_paths([dir.path().join("empty"), dir.path().join("path")]).expect("join");

    let found = discover(Toolchain::Nu, None, Some(path_var.clone())).expect("path");
    assert_eq!((found.path, found.source), (on_path, BinarySource::Path));

    let found = discover(Toolchain::Nu, Some(pinned.clone().into()), Some(path_var.clone()))
        .expect("override");
    assert_eq!((found.path, found.source), (pinned, BinarySource::Override));

    let missing: OsString = dir.path().join("missing").into();
    assert!(matches!(
        discover(Toolchain::Nu, Some(missing), Some(path_var)),
        Err(ResolveError::BadOverride { .. })
    ));
}

/// End-to-end against the machine's real toolchains; skipped when absent.
#[test]
fn resolves_installed_toolchains_when_present() {
    let here = Path::new(env!("CARGO_MANIFEST_DIR"));
    for tool in Toolchain::ALL {
        let Ok(runtime) = tool.resolve_unchecked(here) else { continue };
        assert!(runtime.path().is_file());
        assert!(runtime.version().chars().next().is_some_and(|c| c.is_ascii_digit()));
        let output = runtime.command(["--version"]).output().expect("launch");
        assert!(output.status.success());
        assert!(runtime.env().iter().any(|(k, _)| k == tool.executable_env()));
    }
}
