// SPDX-License-Identifier: Apache-2.0
//! Unified cross-platform Python/AI runtime orchestration.
//!
//! `uv` remains the resolver and environment owner; Aphrody owns the policy,
//! platform probe, project routing and machine-readable report. CUDA drivers
//! are never installed implicitly: the command only detects capabilities and
//! validates the managed runtime selected by `aphrody-infer`.

use aphrody_proc::NoWindow as _;
use std::{path::PathBuf, process::Command};

use clap::{Subcommand, ValueEnum};
use miette::{IntoDiagnostic, Result, WrapErr};
use serde::Serialize;

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum RuntimeAction {
    /// Report uv, Python project and accelerator state.
    Status {
        #[arg(long)]
        project: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Reconcile the selected Python project from its locked uv graph.
    Sync {
        #[arg(long)]
        project: Option<PathBuf>,
        #[arg(long, value_enum, default_value_t = LockMode::Locked)]
        lock: LockMode,
    },
    /// Run uv's integrity checks without changing the environment.
    Check {
        #[arg(long)]
        project: Option<PathBuf>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(crate) enum LockMode {
    Locked,
    Refresh,
}

#[derive(Debug, Serialize)]
struct RuntimeStatus {
    project: String,
    uv: Option<String>,
    python: Option<String>,
    accelerators: aphrody_models::HardwareProfile,
    onnx_runtime: String,
    ecosystem: Vec<SurfaceAvailability>,
}

#[derive(Debug, Serialize)]
struct SurfaceAvailability {
    surface: String,
    owner: String,
    boundary: String,
    binary_found: Option<bool>,
}

pub(crate) fn run(action: RuntimeAction) -> Result<()> {
    match action {
        RuntimeAction::Status { project, json } => status(project, json),
        RuntimeAction::Sync { project, lock } => sync(project, lock),
        RuntimeAction::Check { project } => check(project),
    }
}

fn project_root(project: Option<PathBuf>) -> Result<PathBuf> {
    let root = project
        .or_else(|| std::env::var_os("APHRODY_PY_ROOT").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("py"));
    let root = if root.is_absolute() {
        root
    } else {
        std::env::current_dir().into_diagnostic()?.join(root)
    };
    if !root.join("pyproject.toml").is_file() {
        return Err(miette::miette!("projet uv introuvable: {}", root.display()));
    }
    Ok(root)
}

fn run_uv(project: &std::path::Path, args: &[&str]) -> Result<std::process::Output> {
    Command::new(std::env::var_os("APHRODY_UV_BIN").unwrap_or_else(|| "uv".into()))
        .no_window()
        .current_dir(project)
        .args(args)
        .output()
        .into_diagnostic()
        .wrap_err("exécution de uv")
}

fn output_text(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_owned()
    } else {
        stdout
    }
}

fn status(project: Option<PathBuf>, json: bool) -> Result<()> {
    let project = project_root(project)?;
    let uv = run_uv(&project, &["--version"])
        .ok()
        .map(|out| output_text(&out));
    let python = run_uv(&project, &["run", "python", "--version"])
        .ok()
        .map(|out| output_text(&out));
    let hardware = aphrody_models::accel::probe();
    #[cfg(feature = "infer")]
    let onnx_runtime = aphrody_infer::discover().label().to_owned();
    #[cfg(not(feature = "infer"))]
    let onnx_runtime = "infer-feature-disabled".to_owned();
    let report = RuntimeStatus {
        project: project.display().to_string(),
        uv,
        python,
        accelerators: hardware,
        onnx_runtime,
        ecosystem: crate::ecosystem::SURFACES
            .iter()
            .map(|surface| SurfaceAvailability {
                surface: format!("{:?}", surface.surface),
                owner: format!("{:?}", surface.owner),
                boundary: format!("{:?}", surface.boundary),
                binary_found: matches!(
                    surface.boundary,
                    crate::ecosystem::Boundary::LocalProcess
                        | crate::ecosystem::Boundary::LocalStdio
                )
                .then(|| {
                    crate::ecosystem::find_local_surface(
                        surface.surface,
                        &crate::ecosystem::path_directories(),
                    )
                    .is_some()
                }),
            })
            .collect(),
    };
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).into_diagnostic()?
        );
    } else {
        println!("project: {}", report.project);
        println!("uv: {}", report.uv.as_deref().unwrap_or("unavailable"));
        println!(
            "python: {}",
            report.python.as_deref().unwrap_or("unavailable")
        );
        println!("accelerator: {}", report.accelerators.best());
        println!("onnx-runtime: {}", report.onnx_runtime);
        for surface in &report.ecosystem {
            println!(
                "ecosystem: {} ({}, {}, binary-found={})",
                surface.surface,
                surface.owner,
                surface.boundary,
                surface
                    .binary_found
                    .map_or("n/a", |found| if found { "yes" } else { "no" })
            );
        }
    }
    Ok(())
}

fn sync(project: Option<PathBuf>, lock: LockMode) -> Result<()> {
    let project = project_root(project)?;
    let args = match lock {
        LockMode::Locked => ["sync", "--locked"].as_slice(),
        LockMode::Refresh => ["sync"].as_slice(),
    };
    let output = run_uv(&project, args)?;
    print!("{}", String::from_utf8_lossy(&output.stdout));
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    if output.status.success() {
        Ok(())
    } else {
        Err(miette::miette!("uv sync a échoué ({})", output.status))
    }
}

fn check(project: Option<PathBuf>) -> Result<()> {
    let project = project_root(project)?;
    let output = run_uv(&project, &["lock", "--check"])?;
    print!("{}", String::from_utf8_lossy(&output.stdout));
    eprint!("{}", String::from_utf8_lossy(&output.stderr));
    if output.status.success() {
        Ok(())
    } else {
        Err(miette::miette!(
            "uv lock --check a échoué ({})",
            output.status
        ))
    }
}
