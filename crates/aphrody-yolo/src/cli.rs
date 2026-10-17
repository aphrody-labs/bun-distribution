// SPDX-License-Identifier: Apache-2.0
//! Native Rust YOLO engine CLI (`aphrody yolo`, former `aphrody-yolo` binary).

use aphrody_proc::NoWindow as _;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{mapper, polyglot};
use anyhow::{Context, Result, bail};
use aphrody_fsindex::{PathHit, PathIndex};
use aphrody_kernel_client::{ClientOptions, KernelClient};
use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;
use serde_json::json;

fn default_shell() -> String {
    if cfg!(windows) {
        if which::which("pwsh.exe").is_ok() {
            "pwsh.exe".to_string()
        } else {
            "powershell.exe".to_string()
        }
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    }
}

/// Name of the index in the repository state directory.
const FS_INDEX_FILE: &str = "fsindex.sqlite";
/// Text index written by earlier releases, imported once then removed.
const FS_INDEX_LEGACY: &str = "fsindex.tsv";

/// Rebuilds the path index at `database` from the files under `root`. The walk honours
/// `.gitignore`, `.ignore` and Git excludes and never enters `.git`.
fn build_index(database: &Path, root: &Path) -> Result<usize> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build();
    let entries = walker
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|entry| {
            let metadata = entry.metadata().ok();
            PathHit {
                path: entry.path().display().to_string(),
                size: metadata.as_ref().map_or(0, fs::Metadata::len),
                modified: metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs()),
            }
        });
    let count = PathIndex::open(database).write(entries)?;
    let _ = fs::remove_file(database.with_file_name(FS_INDEX_LEGACY));
    Ok(count)
}

/// Aphrody state directory: `$APHRODY_HOME`, else `~/.aphrody`.
fn state_dir() -> Option<PathBuf> {
    let non_empty = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    non_empty("APHRODY_HOME").or_else(|| {
        let home = if cfg!(windows) {
            non_empty("USERPROFILE")
        } else {
            None
        };
        home.or_else(|| non_empty("HOME"))
            .map(|home| home.join(".aphrody"))
    })
}

/// Per-repository yolo state: `<state>/yolo/<directory name>-<hash of the root path>`, so map
/// and index outputs never land in the scanned checkout.
fn repo_state_dir(root: &Path) -> PathBuf {
    let text = root.display().to_string();
    let text = if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    };
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    });
    let name = root
        .file_name()
        .map_or_else(|| "root".into(), |n| n.to_string_lossy().into_owned());
    let base = state_dir().unwrap_or_else(|| root.join(".aphrody"));
    base.join("yolo")
        .join(format!("{name}-{:08x}", hash as u32))
}

#[derive(Debug, Parser)]
#[command(
    name = "aphrody-yolo",
    version,
    about = "Aphrody OS native YOLO engine"
)]
struct Cli {
    /// Repository root. Defaults to the current directory.
    #[arg(long, global = true, default_value = ".")]
    root: PathBuf,

    /// Emit one JSON record per executed phase.
    #[arg(long, global = true)]
    json: bool,

    /// Kernel endpoint. Defaults to APHRODY_OS_SOCKET or the per-user local endpoint.
    #[arg(long, global = true, env = "APHRODY_OS_SOCKET")]
    socket: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Verify tool availability and versions without changing the repository.
    Doctor,
    /// Detect a file type and extract structural symbols.
    Detect {
        /// File to inspect.
        path: PathBuf,
    },
    /// Run ordered polyglot validation tiers. Defaults to every tier.
    Verify {
        /// Restrict execution to one or more tiers.
        #[arg(long, value_enum, value_delimiter = ',')]
        tier: Vec<Tier>,
        /// Scan all tracked Markdown, including imported upstream documentation.
        #[arg(long)]
        all_docs: bool,
    },
    /// Map, audit and watch the monorepo source topology.
    Map {
        /// Path for the path-hardening audit. Defaults to path.json in the repository state
        /// directory (~/.aphrody/yolo/<repo>-<hash>/).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Path for the complete monorepo map. Defaults to monorepo-map.json in the repository
        /// state directory.
        #[arg(long)]
        map: Option<PathBuf>,
        #[command(subcommand)]
        command: MapCommand,
    },
    /// Run structured Nushell commands through the embedded Aphrody shell.
    Shell {
        #[command(subcommand)]
        command: ShellCommand,
    },
    /// Build and query the persistent metadata-only filesystem index (tab-separated text).
    Fs {
        #[command(subcommand)]
        command: FsCommand,
    },
    /// Proxy Windows administration to the running kernel admin subsystem.
    Win {
        #[command(subcommand)]
        command: WinCommand,
    },
    /// Report orchestration services and the kernel control-plane connection.
    System,
    /// Inspect the YOLO manifest and produce the bounded polyglot gate plan.
    Plan,
    /// Validate the unified Aphrody plugin's agents, skills and YOLO manifest.
    Check,
    /// Create one Rust-owned YOLO automation tick.
    Grind {
        /// Inspect the plan without creating coordination state.
        #[arg(long)]
        dry_run: bool,
        /// Direct mission, taking precedence over plan tasks.
        #[arg(long)]
        goal: Option<String>,
    },
    /// Dispatch bounded unattended ticks through an installed agent harness.
    Autopilot {
        /// Execute one tick and exit.
        #[arg(long)]
        once: bool,
        /// Produce the plan and prompt without starting an external harness.
        #[arg(long)]
        dry_run: bool,
        /// Delay between ticks when --once is omitted.
        #[arg(long, default_value_t = 60)]
        interval_secs: u64,
        /// Stop after this many ticks.
        #[arg(long)]
        max_ticks: Option<u64>,
        /// Preferred harness; defaults to agy, then claude, then gemini.
        #[arg(long)]
        harness: Option<String>,
        /// Run lead missions one after another in a shared checkout.
        #[arg(long)]
        sequential: bool,
        /// Direct missions, up to four; repeat --goal for independent lanes.
        #[arg(long)]
        goal: Vec<String>,
    },
    /// Ingest a Git repository or directory into a prompt-ready LLM digest (GitIngest standard).
    Ingest {
        /// Git repository URL, owner/repo slug, or local directory path.
        #[arg(default_value = ".")]
        source: String,
        /// Maximum allowed file size in bytes (default: 10MB).
        #[arg(short = 's', long, default_value_t = 10_485_760)]
        max_size: u64,
        /// Include file patterns (e.g. -i "*.py" -i "*.rs").
        #[arg(short = 'i', long = "include")]
        include: Vec<String>,
        /// Exclude file patterns (e.g. -e "tests/*").
        #[arg(short = 'e', long = "exclude")]
        exclude: Vec<String>,
        /// Git branch to ingest.
        #[arg(short = 'b', long)]
        branch: Option<String>,
        /// Git tag to ingest.
        #[arg(long)]
        tag: Option<String>,
        /// Subpath within the repository.
        #[arg(long)]
        subpath: Option<String>,
        /// Personal access token for private repositories.
        #[arg(short = 't', long)]
        token: Option<String>,
        /// Output file path, or "-" for stdout (default: stdout).
        #[arg(short = 'o', long)]
        output: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
enum MapCommand {
    /// Produce the audit and topology JSON files once.
    Scan,
    /// Produce JSON files and fail when path-hardening findings exist.
    Check,
    /// Re-run the mapper when source topology changes.
    Watch {
        /// Debounce filesystem events in milliseconds.
        #[arg(long, default_value_t = 1500)]
        debounce_ms: u64,
    },
}

#[derive(Debug, Subcommand)]
enum ShellCommand {
    /// Evaluate Nushell code and return structured output.
    Eval { code: String },
    /// List embedded Nushell commands.
    Commands { filter: Option<String> },
    /// Print full embedded Nushell help for a command.
    Describe { command: String },
}

#[derive(Debug, Subcommand)]
enum FsCommand {
    /// Build or refresh the index (path, size, mtime per file; honours .gitignore, skips .git).
    Build {
        /// Index path. Defaults to fsindex.sqlite in the repository state directory.
        #[arg(long)]
        database: Option<PathBuf>,
    },
    /// List indexed paths containing every word of the query (case-insensitive).
    Search {
        /// One or more words; all must appear in the path.
        #[arg(required = true, num_args = 1..)]
        query: Vec<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
        /// Index path. Defaults to fsindex.sqlite in the repository state directory.
        #[arg(long)]
        database: Option<PathBuf>,
    },
    /// Report the entry count of an existing filesystem index.
    Status {
        /// Index path. Defaults to fsindex.sqlite in the repository state directory.
        #[arg(long)]
        database: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
enum WinCommand {
    /// List the generated WinClean tool catalog without loading the DLL.
    Catalog { filter: Option<String> },
    /// Report the native WinClean runtime and tool catalog state.
    Status,
    /// Invoke one WinClean tool with a JSON object supplied explicitly.
    Call {
        tool: String,
        #[arg(long, default_value = "{}")]
        args: String,
    },
}

#[derive(Serialize)]
struct YoloPlan {
    manifest: String,
    manifest_id: String,
    plan_file: Option<String>,
    actionable_tasks: Vec<String>,
    runtimes: Vec<String>,
    languages: Vec<String>,
    gates: Vec<String>,
    native_shell: String,
    filesystem_index: String,
    filesystem_index_ready: bool,
}

#[derive(Serialize)]
struct YoloCheck {
    manifest_id: String,
    agents: usize,
    skills: usize,
}

#[derive(Serialize)]
struct YoloTick {
    timestamp: u64,
    run_id: String,
    event: &'static str,
    tasks: Vec<RuntimeTask>,
    coordinated: bool,
}

#[derive(Serialize)]
struct RuntimeTask {
    id: usize,
    title: String,
    owner: &'static str,
}

#[derive(Serialize)]
struct CoordEnvelope<'a> {
    v: u8,
    ts: String,
    id: &'a str,
    from: &'static str,
    to: &'static str,
    kind: &'static str,
    topic: &'static str,
    body: &'a [RuntimeTask],
}

#[derive(Serialize)]
struct SystemStatus {
    terminal_shell: String,
    kernel_shell_ready: bool,
    filesystem_index: String,
    filesystem_index_ready: bool,
    kernel_endpoint: String,
    kernel_reachable: bool,
    kernel_admin_tools: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum Tier {
    Tools,
    Rust,
    Bun,
    Uv,
    Pwsh,
    Nushell,
}

impl Tier {
    const ALL: [Self; 6] = [
        Self::Tools,
        Self::Rust,
        Self::Bun,
        Self::Uv,
        Self::Pwsh,
        Self::Nushell,
    ];

    fn name(self) -> &'static str {
        match self {
            Self::Tools => "tools",
            Self::Rust => "rust",
            Self::Bun => "bun",
            Self::Uv => "uv",
            Self::Pwsh => "pwsh",
            Self::Nushell => "nushell",
        }
    }
}

#[derive(Serialize)]
struct SkippedPhase<'a> {
    tier: &'static str,
    skipped: &'a str,
}

fn skip(json: bool, tier: Tier, reason: &str) -> Result<()> {
    if json {
        println!(
            "{}",
            serde_json::to_string(&SkippedPhase {
                tier: tier.name(),
                skipped: reason
            })?
        );
    } else {
        eprintln!("== {}: skipped ({reason})", tier.name());
    }
    Ok(())
}

/// The Bun runtime source checkout (oven-sh/bun or a fork): its gates are `bun bd` and the
/// package scripts, not a plain `cargo check` or `bun run test`.
fn is_bun_source(root: &Path) -> bool {
    root.join("Cargo.toml").is_file()
        && fs::read_to_string(root.join("package.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .is_some_and(|package| {
                package["name"] == "bun"
                    && package["scripts"]["bd"].is_string()
                    && package["scripts"]["rust:check-all"].is_string()
            })
}

/// Gates of the Bun runtime source checkout, from its CLAUDE.md and package scripts.
const BUN_SOURCE_GATES: [&str; 5] = [
    "bun bd    # debug build (build/debug/bun-debug)",
    "bun bd test <test-file>    # tests against the debug build, never plain bun test",
    "bun run rust:check-all    # every target, after platform-gated changes",
    "bun run lint    # oxlint --config=oxlint.json src/js",
    "bun run prettier    # formatting of scripts, packages, src, docs and tests",
];

/// Nushell scripts under `scripts/`, honouring ignore files.
fn nushell_scripts(root: &Path) -> Vec<String> {
    let scripts = root.join("scripts");
    if !scripts.is_dir() {
        return Vec::new();
    }
    let mut found: Vec<String> = ignore::WalkBuilder::new(&scripts)
        .require_git(false)
        .build()
        .flatten()
        .filter(|e| {
            e.file_type().is_some_and(|t| t.is_file())
                && e.path().extension().is_some_and(|x| x == "nu")
        })
        .filter_map(|e| {
            e.path()
                .strip_prefix(root)
                .ok()
                .map(|p| p.display().to_string().replace('\\', "/"))
        })
        .collect();
    found.sort();
    found
}

#[derive(Serialize)]
struct PhaseResult {
    tier: &'static str,
    program: String,
    args: Vec<String>,
    success: bool,
}

fn run(root: &Path, json: bool, tier: Tier, program: &str, args: &[String]) -> Result<()> {
    run_at(root, json, tier, program, args)
}

fn run_at(cwd: &Path, json: bool, tier: Tier, program: &str, args: &[String]) -> Result<()> {
    if !json {
        eprintln!("== {}: {} {}", tier.name(), program, args.join(" "));
    }
    let mut command = ProcessCommand::new(program).no_window();
    command.args(args).current_dir(cwd);
    if json {
        // Keep stdout reserved for the phase record; child diagnostics remain on stderr.
        command.stdout(Stdio::null());
    }
    let status = command
        .status()
        .with_context(|| format!("failed to start {program}"))?;
    let result = PhaseResult {
        tier: tier.name(),
        program: program.to_owned(),
        args: args.to_vec(),
        success: status.success(),
    };
    if json {
        println!("{}", serde_json::to_string(&result)?);
    }
    if !status.success() {
        bail!(
            "{} tier failed: {program} exited with {status}",
            tier.name()
        );
    }
    Ok(())
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn doctor(root: &Path, json: bool) -> Result<()> {
    for tool in ["cargo", "bun", "uv", "pwsh", "nu", "rg", "bat", "fd", "eza"] {
        run(root, json, Tier::Tools, tool, &strings(&["--version"]))?;
    }
    Ok(())
}

fn detect(path: &Path, json: bool) -> Result<()> {
    let result = polyglot::inspect_file(path)?;
    if json {
        println!("{}", serde_json::to_string(&result)?);
    } else {
        println!(
            "{}: {} ({})",
            result.path, result.definition.name, result.definition.mime_type
        );
        if let Some(parse) = result.parse {
            println!(
                "lines: code={} comment={} blank={}",
                parse.code_lines, parse.comment_lines, parse.blank_lines
            );
            println!("imports: {}", parse.imports.join(", "));
        }
    }
    Ok(())
}

fn check_tier(root: &Path, json: bool, tier: Tier, all_docs: bool) -> Result<()> {
    match tier {
        Tier::Tools => doctor(root, json),
        Tier::Rust if !root.join("Cargo.toml").is_file() => skip(json, tier, "no Cargo.toml"),
        Tier::Rust if is_bun_source(root) => {
            run(root, json, tier, "bun", &strings(&["run", "rust:check"]))
        }
        Tier::Rust => run(
            root,
            json,
            tier,
            "cargo",
            &strings(&["check", "--workspace", "--all-targets", "--locked"]),
        ),
        Tier::Bun if !root.join("package.json").is_file() => skip(json, tier, "no package.json"),
        Tier::Bun if is_bun_source(root) => {
            run(root, json, tier, "bun", &strings(&["run", "lint"]))
        }
        Tier::Bun => {
            run(
                root,
                json,
                tier,
                "bun",
                &strings(&["install", "--frozen-lockfile"]),
            )?;
            run(root, json, tier, "bun", &strings(&["run", "test"]))?;
            run(root, json, tier, "bun", &strings(&["run", "lint"]))
        }
        Tier::Uv => {
            // Validate every uv project explicitly. `--locked`/`--check` is
            // the dependency gate; the documentation scan remains a separate
            // no-project phase so imported docs do not mutate a lockfile.
            let projects: Vec<PathBuf> = [root.to_path_buf(), root.join("py")]
                .into_iter()
                .filter(|project| project.join("pyproject.toml").is_file())
                .collect();
            for project in &projects {
                run_at(project, json, tier, "uv", &strings(&["lock", "--check"]))?;
            }
            if !root.join("scripts/scan-doc-links.py").is_file() {
                return if projects.is_empty() {
                    skip(
                        json,
                        tier,
                        "no pyproject.toml and no scripts/scan-doc-links.py",
                    )
                } else {
                    Ok(())
                };
            }
            let mut args = strings(&[
                "run",
                "--no-project",
                "python",
                "scripts/scan-doc-links.py",
                "--json",
            ]);
            if all_docs {
                args.push("--all".to_owned());
            }
            run(root, json, tier, "uv", &args)
        }
        Tier::Pwsh if !root.join("scripts/lint-ps1.ps1").is_file() => {
            skip(json, tier, "no scripts/lint-ps1.ps1")
        }
        Tier::Pwsh => run(
            root,
            json,
            tier,
            "pwsh",
            &[
                "-NoProfile".to_owned(),
                "-File".to_owned(),
                "scripts/lint-ps1.ps1".to_owned(),
                "-Root".to_owned(),
                root.display().to_string(),
            ],
        ),
        Tier::Nushell => {
            let scripts = nushell_scripts(root);
            if scripts.is_empty() {
                return skip(json, tier, "no .nu scripts under scripts/");
            }
            for script in &scripts {
                run(
                    root,
                    json,
                    tier,
                    "nu",
                    &strings(&["--ide-check", "100", script]),
                )?;
            }
            Ok(())
        }
    }
}

fn map(root: &Path, out: Option<PathBuf>, map: Option<PathBuf>, command: MapCommand) -> Result<()> {
    let state = repo_state_dir(root);
    let out = out.map_or_else(|| state.join("path.json"), |path| root.join(path));
    let map = map.map_or_else(|| state.join("monorepo-map.json"), |path| root.join(path));
    for file in [&out, &map] {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("cannot create map directory: {}", parent.display()))?;
        }
    }
    match command {
        MapCommand::Scan => {
            let result = mapper::audit::run(root, &out, &map)?;
            eprintln!(
                "map complete: status={:?} workspaces={} submodules={} findings={} duration_ms={}\n\
                 map: {}\naudit: {}",
                result.status,
                result.workspaces,
                result.submodules,
                result.total_findings,
                result.duration_ms,
                map.display(),
                out.display()
            );
            Ok(())
        }
        MapCommand::Check => {
            let result = mapper::audit::run(root, &out, &map)?;
            if result.status == mapper::core::Status::ProductionReady {
                Ok(())
            } else {
                bail!("map findings detected: {}", result.total_findings)
            }
        }
        MapCommand::Watch { debounce_ms } => mapper::watch::run(root, &out, &map, debounce_ms),
    }
}

fn index_database(root: &Path, database: Option<PathBuf>) -> PathBuf {
    database.map_or_else(
        || repo_state_dir(root).join(FS_INDEX_FILE),
        |path| root.join(path),
    )
}

fn shell(root: &Path, json_output: bool, endpoint: &str, command: ShellCommand) -> Result<()> {
    match command {
        ShellCommand::Eval { code } => {
            let value =
                kernel_tool_call(endpoint, "nu_eval", json!({ "code": code, "cwd": root }))?;
            if json_output {
                println!("{}", serde_json::to_string(&value)?);
            } else {
                println!("{}", serde_json::to_string_pretty(&value)?);
            }
        }
        ShellCommand::Commands { filter } => {
            let commands = kernel_tool_call(endpoint, "nu_commands", json!({ "filter": filter }))?;
            if json_output {
                println!("{}", serde_json::to_string(&commands)?);
            } else {
                for command in commands.as_array().into_iter().flatten() {
                    let name = command
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let description = command
                        .get("description")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    println!("{name}: {description}");
                }
            }
        }
        ShellCommand::Describe { command } => {
            let help = kernel_tool_call(endpoint, "nu_help", json!({ "command": command }))?;
            if json_output {
                println!("{}", serde_json::to_string(&help)?);
            } else {
                println!("{help}");
            }
        }
    }
    Ok(())
}

fn existing_index(database: &Path) -> Result<()> {
    let legacy = database.with_file_name(FS_INDEX_LEGACY);
    if !database.is_file() && legacy.is_file() {
        let imported = PathIndex::open(database).import_legacy(&legacy)?;
        eprintln!(
            "imported {imported} entries from {} into {}",
            legacy.display(),
            database.display()
        );
    }
    anyhow::ensure!(
        database.is_file(),
        "filesystem index does not exist: {}; run `aphrody yolo fs build` first",
        database.display()
    );
    Ok(())
}

fn filesystem(root: &Path, json_output: bool, command: FsCommand) -> Result<()> {
    match command {
        FsCommand::Build { database } => {
            let database = index_database(root, database);
            if let Some(parent) = database.parent() {
                fs::create_dir_all(parent).with_context(|| {
                    format!("cannot create index directory: {}", parent.display())
                })?;
            }
            let indexed = build_index(&database, root)?;
            let value = json!({ "database": database, "indexed": indexed });
            if json_output {
                println!("{}", serde_json::to_string(&value)?);
            } else {
                println!("indexed {indexed} metadata entries: {}", database.display());
            }
        }
        FsCommand::Search {
            query,
            limit,
            database,
        } => {
            let database = index_database(root, database);
            existing_index(&database)?;
            let hits = PathIndex::open(&database).search(&query.join(" "), limit)?;
            if json_output {
                println!("{}", serde_json::to_string(&hits)?);
            } else {
                for hit in hits {
                    println!("{}", hit.path);
                }
            }
        }
        FsCommand::Status { database } => {
            let database = index_database(root, database);
            existing_index(&database)?;
            let entries = PathIndex::open(&database).len()?;
            let value = json!({ "database": database, "entries": entries });
            if json_output {
                println!("{}", serde_json::to_string(&value)?);
            } else {
                println!("{} metadata entries: {}", entries, database.display());
            }
        }
    }
    Ok(())
}

fn kernel_request(
    endpoint: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let mut options = ClientOptions::new(endpoint);
    if let Some(token) = std::env::var("APHRODY_OS_AUTH_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
    {
        options = options.with_auth_token(token);
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("cannot start kernel client runtime")?;
    runtime
        .block_on(async {
            let client = KernelClient::connect(options).await?;
            client.call_method(method, params).await
        })
        .with_context(|| format!("kernel request {method} to {endpoint} failed"))
}

fn kernel_subsystem_tools(endpoint: &str, subsystem: &str) -> Result<Vec<serde_json::Value>> {
    let response = kernel_request(
        endpoint,
        "system/subsystem_tools",
        json!({ "name": subsystem }),
    )?;
    response
        .get("tools")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .with_context(|| format!("kernel {subsystem} subsystem response has no tools array"))
}

fn kernel_admin_tools(endpoint: &str) -> Result<Vec<serde_json::Value>> {
    kernel_subsystem_tools(endpoint, "admin")
}

fn kernel_tool_call(
    endpoint: &str,
    tool: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value> {
    let result = kernel_request(
        endpoint,
        "tools/call",
        json!({ "name": tool, "arguments": arguments }),
    )?;
    anyhow::ensure!(
        !result
            .get("isError")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        "kernel tool failed: {tool}"
    );
    Ok(result.get("structuredContent").cloned().unwrap_or(result))
}

fn system(root: &Path, json_output: bool, endpoint: &str) -> Result<()> {
    let database = index_database(root, None);
    let kernel_admin_tools = kernel_admin_tools(endpoint);
    let kernel_shell_ready = kernel_subsystem_tools(endpoint, "shell").is_ok();
    let status = SystemStatus {
        terminal_shell: default_shell(),
        kernel_shell_ready,
        filesystem_index: database.display().to_string(),
        filesystem_index_ready: database.is_file(),
        kernel_endpoint: endpoint.to_owned(),
        kernel_reachable: kernel_admin_tools.is_ok(),
        kernel_admin_tools: kernel_admin_tools.map_or(0, |tools| tools.len()),
    };
    if json_output {
        println!("{}", serde_json::to_string(&status)?);
    } else {
        println!("terminal shell: {}", status.terminal_shell);
        println!("kernel Nushell: {}", status.kernel_shell_ready);
        println!("filesystem index: {}", status.filesystem_index);
        println!("filesystem index ready: {}", status.filesystem_index_ready);
        println!("kernel endpoint: {}", status.kernel_endpoint);
        println!("kernel reachable: {}", status.kernel_reachable);
        println!("kernel admin tools: {}", status.kernel_admin_tools);
    }
    Ok(())
}

fn windows(json_output: bool, endpoint: &str, command: WinCommand) -> Result<()> {
    match command {
        WinCommand::Catalog { filter } => {
            let needle = filter.as_deref().map(str::to_ascii_lowercase);
            let tools = kernel_admin_tools(endpoint)?
                .into_iter()
                .filter(|tool| {
                    needle.as_ref().is_none_or(|needle| {
                        tool.get("name")
                            .and_then(serde_json::Value::as_str)
                            .is_some_and(|name| name.to_ascii_lowercase().contains(needle))
                            || tool
                                .get("description")
                                .and_then(serde_json::Value::as_str)
                                .is_some_and(|description| {
                                    description.to_ascii_lowercase().contains(needle)
                                })
                    })
                })
                .collect::<Vec<_>>();
            if json_output {
                println!("{}", serde_json::to_string(&tools)?);
            } else {
                for tool in tools {
                    let name = tool
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let description = tool
                        .get("description")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    println!("{name}: {description}");
                }
            }
        }
        WinCommand::Status => {
            let tools = kernel_admin_tools(endpoint)?;
            let value = json!({
                "kernel_endpoint": endpoint,
                "kernel_reachable": true,
                "admin_tools": tools.len(),
            });
            if json_output {
                println!("{}", serde_json::to_string(&value)?);
            } else {
                println!("{}", serde_json::to_string_pretty(&value)?);
            }
        }
        WinCommand::Call { tool, args } => {
            let arguments: serde_json::Value =
                serde_json::from_str(&args).context("kernel tool arguments must be JSON")?;
            anyhow::ensure!(
                arguments.is_object(),
                "kernel tool arguments must be a JSON object"
            );
            anyhow::ensure!(
                kernel_admin_tools(endpoint)?.iter().any(|entry| entry
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    == Some(&tool)),
                "unknown kernel admin tool: {tool}"
            );
            let result = kernel_request(
                endpoint,
                "tools/call",
                json!({ "name": tool, "arguments": arguments }),
            )?;
            anyhow::ensure!(
                !result
                    .get("isError")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                "kernel admin tool failed: {tool}"
            );
            if json_output {
                println!("{}", serde_json::to_string(&result)?);
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
    }
    Ok(())
}

fn parse_open_tasks(path: &Path) -> Result<Vec<String>> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("cannot read plan file: {}", path.display()))?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|line| {
            (line.starts_with('-') || line.starts_with('*') || line.starts_with('|'))
                && (line.contains('⏳') || line.contains("[ ]") || line.contains("TODO:"))
        })
        .map(|line| {
            line.trim_start_matches(['-', '*', ' ', '[', ']', '⏳', '|'])
                .trim_start_matches("TODO:")
                .trim()
                .to_owned()
        })
        .filter(|task| !task.is_empty())
        .collect())
}

fn root_entries(root: &Path) -> Result<Vec<String>> {
    fs::read_dir(root)
        .with_context(|| format!("cannot read repository root: {}", root.display()))?
        .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
        .collect::<std::io::Result<Vec<_>>>()
        .context("cannot enumerate repository root")
}

fn has_extension(entries: &[String], extensions: &[&str]) -> bool {
    entries.iter().any(|entry| {
        extensions
            .iter()
            .any(|extension| entry.ends_with(extension))
    })
}

fn yolo_plan(root: &Path, json: bool) -> Result<()> {
    yolo_plan_resources(root, &yolo_root(root)?, json)
}

fn yolo_plan_resources(root: &Path, resources: &Path, json: bool) -> Result<()> {
    let manifest = resources.join("yolo.json");
    let value: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&manifest)
            .with_context(|| format!("cannot read YOLO manifest: {}", manifest.display()))?,
    )
    .context("invalid YOLO manifest JSON")?;
    let schema = value
        .get("$schema")
        .and_then(serde_json::Value::as_str)
        .context("YOLO manifest has no $schema")?;
    if !manifest.parent().unwrap_or(root).join(schema).is_file() {
        bail!("YOLO manifest schema does not exist: {schema}");
    }
    let manifest_id = value
        .get("id")
        .and_then(serde_json::Value::as_str)
        .context("YOLO manifest has no id")?
        .to_owned();

    let plan_file = [
        "docs/PLAN-POLYGLOT-2026.md",
        "docs/PLAN.md",
        "UNIFIED-PLAN.md",
        "docs/UNIFIED-PLAN.md",
        "PLAN.md",
        "TODO.md",
        "todo.md",
        "tasks.md",
    ]
    .into_iter()
    .map(|candidate| (candidate, root.join(candidate)))
    .find(|(_, path)| path.is_file());
    let (plan_file, actionable_tasks) = match plan_file {
        Some((candidate, path)) => (Some(candidate.to_owned()), parse_open_tasks(&path)?),
        None => (None, Vec::new()),
    };

    let entries = root_entries(root)?;
    let mut runtimes = Vec::new();
    let mut languages = entries
        .iter()
        .map(|entry| polyglot::detect(Path::new(entry), None).name.to_owned())
        .filter(|name| name != "Plain Text")
        .collect::<Vec<_>>();
    let mut gates = Vec::new();
    let bun_source = is_bun_source(root);
    if bun_source {
        runtimes.extend(["bun-source".to_owned(), "rust".to_owned(), "bun".to_owned()]);
        gates.extend(BUN_SOURCE_GATES.iter().map(|gate| (*gate).to_owned()));
    } else {
        if root.join("Cargo.toml").is_file() {
            runtimes.push("rust".to_owned());
            gates.push("aphrody yolo verify --tier rust".to_owned());
        }
        if root.join("package.json").is_file() {
            runtimes.push("bun".to_owned());
            gates.push("aphrody yolo verify --tier bun".to_owned());
        }
    }
    if root.join("scripts/scan-doc-links.py").is_file()
        || root.join("pyproject.toml").is_file()
        || root.join("py/pyproject.toml").is_file()
    {
        runtimes.push("uv".to_owned());
        gates.push("aphrody yolo verify --tier uv".to_owned());
    }
    if root.join("scripts/lint-ps1.ps1").is_file() {
        runtimes.push("powershell".to_owned());
        gates.push("aphrody yolo verify --tier pwsh".to_owned());
    }
    if !nushell_scripts(root).is_empty() {
        runtimes.push("nushell".to_owned());
        gates.push("aphrody yolo verify --tier nushell".to_owned());
    }
    #[cfg(windows)]
    {
        runtimes.push("winclean".to_owned());
        gates.push("aphrody yolo win status".to_owned());
    }
    if has_extension(&entries, &[".sln", ".csproj"]) {
        runtimes.push("csharp".to_owned());
        gates.push("dotnet build && dotnet test".to_owned());
    }
    if root.join("CMakeLists.txt").is_file()
        || root.join("Makefile").is_file()
        || has_extension(&entries, &[".c", ".cc", ".cpp", ".cxx"])
    {
        runtimes.push("c-cpp".to_owned());
        gates.push("ctest || make test".to_owned());
    }
    if has_extension(&entries, &[".asm", ".nasm", ".s"]) {
        runtimes.push("assembly".to_owned());
        gates.push("nasm -f elf64 || as".to_owned());
    }
    if root.join("go.mod").is_file() {
        runtimes.push("go".to_owned());
        gates.push("go test ...".to_owned());
    }
    if root.join("index.html").is_file() || has_extension(&entries, &[".html", ".css"]) {
        runtimes.push("web".to_owned());
    }
    if root.join("docs").is_dir()
        || root.join("schemas").is_dir()
        || root.join("README.md").is_file()
    {
        runtimes.push("docs-schemas".to_owned());
    }
    runtimes.sort();
    runtimes.dedup();
    languages.sort();
    languages.dedup();
    let filesystem_index = index_database(root, None);

    let plan = YoloPlan {
        manifest: manifest.display().to_string(),
        manifest_id,
        plan_file,
        actionable_tasks,
        runtimes,
        languages,
        gates,
        native_shell: default_shell(),
        filesystem_index_ready: filesystem_index.is_file(),
        filesystem_index: filesystem_index.display().to_string(),
    };
    if json {
        println!("{}", serde_json::to_string(&plan)?);
    } else {
        println!("YOLO manifest: {}", plan.manifest_id);
        println!("Runtimes: {}", plan.runtimes.join(", "));
        println!("Languages: {}", plan.languages.join(", "));
        println!("Native shell: {}", plan.native_shell);
        println!("Filesystem index: {}", plan.filesystem_index);
        println!("Gates:");
        for gate in &plan.gates {
            println!("  {gate}");
        }
        println!("Actionable tasks: {}", plan.actionable_tasks.len());
    }
    Ok(())
}

fn yolo_check(root: &Path, json: bool) -> Result<()> {
    yolo_check_resources(root, &yolo_root(root)?, json)
}

fn yolo_check_resources(root: &Path, yolo_root: &Path, json: bool) -> Result<()> {
    anyhow::ensure!(
        !root.join("packages/yolo/package.json").is_file(),
        "obsolete packages/yolo package must not exist; YOLO belongs to the Aphrody plugin"
    );
    anyhow::ensure!(
        !root
            .join("crates/aphrody-yolo/resources/yolo/yolo.json")
            .exists(),
        "duplicate YOLO manifest remains under aphrody-yolo resources"
    );
    let manifest_path = yolo_root.join("yolo.json");
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path)
            .with_context(|| format!("cannot read YOLO manifest: {}", manifest_path.display()))?,
    )
    .context("invalid YOLO manifest JSON")?;
    let schema = manifest
        .get("$schema")
        .and_then(serde_json::Value::as_str)
        .context("YOLO manifest has no $schema")?;
    anyhow::ensure!(
        yolo_root.join(schema).is_file(),
        "YOLO manifest schema does not exist: {schema}"
    );
    let manifest_id = manifest
        .get("id")
        .and_then(serde_json::Value::as_str)
        .context("YOLO manifest has no id")?
        .to_owned();
    let entrypoints = manifest
        .get("entrypoints")
        .and_then(serde_json::Value::as_object)
        .context("YOLO manifest has no entrypoints")?;
    anyhow::ensure!(
        entrypoints.values().all(|entry| entry
            .as_str()
            .is_some_and(|entry| entry.starts_with("aphrody-yolo"))),
        "YOLO entrypoints must use aphrody-yolo"
    );
    let agents = fs::read_dir(yolo_root.join("agents"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "md"))
        .map(|entry| -> Result<()> {
            let text = fs::read_to_string(entry.path())?;
            anyhow::ensure!(
                text.starts_with("---\n") || text.starts_with("---\r\n"),
                "agent has no frontmatter: {}",
                entry.path().display()
            );
            anyhow::ensure!(
                text.contains("\nname:") && text.contains("\ndescription:"),
                "agent frontmatter is incomplete: {}",
                entry.path().display()
            );
            Ok(())
        })
        .collect::<Result<Vec<_>>>()?
        .len();
    anyhow::ensure!(agents > 0, "YOLO has no agent definitions");

    let skills = fs::read_dir(yolo_root.join("skills"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .map(|entry| -> Result<()> {
            anyhow::ensure!(
                entry.path().join("SKILL.md").is_file(),
                "skill has no SKILL.md: {}",
                entry.path().display()
            );
            Ok(())
        })
        .collect::<Result<Vec<_>>>()?
        .len();
    anyhow::ensure!(skills > 0, "YOLO has no skills");

    let result = YoloCheck {
        manifest_id,
        agents,
        skills,
    };
    if json {
        println!("{}", serde_json::to_string(&result)?);
    } else {
        println!(
            "YOLO validated: {} agents, {} skills",
            result.agents, result.skills
        );
    }
    Ok(())
}

/// Resources belong to the canonical plugin, never to a versioned plugin cache. Without an
/// override, the first `plugins/aphrody` holding a `yolo.json` wins among: the repository root
/// and its ancestors, the plugins checkout of the Aphrody state (`<state>/workspace/plugins`),
/// then the installed plugin copy (`<state>/plugins/aphrody`). Relative overrides are resolved
/// against the requested repository root.
fn resolve_yolo_root(
    root: &Path,
    override_path: Option<&Path>,
    state: Option<&Path>,
) -> Result<PathBuf> {
    let candidates = match override_path {
        Some(path) => {
            anyhow::ensure!(
                !path.as_os_str().is_empty(),
                "APHRODY_YOLO_ROOT cannot be empty"
            );
            vec![if path.is_absolute() {
                path.to_path_buf()
            } else {
                root.join(path)
            }]
        }
        None => {
            let mut list: Vec<PathBuf> = root
                .ancestors()
                .map(|dir| dir.join("plugins/aphrody"))
                .collect();
            if let Some(state) = state {
                list.push(state.join("workspace/plugins/aphrody"));
                list.push(state.join("plugins/aphrody"));
            }
            list
        }
    };
    let path = candidates
        .iter()
        .find(|candidate| candidate.join("yolo.json").is_file())
        .with_context(|| {
            format!(
                "YOLO resources missing: no yolo.json in {} (override: APHRODY_YOLO_ROOT)",
                candidates
                    .iter()
                    .map(|c| c.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(path.join("yolo.json"))?)
        .with_context(|| format!("invalid YOLO manifest: {}", path.display()))?;
    let schema = manifest["$schema"]
        .as_str()
        .context("YOLO manifest has no $schema")?;
    anyhow::ensure!(
        path.join(schema).is_file(),
        "YOLO manifest schema does not exist: {}",
        path.join(schema).display()
    );
    for directory in ["agents", "skills"] {
        anyhow::ensure!(
            path.join(directory).is_dir(),
            "YOLO resources missing: {}",
            path.join(directory).display()
        );
    }
    Ok(path.clone())
}

fn yolo_root(root: &Path) -> Result<PathBuf> {
    let override_path = std::env::var_os("APHRODY_YOLO_ROOT").map(PathBuf::from);
    resolve_yolo_root(root, override_path.as_deref(), state_dir().as_deref())
}

fn task_owner(title: &str) -> &'static str {
    let title = title.to_ascii_lowercase();
    if title.contains("rust") || title.contains("cargo") || title.contains("crate") {
        "rust-engineer"
    } else if title.contains("bun") || title.contains("typescript") || title.contains("web") {
        "bun-web-engineer"
    } else if title.contains("window") || title.contains("winclean") || title.contains("desktop") {
        "windows-engineer"
    } else if title.contains("test") || title.contains("lint") || title.contains("audit") {
        "quality-auditor"
    } else {
        "yolo-prod-ready"
    }
}

fn runtime_tasks(root: &Path, goals: &[String]) -> Result<Vec<RuntimeTask>> {
    if !goals.is_empty() {
        anyhow::ensure!(
            goals.len() <= 4,
            "at most four direct missions are supported"
        );
        anyhow::ensure!(
            goals.iter().all(|title| !title.trim().is_empty()),
            "direct missions cannot be empty"
        );
        return Ok(goals
            .iter()
            .enumerate()
            .map(|(index, title)| RuntimeTask {
                id: index + 1,
                owner: task_owner(title),
                title: title.clone(),
            })
            .collect());
    }
    let plan_file = [
        "docs/PLAN.md",
        "docs/PLAN-POLYGLOT-2026.md",
        "UNIFIED-PLAN.md",
        "docs/UNIFIED-PLAN.md",
        "PLAN.md",
        "TODO.md",
        "todo.md",
        "tasks.md",
    ]
    .into_iter()
    .map(|candidate| root.join(candidate))
    .find(|path| path.is_file());
    let tasks = plan_file.map_or_else(|| Ok(Vec::new()), |path| parse_open_tasks(&path))?;
    let tasks = if tasks.is_empty() {
        vec![
            "Inspect the runtime state, select the highest-leverage autonomous improvement, \
             implement and verify it."
                .to_owned(),
        ]
    } else {
        tasks
    };
    Ok(tasks
        .into_iter()
        .take(4)
        .enumerate()
        .map(|(index, title)| RuntimeTask {
            id: index + 1,
            owner: task_owner(&title),
            title,
        })
        .collect())
}

fn yolo_grind(root: &Path, json: bool, dry_run: bool, goals: &[String]) -> Result<YoloTick> {
    yolo_plan(root, json)?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let run_id = format!("tick-{}", chrono::Utc::now().timestamp_millis());
    let tasks = runtime_tasks(root, goals)?;
    let tick = YoloTick {
        timestamp,
        run_id,
        event: "tick",
        tasks,
        coordinated: !dry_run,
    };
    if dry_run {
        if json {
            println!("{}", serde_json::to_string(&tick)?);
        } else {
            println!("YOLO dry-run: {} task(s)", tick.tasks.len());
        }
        return Ok(tick);
    }

    let state = root.join("var/yolo");
    let run = state.join("runs").join(&tick.run_id);
    let coord = root.join(".coord");
    fs::create_dir_all(&run)?;
    fs::create_dir_all(&coord)?;
    fs::write(run.join("manifest.json"), serde_json::to_vec_pretty(&tick)?)?;
    fs::write(
        state.join("heartbeat.txt"),
        format!("{} {}\n", tick.timestamp, tick.run_id),
    )?;
    let envelope = CoordEnvelope {
        v: 1,
        ts: chrono::Utc::now().to_rfc3339(),
        id: &tick.run_id,
        from: "aphrody-yolo",
        to: "peers",
        kind: "fact",
        topic: "yolo-tick",
        body: &tick.tasks,
    };
    fs::write(
        coord.join("heartbeat-aphrody-yolo.txt"),
        format!("{} {}\n", envelope.ts, tick.run_id),
    )?;
    let mut inbox = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(coord.join("inbox-from-aphrody-yolo.jsonl"))?;
    writeln!(inbox, "{}", serde_json::to_string(&envelope)?)?;
    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.join("ticks.jsonl"))?;
    writeln!(log, "{}", serde_json::to_string(&tick)?)?;
    if json {
        println!("{}", serde_json::to_string(&tick)?);
    } else {
        println!("YOLO tick {}: {} task(s)", tick.run_id, tick.tasks.len());
    }
    Ok(tick)
}

fn select_harness(explicit: Option<String>) -> Result<String> {
    if let Some(candidate) = explicit {
        anyhow::ensure!(
            ProcessCommand::new(&candidate)
                .no_window()
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok(),
            "requested agent harness is unavailable: {candidate}"
        );
        return Ok(candidate);
    }
    let mut candidates = ["agy".to_owned(), "claude".to_owned(), "gemini".to_owned()].into_iter();
    candidates
        .find(|candidate| {
            ProcessCommand::new(candidate)
                .no_window()
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok()
        })
        .context("no agent harness found (agy, claude or gemini)")
}

fn select_auditor() -> Result<String> {
    ["gemini", "claude", "agy"]
        .into_iter()
        .find(|candidate| {
            ProcessCommand::new(candidate)
                .no_window()
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok()
        })
        .map(str::to_owned)
        .context("no auditor harness found (gemini, claude or agy)")
}

fn run_lead_lanes(
    root: &Path,
    harness: &str,
    tasks: &[RuntimeTask],
    sequential: bool,
) -> Result<()> {
    let mut lanes = Vec::with_capacity(tasks.len());
    for task in tasks {
        let prompt = format!(
            "YOLO lead lane {}. Role: {}. Task: {}. Own a distinct file family, implement \
             end-to-end, run relevant gates, then report FAIT/INCOMPLET/NON_FAIT with evidence. \
             Route Windows administration through the running aphrody-kernel admin subsystem.",
            task.id, task.owner, task.title,
        );
        let child = ProcessCommand::new(harness)
            .no_window()
            .args(harness_args(harness, &prompt))
            .current_dir(root)
            .spawn()
            .with_context(|| format!("cannot start lead lane {} via {harness}", task.id))?;
        if sequential {
            let mut child = child;
            let status = child
                .wait()
                .with_context(|| format!("cannot wait for lead lane {}", task.id))?;
            anyhow::ensure!(
                status.success(),
                "lead lane {} exited with {status}",
                task.id
            );
            continue;
        }
        lanes.push((task.id, child));
    }
    for (id, mut lane) in lanes {
        let status = lane
            .wait()
            .with_context(|| format!("cannot wait for lead lane {id}"))?;
        anyhow::ensure!(status.success(), "lead lane {id} exited with {status}");
    }
    Ok(())
}

fn run_auditor_lane(root: &Path, harness: &str, tick: &YoloTick) -> Result<()> {
    let prompt = format!(
        "YOLO independent auditor. Audit run {} in var/yolo/runs/{}/manifest.json. Inspect the \
         current working tree and validation evidence. Do not implement features. Report only \
         verified FAIT/INCOMPLET/NON_FAIT findings with exact paths and commands.",
        tick.run_id, tick.run_id
    );
    let status = ProcessCommand::new(harness)
        .no_window()
        .args(harness_args(harness, &prompt))
        .current_dir(root)
        .status()
        .with_context(|| format!("cannot start auditor lane via {harness}"))?;
    anyhow::ensure!(status.success(), "auditor lane exited with {status}");
    Ok(())
}

struct AutopilotOptions {
    json: bool,
    once: bool,
    dry_run: bool,
    interval_secs: u64,
    max_ticks: Option<u64>,
    harness: Option<String>,
    sequential: bool,
    goals: Vec<String>,
}

fn yolo_autopilot(root: &Path, options: AutopilotOptions) -> Result<()> {
    let mut ticks = 0_u64;
    loop {
        if options.max_ticks.is_some_and(|limit| ticks >= limit) {
            return Ok(());
        }
        ticks += 1;
        if options.dry_run {
            yolo_grind(root, options.json, true, &options.goals)?;
            return Ok(());
        }
        let harness = select_harness(options.harness.clone())?;
        let auditor = select_auditor()?;
        let tick = yolo_grind(root, options.json, false, &options.goals)?;
        run_lead_lanes(root, &harness, &tick.tasks, options.sequential)?;
        run_auditor_lane(root, &auditor, &tick)?;
        if options.once {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(options.interval_secs.max(1)));
    }
}

fn harness_args<'a>(harness: &str, prompt: &'a str) -> [&'a str; 2] {
    if harness == "gemini" {
        ["--prompt", prompt]
    } else {
        ["-p", prompt]
    }
}

/// `\\?\C:\x` → `C:\x`; UNC (`\\?\UNC\`) and non-Windows paths are kept.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// Entry point of the former `aphrody-yolo` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<std::ffi::OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    let endpoint = cli
        .socket
        .clone()
        .unwrap_or_else(aphrody_kernel_client::default_endpoint);
    let root = match cli.root.canonicalize().map(strip_verbatim) {
        Ok(root) if root.is_dir() => root,
        Ok(root) => {
            eprintln!("repository root is not a directory: {}", root.display());
            return 2;
        }
        Err(error) => {
            eprintln!("cannot resolve repository root: {error}");
            return 2;
        }
    };

    let result = match cli.command {
        Command::Doctor => doctor(&root, cli.json),
        Command::Detect { path } => detect(&root.join(path), cli.json),
        Command::Verify { tier, all_docs } => {
            let tiers = if tier.is_empty() {
                Tier::ALL.to_vec()
            } else {
                tier
            };
            tiers
                .into_iter()
                .try_for_each(|tier| check_tier(&root, cli.json, tier, all_docs))
        }
        Command::Map {
            out,
            map: map_out,
            command,
        } => map(&root, out, map_out, command),
        Command::Shell { command } => shell(&root, cli.json, &endpoint, command),
        Command::Fs { command } => filesystem(&root, cli.json, command),
        Command::Win { command } => windows(cli.json, &endpoint, command),
        Command::System => system(&root, cli.json, &endpoint),
        Command::Plan => yolo_plan(&root, cli.json),
        Command::Check => yolo_check(&root, cli.json),
        Command::Grind { dry_run, goal } => {
            let goals = goal.into_iter().collect::<Vec<_>>();
            yolo_grind(&root, cli.json, dry_run, &goals).map(|_| ())
        }
        Command::Autopilot {
            once,
            dry_run,
            interval_secs,
            max_ticks,
            harness,
            sequential,
            goal,
        } => yolo_autopilot(
            &root,
            AutopilotOptions {
                json: cli.json,
                once,
                dry_run,
                interval_secs,
                max_ticks,
                harness,
                sequential,
                goals: goal,
            },
        ),
        Command::Ingest {
            source,
            max_size,
            include,
            exclude,
            branch,
            tag,
            subpath,
            token,
            output,
        } => (|| -> Result<()> {
            let options = aphrody_git::IngestOptions {
                max_file_size: max_size,
                include_patterns: include,
                exclude_patterns: exclude,
                branch,
                tag,
                subpath,
                token,
                include_gitignored: false,
                include_submodules: false,
            };
            if !aphrody_git::is_remote_source(&source) {
                anyhow::bail!(
                    "local directory ingestion moved to the `git_ingest` tool of `bun mcp` (Bun fork)"
                );
            }
            let ingest_result = aphrody_git::ingest_remote(source.trim(), &options)
                .map_err(|e| anyhow::anyhow!("ingestion failed: {e}"))?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&ingest_result)?);
            } else {
                let context = ingest_result.full_context();
                if let Some(out_path) = output {
                    if out_path == "-" {
                        print!("{context}");
                    } else {
                        fs::write(&out_path, &context)?;
                        eprintln!(
                            "Digest written to {} ({} files, {} tokens)",
                            out_path, ingest_result.file_count, ingest_result.formatted_tokens
                        );
                    }
                } else {
                    print!("{context}");
                }
            }
            Ok(())
        })(),
    };
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("aphrody-yolo: {error:#}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "aphrody-yolo-resources-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn plugin(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.join("schemas")).unwrap();
            fs::create_dir_all(path.join("agents")).unwrap();
            fs::create_dir_all(path.join("skills/yolo")).unwrap();
            fs::write(path.join("yolo.json"), r#"{"$schema":"./schemas/yolo.schema.json","id":"fixture","entrypoints":{"plan":"aphrody-yolo plan"}}"#).unwrap();
            fs::write(path.join("schemas/yolo.schema.json"), "{}").unwrap();
            fs::write(
                path.join("agents/lead.md"),
                "---\nname: lead\ndescription: fixture\n---\n",
            )
            .unwrap();
            fs::write(path.join("skills/yolo/SKILL.md"), "fixture").unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn consolidated_plugin_supports_plan_and_check_without_override() {
        let fixture = Fixture::new();
        let expected = fixture.plugin("plugins/aphrody");
        let resources = resolve_yolo_root(&fixture.0, None, None).unwrap();
        assert_eq!(resources, expected);
        yolo_plan_resources(&fixture.0, &resources, true).unwrap();
        yolo_check_resources(&fixture.0, &resources, true).unwrap();
    }

    #[test]
    fn explicit_resource_override_is_authoritative_and_validated() {
        let fixture = Fixture::new();
        fixture.plugin("plugins/aphrody");
        let external = fixture.plugin("custom plugin");
        assert_eq!(
            resolve_yolo_root(&fixture.0, Some(Path::new("custom plugin")), None).unwrap(),
            external
        );
        assert_eq!(
            resolve_yolo_root(&fixture.0, Some(&external), None).unwrap(),
            external
        );
        assert!(resolve_yolo_root(&fixture.0, Some(Path::new("missing")), None).is_err());
        assert!(resolve_yolo_root(&fixture.0, Some(Path::new("")), None).is_err());
        fs::remove_file(external.join("schemas/yolo.schema.json")).unwrap();
        assert!(
            resolve_yolo_root(&fixture.0, Some(&external), None)
                .unwrap_err()
                .to_string()
                .contains("schema")
        );
        fs::remove_file(fixture.0.join("plugins/aphrody/yolo.json")).unwrap();
        assert!(resolve_yolo_root(&fixture.0, None, None).is_err());
    }

    #[test]
    fn resources_are_found_in_ancestors_then_the_state_checkout() {
        let fixture = Fixture::new();
        let repo = fixture.0.join("work/repo");
        fs::create_dir_all(&repo).unwrap();
        let state = fixture.0.join("state");
        let installed = fixture.plugin("state/plugins/aphrody");
        assert_eq!(
            resolve_yolo_root(&repo, None, Some(&state)).unwrap(),
            installed
        );
        let checkout = fixture.plugin("state/workspace/plugins/aphrody");
        assert_eq!(
            resolve_yolo_root(&repo, None, Some(&state)).unwrap(),
            checkout
        );
        let ancestor = fixture.plugin("work/plugins/aphrody");
        assert_eq!(
            resolve_yolo_root(&repo, None, Some(&state)).unwrap(),
            ancestor
        );
        let error = resolve_yolo_root(&fixture.0.join("elsewhere"), None, None).unwrap_err();
        assert!(error.to_string().contains("no yolo.json"), "{error}");
    }

    #[test]
    fn verify_skips_tiers_without_inputs() {
        let fixture = Fixture::new();
        for tier in [Tier::Nushell, Tier::Pwsh, Tier::Uv, Tier::Rust, Tier::Bun] {
            check_tier(&fixture.0, true, tier, false).unwrap();
        }
        fs::create_dir_all(fixture.0.join("scripts")).unwrap();
        fs::write(fixture.0.join("scripts/build.ts"), "").unwrap();
        assert!(nushell_scripts(&fixture.0).is_empty());
        fs::write(fixture.0.join("scripts/check.nu"), "").unwrap();
        assert_eq!(nushell_scripts(&fixture.0), ["scripts/check.nu"]);
    }

    #[test]
    fn the_bun_source_checkout_is_recognised() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("Cargo.toml"), "[workspace]\n").unwrap();
        fs::write(
            fixture.0.join("package.json"),
            r#"{"name":"bun","scripts":{"bd":"x"}}"#,
        )
        .unwrap();
        assert!(!is_bun_source(&fixture.0));
        fs::write(
            fixture.0.join("package.json"),
            r#"{"name":"bun","scripts":{"bd":"x","rust:check-all":"y"}}"#,
        )
        .unwrap();
        assert!(is_bun_source(&fixture.0));
    }

    #[test]
    fn the_filesystem_index_honours_gitignore_and_migrates_the_text_index() {
        let fixture = Fixture::new();
        let root = fixture.0.join("repo");
        for (path, text) in [
            (".gitignore", "ignored/\n"),
            ("src/http/client.rs", "x"),
            ("src/http/server.rs", "x"),
            ("docs/http.md", "x"),
            ("ignored/client.rs", "x"),
            (".git/config", "x"),
            (".github/workflows/ci.yml", "x"),
        ] {
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        let database = fixture.0.join(FS_INDEX_FILE);
        assert_eq!(build_index(&database, &root).unwrap(), 5);
        let index = PathIndex::open(&database);
        let found = |query: &str| -> Vec<String> {
            index
                .search(query, 10)
                .unwrap()
                .into_iter()
                .map(|hit| {
                    hit.path
                        .replace('\\', "/")
                        .rsplit("repo/")
                        .next()
                        .unwrap()
                        .to_owned()
                })
                .collect()
        };
        assert_eq!(found("HTTP client"), ["src/http/client.rs"]);
        let mut http = found("http");
        http.sort();
        assert_eq!(
            http,
            ["docs/http.md", "src/http/client.rs", "src/http/server.rs"]
        );
        assert!(found("ignored").is_empty());
        assert!(found("config").is_empty());
        assert_eq!(found("workflows"), [".github/workflows/ci.yml"]);
        assert_eq!(index.len().unwrap(), 5);
        assert!(
            index
                .search("http", 10)
                .unwrap()
                .iter()
                .all(|hit| hit.size == 1 && hit.modified > 0)
        );

        let legacy = fixture.0.join("state").join(FS_INDEX_LEGACY);
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, "C:\\repo\\src\\Lib.rs\t42\t7\nbroken line\n").unwrap();
        let migrated = legacy.with_file_name(FS_INDEX_FILE);
        existing_index(&migrated).unwrap();
        assert!(!legacy.exists());
        assert_eq!(PathIndex::open(&migrated).len().unwrap(), 1);
    }

    #[test]
    fn verbatim_prefixes_are_removed_except_unc() {
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\C:\bun")),
            PathBuf::from(r"C:\bun")
        );
        let unc = PathBuf::from(r"\\?\UNC\host\share");
        assert_eq!(strip_verbatim(unc.clone()), unc);
        assert_eq!(
            strip_verbatim(PathBuf::from("/data/x")),
            PathBuf::from("/data/x")
        );
    }

    #[test]
    fn repository_state_stays_outside_the_checkout() {
        let fixture = Fixture::new();
        let state = repo_state_dir(&fixture.0);
        assert!(!state.starts_with(&fixture.0) || std::env::var_os("APHRODY_HOME").is_none());
        assert_eq!(state, repo_state_dir(&fixture.0));
        assert_ne!(state, repo_state_dir(&fixture.0.join("other")));
    }

    #[test]
    fn aphrody_plugin_yolo_resources_validate_without_a_bun_package() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .find(|path| path.join("Cargo.toml").is_file() && path.join("package.json").is_file())
            .expect("workspace root");
        // plugins/ is its own repository, checked out beside the sources on developer hosts only.
        if !root.join("plugins/aphrody/yolo.json").is_file() {
            eprintln!(
                "skipped: no plugins/aphrody checkout under {}",
                root.display()
            );
            return;
        }
        yolo_check(root, false).expect("the Aphrody plugin YOLO resources must validate");
    }
}
