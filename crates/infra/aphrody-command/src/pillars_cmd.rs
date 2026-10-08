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
    /// Inspect Aphrody Shell capabilities (Nushell, PTY, TUI)
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
    /// Evaluate a Nushell command or pipeline
    Eval {
        /// Nushell code/pipeline to evaluate
        pipeline: String,
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
                "backend": "aphrody-terminal-backend",
                "tui": "ratatui-0.30",
                "engine": "nushell-0.116.0",
                "status": "ready"
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&status).into_diagnostic()?);
            } else {
                println!("=== Aphrody Shell Environment ===");
                println!("  * Engine:     Nushell 0.116.0");
                println!("  * TUI:        Ratatui 0.30");
                println!("  * PTY Bridge: aphrody-terminal-backend (WebSocket/Local)");
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
        ShellAction::Eval { pipeline, json } => {
            let nu_path = which::which("nu").unwrap_or_else(|_| std::path::PathBuf::from("nu"));
            let mut cmd = std::process::Command::new(&nu_path);
            let code = if json {
                format!("{} | to json", pipeline)
            } else {
                pipeline
            };
            cmd.arg("-c").arg(&code);
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
            cmd.stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let mut child = cmd.spawn().map_err(|e| miette::miette!("Failed to launch Nushell eval: {}", e))?;
            let status = child.wait().map_err(|e| miette::miette!("Shell eval error: {}", e))?;
            if !status.success() {
                std::process::exit(status.code().unwrap_or(1));
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
