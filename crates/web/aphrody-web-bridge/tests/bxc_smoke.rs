// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! End-to-end smoke test for the bxc bridge.
//!
//! This is the test that catches a bridge which compiles, resolves its
//! artefacts, loads them cleanly - and hands back an empty page, or HTML that
//! nobody converted. It needs the real cdylib, the real binary and (for the
//! network cases) the network, so it **skips** rather than fails when the
//! machine has none of them:
//!
//! ```text
//! cargo test -p aphrody-web-bridge --test bxc_smoke -- --nocapture
//! APHRODY_BXC_NET=1 cargo test -p aphrody-web-bridge --test bxc_smoke -- --nocapture
//! ```
//!
//! Skipping on a bare machine is deliberate, and copied from
//! `crates/aphrody-voice/tests/whisper_cpp_smoke.rs`: a hard failure there
//! trains everyone to ignore the test, which is worse than not having it.
//!
//! The network cases are additionally behind `APHRODY_BXC_NET=1`, because a
//! test suite that reaches the public internet by default is a test suite that
//! goes red on a train.

#![allow(clippy::print_stderr)]

use aphrody_web_bridge::fetch::{Rendering, Request, Transport};

/// Opt-in switch for the cases that leave the machine.
const NET_ENV: &str = "APHRODY_BXC_NET";

fn net_enabled() -> bool {
    std::env::var(NET_ENV).is_ok_and(|v| !v.is_empty() && v != "0")
}

/// Availability must always answer, and every absence must carry its fix.
#[test]
fn availability_reports_both_halves_or_says_how_to_get_them() {
    let a = aphrody_web_bridge::Availability::probe();
    eprintln!("binary  {:?}", a.binary);
    eprintln!("library {:?}", a.library);
    for m in &a.missing {
        eprintln!("missing: {m}");
    }
    assert_eq!(
        a.missing.len(),
        usize::from(!a.has_binary()) + usize::from(!a.has_library()),
        "an absent half without an explanation is exactly the silence this bridge removes"
    );
}

/// The seam that retires `r.jina.ai`: bytes in, Markdown out, in-process.
#[test]
fn the_loaded_bridge_converts_html_to_markdown_in_process() {
    let Ok(bridge) = aphrody_web_bridge::ffi::shared() else {
        eprintln!("skipped: bxc_rust_bridge cdylib not installed on this machine");
        return;
    };
    eprintln!("library {} ({})", bridge.path().display(), bridge.source().label());

    let html = "<html><head><title>Style Guide</title></head><body><h1>Style Guide</h1><p>Prefer \
                <code>const</code>.</p><ul><li>one</li><li>two</li></ul></body></html>";

    let md = bridge.html_to_markdown(html).expect("conversion must succeed");
    eprintln!("--- markdown ---\n{md}\n----------------");
    assert!(md.contains("Style Guide"), "the heading was lost: {md}");
    assert!(md.contains("one") && md.contains("two"), "the list was lost: {md}");
    assert!(!md.contains("<li>"), "raw markup survived the conversion: {md}");

    // Preserve the bridge's historical NUL scrub before local Rust conversion.
    let with_nul = "<p>a\0b</p>";
    let out = bridge.html_to_markdown(with_nul).expect("a NUL must not reach the C ABI");
    assert!(out.contains("ab"), "{out}");
}

/// A parsed tree must answer selectors and free itself exactly once.
#[test]
fn the_cdylib_runs_selectors_over_an_owned_tree() {
    let Ok(bridge) = aphrody_web_bridge::ffi::shared() else {
        eprintln!("skipped: bxc_rust_bridge cdylib not installed on this machine");
        return;
    };
    let html = "<div><a class=\"r\" href=\"https://a.example\">A</a>\
                <a class=\"r\" href=\"https://b.example\">B</a><a>C</a></div>";
    let dom = bridge.parse_html(html).expect("parse must succeed");
    let all = dom.query_selector_all("a.r").expect("query-all must succeed");
    assert_eq!(all.len(), 2, "expected two anchors, got {all:?}");
    assert!(all[0].contains("a.example"), "{all:?}");
    assert_eq!(bridge.extract_title("<title>T</title>").unwrap(), "T");
}

/// The `bxc` executable must be reachable through the shared chain, and a
/// non-zero exit must never be read as "not installed" - `--help` exits 1.
#[tokio::test]
async fn the_binary_is_reachable_and_a_nonzero_exit_is_not_an_absence() {
    let Ok(cli) = aphrody_web_bridge::BxcCli::discover() else {
        eprintln!("skipped: bxc executable not installed on this machine");
        return;
    };
    eprintln!("binary {} ({})", cli.path().display(), cli.source().label());

    let run = cli
        .run(&["--version".to_owned()], std::time::Duration::from_secs(60))
        .await
        .expect("spawning an installed bxc must succeed");
    eprintln!("--version -> code {:?}, stdout {:?}", run.code, run.stdout.trim());
    let version = run.stdout.to_lowercase();
    assert!(
        version.contains("bxc") || version.contains("aphrody web browser"),
        "stdout: {:?}",
        run.stdout
    );

    // Measured on 2026-09-07: help exits 1 while printing to stdout. A probe
    // that treats exit != 0 as "missing" would report an installed bxc as
    // absent.
    let help = cli
        .run(&["recon".to_owned(), "--help".to_owned()], std::time::Duration::from_secs(60))
        .await
        .expect("spawn must succeed");
    eprintln!("recon --help -> code {:?}", help.code);
    assert!(!help.stdout.is_empty(), "help must reach stdout even at exit {:?}", help.code);
    assert!(
        aphrody_web_bridge::BxcCli::discover().is_ok(),
        "a non-zero exit must not change whether bxc is considered installed"
    );
}

/// A dead child must be bounded. `bxc scrape` writes its page and then hangs;
/// the bridge kills it and keeps the output. This asserts the bound itself on
/// a subcommand that is cheap to run.
#[tokio::test]
async fn a_run_that_outlives_its_budget_is_killed_rather_than_awaited() {
    let Ok(cli) = aphrody_web_bridge::BxcCli::discover() else {
        eprintln!("skipped: bxc executable not installed on this machine");
        return;
    };
    if !net_enabled() {
        eprintln!("skipped: set {NET_ENV}=1 to exercise the timeout against a real fetch");
        return;
    }

    // Deliberately the shipped budget, not a shorter one: the point of this
    // case is that `SCRAPE_BUDGET` is long enough to see the output. A 20 s
    // budget was measured to kill the child with **zero** bytes on stdout -
    // bxc spends the first ~45 s waiting out its Redis reconnection back-off
    // before it prints anything, so a budget tuned to "the content is already
    // there" returns an empty page and calls it a hang.
    let budget = aphrody_web_bridge::cli::SCRAPE_BUDGET;
    let started = std::time::Instant::now();
    let run = cli
        .run(
            &["scrape".to_owned(), "https://example.com".to_owned(), "--markdown".to_owned()],
            budget,
        )
        .await
        .expect("spawn must succeed");
    let elapsed = started.elapsed();
    eprintln!(
        "scrape -> timed_out {} after {:?}, {} bytes",
        run.timed_out,
        elapsed,
        run.stdout.len()
    );

    assert!(
        elapsed < budget + std::time::Duration::from_secs(30),
        "the budget did not bound the child: {elapsed:?}"
    );
    assert!(
        !run.stdout.is_empty(),
        "SCRAPE_BUDGET ({}s) is too short for this machine: the child was killed with no output, \
         which is indistinguishable from a failed fetch",
        budget.as_secs()
    );
    assert!(run.stdout.contains("Example Domain"), "stdout: {:?}", run.stdout);
}

/// The whole point, end to end: a page fetched by aphrody itself, converted in
/// this process, with no third party anywhere in the itinerary.
#[tokio::test]
async fn a_real_page_comes_back_as_markdown_with_no_proxy_in_the_path() {
    if !net_enabled() {
        eprintln!("skipped: set {NET_ENV}=1 to fetch a real page");
        return;
    }

    let page = aphrody_web_bridge::fetch::fetch(&Request::new("https://example.com"))
        .await
        .expect("fetching example.com must succeed");

    eprintln!("{}", page.banner());
    eprintln!("--- body ---\n{}\n------------", page.body);

    assert!(
        matches!(page.transport, Transport::Direct { status: 200, .. }),
        "{:?}",
        page.transport
    );
    assert!(page.body.contains("Example Domain"), "the page content was lost: {}", page.body);

    // Nothing in the trail may name a third party. This is the assertion that
    // would have failed on the code this bridge replaces.
    let trail = page.path_taken.join(" ");
    assert!(!trail.contains("jina"), "a proxy crept back into the path: {trail}");
    assert!(!page.body.contains("r.jina.ai"), "proxy artefacts in the body");

    match &page.rendering {
        Rendering::Markdown { via } => {
            assert!(via.contains("bxc"), "{via}");
            assert!(!page.body.contains("<h1>"), "raw markup survived: {}", page.body);
            // example.com carries an inline stylesheet. Before the noise-block
            // pass it came through as `Example Domainbody{background:#eee;...}`
            // in the very first line of the model-facing body.
            assert!(
                !page.body.contains("background:"),
                "inline CSS reached the body: {}",
                page.body
            );
        },
        Rendering::RawHtml { reason } => {
            // Legitimate on a machine without the cdylib - but it must say so.
            eprintln!("degraded (expected without the cdylib): {reason}");
            assert!(
                reason.contains("APHRODY_BXC_LIB") || reason.contains("bxc"),
                "a degraded answer must name its fix: {reason}"
            );
            assert!(page.banner().contains("NOTE:"), "degradation must be announced");
        },
        Rendering::Verbatim { content_type } => {
            panic!("example.com is HTML, not {content_type}")
        },
    }
}

/// A non-http scheme is refused before anything is spawned or loaded.
#[tokio::test]
async fn a_non_http_url_is_refused_up_front() {
    let err = aphrody_web_bridge::fetch::fetch(&Request::new("file:///c:/windows/win.ini"))
        .await
        .expect_err("a file:// URL must not be fetched");
    assert!(matches!(err, aphrody_web_bridge::BxcError::BadUrl { .. }), "{err}");
}
