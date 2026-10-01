// SPDX-License-Identifier: Apache-2.0
//! Desktop binary entry point: a thin shell over [`aphrody_app_lib::run`].
//!
//! The agent runs inside this process, so this executable is also what the managed
//! `llama-server` supervisor re-executes as `<exe> __llama-daemon ...`. That argument is
//! answered here, before any window exists, and never reaches Tauri
//! (see `aphrody_app_lib::llama_daemon`).

// Hide the console window on Windows release builds (kept in debug so log output shows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> ExitCode {
    if let Some(code) = aphrody_app_lib::llama_daemon::run_if_requested(std::env::args_os()) {
        return code;
    }
    aphrody_app_lib::run();
    ExitCode::SUCCESS
}
