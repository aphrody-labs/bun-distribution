// SPDX-License-Identifier: Apache-2.0
//! `aphrody canvas` (former `aphrody-canvas` binary): render one untrusted M3 canvas scene
//! (JSON on stdin) to PNG (stdout).
//!
//! Exit codes: 0 rendered, 2 invalid JSON, 3 invalid scene (reason on stderr), 4 render failure,
//! 5 I/O failure. `aphrody-site` (aphrody-web) runs it for `/api/v1/canvas/render` so that it
//! never links this UI-layer crate.

use std::{
    ffi::OsString,
    io::{Read, Write},
};

use crate::canvas::{MAX_REQUEST_BYTES, render_untrusted};

/// Entry point of the former `aphrody-canvas` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
#[must_use]
pub fn cli_main(_args: Vec<OsString>) -> i32 {
    let mut body = Vec::new();
    let limit = u64::try_from(MAX_REQUEST_BYTES).unwrap_or(u64::MAX).saturating_add(1);
    if let Err(error) = std::io::stdin().take(limit).read_to_end(&mut body) {
        eprintln!("aphrody-canvas: read stdin: {error}");
        return 5;
    }
    match render_untrusted(&body) {
        Ok(png) => {
            let mut stdout = std::io::stdout().lock();
            if let Err(error) = stdout.write_all(&png).and_then(|()| stdout.flush()) {
                eprintln!("aphrody-canvas: write stdout: {error}");
                return 5;
            }
            0
        },
        Err(error) => {
            eprintln!("{error}");
            error.exit_code()
        },
    }
}
