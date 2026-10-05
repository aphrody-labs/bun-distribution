// SPDX-License-Identifier: Apache-2.0
//! Transitional entry point of the home database; the verbs move under `aphrody` (multi-call).

fn main() -> std::process::ExitCode {
    aphrody_store::cli::cli_main()
}
