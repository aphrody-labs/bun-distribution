// SPDX-License-Identifier: Apache-2.0
//! Native entry point for the same sheets exposed by `aphrody m3 tokens`.
//! `cargo run -p aphrody-m3-tokens --example sheets -- --sheet scheme --seed '#6d00ce' --dark`

use std::{
    env,
    io::{self, Write},
    process::ExitCode,
};

use aphrody_m3_tokens::{
    color::{export_shadcn_aliases, export_tailwind_theme},
    sheets::{self, SheetRequest},
};

fn run(args: impl Iterator<Item = String>) -> Result<(), String> {
    let mut args = args;
    let mut sheet = String::from("tokens");
    let mut seed = None;
    let mut variant = None;
    let mut contrast = None;
    let mut dark = false;
    let mut aliases = false;
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--dark" => dark = true,
            "--aliases" => aliases = true,
            "--help" | "-h" => {
                println!(
                    "sheets [--sheet tokens|tailwind|spaceui|scheme] [--seed #rrggbb] [--variant name] [--contrast -1..1] [--dark] [--aliases]"
                );
                return Ok(());
            }
            "--sheet" | "--seed" | "--variant" | "--contrast" => {
                let value = args.next().ok_or_else(|| format!("{flag} needs a value"))?;
                match flag.as_str() {
                    "--sheet" => sheet = value,
                    "--seed" => seed = Some(value),
                    "--variant" => variant = Some(value),
                    _ => {
                        contrast = Some(
                            value
                                .parse::<f64>()
                                .map_err(|_| format!("invalid contrast {value:?}"))?,
                        )
                    }
                }
            }
            _ => return Err(format!("unknown option {flag:?}")),
        }
    }
    let request = SheetRequest::parse(
        &sheet,
        seed.as_deref(),
        variant.as_deref(),
        Some(dark),
        contrast,
    )?;
    if aliases && sheet != "scheme" {
        return Err(String::from("--aliases requires --sheet scheme"));
    }
    let mut css = sheets::render(&request);
    if aliases {
        css.push_str(&export_shadcn_aliases());
        css.push('\n');
        css.push_str(&export_tailwind_theme());
        css.push('\n');
    }
    io::stdout()
        .lock()
        .write_all(css.as_bytes())
        .map_err(|error| error.to_string())
}

fn main() -> ExitCode {
    match run(env::args().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("m3 sheets: {error}");
            ExitCode::FAILURE
        }
    }
}
