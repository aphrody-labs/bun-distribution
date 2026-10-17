// SPDX-License-Identifier: Apache-2.0
//! Cross-OS / BIOS / firmware RE pipeline: acquire, identify, unpack, analyze, lift, decompile,
//! rebuild, verify. Every stage reports through the typed [`contract`]; owners elsewhere in Bun OS
//! plug in as [`registry::StageAdapter`]s. See `docs/re-pipeline.md`.

pub mod contract;
pub mod emit_c;
pub mod emit_rust;
pub mod ghidra;
pub mod image;
pub mod ir;
pub mod lift;
pub mod lift_aarch64;
pub mod registry;
pub mod schema;
pub mod stages;
pub mod util;

use contract::{PipelineReport, SCHEMA_VERSION, Stage, StageReport, StageStatus};
use registry::{AdapterStatus, Ctx, Options, Registry, report};

/// Run the full pipeline with the standard registry.
///
/// # Errors
/// Returns an I/O error when the output directory cannot be created.
pub fn run(opts: Options) -> std::io::Result<PipelineReport> {
    run_with(&Registry::standard(), opts)
}

/// Run the full pipeline with a caller-provided registry.
///
/// # Errors
/// Returns an I/O error when the output directory cannot be created.
pub fn run_with(reg: &Registry, opts: Options) -> std::io::Result<PipelineReport> {
    let mut opts = opts;
    std::fs::create_dir_all(&opts.outdir)?;
    opts.outdir = std::path::absolute(&opts.outdir)?;
    let mut ctx = Ctx::new(opts.clone());
    let mut stages: Vec<StageReport> = Vec::new();
    let mut aborted = false;
    for stage in Stage::ALL {
        if aborted {
            stages.push(report(stage, "-", StageStatus::Skipped, "earlier stage failed"));
            continue;
        }
        let ready: Vec<&dyn registry::StageAdapter> = reg
            .for_stage(stage)
            .filter(|a| a.info(&opts).status == AdapterStatus::Ready && a.applies(&ctx))
            .collect();
        if ready.is_empty() {
            let cands: Vec<String> = reg
                .for_stage(stage)
                .filter(|a| a.applies(&ctx))
                .map(|a| {
                    let i = a.info(&opts);
                    let st = serde_json::to_value(i.status).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
                    match i.reason {
                        Some(r) => format!("{} [{st}: {r}]", i.id),
                        None => format!("{} [{st}]", i.id),
                    }
                })
                .collect();
            let ident = ctx.effective_ident().map(|i| i.format.clone()).unwrap_or_else(|| "unidentified".into());
            let prereq_missing = stage >= Stage::Analyze && ctx.payload.is_none();
            let (status, detail) = if prereq_missing {
                (StageStatus::Skipped, "no payload produced by earlier stages".to_string())
            } else {
                (
                    StageStatus::Unavailable,
                    format!("no runnable adapter for {ident}; candidates: {}", if cands.is_empty() { "none registered".into() } else { cands.join("; ") }),
                )
            };
            stages.push(report(stage, "-", status, detail));
            if stage == Stage::Acquire {
                aborted = true;
            }
            continue;
        }
        for a in ready {
            let rep = a.run(&mut ctx);
            if rep.status == StageStatus::Failed && matches!(stage, Stage::Acquire | Stage::Identify) {
                aborted = true;
            }
            stages.push(rep);
        }
    }
    let any_failed = stages.iter().any(|s| s.status == StageStatus::Failed);
    let all_ok = stages.iter().all(|s| s.status == StageStatus::Ok);
    let produced = stages.iter().any(|s| !s.artifacts.is_empty());
    let summary = if all_ok {
        "ok"
    } else if any_failed && !produced {
        "failed"
    } else {
        "partial"
    };
    let rep = PipelineReport {
        schema_version: SCHEMA_VERSION,
        input: opts.input.clone(),
        target: opts.target,
        outdir: opts.outdir.display().to_string(),
        stages,
        summary: summary.to_string(),
    };
    if let Ok(j) = serde_json::to_vec_pretty(&rep) {
        let _ = std::fs::write(opts.outdir.join("report.json"), j);
    }
    Ok(rep)
}
