// SPDX-License-Identifier: Apache-2.0

mod analyze;
mod app_cmd;
mod bin_cmd;
mod bunpp_cmd;
mod cli;
mod commands;
mod linux_cmd;
mod patch;
mod rust_cmd;
mod scaffold_fs;
#[cfg(test)]
mod schema_test;
mod subprocess;
mod wasm_cmd;
mod win32_cmd;

use std::{ffi::OsString, process::ExitCode};

/// Run N2B inside an embedding process with an explicit argument iterator.
pub fn run_from<I, T>(args: I) -> anyhow::Result<ExitCode>
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    cli::dispatch::run_from(args)
}

/// Run N2B from the current process arguments.
pub fn run_from_env() -> anyhow::Result<ExitCode> {
    cli::dispatch::run_from_args()
}
