// SPDX-License-Identifier: Apache-2.0
//! `aphrody m3-reproduce` CLI (former `aphrody-m3-reproduce` binary): `--url <u> | --image <png>` to a
//! [`crate::ReproductionPlan`] and, unless `--json` is given, an emitted
//! `@aphrody/m3` app scaffold.

use std::{ffi::OsString, path::PathBuf};

use clap::Parser;

use crate::{ReproductionPlan, plan::ReproductionSource, scaffold};

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

/// Entry point of the former `aphrody-m3-reproduce` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(err) => {
            let code = err.exit_code();
            let _ = err.print();
            return code;
        },
    };

    let plan = match run(&cli) {
        Ok(plan) => plan,
        Err(err) => {
            eprintln!("aphrody-m3-reproduce: {err}");
            return 1;
        },
    };

    if cli.json {
        match plan.to_json() {
            Ok(json) => println!("{json}"),
            Err(err) => {
                eprintln!("aphrody-m3-reproduce: {err}");
                return 1;
            },
        }
        return 0;
    }

    if let Err(err) = scaffold::emit_scaffold(&plan, &cli.out) {
        eprintln!("aphrody-m3-reproduce: {err}");
        return 1;
    }
    println!(
        "Wrote scaffold to {} (seed {}, {} component(s) detected)",
        cli.out.display(),
        plan.theme.seed_hex,
        plan.components.len()
    );
    0
}

fn run(cli: &Cli) -> crate::Result<ReproductionPlan> {
    if let Some(url) = &cli.url {
        return crate::fetch::plan_from_url(url);
    }
    if let Some(image) = &cli.image {
        let bytes = std::fs::read(image)?;
        return ReproductionPlan::from_image_bytes(&bytes);
    }
    let html = std::io::read_to_string(std::io::stdin())?;
    Ok(ReproductionPlan::from_html(&html, ReproductionSource::Html))
}
