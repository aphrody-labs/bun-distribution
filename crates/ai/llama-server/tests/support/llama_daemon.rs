// SPDX-License-Identifier: Apache-2.0
//! Test-support host for the daemon: the integration tests spawn it as `aphrody-llama-daemon`
//! (the production entry is the `aphrody` multi-call binary, which calls the same
//! `aphrody_llama_server::cli_main`).

fn main() -> std::process::ExitCode {
    let code = aphrody_llama_server::cli_main(std::env::args_os().collect());
    std::process::ExitCode::from(u8::try_from(code).unwrap_or(1))
}
