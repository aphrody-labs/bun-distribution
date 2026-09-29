// SPDX-License-Identifier: Apache-2.0
//! `aphrody-m3-reproduce` CLI: `--url <u> | --image <png>` to a
//! [`aphrody_m3_reproduce::ReproductionPlan`] and, unless `--json` is given, an emitted
//! `@aphrody/m3` app scaffold.

use std::{path::PathBuf, process::ExitCode};

use aphrody_m3_reproduce::{ReproductionPlan, plan::ReproductionSource, scaffold};
use clap::Parser;

/// Reproduce a site in Material 3 from a screenshot or a crawl.
#[derive(Parser)]
#[command(name = "aphrody-m3-reproduce", version)]
struct Cli {
    /// A URL to fetch and crawl for theme colors, fonts, shape and layout landmarks.
    #[arg(long, conflicts_with = "image")]
    url: Option<String>,
    /// A PNG or JPEG screenshot to seed the theme from.
    #[arg(long, conflicts_with = "url")]
    image: Option<PathBuf>,
    /// Directory to write the scaffold to. Defaults to `./reproduced`.
    #[arg(long, default_value = "reproduced")]
    out: PathBuf,
    /// Print the plan as JSON to stdout instead of writing a scaffold.
    #[arg(long)]
    json: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let plan = match run(&cli) {
        Ok(plan) => plan,
        Err(err) => {
            eprintln!("aphrody-m3-reproduce: {err}");
            return ExitCode::FAILURE;
        },
    };

    if cli.json {
        match plan.to_json() {
            Ok(json) => println!("{json}"),
            Err(err) => {
                eprintln!("aphrody-m3-reproduce: {err}");
                return ExitCode::FAILURE;
            },
        }
        return ExitCode::SUCCESS;
    }

    if let Err(err) = scaffold::emit_scaffold(&plan, &cli.out) {
        eprintln!("aphrody-m3-reproduce: {err}");
        return ExitCode::FAILURE;
    }
    println!(
        "Wrote scaffold to {} (seed {}, {} component(s) detected)",
        cli.out.display(),
        plan.theme.seed_hex,
        plan.components.len()
    );
    ExitCode::SUCCESS
}

fn run(cli: &Cli) -> aphrody_m3_reproduce::Result<ReproductionPlan> {
    if let Some(url) = &cli.url {
        return aphrody_m3_reproduce::fetch::plan_from_url(url);
    }
    if let Some(image) = &cli.image {
        let bytes = std::fs::read(image)?;
        return ReproductionPlan::from_image_bytes(&bytes);
    }
    let html = std::io::read_to_string(std::io::stdin())?;
    Ok(ReproductionPlan::from_html(&html, ReproductionSource::Html))
}
