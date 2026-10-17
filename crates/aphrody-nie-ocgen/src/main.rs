//! `aphrody-nie-ocgen` — the original-character 3D generation pipeline, as a standalone command.
//!
//! Same code as `nie ocgen`: both are a `clap` parse and a call into [`aphrody_nie_ocgen::cli::run`].

use clap::Parser;

/// Command-line entry point.
#[derive(Parser, Debug)]
#[command(
    name = "aphrody-nie-ocgen",
    about = "Génération 3D d'un personnage original"
)]
struct Args {
    /// Sub-command to run.
    #[command(subcommand)]
    op: aphrody_nie_ocgen::cli::OcgenCmd,
}

fn main() -> Result<(), aphrody_nie_ocgen::Error> {
    aphrody_nie_ocgen::cli::run(&Args::parse().op)
}
