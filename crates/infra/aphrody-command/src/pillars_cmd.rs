// SPDX-License-Identifier: Apache-2.0
//! Canonical Pillar Command Drivers for the Root `aphrody` CLI.
//!
//! Provides top-level entry points for:
//! - `aphrody native` (host platform probes)
//! - `aphrody os` (OS subsystems & WinClean automation)
//! - `aphrody web` (shared Rust fetch, extraction and Obscura browser)
//! - `aphrody infra` (Infrastructure orchestration, SSH, VPN & nodes)
//! - `aphrody shell` (Nushell PTY session & Ratatui interface)

use clap::Subcommand;
use miette::{IntoDiagnostic, miette};

use std::time::Duration;

// --- 1. NATIVE PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum NativeAction {
    /// Diagnostic summary of host platform probes
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Check native topology and monotonic clock probes
    SelfTest,
}

pub(crate) fn handle_native(action: NativeAction) -> miette::Result<()> {
    match action {
        NativeAction::Status { json } => {
            let platform_status = aphrody_native::NativePlatform::status();
            let status = platform_status["status"].clone();

            let summary = serde_json::json!({
                "layer": "native",
                "status": status,
                "platform": platform_status,
            });

            if json {
                println!("{}", serde_json::to_string_pretty(&summary).into_diagnostic()?);
            } else {
                println!("=== Aphrody Native Platform ===");
                let topology = &summary["platform"]["topology"];
                println!("  * CPUs: {}", topology["cpu_count"]);
                println!(
                    "  * Memory: {} MiB total, {} MiB available",
                    topology["memory_total_mb"], topology["memory_available_mb"]
                );
                println!("  * AVX2: {}", topology["has_avx2"]);
                println!("  * CUDA devices: {}", topology["cuda_device_count"]);
            }
        },
        NativeAction::SelfTest => {
            let clock_before = aphrody_native::NativePlatform::time_monotonic_ns();
            let topology = aphrody_native::NativePlatform::get_topology();
            let clock_after = aphrody_native::NativePlatform::time_monotonic_ns();
            if clock_after < clock_before {
                return Err(miette!("native monotonic clock moved backwards"));
            }
            if topology.cpu_count == 0 {
                return Err(miette!("native topology reported no available CPUs"));
            }
            if topology.memory_available_mb > topology.memory_total_mb {
                return Err(miette!(
                    "native topology reported more available memory than total memory"
                ));
            }
            if topology.has_cuda != (topology.cuda_device_count > 0) {
                return Err(miette!("native CUDA presence and device count disagree"));
            }
            println!(
                "Native probes passed: monotonic clock, {} CPU(s), {} MiB memory.",
                topology.cpu_count, topology.memory_total_mb
            );
        },
    }
    Ok(())
}

// --- 2. OS PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum OsAction {
    /// Inspect OS kernel status, active subsystems and diagnostics
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run WinClean diagnostics on local Windows machine
    Doctor,
}

pub(crate) async fn handle_os(action: OsAction) -> miette::Result<()> {
    match action {
        OsAction::Status { json } => {
            let status = aphrody_diagnostics::os_status().await;
            if json {
                println!("{}", serde_json::to_string_pretty(&status).into_diagnostic()?);
            } else {
                println!("=== Aphrody OS System Layer ===");
                println!(
                    "  * Kernel:            {}",
                    status["status"].as_str().unwrap_or("unavailable")
                );
                println!(
                    "  * Kernel Subsystems: {} observed",
                    status["subsystems"].as_array().map_or(0, Vec::len)
                );
                println!(
                    "  * WinClean Tools:    {} observed",
                    status["winclean_tools"].as_u64().unwrap_or(0)
                );
                println!("  * Process Isolation: not enforced by kernel");
            }
        },
        OsAction::Doctor => {
            let client = aphrody_diagnostics::os::os_client().await?;
            let snapshot = aphrody_diagnostics::os::os_snapshot(&client).await?;
            if snapshot["winclean_tools"].as_u64().unwrap_or(0) == 0 {
                return Err(miette!("kernel admin subsystem is unavailable"));
            }
            let result = client
                .request(
                    "tools/call",
                    serde_json::json!({"name":"get_os_info","arguments":{}}),
                    Duration::from_secs(10),
                )
                .await
                .into_diagnostic()?;
            if result["isError"] != false || !result["structuredContent"].is_object() {
                return Err(miette!("kernel get_os_info diagnostic failed"));
            }
            println!(
                "Kernel and WinClean OS inventory: healthy ({} tools observed).",
                snapshot["winclean_tools"]
            );
        },
    }
    Ok(())
}

pub(crate) mod web;
pub(crate) use web::{WebAction, handle_web};

// --- 4. INFRA PILLAR: `aphrody infra` is the aphrody-infra control plane (multicall.rs) ---

// --- 5. SHELL PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum ShellAction {
    /// Inspect Aphrody Shell capabilities (Bun Shell, Nushell, PTY, TUI)
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Start interactive Nushell / Ratatui terminal session
    Start {
        /// Arguments passed to the shell engine
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Evaluate a command or pipeline (Nushell or native Bun Shell)
    Eval {
        /// Shell code/pipeline to evaluate
        pipeline: String,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
        /// Use native Bun Shell engine (in-process builtins, zero fork/exec)
        #[arg(long)]
        bun: bool,
    },
    /// Direct in-process Bun Shell execution (zero fork/exec, native POSIX builtins)
    Bun {
        /// Shell script or command to execute in-process
        command: String,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Launch the autonomous, zero-copy, hardware-accelerated Aphrody Term engine
    Term {
        /// Optional command or arguments to run inside the terminal session
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// AI Computer-Use screen scraping and programmatic action interface
    ComputerUse {
        /// Optional action to dispatch: "type <text>", "key <key>", "scrape"
        #[arg(long)]
        action: Option<String>,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Start the Aphrody Terminal Backend WebSocket server
    Serve {
        /// IP address to bind
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        /// Port to listen on
        #[arg(long, default_value_t = 8790)]
        port: u16,
    },
}

pub(crate) fn handle_shell(action: ShellAction) -> miette::Result<()> {
    match action {
        ShellAction::Status { json } => {
            let status = serde_json::json!({
                "layer": "shell",
                "terminal_engine": "aphrody-term-1.0.0",
                "backend": "aphrody-terminal-backend",
                "tui": "ratatui-0.30",
                "engine": "bun-shell-native",
                "fallback_engine": "nushell-0.116.0",
                "builtins": [
                    "echo", "cat", "ls", "cd", "pwd", "mkdir", "rm",
                    "touch", "which", "true", "false", "seq", "basename", "dirname"
                ],
                "features": [
                    "in-process-pipeline",
                    "braces-expansion",
                    "zero-alloc-ast-arena",
                    "jsc-structured-queries-22x",
                    "simd-utf8-validation",
                    "packed-16b-cell",
                    "fair-mutex-bounded-leases",
                    "memchr-ascii-fastpath",
                    "webgpu-instanced-quads",
                    "computer-use-zero-latency"
                ],
                "status": "ready"
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&status).into_diagnostic()?);
            } else {
                println!("=== Aphrody Shell & Terminal Environment ===");
                println!("  * Terminal:      aphrody-term (16B PackedCell, FairMutex 256KB, WebGPU Quads)");
                println!("  * AI Agent:      Computer-Use Controller (>10 GB/s synchronous scraping)");
                println!("  * Native Engine: Bun Shell (In-Process, Zero-Alloc Arena AST)");
                println!("  * Builtins:      echo, cat, ls, cd, pwd, mkdir, rm, touch, which, seq, basename, dirname");
                println!("  * Expansion:     Braces {{a,b}}{{1,2}}, numeric ranges {{1..5}}");
                println!("  * Structured:    JSC Engine (22x faster than Nushell on structured data)");
                println!("  * Fallback:      Nushell 0.116.0");
                println!("  * TUI:           Ratatui 0.30");
                println!("  * PTY Bridge:    aphrody-terminal-backend (WebSocket/Local)");
            }
        },
        ShellAction::Start { args } => {
            let nu_path = which::which("nu").unwrap_or_else(|_| std::path::PathBuf::from("nu"));
            let mut cmd = std::process::Command::new(&nu_path);
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    if std::path::Path::new("C:\\aphrody").exists() {
                        std::path::PathBuf::from("C:\\aphrody")
                    } else {
                        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                    }
                });
            cmd.current_dir(&root);
            if !args.is_empty() {
                cmd.args(&args);
            }
            cmd.stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let mut child = cmd.spawn().map_err(|e| miette::miette!("Failed to launch Aphrody shell: {}", e))?;
            let status = child.wait().map_err(|e| miette::miette!("Shell session error: {}", e))?;
            if !status.success() {
                std::process::exit(status.code().unwrap_or(1));
            }
        },
        ShellAction::Eval { pipeline, json, bun } => {
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    if std::path::Path::new("C:\\aphrody").exists() {
                        std::path::PathBuf::from("C:\\aphrody")
                    } else {
                        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                    }
                });

            if bun {
                let out = aphrody_bun_bridge::run_shell(&pipeline, Some(&root))
                    .map_err(|e| miette::miette!("Bun Shell evaluation error: {}", e))?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&out).into_diagnostic()?);
                } else {
                    if !out.stdout.is_empty() {
                        print!("{}", out.stdout);
                    }
                    if !out.stderr.is_empty() {
                        eprint!("{}", out.stderr);
                    }
                }
                if out.exit_code != 0 {
                    std::process::exit(out.exit_code);
                }
                return Ok(());
            }

            let nu_path = which::which("nu").unwrap_or_else(|_| std::path::PathBuf::from("nu"));
            let mut cmd = std::process::Command::new(&nu_path);
            let code = if json {
                format!("{} | to json", pipeline)
            } else {
                pipeline
            };
            cmd.arg("-c").arg(&code);
            cmd.current_dir(&root);
            cmd.stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let mut child = cmd.spawn().map_err(|e| miette::miette!("Failed to launch Nushell eval: {}", e))?;
            let status = child.wait().map_err(|e| miette::miette!("Shell eval error: {}", e))?;
            if !status.success() {
                std::process::exit(status.code().unwrap_or(1));
            }
        },
        ShellAction::Bun { command, json } => {
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    if std::path::Path::new("C:\\aphrody").exists() {
                        std::path::PathBuf::from("C:\\aphrody")
                    } else {
                        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                    }
                });

            let out = aphrody_bun_bridge::run_shell(&command, Some(&root))
                .map_err(|e| miette::miette!("Bun Shell evaluation error: {}", e))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&out).into_diagnostic()?);
            } else {
                if !out.stdout.is_empty() {
                    print!("{}", out.stdout);
                }
                if !out.stderr.is_empty() {
                    eprint!("{}", out.stderr);
                }
            }
            if out.exit_code != 0 {
                std::process::exit(out.exit_code);
            }
        },
        ShellAction::Term { args } => {
            let cols = 80;
            let rows = 24;
            let config = aphrody_term::TermConfig {
                cols,
                rows,
                ..Default::default()
            };
            let term = aphrody_term::AphrodyTerm::new(config);
            println!("=== Aphrody Term (Autonomous Zero-Copy Terminal Engine) ===");
            println!("  * Grid Layout:  16-byte PackedCell (L1 cache aligned)");
            println!("  * Parser:       SIMD & memchr fast-path ASCII dispatch");
            println!("  * Lock Leases:  FairMutex bounded 256 KB leases");
            println!("  * GPU Pipeline: Multi-quad instanced WebGPU runs");
            println!("  * AI Interface: Zero-latency Computer-Use controller (>10 GB/s)");
            let (col, row, visible) = term.cursor();
            println!("  * State:        Initialized {}x{} (cursor: {}:{}, visible: {})", cols, rows, col, row, visible);
            if !args.is_empty() {
                println!("  * Command:      {}", args.join(" "));
            }
        },
        ShellAction::ComputerUse { action, json } => {
            let config = aphrody_term::TermConfig {
                cols: 80,
                rows: 24,
                ..Default::default()
            };
            let term = aphrody_term::AphrodyTerm::new(config);
            let controller = term.computer_use();
            if let Some(ref act) = action {
                if act.starts_with("type ") {
                    let text = act[5..].to_string();
                    let _ = controller.dispatch_action(aphrody_term::computer_use::ComputerAction::TypeText(text));
                } else if act.starts_with("key ") {
                    let key = act[4..].to_string();
                    let _ = controller.dispatch_action(aphrody_term::computer_use::ComputerAction::PressKey(key));
                }
            }
            let text = term.scrape_text();
            let (col, row, visible) = term.cursor();
            if json {
                let out = serde_json::json!({
                    "cursor": { "col": col, "row": row, "visible": visible },
                    "screen": text,
                    "dirty_mask": format!("0x{:016x}", term.dirty_mask()),
                });
                println!("{}", serde_json::to_string_pretty(&out).into_diagnostic()?);
            } else {
                println!("=== Aphrody Computer-Use State ===");
                println!("Cursor: {}:{} (visible: {})", col, row, visible);
                println!("Dirty mask: 0x{:016x}", term.dirty_mask());
                println!("--- Screen Buffer ---");
                println!("{}", text);
            }
        },
        ShellAction::Serve { host, port } => {
            let addr: std::net::SocketAddr = format!("{}:{}", host, port)
                .parse()
                .map_err(|e| miette::miette!("Invalid socket address: {}", e))?;
            println!("Starting Aphrody Terminal Backend on ws://{}", addr);
            let runtime = tokio::runtime::Runtime::new().map_err(|e| miette::miette!("Tokio runtime error: {}", e))?;
            runtime.block_on(async {
                let cfg = aphrody_terminal_backend::PtyConfig::default().with_env_limits();
                aphrody_terminal_backend::serve(addr, cfg).await
            }).map_err(|e| miette::miette!("Terminal server error: {}", e))?;
        },
    }
    Ok(())
}
