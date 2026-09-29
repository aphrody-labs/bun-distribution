//! Probe: does `Request::with_timeout` bound the bxc path downward?
#![cfg(not(target_arch = "wasm32"))]

use std::time::{Duration, Instant};

#[tokio::test(flavor = "multi_thread")]
async fn short_timeout_should_bound_the_bxc_path() {
    if std::env::var("APHRODY_BXC_NET").is_err() {
        eprintln!("SKIP: APHRODY_BXC_NET unset");
        return;
    }
    let req = aphrody_web_bridge::fetch::Request::new("https://example.com")
        .with_profile(aphrody_web_bridge::Profile::Static)
        .with_timeout(Duration::from_secs(5));
    let t = Instant::now();
    let r = aphrody_web_bridge::fetch::fetch(&req).await;
    let elapsed = t.elapsed();
    eprintln!("ELAPSED={:?} ok={}", elapsed, r.is_ok());
    if let Ok(f) = &r {
        eprintln!("PATH={:?}", f.path_taken);
    }
    assert!(elapsed < Duration::from_secs(20), "caller budget 5s ignored: {elapsed:?}");
}
