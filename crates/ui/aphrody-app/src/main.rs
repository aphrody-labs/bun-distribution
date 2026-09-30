// SPDX-License-Identifier: Apache-2.0
//! Desktop binary entry point: a thin shell over [`aphrody_app_lib::run`].

// Hide the console window on Windows release builds (kept in debug so log output shows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    aphrody_app_lib::run();
}
