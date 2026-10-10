// SPDX-License-Identifier: Apache-2.0
//! `aphrody identity terminal-theme` without building the multi-call binary:
//! `cargo run -p aphrody-identity --example terminal-theme -- --check`.

fn main() {
    std::process::exit(aphrody_identity::terminal_theme_main(std::env::args_os().collect()));
}
