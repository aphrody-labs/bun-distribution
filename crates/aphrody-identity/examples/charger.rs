// SPDX-License-Identifier: Apache-2.0
//! `aphrody identity charger` without building the multi-call binary:
//! `cargo run -p aphrody-identity --features net --example charger -- symbol:home --svg`.

fn main() {
    std::process::exit(aphrody_identity::charger_main(
        std::env::args_os().collect(),
    ));
}
