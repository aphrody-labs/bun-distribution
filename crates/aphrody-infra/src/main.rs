// SPDX-License-Identifier: Apache-2.0
//! Bun OS infrastructure executable, sharing the existing capability owner.

fn main() {
    std::process::exit(aphrody_infra::cli_main(std::env::args_os().collect()));
}
