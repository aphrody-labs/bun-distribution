// SPDX-License-Identifier: Apache-2.0
//! Auto-generate `docs/SUMMARY.md` (mdBook table of contents) from the docs/
//! directory tree.
//!
//! Usage:
//!   aphrody summary
//!   aphrody summary --check    # CI: fail if SUMMARY.md drifts
//!
//! All generation logic lives in the crate root. This module adds the on-disk
//! write step and the `--check` mode used by CI.

use std::{ffi::OsString, fs};

use anyhow::Result;

use crate::summary::{generate, generate_llms, repo_root};

/// Returns the exit code: 0 when written or up to date, 1 when `--check` finds drift.
fn run(args: &[OsString]) -> Result<i32> {
    let check_mode = args.iter().any(|a| a == "--check");

    let repo_root = repo_root()?;
    let docs_root = repo_root.join("docs");
    let summary_path = docs_root.join("SUMMARY.md");
    let llms_path = docs_root.join("llms.txt");

    let generated = generate()?;
    let generated_llms = generate_llms()?;

    if check_mode {
        let existing = fs::read_to_string(&summary_path).unwrap_or_default();
        if existing.trim() != generated.trim() {
            eprintln!("docs/SUMMARY.md is out of date. Run: aphrody summary");
            return Ok(1);
        }
        let existing_llms = fs::read_to_string(&llms_path).unwrap_or_default();
        if existing_llms.trim() != generated_llms.trim() {
            eprintln!("docs/llms.txt is out of date. Run: aphrody summary");
            return Ok(1);
        }
        println!("docs/SUMMARY.md and docs/llms.txt are up to date.");
        return Ok(0);
    }

    fs::write(&summary_path, &generated)?;
    let line_count = generated.lines().count();
    println!("Generated docs/SUMMARY.md ({} lines)", line_count);

    fs::write(&llms_path, &generated_llms)?;
    let llms_line_count = generated_llms.lines().count();
    println!("Generated docs/llms.txt ({} lines)", llms_line_count);

    Ok(0)
}

/// Entry point of the former `aphrody-summary` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention). Returns the process exit
/// code.
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    match run(&args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("aphrody-summary: {error:#}");
            1
        },
    }
}
