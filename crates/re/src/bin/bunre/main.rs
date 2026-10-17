// SPDX-License-Identifier: Apache-2.0
//! `bunre`: the native half of the Bun OS `re` product. One binary, one subcommand per capability:
//! `pipeline` (cross-OS RE pipeline, feature `pipeline`), `recompile` (static recompilation of
//! console BIOS/ROM images to native executables and WebAssembly over the pipeline), `game`
//! (game-agnostic asset pipeline: detect, mount, index, export and serve any installed game,
//! feature `assets`) and `dbxv2` (Dragon Ball Xenoverse 2 inventory and archives). Steam depot
//! acquisition is `bun-steam-depot` (crate `bun-steam`).

mod dbxv2;
#[cfg(feature = "assets")]
mod game;
#[cfg(feature = "pipeline")]
mod pipeline;

use std::ffi::OsString;
use std::process::ExitCode;

const USAGE: &str = "usage: bunre <pipeline|recompile|game|dbxv2> ...";

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    match command.to_str() {
        Some("dbxv2") => dbxv2::main(args),
        #[cfg(feature = "assets")]
        Some("game") => game::main(args),
        #[cfg(not(feature = "assets"))]
        Some("game") => {
            eprintln!(
                "bunre: this build lacks the `assets` feature (build with --features assets)"
            );
            ExitCode::from(2)
        }
        #[cfg(feature = "pipeline")]
        Some("pipeline") => match args
            .map(OsString::into_string)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(args) => pipeline::main(args),
            Err(_) => {
                eprintln!("bunre pipeline: arguments must be valid Unicode");
                ExitCode::from(2)
            }
        },
        #[cfg(feature = "pipeline")]
        Some("recompile") => match args
            .map(OsString::into_string)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(args) => pipeline::recompile(args),
            Err(_) => {
                eprintln!("bunre recompile: arguments must be valid Unicode");
                ExitCode::from(2)
            }
        },
        #[cfg(not(feature = "pipeline"))]
        Some("pipeline" | "recompile") => {
            eprintln!("bunre: this build lacks the `pipeline` feature");
            ExitCode::from(2)
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
