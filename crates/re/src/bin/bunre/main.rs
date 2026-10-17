// SPDX-License-Identifier: Apache-2.0
//! `bunre`: the native half of the Bun OS `re` product. One binary, one subcommand per capability:
//! `pipeline` (cross-OS RE pipeline, feature `pipeline`), `steam` (native depot acquisition,
//! feature `steam-download`) and `dbxv2` (Dragon Ball Xenoverse 2 inventory and archives).

mod dbxv2;
#[cfg(feature = "pipeline")]
mod pipeline;
#[cfg(feature = "steam-download")]
mod steam;

use std::ffi::OsString;
use std::process::ExitCode;

const USAGE: &str = "usage: bunre <pipeline|steam|dbxv2> ...";

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    match command.to_str() {
        Some("dbxv2") => dbxv2::main(args),
        #[cfg(feature = "pipeline")]
        Some("pipeline") => match args.map(OsString::into_string).collect::<Result<Vec<_>, _>>() {
            Ok(args) => pipeline::main(args),
            Err(_) => {
                eprintln!("bunre pipeline: arguments must be valid Unicode");
                ExitCode::from(2)
            },
        },
        #[cfg(feature = "steam-download")]
        Some("steam") => steam::main(args.collect()),
        Some("pipeline" | "steam") => {
            eprintln!("bunre: this build lacks the `{}` feature", command.to_string_lossy());
            ExitCode::from(2)
        },
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        },
    }
}
