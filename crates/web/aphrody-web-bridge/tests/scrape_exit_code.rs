//! Regression proof: `scrape_markdown` ignores the child's exit code.
#![cfg(not(target_arch = "wasm32"))]

use std::time::Duration;

use aphrody_web_bridge::{BxcCli, cli::Run, resolve::Source};

/// A stand-in for `bxc` that prints half a page and then fails with 65.
fn fake_bxc(dir: &std::path::Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let p = dir.join("fake-bxc.cmd");
        std::fs::write(&p, "@echo off\r\necho # Partial page\r\nexit /b 65\r\n").unwrap();
        p
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let p = dir.join("fake-bxc.sh");
        std::fs::write(&p, "#!/bin/sh\necho '# Partial page'\nexit 65\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }
}

#[tokio::test]
async fn scrape_markdown_returns_ok_on_exit_65_with_partial_body() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = fake_bxc(tmp.path());
    let cli = BxcCli::from_source(Source::Override(bin));

    let res = cli.scrape_markdown("https://example.com", None, Duration::from_secs(20)).await;
    let (body, run): (String, Run) = res.expect("BUG: returned Ok despite exit 65");
    assert_eq!(run.code, Some(65), "child exit code");
    assert!(!run.ok(), "run.ok() is false");
    assert!(body.contains("Partial page"), "partial body surfaced as success: {body:?}");
    eprintln!("PROOF: Ok(()) with code={:?} ok()={} body={body:?}", run.code, run.ok());
}
