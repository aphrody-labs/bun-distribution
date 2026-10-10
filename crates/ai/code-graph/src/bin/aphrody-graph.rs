// SPDX-License-Identifier: Apache-2.0
//! Transitional entry point of the code graph; the verbs live under `aphrody graph`.

fn main() -> std::process::ExitCode {
    let code = aphrody_code_graph::cli::cli_main(std::env::args_os().collect());
    std::process::ExitCode::from(u8::try_from(code).unwrap_or(1))
}
