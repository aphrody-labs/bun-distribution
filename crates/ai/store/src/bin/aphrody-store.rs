// SPDX-License-Identifier: Apache-2.0
//! Transitional entry point of the home database; the verbs live under `aphrody home`.

fn main() -> std::process::ExitCode {
    let code = aphrody_store::cli::cli_main(std::env::args_os().collect());
    std::process::ExitCode::from(u8::try_from(code).unwrap_or(1))
}
