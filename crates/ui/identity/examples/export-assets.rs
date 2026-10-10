// SPDX-License-Identifier: Apache-2.0
//! `aphrody identity export-assets` without building the multi-call binary:
//! `cargo run -p aphrody-identity --example export-assets -- --out crates/ui/identity/assets/brand`.

fn main() {
    std::process::exit(aphrody_identity::export_assets_main(std::env::args_os().collect()));
}
