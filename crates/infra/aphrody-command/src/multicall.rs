// SPDX-License-Identifier: Apache-2.0
//! Multi-call dispatch: the `aphrody` binary serves every former standalone CLI.
//!
//! A tool is reached by subcommand (`aphrody infra …`) or by invocation name: the former binary
//! names (`aphrody-infra`, `aphrody-kernel`, …) are links to `aphrody`, created by
//! `aphrody self install-path`. Tools that already have a clap command here are rewritten to it;
//! the others call their owner crate's `cli_main` in process, before any runtime exists.

use std::{
    ffi::{OsStr, OsString},
    path::Path,
};

/// Where a tool's arguments go.
pub(crate) enum Target {
    /// Rewrite to the existing `aphrody <subcommand>` clap command.
    Command(&'static str),
    /// Call the owner crate's entry point; `args[0]` is the invocation name.
    Entry(fn(Vec<OsString>) -> i32),
}

/// One former standalone binary.
pub(crate) struct Tool {
    /// Subcommand name: `aphrody <name> …`.
    pub name: &'static str,
    /// Former binary names, recognised as `argv[0]` and installed as links.
    pub aliases: &'static [&'static str],
    pub target: Target,
}

pub(crate) const TOOLS: &[Tool] = &[
    // Infrastructure and OS.
    tool("infra", &["aphrody-infra"], Target::Entry(aphrody_infra::cli_main)),
    tool("ovh", &["aphrody-ovh"], Target::Entry(ovh)),
    tool("yolo", &["aphrody-yolo"], Target::Entry(aphrody_yolo::cli_main)),
    tool("kernel", &["aphrody-kernel"], Target::Entry(aphrody_kernel::cli_main)),
    tool(
        "host-service",
        &["aphrody-host-service"],
        Target::Entry(aphrody_kernel::host_service_main),
    ),
    tool("ssh", &["aphrody-ssh"], Target::Command("ssh")),
    tool("wsl", &["aphrody-wsl"], Target::Entry(aphrody_wsl::cli_main)),
    tool("backend", &["aphrody-backend"], Target::Entry(aphrody_backend::cli_main)),
    // MCP and Web.
    tool("mcp-server", &["aphrody-mcp"], Target::Entry(aphrody_mcp::cli_main)),
    tool("web-engine", &["aphrody-web"], Target::Entry(aphrody_web_engine::cli_main)),
    tool("web-worker", &["aphrody-web-worker"], Target::Entry(aphrody_web_engine::worker_main)),
    tool("x", &["x-cli"], Target::Entry(aphrody_x::cli_main)),
    // AI and Google.
    tool("gemini-web", &["aphrody-gemini-web"], Target::Entry(aphrody_gemini_web::cli_main)),
    tool("google", &["aphrody-google"], Target::Command("google")),
    tool("translate-project", &["aphrody-translate"], Target::Entry(aphrody_translate::cli_main)),
    tool("jev", &["aphrody-jev"], Target::Entry(aphrody_jev::cli_main)),
    tool("embed", &["aphrody-embed"], Target::Entry(aphrody_embed::cli_main)),
    tool("summary", &["aphrody-summary"], Target::Entry(aphrody_summary::cli_main)),
    tool("skills", &["aphrody-skills"], Target::Entry(aphrody_skills::cli_main)),
    tool(
        "agent-home-memory",
        &["aphrody-agent-home-memory"],
        Target::Entry(aphrody_memory::cli_main),
    ),
    tool("agent-train", &["aphrody-agent-train"], Target::Entry(aphrody_train::cli_main)),
    tool("llama-daemon", &["aphrody-llama-daemon"], Target::Entry(aphrody_llama_server::cli_main)),
    tool("n2b", &["n2b"], Target::Command("n2b")),
    // Tauri tooling (vendored crates; their standalone binaries are not built).
    tool("tauri", &["cargo-tauri"], Target::Entry(tauri)),
    tool("create-tauri-app", &["cargo-create-tauri-app"], Target::Entry(create_tauri_app)),
    // UI and build tooling.
    tool("identity", &[], Target::Entry(identity)),
    tool("m3-reproduce", &["aphrody-m3-reproduce"], Target::Entry(aphrody_m3_reproduce::cli_main)),
    tool("canvas", &["aphrody-canvas"], Target::Entry(aphrody_render::cli_main)),
    tool("bindgen", &["aphrody-bindgen"], Target::Entry(aphrody_bindgen::cli_main)),
];

const fn tool(name: &'static str, aliases: &'static [&'static str], target: Target) -> Tool {
    Tool { name, aliases, target }
}

/// Listed under `aphrody --help`; a unit test keeps it in step with [`TOOLS`].
pub(crate) const HELP: &str = "Former standalone binaries, also callable by their old name \
through the links `aphrody self install-path` creates:
  infra, ovh, yolo, kernel, host-service, ssh, wsl, backend, mcp-server, web-engine, web-worker, x,
  gemini-web, google, translate-project, jev, embed, summary, skills, agent-home-memory,
  agent-train, llama-daemon, n2b, identity (design | export-assets | pixel), m3-reproduce,
  canvas, bindgen, tauri (cargo-tauri), create-tauri-app";

/// `aphrody ovh …` is `aphrody infra ovh …`: the OVHcloud control plane (DNS, email, VPS
/// inspection, reboot and renewal).
fn ovh(args: Vec<OsString>) -> i32 {
    let mut argv = vec![OsString::from("aphrody-infra"), OsString::from("ovh")];
    argv.extend(args.into_iter().skip(1));
    aphrody_infra::cli_main(argv)
}

/// `aphrody tauri …` / `cargo tauri …`: the Tauri CLI. `args[0]` is the invocation name; `cargo tauri` passes a
/// redundant `tauri` first argument that is dropped.
fn tauri(args: Vec<OsString>) -> i32 {
    let mut rest = args.into_iter().peekable();
    let first = rest.next();
    let bin_name = if first.as_deref().and_then(invocation_name) == Some("cargo-tauri") {
        if rest.peek().and_then(|arg| arg.to_str()) == Some("tauri") {
            rest.next();
            "cargo tauri"
        } else {
            "cargo-tauri"
        }
    } else {
        "aphrody tauri"
    };
    tauri_cli::run(rest, Some(bin_name.to_owned()));
    0
}

/// `aphrody create-tauri-app …` / `cargo create-tauri-app …`: the Tauri project scaffolder.
fn create_tauri_app(args: Vec<OsString>) -> i32 {
    let mut rest = args.into_iter().peekable();
    let first = rest.next();
    let (bin_name, manager) = if first.as_deref().and_then(invocation_name) == Some("cargo-create-tauri-app") {
        if rest.peek().and_then(|arg| arg.to_str()) == Some("create-tauri-app") {
            rest.next();
            ("cargo create-tauri-app", Some("cargo".to_owned()))
        } else {
            ("cargo-create-tauri-app", Some("cargo".to_owned()))
        }
    } else {
        ("aphrody create-tauri-app", None)
    };
    create_tauri_app::run(rest, Some(bin_name.to_owned()), manager);
    0
}

/// `aphrody identity design|export-assets|pixel …`: the three former `aphrody-identity` binaries.
fn identity(args: Vec<OsString>) -> i32 {
    let mut rest = args.into_iter().skip(1);
    let Some(tool) = rest.next() else {
        eprintln!("usage: aphrody identity <design|export-assets|pixel> [args…]");
        return 2;
    };
    let entry: fn(Vec<OsString>) -> i32 = match tool.to_str() {
        Some("design") => aphrody_identity::design_main,
        Some("export-assets") => aphrody_identity::export_assets_main,
        Some("pixel") => aphrody_identity::pixel_main,
        _ => {
            eprintln!("aphrody identity: unknown tool {}", tool.to_string_lossy());
            return 2;
        },
    };
    let mut argv = vec![tool];
    argv.extend(rest);
    entry(argv)
}

/// What [`resolve`] decided for an argument vector.
pub(crate) enum Resolved {
    /// Not a multi-call tool: parse with clap as usual.
    Clap(Vec<OsString>),
    /// Run this entry point with these arguments (`args[0]` is the invocation name).
    Entry(fn(Vec<OsString>) -> i32, Vec<OsString>),
}

fn invocation_name(argv0: &OsStr) -> Option<&str> {
    Path::new(argv0).file_stem().and_then(OsStr::to_str)
}

/// Route `argv` by invocation name first, then by subcommand.
pub(crate) fn resolve(argv: Vec<OsString>) -> Resolved {
    let Some(argv0) = argv.first() else {
        return Resolved::Clap(argv);
    };
    if let Some(name) = invocation_name(argv0)
        && let Some(tool) = TOOLS.iter().find(|tool| tool.aliases.contains(&name))
    {
        return match tool.target {
            Target::Entry(entry) => Resolved::Entry(entry, argv),
            Target::Command(command) => {
                let mut rewritten = vec![OsString::from("aphrody"), OsString::from(command)];
                rewritten.extend(argv.into_iter().skip(1));
                Resolved::Clap(rewritten)
            },
        };
    }
    let subcommand = argv.get(1).and_then(|arg| arg.to_str());
    if let Some(tool) = TOOLS.iter().find(|tool| Some(tool.name) == subcommand)
        && let Target::Entry(entry) = tool.target
    {
        let program = tool.aliases.first().copied().unwrap_or(tool.name);
        let mut args = vec![OsString::from(program)];
        args.extend(argv.into_iter().skip(2));
        return Resolved::Entry(entry, args);
    }
    Resolved::Clap(argv)
}

/// Run an entry point on a dedicated thread: callers may already be inside an async runtime
/// (the FFI path), and the tool builds its own.
pub(crate) fn run_isolated(entry: fn(Vec<OsString>) -> i32, args: Vec<OsString>) -> i32 {
    std::thread::Builder::new()
        .name("aphrody-tool".into())
        .stack_size(16 << 20)
        .spawn(move || entry(args))
        .map_or(70, |handle| handle.join().unwrap_or(101))
}

/// Every link name `aphrody self install-path` creates next to the binary.
pub(crate) fn aliases() -> impl Iterator<Item = &'static str> {
    TOOLS.iter().flat_map(|tool| tool.aliases.iter().copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn clap_args(resolved: Resolved) -> Vec<String> {
        match resolved {
            Resolved::Clap(argv) => argv.into_iter().map(|a| a.into_string().unwrap()).collect(),
            Resolved::Entry(..) => panic!("expected a clap rewrite"),
        }
    }

    #[test]
    fn help_names_every_tool() {
        for tool in TOOLS {
            assert!(HELP.contains(tool.name), "HELP misses {}", tool.name);
        }
    }

    #[test]
    fn aliases_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for alias in aliases() {
            assert!(seen.insert(alias), "duplicate alias {alias}");
        }
    }

    #[test]
    fn invocation_name_rewrites_to_command() {
        let argv = args(&["/home/u/.local/bin/aphrody-ssh", "status", "--json"]);
        assert_eq!(clap_args(resolve(argv)), ["aphrody", "ssh", "status", "--json"]);
    }

    #[test]
    fn plain_aphrody_is_left_to_clap() {
        let argv = args(&["aphrody", "doctor"]);
        assert_eq!(clap_args(resolve(argv)), ["aphrody", "doctor"]);
    }

    #[test]
    fn windows_extension_is_ignored() {
        let argv = args(&["n2b.exe", "scan"]);
        assert_eq!(clap_args(resolve(argv)), ["aphrody", "n2b", "scan"]);
    }

    #[test]
    fn subcommand_reaches_entry_with_former_name() {
        let Resolved::Entry(_, argv) = resolve(args(&["aphrody", "infra", "status"])) else {
            panic!("expected the aphrody-infra entry");
        };
        assert_eq!(argv, args(&["aphrody-infra", "status"]));
    }

    #[test]
    fn tools_do_not_shadow_clap_commands() {
        use clap::CommandFactory;
        // Building the whole command graph overflows the default test-thread stack in debug.
        let check = || {
            let cli = crate::Cli::command();
            for tool in TOOLS {
                match tool.target {
                    Target::Entry(_) => assert!(
                        cli.find_subcommand(tool.name).is_none(),
                        "{} would shadow a clap command",
                        tool.name
                    ),
                    Target::Command(command) => assert!(
                        cli.find_subcommand(command).is_some(),
                        "{command} is not a clap command"
                    ),
                }
            }
        };
        std::thread::Builder::new()
            .stack_size(16 << 20)
            .spawn(check)
            .expect("spawn the test thread")
            .join()
            .expect("tools shadow no clap command");
    }
}
