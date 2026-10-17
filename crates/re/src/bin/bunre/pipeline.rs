// SPDX-License-Identifier: Apache-2.0
//! `bunre pipeline`: JSON CLI over `bun_re::pipeline`, driven by `re pipeline` (packages/re).
//!
//! Subcommands: `run <input> --target os|bios|firmware --out DIR [--external] [--trace]
//! [--max-functions N] [--max-insns N]`, `adapters [--stage S]`, `triage <input> [--strings N]`, `schema DIR`.

use bun_re::pipeline::contract::{Stage, TargetKind};
use bun_re::pipeline::recomp::{RecompTarget, Recompile};
use bun_re::pipeline::registry::{Options, Registry};
use bun_re::pipeline::{run, schema};
use std::path::PathBuf;
use std::process::ExitCode;

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

pub fn main(args: Vec<String>) -> ExitCode {
    let Some(cmd) = args.first().map(String::as_str) else {
        eprintln!("usage: bunre pipeline run|adapters|schema ...");
        return ExitCode::from(2);
    };
    match cmd {
        "run" => {
            let Some(input) = args.get(1).filter(|a| !a.starts_with("--")).cloned() else {
                eprintln!("run: missing <input>");
                return ExitCode::from(2);
            };
            let target =
                flag(&args, "--target").map_or(Some(TargetKind::Os), |t| TargetKind::parse(&t));
            let Some(target) = target else {
                eprintln!("run: --target must be os, bios or firmware");
                return ExitCode::from(2);
            };
            let out =
                flag(&args, "--out").map_or_else(|| PathBuf::from("bunre-out"), PathBuf::from);
            let mut o = Options::new(input, target, out);
            o.external = args.iter().any(|a| a == "--external");
            o.trace = args.iter().any(|a| a == "--trace");
            if let Some(n) = flag(&args, "--max-functions").and_then(|v| v.parse().ok()) {
                o.max_functions = n;
            }
            if let Some(n) = flag(&args, "--max-insns").and_then(|v| v.parse().ok()) {
                o.max_insns = n;
            }
            if let Some(n) = flag(&args, "--timeout").and_then(|v| v.parse().ok()) {
                o.timeout_secs = n;
            }
            match run(o) {
                Ok(rep) => {
                    println!("{}", serde_json::to_string(&rep).unwrap_or_default());
                    if rep.summary == "failed" {
                        ExitCode::from(1)
                    } else {
                        ExitCode::SUCCESS
                    }
                }
                Err(e) => {
                    eprintln!("run: {e}");
                    ExitCode::from(1)
                }
            }
        }
        "adapters" => {
            let opts = Options::new("", TargetKind::Os, ".");
            let mut list = Registry::standard().list(&opts);
            if let Some(s) = flag(&args, "--stage") {
                list.retain(|a| {
                    serde_json::to_value(a.stage)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_string))
                        .as_deref()
                        == Some(s.as_str())
                });
            }
            let _ = Stage::ALL;
            println!("{}", serde_json::to_string(&list).unwrap_or_default());
            ExitCode::SUCCESS
        }
        // The analyze-stage triage alone (`re bin`): format, hashes, sections, imports, libraries,
        // exports and a bounded string sample, without lifting or rebuilding.
        "triage" => {
            let Some(input) = args.get(1).filter(|a| !a.starts_with("--")) else {
                eprintln!("triage: missing <input>");
                return ExitCode::from(2);
            };
            let strings = flag(&args, "--strings")
                .and_then(|v| v.parse().ok())
                .unwrap_or(bun_re::STRINGS_SAMPLE_LIMIT);
            match std::fs::read(input)
                .map_err(|e| e.to_string())
                .and_then(|b| bun_re::triage_bounded(&b, strings).map_err(|e| e.to_string()))
            {
                Ok(report) => {
                    println!("{}", serde_json::to_string(&report).unwrap_or_default());
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("triage: {input}: {e}");
                    ExitCode::from(1)
                }
            }
        }
        "schema" => {
            let dir = args
                .get(1)
                .map_or_else(|| PathBuf::from("schema"), PathBuf::from);
            match schema::emit_schemas(&dir) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("schema: {e}");
                    ExitCode::from(1)
                }
            }
        }
        _ => {
            eprintln!("unknown subcommand {cmd}");
            ExitCode::from(2)
        }
    }
}

const RECOMPILE_USAGE: &str = "usage: bunre recompile <input> --target wasm|exe --out DIR [--machine gba|psx|nes] [--bios FILE] [--frames N] [--input key@first[-last],...] [--no-build] [--timeout SECS]";

/// `bunre recompile`: lift a console BIOS/ROM image, emit a Rust crate over the Bun Engine core,
/// build it for the host or `wasm32-unknown-unknown` and verify it against the interpreter.
/// Prints the pipeline report as JSON.
pub fn recompile(args: Vec<String>) -> ExitCode {
    let Some(input) = args.first().filter(|a| !a.starts_with("--")).cloned() else {
        eprintln!("{RECOMPILE_USAGE}");
        return ExitCode::from(2);
    };
    let Some(target) =
        flag(&args, "--target").map_or(Some(RecompTarget::Exe), |t| RecompTarget::parse(&t))
    else {
        eprintln!("recompile: --target must be wasm or exe");
        return ExitCode::from(2);
    };
    let out = flag(&args, "--out").map_or_else(|| PathBuf::from("bunre-recompile"), PathBuf::from);
    let mut o = Options::new(input, TargetKind::Firmware, out);
    if let Some(n) = flag(&args, "--timeout").and_then(|v| v.parse().ok()) {
        o.timeout_secs = n;
    }
    if let Some(n) = flag(&args, "--max-insns").and_then(|v| v.parse().ok()) {
        o.max_insns = n;
    }
    o.recompile = Some(Recompile {
        target,
        machine: flag(&args, "--machine"),
        bios: flag(&args, "--bios").map(PathBuf::from),
        frames: flag(&args, "--frames")
            .and_then(|v| v.parse().ok())
            .unwrap_or(300),
        build: !args.iter().any(|a| a == "--no-build"),
        input: flag(&args, "--input"),
    });
    let build = o.recompile.as_ref().is_some_and(|r| r.build);
    match run(o) {
        Ok(rep) => {
            println!("{}", serde_json::to_string(&rep).unwrap_or_default());
            // Success is the verification passing (or the crate being emitted with --no-build);
            // analysis stages that only report partial information do not fail a recompile.
            let wanted = if build {
                ("recompile-verify", Stage::Verify)
            } else {
                ("emit-console-rust", Stage::Decompile)
            };
            let ok = rep.stages.iter().any(|s| {
                s.adapter == wanted.0
                    && s.stage == wanted.1
                    && s.status == bun_re::pipeline::contract::StageStatus::Ok
            });
            if ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(e) => {
            eprintln!("recompile: {e}");
            ExitCode::from(1)
        }
    }
}
