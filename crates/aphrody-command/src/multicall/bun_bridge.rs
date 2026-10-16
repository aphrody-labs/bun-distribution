// SPDX-License-Identifier: Apache-2.0
//! Aphrody commands whose owners are Bun packages, served by the single `aphrody` binary.
//!
//! The former `yolo` Bun CLI (`packages/engine/yolo/src/index.ts`) dispatches the commands owned by
//! TypeScript packages that depend on Bun itself (`Bun.serve`, in-process package runners, m3, forge,
//! the build factory). `aphrody <name> …` runs `bun <dispatcher> <command> …` from the checkout, so
//! there is one command line while the owners keep their code. Commands with a Rust owner never come
//! here. Generic devtools reuse the existing Bun fork owners; Workspace retains verification.

use aphrody_proc::NoWindow as _;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

/// Dispatcher of the Bun-owned commands, relative to the checkout root.
pub(crate) const DISPATCHER: &str = "packages/engine/yolo/src/index.ts";

/// `aphrody <name>` → `bun <dispatcher> <command>`.
pub(crate) const ROUTES: &[(&str, &str)] = &[
    // Monorepo state and generated catalogs (Bun.TOML, Bun.Glob over vendor/).
    ("status", "status"),
    ("generate", "generate"),
    // Existing devtools and repository gate owners, including the pre-activation fork bridge.
    ("rename", "rename"),
    ("parse", "parse"),
    ("bench", "bench"),
    ("verify", "verify"),
    // Desktop frontend (m3/packages/app-ui, embedded by crates/ui/app) and the desktop runtime release.
    ("desktop", "desktop"),
    ("desktop-runtime", "desktop-runtime"),
    // Release artifacts of the aphrody_ffi library (former `yolo runtime`: install, list, rollback,
    // verify, info). `aphrody runtime` stays the uv/Python runtime.
    ("ffi", "runtime"),
    ("import", "import"),
    ("plugin", "plugin"),
    // Python tooling through the verified vu artifact.
    ("py", "py"),
    ("python", "python"),
    ("uv", "uv"),
    ("ruff", "ruff"),
    ("vu", "vu"),
    // Build factory and its git hooks.
    ("ship", "ship"),
    ("hooks", "hooks"),
    // Workspace owners (packages/infra/workspace, packages/infra/update).
    ("ops", "ops"),
    ("workspace", "workspace"),
    ("optimize", "optimize"),
    ("update", "update"),
    // Document AI (packages/ai/doc-ai); canonical name `aphrody ai doc-ai` once wired in ai_cmd.
    ("doc-ai", "doc-ai"),
    ("browser", "browser"),
    ("forge", "forge"),
    ("m3", "m3"),
    ("host", "host"),
    // Local HTTP/OpenAPI server and the yolo_* tool host (Bun.serve).
    ("api", "api"),
    ("serve", "serve"),
    ("tool", "tool"),
];

/// Former top-level names kept with a deprecation note on stderr: (name, replacement).
const DEPRECATED: &[(&str, &str)] =
    &[("doc-ai", "aphrody ai doc-ai"), ("python", "aphrody py"), ("serve", "aphrody api")];

/// Multi-call entry: `args[0]` is the route name (the tool has no former binary name).
pub(crate) fn entry(args: Vec<OsString>) -> i32 {
    let mut args = args.into_iter();
    let name = args.next().and_then(|name| name.into_string().ok()).unwrap_or_default();
    let Some(&(_, command)) = ROUTES.iter().find(|(route, _)| *route == name) else {
        eprintln!("aphrody: `{name}` is not a Bun-owned command");
        return 2;
    };
    if let Some((_, replacement)) = DEPRECATED.iter().find(|(old, _)| *old == name) {
        eprintln!("aphrody: `aphrody {name}` is deprecated, use `{replacement}`");
    }
    dispatch(command, args)
}

/// `aphrody google drive|fonts …`: the Google commands owned by packages/google/google (Drive
/// projection, Fonts proxy). The rest of `aphrody google` is the Rust Gemini runtime.
pub(crate) fn google(args: Vec<OsString>) -> i32 {
    dispatch("google", args.into_iter().skip(1))
}

/// Run `bun <checkout>/<DISPATCHER> <command> <args…>` with inherited stdio; returns its exit code.
pub(crate) fn dispatch(command: &str, args: impl IntoIterator<Item = OsString>) -> i32 {
    let Some(root) = checkout_root() else {
        eprintln!(
            "aphrody {command}: this command runs from an Aphrody checkout ({DISPATCHER}); set APHRODY_ROOT \
             or run it inside the checkout"
        );
        return 127;
    };
    let mut child = Command::new(bun()).no_window();
    child.arg(root.join(DISPATCHER)).arg(command).args(args);
    child.env("APHRODY_ROOT", &root);
    // The TypeScript owners call `aphrody` back (resolveAphrody): keep them on this binary.
    if std::env::var_os("APHRODY_BIN").is_none()
        && let Ok(exe) = std::env::current_exe()
    {
        child.env("APHRODY_BIN", exe);
    }
    match child.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(err) => {
            eprintln!("aphrody {command}: cannot start bun: {err}");
            127
        },
    }
}

fn bun() -> PathBuf {
    std::env::var_os("APHRODY_BUN")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| which::which("bun").ok())
        .unwrap_or_else(|| PathBuf::from("bun"))
}

fn is_checkout(dir: &Path) -> bool {
    dir.join(DISPATCHER).is_file()
}

/// `APHRODY_ROOT`, then the ancestors of the binary (`target/<profile>/aphrody`) and of the working
/// directory. No machine-specific checkout fallback creates an execution context.
pub(crate) fn checkout_root() -> Option<PathBuf> {
    let env_dir = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(dir) = env_dir("APHRODY_ROOT")
        .filter(|dir| is_checkout(dir))
        .or_else(|| env_dir("APHRODY_WORKSPACE").filter(|dir| is_checkout(dir)))
    {
        return Some(dir);
    }
    let from_exe = std::env::current_exe().ok();
    let from_cwd = std::env::current_dir().ok();
    for start in [from_cwd, from_exe].into_iter().flatten() {
        if let Some(dir) = start.ancestors().find(|dir| is_checkout(dir)) {
            return Some(dir.to_path_buf());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dispatcher cases served elsewhere: by a Rust owner of the same name (or `aphrody infra …`),
    /// retired with the standalone yolo distribution, or moved to the Bun fork by Z1.
    const RUST_OWNED: &[&str] = &[
        "n2b",
        "web",
        "tauri",
        "docs",
        "version",
        "--version",
        "-v",
        "doctor",
        "scan",
        "train",
        "ai",
        "mcp",
        "awesome",
        "google",
        "infra",
        "git",
        "ssh",
        "workflow",
        "help",
        "--help",
        "-h",
    ];
    const RETIRED: &[&str] = &["upgrade", "uninstall"];
    const Z1_BUN: &[&str] = &["create"];

    fn dispatcher_cases() -> Option<Vec<String>> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../apps/aphrody/crates/infra").join(DISPATCHER);
        let source = std::fs::read_to_string(path).ok()?;
        Some(
            source
                .lines()
                .filter_map(|line| line.trim().strip_prefix("case \""))
                .filter_map(|rest| rest.split_once("\":").map(|(name, _)| name.to_owned()))
                .collect(),
        )
    }

    #[test]
    fn every_dispatcher_command_has_one_destination() {
        let Some(cases) = dispatcher_cases() else { return };
        assert!(cases.len() > 20, "the dispatcher scan found {} cases", cases.len());
        let routed: Vec<&str> = ROUTES.iter().map(|(_, command)| *command).collect();
        for case in &cases {
            let homes = [
                routed.contains(&case.as_str()),
                RUST_OWNED.contains(&case.as_str()),
                RETIRED.contains(&case.as_str()),
                Z1_BUN.contains(&case.as_str()),
            ];
            assert_eq!(
                homes.iter().filter(|home| **home).count(),
                1,
                "`{case}` needs exactly one destination"
            );
        }
        for command in routed {
            assert!(
                cases.iter().any(|case| case == command),
                "{command} is not a dispatcher command"
            );
        }
    }

    #[test]
    fn routes_are_unique_and_deprecations_are_routes() {
        let mut seen = std::collections::HashSet::new();
        for (name, _) in ROUTES {
            assert!(seen.insert(*name), "duplicate route {name}");
        }
        for (old, _) in DEPRECATED {
            assert!(seen.contains(old), "deprecated {old} is not routed");
        }
    }

    #[test]
    fn the_repository_is_a_checkout() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../apps/aphrody/crates/infra");
        if root.join(DISPATCHER).exists() {
            assert!(is_checkout(&root));
        }
    }
}
