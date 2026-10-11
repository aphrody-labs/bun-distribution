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

pub(crate) mod bun_bridge;

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
    tool("wsl", &["aphrody-wsl"], Target::Entry(crate::wsl::cli_main)),
    tool("backend", &["aphrody-backend"], Target::Entry(aphrody_backend::cli_main)),
    // MCP and Web.
    tool("mcp-server", &["aphrody-mcp"], Target::Entry(aphrody_mcp::cli_main)),
    tool("web-engine", &["aphrody-web"], Target::Entry(aphrody_web_engine::cli_main)),
    tool("web-worker", &["aphrody-web-worker"], Target::Entry(aphrody_web_engine::worker_main)),
    tool("x", &["x-cli"], Target::Entry(aphrody_x::cli_main)),
    // AI and Google.
    tool("google", &["aphrody-google"], Target::Command("google")),
    tool("embed", &["aphrody-embed"], Target::Entry(aphrody_embed::cli_main)),
    tool("n2b", &["n2b"], Target::Command("n2b")),
    // Tauri tooling (vendored crates; their standalone binaries are not built).
    tool("rag-eval", &["aphrody-rag-eval"], Target::Entry(aphrody_rag_eval::cli_main)),
    // The agent home: one database, one pipeline, one retrieval (docs/plans/agent-home-pipeline).
    tool("home", &["aphrody-home"], Target::Entry(aphrody_rag::home_cli::cli_main)),
    tool("graph", &["aphrody-graph"], Target::Entry(aphrody_code_graph::cli::cli_main)),
    tool("tauri", &["cargo-tauri"], Target::Entry(tauri)),
    tool("create-tauri-app", &["cargo-create-tauri-app"], Target::Entry(create_tauri_app)),
    // UI and build tooling.
    tool("identity", &[], Target::Entry(identity)),
    tool("m3-reproduce", &["aphrody-m3-reproduce"], Target::Entry(aphrody_m3_reproduce::cli_main)),
    tool("canvas", &["aphrody-canvas"], Target::Entry(aphrody_render::cli_main)),
    tool("bindgen", &["aphrody-bindgen"], Target::Entry(aphrody_bindgen::cli_main)),
    // Codex OSS and App-Server Protocol v2.
    tool("codex", &["aphrody-codex"], Target::Command("codex")),
    tool("app-server", &["aphrody-app-server"], Target::Entry(app_server)),
    // Former `yolo workflow`: the aphrody-infra pipeline stages.
    tool("workflow", &[], Target::Entry(workflow)),
    // Commands owned by Bun packages of the checkout (former yolo Bun CLI), see bun_bridge.
    bun("status"),
    bun("generate"),
    bun("rename"),
    bun("parse"),
    bun("bench"),
    bun("verify"),
    bun("desktop"),
    bun("desktop-runtime"),
    bun("ffi"),
    bun("import"),
    bun("plugin"),
    bun("py"),
    bun("python"),
    bun("uv"),
    bun("ruff"),
    bun("vu"),
    bun("ship"),
    bun("hooks"),
    bun("ops"),
    bun("workspace"),
    bun("optimize"),
    bun("update"),
    bun("doc-ai"),
    bun("browser"),
    bun("forge"),
    bun("m3"),
    bun("host"),
    bun("api"),
    bun("serve"),
    bun("tool"),
];

const fn bun(name: &'static str) -> Tool {
    tool(name, &[], Target::Entry(bun_bridge::entry))
}

const fn tool(name: &'static str, aliases: &'static [&'static str], target: Target) -> Tool {
    Tool { name, aliases, target }
}

/// Listed under `aphrody --help`; a unit test keeps it in step with [`TOOLS`].
pub(crate) const HELP: &str = "Former standalone binaries, also callable by their old name \
through the links `aphrody self install-path` creates:
  infra, ovh, yolo, kernel, host-service, ssh, wsl, backend, mcp-server, web-engine, web-worker, x,
  google, embed, n2b (Node 2 Bun), identity (charger | design | export-assets | pet | pixel | terminal-theme), m3-reproduce, canvas,
  bindgen, rag-eval, tauri (cargo-tauri), create-tauri-app, home (agent home: status, backup, import,
  index, query), graph (code graph: build, query, explain, path, report, export), codex, app-server,
  workflow (aphrody-infra pipeline stages)

Commands owned by Bun packages of the checkout (run as `bun packages/engine/yolo/src/index.ts`):
  status, generate, rename, parse, bench, verify, desktop [build|dev], desktop-runtime, ffi (aphrody_ffi release artifacts),
  import, plugin, py, python, uv, ruff, vu, ship, hooks, ops, workspace, optimize, update, doc-ai,
  browser, forge, m3, host, api, serve, tool (yolo_* tools: list | call); google drive|fonts.
  `aphrody mcp` without arguments starts the MCP server (= mcp-server).";

/// `aphrody ovh …` is `aphrody infra ovh …`: the OVHcloud control plane (DNS, email, VPS
/// inspection, reboot and renewal).
fn ovh(args: Vec<OsString>) -> i32 {
    let mut argv = vec![OsString::from("aphrody-infra"), OsString::from("ovh")];
    argv.extend(args.into_iter().skip(1));
    aphrody_infra::cli_main(argv)
}

/// `aphrody workflow …` is `aphrody infra workflow …` (former `yolo workflow`).
fn workflow(args: Vec<OsString>) -> i32 {
    let mut argv = vec![OsString::from("aphrody-infra"), OsString::from("workflow")];
    argv.extend(args.into_iter().skip(1));
    aphrody_infra::cli_main(argv)
}

/// `aphrody mcp` without arguments: the single MCP server.
fn mcp_server(args: Vec<OsString>) -> i32 {
    let mut argv = vec![OsString::from("aphrody-mcp")];
    argv.extend(args.into_iter().skip(1));
    aphrody_mcp::cli_main(argv)
}

/// Routes that depend on more than the subcommand name: `google drive|fonts` (Bun owner),
/// bare `mcp` (the server).
fn compat_route(argv: &[OsString]) -> Option<Resolved> {
    let word = |index: usize| argv.get(index).and_then(|arg| arg.to_str());
    match (word(1), word(2)) {
        (Some("google"), Some("drive" | "fonts")) => {
            Some(Resolved::Entry(bun_bridge::google, argv[1..].to_vec()))
        },
        (Some("mcp"), None) => Some(Resolved::Entry(mcp_server, vec![OsString::from("mcp")])),
        _ => None,
    }
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
    let (bin_name, manager) =
        if first.as_deref().and_then(invocation_name) == Some("cargo-create-tauri-app") {
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

/// `aphrody identity charger|design|export-assets|pet|pixel|terminal-theme …`: the `aphrody-identity` entry points.
fn identity(args: Vec<OsString>) -> i32 {
    let mut rest = args.into_iter().skip(1);
    let Some(tool) = rest.next() else {
        eprintln!(
            "usage: aphrody identity <charger|design|export-assets|pet|pixel|terminal-theme> [args…]"
        );
        return 2;
    };
    let entry: fn(Vec<OsString>) -> i32 = match tool.to_str() {
        Some("charger") => aphrody_identity::charger_main,
        Some("design") => aphrody_identity::design_main,
        Some("export-assets") => aphrody_identity::export_assets_main,
        Some("pet") => aphrody_identity::pet_main,
        Some("pixel") => aphrody_identity::pixel_main,
        Some("terminal-theme") => aphrody_identity::terminal_theme_main,
        _ => {
            eprintln!("aphrody identity: unknown tool {}", tool.to_string_lossy());
            return 2;
        },
    };
    let mut argv = vec![tool];
    argv.extend(rest);
    entry(argv)
}

/// `aphrody app-server …`: local app-server daemon.
fn app_server(args: Vec<OsString>) -> i32 {
    let mut argv =
        vec![OsString::from("aphrody"), OsString::from("codex"), OsString::from("app-server")];
    argv.extend(args.into_iter().skip(1));
    crate::run_from_args(argv)
}

/// Invocation name of the former Bun CLI, served by this binary. Not linked by
/// `aphrody self install-path` yet: the Bun fork commands of chantier Z1 (rename, parse, bench,
/// create, verify) still run through `bin/yolo`.
const YOLO_NAME: &str = "yolo";

/// What [`resolve`] decided for an argument vector.
pub(crate) enum Resolved {
    /// Not a multi-call tool: parse with clap as usual.
    Clap(Vec<OsString>),
    /// Run this entry point with these arguments (`args[0]` is the invocation name).
    Entry(fn(Vec<OsString>) -> i32, Vec<OsString>),
}

/// The tool name an executable was started under: `bxc` for `/home/u/.local/bin/bxc.exe`.
pub(crate) fn invocation_name(argv0: &OsStr) -> Option<&str> {
    Path::new(argv0).file_stem().and_then(OsStr::to_str)
}

/// Route `argv` by invocation name first, then by subcommand.
pub(crate) fn resolve(mut argv: Vec<OsString>) -> Resolved {
    let Some(argv0) = argv.first() else {
        return Resolved::Clap(argv);
    };
    // `yolo` is a name of `aphrody` itself (the former Bun CLI), not of one tool.
    if invocation_name(argv0) == Some(YOLO_NAME) {
        argv[0] = OsString::from("aphrody");
    }
    if let Some(resolved) = compat_route(&argv) {
        return resolved;
    }
    let argv0 = &argv[0];
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
    fn n2b_stays_an_alias_of_the_clap_command() {
        let argv = args(&["/home/u/.local/bin/n2b", "--help"]);
        assert_eq!(clap_args(resolve(argv)), ["aphrody", "n2b", "--help"]);
    }

    #[test]
    fn install_path_links_every_compatibility_name() {
        let names: Vec<_> = aliases().collect();
        assert!(names.contains(&"n2b"), "`aphrody self install-path` must link n2b");
    }

    #[test]
    fn yolo_invocation_is_aphrody() {
        let argv = args(&["/home/u/.local/bin/yolo", "doctor"]);
        assert_eq!(clap_args(resolve(argv)), ["aphrody", "doctor"]);
        let Resolved::Entry(_, argv) = resolve(args(&["yolo.exe", "m3", "dev"])) else {
            panic!("expected the Bun bridge");
        };
        assert_eq!(argv, args(&["m3", "dev"]));
    }

    #[test]
    fn every_bun_bridge_route_is_registered_before_clap() {
        for &(route, _) in bun_bridge::ROUTES {
            let Resolved::Entry(_, argv) = resolve(args(&["aphrody", route, "--help"])) else {
                panic!("Bun route {route} must not fall through to natural-language dispatch");
            };
            assert_eq!(argv, args(&[route, "--help"]));
        }
    }

    #[test]
    fn bun_owned_commands_keep_their_name_as_first_argument() {
        let Resolved::Entry(_, argv) = resolve(args(&["aphrody", "ffi", "list"])) else {
            panic!("expected the Bun bridge");
        };
        assert_eq!(argv, args(&["ffi", "list"]));
    }

    #[test]
    fn google_drive_goes_to_bun_and_the_rest_to_rust() {
        let Resolved::Entry(_, argv) = resolve(args(&["aphrody", "google", "drive", "status"]))
        else {
            panic!("expected the Bun google owner");
        };
        assert_eq!(argv, args(&["google", "drive", "status"]));
        assert_eq!(
            clap_args(resolve(args(&["aphrody", "google", "models"]))),
            ["aphrody", "google", "models"]
        );
    }

    #[test]
    fn bare_mcp_is_the_server_and_mcp_subcommands_stay_clap() {
        assert!(matches!(resolve(args(&["aphrody", "mcp"])), Resolved::Entry(..)));
        assert_eq!(
            clap_args(resolve(args(&["aphrody", "mcp", "list"]))),
            ["aphrody", "mcp", "list"]
        );
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
