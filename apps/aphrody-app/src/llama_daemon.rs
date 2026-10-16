// SPDX-License-Identifier: Apache-2.0
//! The desktop executable as the host of the managed `llama-server` daemon.
//!
//! `aphrody-agent-runtime` starts a managed model server by spawning a detached daemon: the
//! current executable, re-executed as `<exe> __llama-daemon --state-root <dir> --role <role>`.
//! The agent used to run inside the `aphrody` CLI, whose hidden `__llama-daemon` subcommand
//! served that request. It now runs in the desktop process (see [`crate::broker`]), so the
//! desktop executable has to answer the same argument vector, before Tauri or any window
//! exists, or the daemon would never come up and every local model would time out.
//!
//! The daemon body is [`aphrody_llama_server::daemon::run`]; this module only parses the
//! arguments and hosts it on a current-thread runtime (the server is spawned from that very
//! thread, which the Linux parent-death signal is bound to). Exit status: `0` when the server
//! ended for a normal reason, `1` when it could not be brought up (the reason is also published
//! for the waiting client), `2` on a usage error, like `aphrody-llama-daemon`.
//!
//! With the default `in-process` feature the desktop never takes this path: the supervisor is
//! bypassed and `aphrody_llama_server::InferenceBackend` selects the in-process engine. This
//! entry only serves builds without the feature, or an explicit `APHRODY_LLAMA_BACKEND=spawn`.

use std::{
    ffi::{OsStr, OsString},
    path::PathBuf,
    process::ExitCode,
};

use aphrody_llama_server::{Role, StateDirs, daemon};

/// The hidden first argument the supervisor passes.
pub const DAEMON_ARG: &str = "__llama-daemon";

/// The arguments after [`DAEMON_ARG`].
#[derive(Debug, PartialEq, Eq)]
struct DaemonArgs {
    state_root: PathBuf,
    role: Role,
}

/// Parse `--state-root <dir> --role <chat|embed|rerank>`.
fn parse(mut args: impl Iterator<Item = OsString>) -> Result<DaemonArgs, String> {
    let mut state_root = None;
    let mut role = None;
    while let Some(flag) = args.next() {
        let flag = flag.to_string_lossy().into_owned();
        let mut value = || args.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--state-root" => state_root = Some(PathBuf::from(value()?)),
            "--role" => {
                let name = value()?.to_string_lossy().into_owned();
                role = Some(Role::parse(&name).ok_or_else(|| format!("unknown role `{name}`"))?);
            },
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    Ok(DaemonArgs {
        state_root: state_root.ok_or("--state-root is required")?,
        role: role.ok_or("--role is required")?,
    })
}

/// Run the daemon when `args` (the whole process argument vector, program name first) ask for
/// it, and return its exit status. `None` is a normal desktop launch.
#[must_use]
pub fn run_if_requested(args: impl IntoIterator<Item = OsString>) -> Option<ExitCode> {
    let mut args = args.into_iter().skip(1);
    if args.next().as_deref() != Some(OsStr::new(DAEMON_ARG)) {
        return None;
    }
    let args = match parse(args) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{DAEMON_ARG}: {message}");
            eprintln!("usage: {DAEMON_ARG} --state-root <dir> --role <chat|embed|rerank>");
            return Some(ExitCode::from(2));
        },
    };
    // reqwest is built with `rustls-no-provider`: install the process-wide crypto provider before
    // any HTTP client exists (building one without it panics).
    let _ = rustls::crypto::ring::default_provider().install_default();
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("{DAEMON_ARG}: cannot start the runtime: {error}");
            return Some(ExitCode::FAILURE);
        },
    };
    let dirs = StateDirs::new(args.state_root);
    Some(match runtime.block_on(daemon::run(&dirs, args.role)) {
        Ok(reason) => {
            eprintln!("{DAEMON_ARG}[{}]: exiting ({reason:?})", args.role.as_str());
            ExitCode::SUCCESS
        },
        Err(error) => {
            eprintln!("{DAEMON_ARG}[{}]: {error}", args.role.as_str());
            ExitCode::FAILURE
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    #[test]
    fn a_normal_launch_is_not_a_daemon_request() {
        assert!(run_if_requested(os(&["aphrody-app"])).is_none());
        assert!(run_if_requested(os(&["aphrody-app", "--autostart"])).is_none());
        assert!(run_if_requested(os(&["aphrody-app", "aphrody://ask?q=hello"])).is_none());
        // The marker only counts as the first argument.
        assert!(run_if_requested(os(&["aphrody-app", "--autostart", DAEMON_ARG])).is_none());
    }

    #[test]
    fn the_supervisor_arguments_are_parsed() {
        let parsed =
            parse(os(&["--state-root", "/tmp/aphrody-state", "--role", "chat"]).into_iter());
        assert_eq!(
            parsed,
            Ok(DaemonArgs { state_root: PathBuf::from("/tmp/aphrody-state"), role: Role::Chat })
        );
        // The order of the flags does not matter.
        let parsed = parse(os(&["--role", "rerank", "--state-root", "state"]).into_iter());
        assert_eq!(
            parsed,
            Ok(DaemonArgs { state_root: PathBuf::from("state"), role: Role::Rerank })
        );
    }

    #[test]
    fn usage_errors_are_reported_not_guessed() {
        assert!(parse(os(&["--role", "chat"]).into_iter()).unwrap_err().contains("--state-root"));
        assert!(parse(os(&["--state-root", "x"]).into_iter()).unwrap_err().contains("--role"));
        assert!(parse(os(&["--state-root"]).into_iter()).unwrap_err().contains("needs a value"));
        assert!(
            parse(os(&["--role", "tts", "--state-root", "x"]).into_iter())
                .unwrap_err()
                .contains("unknown role")
        );
        assert!(parse(os(&["--bogus"]).into_iter()).unwrap_err().contains("unknown argument"));
    }
}
