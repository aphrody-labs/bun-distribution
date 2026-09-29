// SPDX-License-Identifier: Apache-2.0
//! `aphrody-llama-daemon --state-root <dir> --role <chat|embed|rerank>`
//!
//! The standalone host of [`aphrody_llama_server::daemon::run`]: it owns one
//! `llama-server` process for one role until that server stops, is stopped, or
//! idles out. Started detached by [`aphrody_llama_server::Supervisor`]; it
//! takes its launch request from the role's spec file under the state root.
//!
//! Exit status: 0 when the server ended for a normal reason, 1 when it could
//! not be brought up (the reason is also published for the waiting client),
//! 2 on a usage error.

use std::{path::PathBuf, process::ExitCode};

use aphrody_llama_server::{Role, StateDirs, daemon};

struct Args {
    state_root: PathBuf,
    role: Role,
}

fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut state_root = None;
    let mut role = None;
    while let Some(flag) = args.next() {
        let mut value = || args.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--state-root" => state_root = Some(PathBuf::from(value()?)),
            "--role" => {
                let name = value()?;
                role = Some(Role::parse(&name).ok_or_else(|| format!("unknown role `{name}`"))?);
            },
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    Ok(Args {
        state_root: state_root.ok_or("--state-root is required")?,
        role: role.ok_or("--role is required")?,
    })
}

fn main() -> ExitCode {
    // reqwest is built with `rustls-no-provider`: install the process-wide rustls
    // crypto provider before any HTTP client exists (building one without it panics).
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("aphrody-llama-daemon: {message}");
            eprintln!("usage: aphrody-llama-daemon --state-root <dir> --role <chat|embed|rerank>");
            return ExitCode::from(2);
        },
    };

    // Current-thread runtime: the server is spawned from this very thread,
    // which the Linux parent-death signal is bound to.
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("aphrody-llama-daemon: cannot start the runtime: {error}");
            return ExitCode::FAILURE;
        },
    };

    let dirs = StateDirs::new(args.state_root);
    match runtime.block_on(daemon::run(&dirs, args.role)) {
        Ok(reason) => {
            eprintln!("aphrody-llama-daemon[{}]: exiting ({reason:?})", args.role.as_str());
            ExitCode::SUCCESS
        },
        Err(error) => {
            eprintln!("aphrody-llama-daemon[{}]: {error}", args.role.as_str());
            ExitCode::FAILURE
        },
    }
}
