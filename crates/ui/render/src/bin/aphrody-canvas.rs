// SPDX-License-Identifier: Apache-2.0
//! `aphrody-canvas`: render one untrusted M3 canvas scene (JSON on stdin) to PNG (stdout).
//!
//! Exit codes: 0 rendered, 2 invalid JSON, 3 invalid scene (reason on stderr), 4 render failure,
//! 5 I/O failure. `aphrody-site` (aphrody-web) runs it for `/api/v1/canvas/render` so that it
//! never links this UI-layer crate.

use std::io::{Read, Write};

use aphrody_render::canvas::{MAX_REQUEST_BYTES, render_untrusted};

fn main() {
    let mut body = Vec::new();
    let limit = u64::try_from(MAX_REQUEST_BYTES).unwrap_or(u64::MAX).saturating_add(1);
    if let Err(error) = std::io::stdin().take(limit).read_to_end(&mut body) {
        eprintln!("aphrody-canvas: read stdin: {error}");
        std::process::exit(5);
    }
    match render_untrusted(&body) {
        Ok(png) => {
            let mut stdout = std::io::stdout().lock();
            if let Err(error) = stdout.write_all(&png).and_then(|()| stdout.flush()) {
                eprintln!("aphrody-canvas: write stdout: {error}");
                std::process::exit(5);
            }
        },
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(error.exit_code());
        },
    }
}
