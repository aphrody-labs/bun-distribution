// SPDX-License-Identifier: Apache-2.0
//! Compatibility alias for the former Bun application `bxc` (Bun x Chrome) and its MCP server
//! `bxc-mcp`.
//!
//! `bxc` was absorbed by `aphrody` and rewritten in Rust (`aphrody web`, `aphrody x`,
//! `aphrody google`, `aphrody kernel mcp`, ...). Only its names survive: `bxc`, `bxc-mcp` and
//! `aphrody bxc ...` are the single `aphrody` binary, and the first argument is mapped through
//! [`PARITY`] to the unified invocation. A subcommand without a unified implementation is
//! retired: the error names its replacement. Nothing here spawns another executable, exit codes
//! and JSON shapes are those of the unified commands, and the state directory of the former
//! application (`~/.bxc`) is no longer written (cookie jars are still read from it by the
//! Google and Gemini clients).
//!
//! The parity table is documented, with the decisions behind each row, in
//! `docs/migration/bxc-n2b-unification-2026-10-05.md`; a unit test keeps both in step.

use std::ffi::OsString;

/// Where one legacy subcommand goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Route {
    /// Run `aphrody <command...> <arguments>`.
    Unified(&'static [&'static str]),
    /// No unified command implements it: the error names the replacement and the reason.
    Retired { replacement: &'static str, reason: &'static str },
}

/// One row of the parity table.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Row {
    /// Legacy subcommand, as typed after `bxc`.
    pub legacy: &'static str,
    /// Other spellings the former router accepted.
    pub aliases: &'static [&'static str],
    /// Second-level words this row applies to; empty means the subcommand as a whole.
    pub subs: &'static [&'static str],
    pub route: Route,
    /// Flags renamed on the way to the unified command.
    pub renames: &'static [(&'static str, &'static str)],
}

impl Row {
    const fn unified(
        legacy: &'static str,
        subs: &'static [&'static str],
        command: &'static [&'static str],
    ) -> Self {
        Self { legacy, aliases: &[], subs, route: Route::Unified(command), renames: &[] }
    }

    const fn retired(
        legacy: &'static str,
        subs: &'static [&'static str],
        replacement: &'static str,
        reason: &'static str,
    ) -> Self {
        Self {
            legacy,
            aliases: &[],
            subs,
            route: Route::Retired { replacement, reason },
            renames: &[],
        }
    }

    const fn aka(self, aliases: &'static [&'static str]) -> Self {
        Self { aliases, ..self }
    }

    const fn renaming(self, renames: &'static [(&'static str, &'static str)]) -> Self {
        Self { renames, ..self }
    }

    fn label(&self) -> String {
        if self.subs.is_empty() {
            self.legacy.to_owned()
        } else {
            format!("{} {}", self.legacy, self.subs.join("|"))
        }
    }

    fn target(&self) -> String {
        match self.route {
            Route::Unified(command) => format!("aphrody {}", command.join(" ")),
            Route::Retired { replacement, .. } => format!("retired, use {replacement}"),
        }
    }
}

/// Every subcommand of `bxc` 0.9.15 (plus the spellings its router accepted), mapped to the
/// unified command or retired. A row that names second-level words wins over the row of the bare
/// subcommand; the first matching row wins.
pub(crate) const PARITY: &[Row] = &[
    // Browser engine and CDP server.
    Row::unified("serve", &[], &["web-engine", "launch"]).renaming(&[("--cdp-port", "--port")]),
    Row::retired(
        "install",
        &[],
        "aphrody self install-path",
        "the engines are linked into the binary: there is no runtime asset to install",
    ),
    Row::retired(
        "self-update",
        &[],
        "aphrody self install-path --bin <new build>",
        "the single binary is replaced as a whole and its links re-pointed",
    )
    .aka(&["upgrade"]),
    Row::unified("chrome", &["launch"], &["web-engine", "launch"]),
    Row::unified("chrome", &["snapshot", "navigate"], &["web", "browser", "snapshot"]),
    Row::retired(
        "chrome",
        &[],
        "aphrody web browser snapshot <url>",
        "no external Chromium is downloaded or managed: Obscura is linked, and `aphrody \
         web-engine chrome-path` resolves an existing Chromium",
    ),
    // Pages.
    Row::unified("recon", &[], &["web", "recon"]).aka(&["docs"]),
    Row::unified("detect", &[], &["web", "detect"]),
    Row::unified("scrape", &[], &["web", "scrape"]),
    Row::unified("extract", &[], &["web", "extract"]),
    Row::unified("search", &[], &["web", "search"]),
    Row::unified("mirror", &[], &["web", "mirror"]),
    Row::unified("crawl", &[], &["web", "crawl"]),
    Row::retired(
        "crawl-worker",
        &[],
        "aphrody web crawl --daemon --sqlite <db> <seed...>",
        "the Redis frontier worker is replaced by the SQLite frontier of the Rust crawler",
    ),
    Row::unified("frames", &[], &["web", "frames"]),
    Row::unified("capabilities", &[], &["web", "capabilities"]),
    Row::unified("doctor", &[], &["doctor"]),
    // MediaWiki.
    Row::unified("wiki", &["search"], &["web", "wiki-search"]),
    Row::unified("wiki", &["md"], &["web", "wiki-page", "--markdown"]),
    Row::unified("wiki", &["page", "images", "infobox", "tables"], &["web", "wiki-page"]),
    Row::unified("wiki", &[], &["web", "wiki-page"]),
    // The single MCP server.
    Row::unified("mcp", &[], &["kernel", "mcp"]),
    // Google and Gemini.
    Row::unified("google", &["search"], &["web", "search"]),
    Row::unified("google", &["translate"], &["translate"]),
    Row::retired(
        "google",
        &[
            "audit",
            "auto-upgrade",
            "book",
            "books",
            "calendar",
            "chat",
            "conversations",
            "delete",
            "doc",
            "download",
            "open",
            "resume",
            "scrape",
            "sheet",
            "tts",
        ],
        "aphrody google --help (dns, suggest, languages, status, models, generate) and the \
         aphrody_google_* MCP tools",
        "the Google property auditor and the web-UI clients (Docs, Sheets, Calendar, Books, \
         chat history) are not part of the unified Google client",
    ),
    Row::unified("google", &[], &["google"]),
    Row::unified("gemini", &["ask"], &["web", "gemini"]),
    Row::unified("gemini", &["status"], &["google", "status"]),
    Row::retired(
        "gemini",
        &[],
        "aphrody web gemini <prompt>, aphrody google models, aphrody antigravity chat",
        "the multi-engine Gemini toolchain is split between the Gemini web client and the \
         Antigravity client",
    ),
    // X.
    Row::unified("x", &["profile"], &["x", "user"]),
    Row::unified("x", &["tweets"], &["x", "user-tweets"]),
    Row::unified("x", &["foryou"], &["x", "home"]),
    Row::retired(
        "x",
        &["rank", "purge-tweets"],
        "@aphrody/x (Bun binding of the aphrody-x crate)",
        "local ranking and bulk deletion are scripted through the Bun binding, not the CLI",
    ),
    Row::unified("x", &[], &["x"]),
    Row::unified("xcom", &[], &["x", "user"]),
    // Retired: no unified implementation.
    Row::retired(
        "api",
        &[],
        "aphrody kernel mcp (MCP) or aphrody web-engine launch (CDP)",
        "there is no HTTP JSON facade over the Rust engines",
    ),
    Row::retired(
        "cookies",
        &[],
        "aphrody web search --cookies <file>; jars live in ~/.aphrody/cookies",
        "cookie extraction is a credential operation reserved to privileged library callers \
         (aphrody-web-chromium), not a CLI command",
    ),
    Row::retired(
        "har",
        &[],
        "aphrody web recon <url> --json",
        "the Rust engine keeps the HAR 1.2 model for CDP (obscura_net::har) but has no \
         record/replay command",
    ),
    Row::retired(
        "fut",
        &[],
        "aphrody-labs/fut",
        "the FIFA Ultimate Team scraper left the platform with its own repository",
    ),
    Row::retired(
        "voiranime",
        &[],
        "aphrody web media resolve <embed-url>",
        "streaming-site catalogues are out of the product; embed players are resolved by the \
         media resolver",
    ),
    Row::retired(
        "animesama",
        &[],
        "aphrody web media resolve <embed-url>",
        "streaming-site catalogues are out of the product; embed players are resolved by the \
         media resolver",
    ),
    Row::retired(
        "archive",
        &[],
        "aphrody web fetch <archive.org url>",
        "site-specific Internet Archive client: Wayback and metadata URLs are plain HTTP",
    ),
    Row::retired(
        "dragonball",
        &[],
        "aphrody-labs/shenron",
        "Dragon Ball sources belong to the Shenron product",
    ),
    Row::retired(
        "assets",
        &[],
        "aphrody web fetch <url>",
        "image and GIF provider search is site-specific and out of the product",
    ),
    Row::retired(
        "aphrody",
        &[],
        "aphrody <command>",
        "this binary is aphrody: run its commands directly (aphrody doctor, aphrody rag, ...)",
    ),
    Row::retired(
        "service",
        &[],
        "aphrody infra service, aphrody infra ssh",
        "the bxc daemons no longer exist; services and tunnels are catalogued by Infra",
    ),
    Row::retired("grok", &[], "@aphrody/xai (Bun)", "the xAI Grok client is a Bun package"),
    Row::retired(
        "actor",
        &[],
        "aphrody web crawl",
        "the Actor runtime is not part of the Rust engine",
    ),
    Row::retired(
        "export",
        &[],
        "aphrody web crawl --json or --sqlite <db>",
        "dataset export follows the crawl store",
    ),
];

/// What the alias does with its arguments.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Plan {
    /// Run this unified invocation (`argv[0]` is `aphrody`).
    Run(Vec<OsString>),
    /// Print this text on stdout and succeed (help, version).
    Print(String),
    /// Print this message on stderr and fail with `code`.
    Refuse { code: i32, message: String },
}

/// Process-wide option of the former router that is honoured: `--json` goes on to the unified
/// command. `-q`/`--quiet` only silenced progress lines and is accepted and ignored.
const REFUSED_OPTIONS: &[(&str, &str)] = &[
    (
        "--insecure",
        "TLS verification cannot be disabled in the unified engine; fix the certificate or use \
         the engine's own flags (`aphrody web-engine --help`)",
    ),
    ("-k", "TLS verification cannot be disabled in the unified engine"),
    (
        "--proxy",
        "pass the proxy to the command that supports it (`aphrody web mirror --proxy`, \
         `aphrody web-engine --proxy`)",
    ),
    ("--timeout", "timeouts are set by each unified command"),
];

fn unified_argv(command: &[&str], rest: &[OsString]) -> Vec<OsString> {
    let mut argv = vec![OsString::from("aphrody")];
    argv.extend(command.iter().map(OsString::from));
    argv.extend(rest.iter().cloned());
    argv
}

fn rename_flags(rest: &[OsString], renames: &[(&str, &str)]) -> Vec<OsString> {
    rest.iter()
        .map(|arg| {
            let Some(text) = arg.to_str() else { return arg.clone() };
            for (from, to) in renames {
                if text == *from {
                    return OsString::from(*to);
                }
                if let Some(value) = text.strip_prefix(&format!("{from}=")) {
                    return OsString::from(format!("{to}={value}"));
                }
            }
            arg.clone()
        })
        .collect()
}

/// The row for `legacy`, and how many second-level words it consumed.
fn lookup(legacy: &str, rest: &[OsString]) -> Option<(&'static Row, usize)> {
    let first = rest.first().and_then(|arg| arg.to_str());
    let rows = || PARITY.iter().filter(|row| row.legacy == legacy || row.aliases.contains(&legacy));
    rows()
        .find(|row| first.is_some_and(|word| row.subs.contains(&word)))
        .map(|row| (row, 1))
        .or_else(|| rows().find(|row| row.subs.is_empty()).map(|row| (row, 0)))
}

fn version_line() -> String {
    let version = env!("CARGO_PKG_VERSION");
    format!("bxc {version} (compatibility alias of aphrody {version})")
}

/// `bxc --help`: the parity table.
pub(crate) fn help() -> String {
    let mut text = String::from(
        "bxc (Bun x Chrome) was absorbed by aphrody and rewritten in Rust.\n`bxc`, `bxc-mcp` and \
         `aphrody bxc` are names of the single `aphrody` binary: each subcommand runs the unified \
         command on its right, a retired one prints its replacement.\n\nUsage: bxc [--json] \
         <subcommand> [args...]\n       bxc-mcp [args...]   (= aphrody kernel mcp)\n\nSubcommands:\n",
    );
    for row in PARITY {
        text.push_str(&format!("  {:<28} {}\n", row.label(), row.target()));
    }
    text.push_str(
        "\nOptions: --json is forwarded, -q/--quiet is ignored, -h/--help and -V/--version \
         are answered here; --insecure/-k, --proxy and --timeout are refused (see \
         docs/migration/bxc-n2b-unification-2026-10-05.md).\n",
    );
    text
}

fn refuse(message: String) -> Plan {
    Plan::Refuse { code: 2, message }
}

fn mcp_plan(rest: &[OsString]) -> Plan {
    let kept: Vec<OsString> =
        rest.iter().filter(|arg| arg.to_str() != Some("--stdio")).cloned().collect();
    Plan::Run(unified_argv(&["kernel", "mcp"], &kept))
}

/// Map the arguments of `bxc` / `bxc-mcp` (`args[0]` is the invocation name) to a [`Plan`].
pub(crate) fn plan(args: &[OsString]) -> Plan {
    let program =
        args.first().and_then(|arg| crate::multicall::invocation_name(arg)).unwrap_or("bxc");
    let rest = args.get(1..).unwrap_or_default();
    let version = |word: Option<&str>| matches!(word, Some("--version" | "-V"));

    if program == "bxc-mcp" {
        if version(rest.first().and_then(|arg| arg.to_str())) {
            return Plan::Print(version_line());
        }
        return mcp_plan(rest);
    }

    let mut json = false;
    let mut index = 0;
    while let Some(arg) = rest.get(index).and_then(|arg| arg.to_str()) {
        if !arg.starts_with('-') || arg == "-" {
            break;
        }
        match arg {
            "--json" => json = true,
            "-q" | "--quiet" => {},
            "-h" | "--help" => return Plan::Print(help()),
            "-V" | "--version" => return Plan::Print(version_line()),
            _ => {
                let name = arg.split_once('=').map_or(arg, |(name, _)| name);
                return refuse(match REFUSED_OPTIONS.iter().find(|(option, _)| *option == name) {
                    Some((option, advice)) => format!("bxc: {option} is refused: {advice}"),
                    None => format!("bxc: unknown option {arg}; run `bxc --help`"),
                });
            },
        }
        index += 1;
    }

    let Some(first) = rest.get(index) else {
        return Plan::Print(help());
    };
    let Some(legacy) = first.to_str() else {
        return refuse("bxc: the subcommand is not valid UTF-8; run `bxc --help`".to_owned());
    };
    if legacy == "help" {
        return Plan::Print(help());
    }
    let tail = &rest[index + 1..];

    // `bxc serve --stdio` was the MCP server of some versions.
    if legacy == "serve" && tail.iter().any(|arg| arg.to_str() == Some("--stdio")) {
        return mcp_plan(tail);
    }

    let Some((row, consumed)) = lookup(legacy, tail) else {
        return refuse(format!("bxc: unknown subcommand `{legacy}`; run `bxc --help`"));
    };
    match row.route {
        Route::Retired { replacement, reason } => {
            refuse(format!("bxc {}: retired, {reason}.\nUse: {replacement}", row.label()))
        },
        Route::Unified(command) => {
            let mut argv = unified_argv(command, &rename_flags(&tail[consumed..], row.renames));
            if json {
                argv.push(OsString::from("--json"));
            }
            Plan::Run(argv)
        },
    }
}

/// Entry of the multi-call tool `bxc` (names `bxc`, `bxc-mcp`, `aphrody bxc`).
pub(crate) fn entry(args: Vec<OsString>) -> i32 {
    match plan(&args) {
        Plan::Run(argv) => crate::run_from_args(argv),
        Plan::Print(text) => {
            println!("{text}");
            0
        },
        Plan::Refuse { code, message } => {
            eprintln!("{message}");
            code
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn run(values: &[&str]) -> Vec<String> {
        match plan(&args(values)) {
            Plan::Run(argv) => argv.into_iter().map(|arg| arg.into_string().unwrap()).collect(),
            other => panic!("expected a unified invocation for {values:?}, got {other:?}"),
        }
    }

    fn refused(values: &[&str]) -> String {
        match plan(&args(values)) {
            Plan::Refuse { code, message } => {
                assert_eq!(code, 2);
                message
            },
            other => panic!("expected a refusal for {values:?}, got {other:?}"),
        }
    }

    /// The 35 subcommands printed by `bxc 0.9.15 --help`, plus the spellings its router accepted.
    const LEGACY_SUBCOMMANDS: &[&str] = &[
        "serve",
        "install",
        "self-update",
        "upgrade",
        "chrome",
        "recon",
        "docs",
        "detect",
        "scrape",
        "extract",
        "wiki",
        "search",
        "api",
        "cookies",
        "har",
        "mirror",
        "fut",
        "voiranime",
        "animesama",
        "archive",
        "dragonball",
        "frames",
        "assets",
        "doctor",
        "capabilities",
        "mcp",
        "google",
        "gemini",
        "aphrody",
        "service",
        "xcom",
        "x",
        "grok",
        "actor",
        "crawl",
        "crawl-worker",
        "export",
    ];

    #[test]
    fn every_legacy_subcommand_has_a_row() {
        for legacy in LEGACY_SUBCOMMANDS {
            assert!(lookup(legacy, &[]).is_some(), "`bxc {legacy}` is neither mapped nor retired");
        }
    }

    #[test]
    fn retired_rows_name_a_replacement_and_a_reason() {
        for row in PARITY {
            if let Route::Retired { replacement, reason } = row.route {
                assert!(!replacement.is_empty() && !reason.is_empty(), "{}", row.label());
            }
        }
    }

    #[test]
    fn no_route_leads_back_to_the_alias() {
        for row in PARITY {
            if let Route::Unified(command) = row.route {
                assert!(
                    !matches!(command[0], "bxc" | "bxc-mcp"),
                    "`bxc {}` would loop through the alias",
                    row.label()
                );
            }
        }
    }

    #[test]
    fn every_unified_target_is_a_real_command() {
        use clap::CommandFactory;
        // Building the whole command graph overflows the default test-thread stack in debug.
        let check = || {
            let cli = crate::Cli::command();
            for row in PARITY {
                let Route::Unified(command) = row.route else { continue };
                // Tools that run their owner crate's entry point own their own subcommands.
                let entry_tool = crate::multicall::TOOLS.iter().any(|tool| {
                    tool.name == command[0]
                        && matches!(tool.target, crate::multicall::Target::Entry(_))
                });
                if entry_tool {
                    continue;
                }
                let mut current = &cli;
                for word in command.iter().take_while(|word| !word.starts_with('-')) {
                    // A passthrough command (`google`, `x`) owns its own words.
                    if !current.has_subcommands() {
                        break;
                    }
                    current = current.find_subcommand(word).unwrap_or_else(|| {
                        panic!(
                            "`bxc {}` maps to `aphrody {}`, which does not exist",
                            row.label(),
                            command.join(" ")
                        )
                    });
                }
            }
        };
        std::thread::Builder::new()
            .stack_size(16 << 20)
            .spawn(check)
            .expect("spawn the test thread")
            .join()
            .expect("every unified target exists");
    }

    #[test]
    fn page_commands_map_to_aphrody_web() {
        assert_eq!(
            run(&["bxc", "recon", "https://example.com", "--profile", "static"]),
            ["aphrody", "web", "recon", "https://example.com", "--profile", "static"]
        );
        assert_eq!(run(&["bxc", "docs", "https://example.com"])[1..3], ["web", "recon"]);
        assert_eq!(run(&["bxc", "search", "rust", "--num", "3"])[1..3], ["web", "search"]);
        assert_eq!(
            run(&["bxc", "crawl", "https://example.com", "--max-requests", "3"]),
            ["aphrody", "web", "crawl", "https://example.com", "--max-requests", "3"]
        );
        assert_eq!(run(&["bxc", "doctor"]), ["aphrody", "doctor"]);
    }

    #[test]
    fn json_before_the_subcommand_follows_the_command() {
        assert_eq!(
            run(&["bxc", "--json", "detect", "https://example.com"]),
            ["aphrody", "web", "detect", "https://example.com", "--json"]
        );
        assert_eq!(run(&["bxc", "-q", "doctor"]), ["aphrody", "doctor"]);
    }

    #[test]
    fn second_level_words_pick_the_row() {
        assert_eq!(
            run(&[
                "bxc",
                "wiki",
                "md",
                "https://w.example/wiki/A",
                "--api-url",
                "https://w.example/api.php"
            ]),
            [
                "aphrody",
                "web",
                "wiki-page",
                "--markdown",
                "https://w.example/wiki/A",
                "--api-url",
                "https://w.example/api.php"
            ]
        );
        assert_eq!(
            run(&["bxc", "wiki", "search", "https://w/api.php", "q"])[1..3],
            ["web", "wiki-search"]
        );
        assert_eq!(run(&["bxc", "google", "search", "q"]), ["aphrody", "web", "search", "q"]);
        assert_eq!(
            run(&["bxc", "google", "dns", "example.com"]),
            ["aphrody", "google", "dns", "example.com"]
        );
        assert_eq!(run(&["bxc", "gemini", "ask", "hello"]), ["aphrody", "web", "gemini", "hello"]);
    }

    #[test]
    fn x_subcommands_keep_their_legacy_spelling() {
        assert_eq!(run(&["bxc", "x", "profile", "jack"]), ["aphrody", "x", "user", "jack"]);
        assert_eq!(run(&["bxc", "x", "tweets", "jack", "-n", "5"])[1..3], ["x", "user-tweets"]);
        assert_eq!(run(&["bxc", "x", "foryou"]), ["aphrody", "x", "home"]);
        assert_eq!(run(&["bxc", "x", "news"]), ["aphrody", "x", "news"]);
        assert_eq!(run(&["bxc", "xcom", "jack"]), ["aphrody", "x", "user", "jack"]);
        assert!(refused(&["bxc", "x", "rank"]).contains("@aphrody/x"));
    }

    #[test]
    fn serve_is_the_cdp_server_and_stdio_is_the_mcp_server() {
        assert_eq!(
            run(&["bxc", "serve", "--cdp-port", "9333"]),
            ["aphrody", "web-engine", "launch", "--port", "9333"]
        );
        assert_eq!(
            run(&["bxc", "serve", "--cdp-port=9333"]),
            ["aphrody", "web-engine", "launch", "--port=9333"]
        );
        assert_eq!(run(&["bxc", "serve", "--stdio"]), ["aphrody", "kernel", "mcp"]);
        assert_eq!(run(&["bxc", "mcp"]), ["aphrody", "kernel", "mcp"]);
    }

    #[test]
    fn bxc_mcp_is_the_single_mcp_server() {
        assert_eq!(run(&["/home/u/.local/bin/bxc-mcp"]), ["aphrody", "kernel", "mcp"]);
        assert_eq!(run(&["bxc-mcp.exe", "--stdio"]), ["aphrody", "kernel", "mcp"]);
        assert_eq!(plan(&args(&["bxc-mcp", "--version"])), Plan::Print(version_line()));
    }

    #[test]
    fn a_retired_subcommand_names_its_replacement() {
        let message = refused(&["bxc", "fut", "player"]);
        assert!(message.contains("retired"), "{message}");
        assert!(message.contains("aphrody-labs/fut"), "{message}");
        let message = refused(&["bxc", "service", "status"]);
        assert!(message.contains("aphrody infra service"), "{message}");
        let message = refused(&["bxc", "google", "calendar"]);
        assert!(message.contains("aphrody google --help"), "{message}");
        assert!(refused(&["bxc", "chrome", "fetch"]).contains("aphrody web browser snapshot"));
    }

    #[test]
    fn unknown_subcommands_and_options_are_refused() {
        assert!(refused(&["bxc", "bogus"]).contains("unknown subcommand `bogus`"));
        assert!(refused(&["bxc", "--bogus", "recon"]).contains("unknown option --bogus"));
        assert!(refused(&["bxc", "-k", "recon", "https://x"]).contains("TLS verification"));
        assert!(refused(&["bxc", "--insecure", "recon", "https://x"]).contains("TLS verification"));
        assert!(refused(&["bxc", "--proxy=http://p:1", "recon"]).contains("web mirror --proxy"));
        assert!(refused(&["bxc", "--timeout", "10", "recon"]).contains("each unified command"));
    }

    #[test]
    fn help_and_version_are_answered_by_the_alias() {
        for argv in [&["bxc"][..], &["bxc", "--help"], &["bxc", "-h"], &["bxc", "help"]] {
            match plan(&args(argv)) {
                Plan::Print(text) => {
                    assert!(text.contains("single `aphrody` binary"), "{text}");
                    assert!(text.contains("aphrody web recon"), "{text}");
                    assert!(text.contains("retired, use aphrody-labs/fut"), "{text}");
                },
                other => panic!("expected the help for {argv:?}, got {other:?}"),
            }
        }
        match plan(&args(&["bxc", "--version"])) {
            Plan::Print(text) => {
                assert!(text.starts_with("bxc ") && text.contains("aphrody"), "{text}")
            },
            other => panic!("expected the version, got {other:?}"),
        }
    }

    /// The document is the owner-facing record of the table: it must name every legacy
    /// subcommand. Skipped when the crate is built outside the monorepo.
    #[test]
    fn the_parity_document_names_every_subcommand() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../docs/migration/bxc-n2b-unification-2026-10-05.md");
        let Ok(text) = std::fs::read_to_string(path) else { return };
        for legacy in LEGACY_SUBCOMMANDS {
            assert!(text.contains(&format!("`{legacy}`")), "the parity document misses `{legacy}`");
        }
    }
}
