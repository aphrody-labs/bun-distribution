// SPDX-License-Identifier: Apache-2.0
//! `bunre-pipeline`: JSON CLI over `bun_re::pipeline`, driven by `bun re pipeline` (packages/re).
//!
//! Subcommands: `run <input> --target os|bios|firmware --out DIR [--external] [--trace]
//! [--max-functions N] [--max-insns N]`, `adapters [--stage S]`, `schema DIR`.

use bun_re::pipeline::contract::{Stage, TargetKind};
use bun_re::pipeline::registry::{Options, Registry};
use bun_re::pipeline::{run, schema};
use std::path::PathBuf;
use std::process::ExitCode;

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().map(String::as_str) else {
        eprintln!("usage: bunre-pipeline run|adapters|schema ...");
        return ExitCode::from(2);
    };
    match cmd {
        "run" => {
            let Some(input) = args.get(1).filter(|a| !a.starts_with("--")).cloned() else {
                eprintln!("run: missing <input>");
                return ExitCode::from(2);
            };
            let target = flag(&args, "--target").map_or(Some(TargetKind::Os), |t| TargetKind::parse(&t));
            let Some(target) = target else {
                eprintln!("run: --target must be os, bios or firmware");
                return ExitCode::from(2);
            };
            let out = flag(&args, "--out").map_or_else(|| PathBuf::from("bunre-out"), PathBuf::from);
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
                    if rep.summary == "failed" { ExitCode::from(1) } else { ExitCode::SUCCESS }
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
                list.retain(|a| serde_json::to_value(a.stage).ok().and_then(|v| v.as_str().map(str::to_string)).as_deref() == Some(s.as_str()));
            }
            let _ = Stage::ALL;
            println!("{}", serde_json::to_string(&list).unwrap_or_default());
            ExitCode::SUCCESS
        }
        "schema" => {
            let dir = args.get(1).map_or_else(|| PathBuf::from("schema"), PathBuf::from);
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
