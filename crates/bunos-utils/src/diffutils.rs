//! diffutils: uutils diffutils (MIT OR Apache-2.0) from `vendor/uutils/diffutils`.

use std::ffi::OsString;
use std::process::ExitCode;

pub const APPLETS: &[(&str, super::Main)] = &[("diff", diff), ("cmp", cmp)];

fn diff(args: Vec<OsString>) -> ExitCode {
    diffutilslib::diff::main(args.into_iter().peekable())
}

fn cmp(args: Vec<OsString>) -> ExitCode {
    diffutilslib::cmp::main(args.into_iter().peekable())
}
