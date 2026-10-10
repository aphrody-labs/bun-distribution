// SPDX-License-Identifier: Apache-2.0
//! Entry point of the former `aphrody-llama-daemon` binary:
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

use std::{ffi::OsString, path::PathBuf};

use crate::{Role, StateDirs, daemon};

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

/// Entry point of the former `aphrody-llama-daemon` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention). Returns the process exit
/// code: 0 for a normal end, 1 when the server could not be brought up, 2 on a usage error.
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    // reqwest is built with `rustls-no-provider`: install the process-wide rustls
    // crypto provider before any HTTP client exists (building one without it panics).
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args = match parse_args(args.into_iter().skip(1).map(|a| a.to_string_lossy().into_owned()))
    {
        Ok(args) => args,
        Err(message) => {
            eprintln!("aphrody-llama-daemon: {message}");
            eprintln!("usage: aphrody-llama-daemon --state-root <dir> --role <chat|embed|rerank>");
            return 2;
        },
    };

    // Current-thread runtime: the server is spawned from this very thread,
    // which the Linux parent-death signal is bound to.
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("aphrody-llama-daemon: cannot start the runtime: {error}");
            return 1;
        },
    };

    let dirs = StateDirs::new(args.state_root);
    match runtime.block_on(daemon::run(&dirs, args.role)) {
        Ok(reason) => {
            eprintln!("aphrody-llama-daemon[{}]: exiting ({reason:?})", args.role.as_str());
            0
        },
        Err(error) => {
            eprintln!("aphrody-llama-daemon[{}]: {error}", args.role.as_str());
            1
        },
    }
}
