// SPDX-License-Identifier: Apache-2.0
//! Offline checks of the fetch profiles against a loopback page: the static path uses the
//! in-process HTTP client, the browser path renders in the in-process Obscura browser.

#![cfg(not(target_arch = "wasm32"))]

use std::time::Duration;

use aphrody_web_service::fetch::{Profile, Request, Transport, fetch};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn local_page() -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request).await;
                let body = "<html><head><title>Shared Browser</title></head><body><main><h1>Shared Browser</h1><p>Local Rust page.</p></main></body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
            });
        }
    });
    (format!("http://{address}/"), task)
}

#[tokio::test(flavor = "multi_thread")]
async fn fast_profile_uses_in_process_browser() {
    let (url, server) = local_page().await;
    let request = Request::new(url)
        .with_profile(Profile::Fast)
        .with_private_network(true)
        .with_timeout(Duration::from_secs(10));
    let page = fetch(&request).await.unwrap();
    server.abort();

    assert!(matches!(page.transport, Transport::Browser { profile: Profile::Fast, .. }));
    assert!(page.body.contains("Shared Browser"), "{}", page.body);
    assert!(page.path_taken.iter().any(|step| step.contains("obscura V8")));
    assert!(!page.truncated);
}

#[tokio::test(flavor = "multi_thread")]
async fn static_profile_uses_local_http_client() {
    let (url, server) = local_page().await;
    let request = Request::new(url).with_profile(Profile::Static);
    let page = fetch(&request).await.unwrap();
    server.abort();

    assert!(matches!(page.transport, Transport::Direct { status: 200, .. }));
    assert!(page.body.contains("Local Rust page"));
}

#[cfg(not(feature = "stealth"))]
#[tokio::test]
async fn stealth_profile_reports_missing_feature() {
    let request = Request::new("https://example.com").with_profile(Profile::Stealth);
    let error = fetch(&request).await.unwrap_err();
    assert!(error.to_string().contains("stealth feature"), "{error}");
}
