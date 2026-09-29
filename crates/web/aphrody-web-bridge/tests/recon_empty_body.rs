// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! Regression: `recon` must not answer `Ok` with an empty body when the child
//! exits 0 while stdout carries nothing but `[recon] ` progress lines.
//!
//! This probe started life as a reproduction — it asserted `out == ""` and
//! passed, which is how the defect was proven. `cli::recon` now rejects that
//! case, so the same fixture pins the fixed behaviour instead. A body with no
//! content under exit 0 is a false green: on a failing origin `recon` escalates
//! through all five profiles and emits only progress lines, and the caller
//! cannot tell that from a genuinely blank document.

#![cfg(not(target_arch = "wasm32"))]

use std::{fs, time::Duration};

use aphrody_web_bridge::{
    cli::{BxcCli, Profile},
    resolve::Source,
};

#[tokio::test]
async fn recon_zero_exit_with_progress_only_is_an_error_not_an_empty_ok() {
    let dir = std::env::temp_dir().join("bxc-bridge-recon-empty");
    fs::create_dir_all(&dir).unwrap();
    let fake = dir.join(if cfg!(windows) { "fake-bxc.cmd" } else { "fake-bxc.sh" });
    let body = if cfg!(windows) {
        "@echo off\r\necho [recon] resolving\r\necho [recon] done\r\nexit /b 0\r\n"
    } else {
        "#!/bin/sh\necho '[recon] resolving'\necho '[recon] done'\nexit 0\n"
    };
    fs::write(&fake, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    }

    let cli = BxcCli::from_source(Source::Override(fake));
    let outcome =
        cli.recon("https://example.com", Some(Profile::Static), Duration::from_secs(30)).await;

    let Err(err) = outcome else {
        panic!("recon accepted a progress-only stdout as a successful report");
    };

    // The error has to be actionable, not merely present: it names the run so
    // an operator can see that bxc did answer, and answered with nothing.
    let rendered = err.to_string();
    assert!(
        !rendered.trim().is_empty(),
        "an empty-body refusal must explain itself, got: {rendered:?}"
    );
}
