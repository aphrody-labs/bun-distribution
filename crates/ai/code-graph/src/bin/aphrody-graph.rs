// SPDX-License-Identifier: Apache-2.0
//! Transitional entry point of the code graph; the verbs move under `aphrody graph`.

fn main() -> std::process::ExitCode {
    aphrody_code_graph::cli::cli_main()
}
