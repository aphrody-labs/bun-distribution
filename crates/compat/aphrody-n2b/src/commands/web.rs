// SPDX-License-Identifier: Apache-2.0
//! Browser/crawler artifact inspection for N2B.
//!
//! The command deliberately accepts only an already acquired page artifact.
//! Aphrody Web/Browser own fetching and V8; N2B owns OXC static analysis.

use std::{path::PathBuf, process::ExitCode};

use anyhow::{Context, Result};
use aphrody_n2b_core::{
    rules::imports_ast::{PageArtifact, analyze_page_artifact},
    types::Report,
};
use serde_json::json;

pub(crate) fn run_web(path: PathBuf, report: Report) -> Result<ExitCode> {
    let source = std::fs::read_to_string(&path)
        .with_context(|| format!("lecture de l'artefact web {}", path.display()))?;
    let artifact: PageArtifact = serde_json::from_str(&source)
        .with_context(|| format!("artefact web invalide {}", path.display()))?;
    let scripts = analyze_page_artifact(&artifact);
    let payload = json!({
        "url": artifact.url,
        "content": {
            "title": artifact.extracted.title,
            "canonical": artifact.extracted.canonical,
            "word_count": artifact.extracted.word_count,
            "simhash": artifact.extracted.simhash,
        },
        "scripts": scripts.clone(),
    });

    match report {
        Report::Json | Report::Jsonl => println!("{}", serde_json::to_string_pretty(&payload)?),
        _ => {
            println!("N2B web: {}", payload["url"].as_str().unwrap_or_default());
            println!(
                "content: {} words, simhash {}",
                payload["content"]["word_count"], payload["content"]["simhash"]
            );
            for script in scripts {
                let location = script.url.as_deref().unwrap_or("inline");
                let imports = if script.specifiers.is_empty() {
                    "—".to_string()
                } else {
                    script.specifiers.join(", ")
                };
                println!(
                    "script {location}: source={} module={} imports={imports}",
                    script.source_available, script.module
                );
            }
        },
    }
    Ok(ExitCode::SUCCESS)
}
