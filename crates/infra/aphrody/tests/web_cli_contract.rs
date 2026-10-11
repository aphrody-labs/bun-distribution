// SPDX-License-Identifier: Apache-2.0
//! End-to-end contract tests for the Web CLI using only a loopback HTTP fixture.

#![cfg(not(target_arch = "wasm32"))]

use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

use assert_cmd::Command;
use serde_json::Value;

fn serve_once(content_type: &str, body: &str) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fixture listener");
    let address = listener.local_addr().expect("fixture address");
    let content_type = content_type.to_owned();
    let body = body.to_owned();
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept fixture request");
        let mut request = [0_u8; 4096];
        let _ = stream.read(&mut request);
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .expect("write fixture response");
    });
    (format!("http://{address}/"), worker)
}

fn aphrody(args: &[&str]) -> std::process::Output {
    Command::cargo_bin("aphrody")
        .expect("aphrody binary")
        .args(args)
        .env("OBSCURA_ALLOW_PRIVATE_NETWORK", "1")
        .output()
        .expect("run aphrody")
}

#[test]
fn empty_fetch_fails_without_stdout() {
    let (url, server) = serve_once("text/plain", "");
    let output = aphrody(&["web", "fetch", &url, "--profile", "static", "--json"]);
    server.join().expect("fixture server");
    assert!(!output.status.success(), "empty fetch must fail");
    assert!(
        output.stdout.is_empty(),
        "stdout must stay empty: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let diagnostic: Value =
        serde_json::from_slice(output.stderr.split(|byte| *byte == b"\n"[0]).next().unwrap())
            .expect("empty-fetch diagnostic JSON");
    assert_eq!(diagnostic["event"], "web.fetch.empty");
    assert_eq!(diagnostic["profileRequested"], "static");
    assert_eq!(diagnostic["profileObtained"], "static");
}

#[test]
fn fetch_json_reports_requested_and_obtained_profiles() {
    let (url, server) =
        serve_once("text/html", "<html><body><main><h1>Useful page</h1></main></body></html>");
    let output = aphrody(&["web", "fetch", &url, "--profile", "http", "--json"]);
    server.join().expect("fixture server");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let report: Value = serde_json::from_slice(&output.stdout).expect("fetch JSON stdout");
    assert_eq!(report["profile_requested"], "http");
    assert_eq!(report["profile_obtained"], "http");
}

#[test]
fn recon_json_reports_profiles_and_content() {
    let (url, server) = serve_once(
        "text/html",
        "<html><head><title>Local page</title></head><body><main><h1>Useful page</h1></main></body></html>",
    );
    let output = aphrody(&["web", "recon", &url, "--profile", "static", "--json"]);
    server.join().expect("fixture server");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let report: Value = serde_json::from_slice(&output.stdout).expect("recon JSON stdout");
    assert_eq!(report["profileRequested"], "static");
    assert_eq!(report["profileObtained"], "static");
    assert_eq!(report["title"], "Useful page");
}

#[test]
fn scrape_without_matches_fails_and_keeps_stdout_empty() {
    let (url, server) = serve_once("text/html", "<html><body><p>present</p></body></html>");
    let output = aphrody(&["web", "scrape", &url, ".missing", "--profile", "static"]);
    server.join().expect("fixture server");
    assert!(!output.status.success(), "no scrape results must fail");
    assert!(
        output.stdout.is_empty(),
        "stdout must stay empty: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    let diagnostic: Value =
        serde_json::from_slice(output.stderr.split(|byte| *byte == b"\n"[0]).next().unwrap())
            .expect("empty-scrape diagnostic JSON");
    assert_eq!(diagnostic["event"], "web.scrape.empty");
    assert_eq!(diagnostic["profileRequested"], "static");
    assert_eq!(diagnostic["profileObtained"], "static");
}

#[test]
fn scrape_keeps_content_on_stdout_and_reports_profile_on_stderr() {
    let (url, server) =
        serve_once("text/html", "<html><body><p class=\"target\">visible text</p></body></html>");
    let output = aphrody(&["web", "scrape", &url, ".target", "--profile", "static"]);
    server.join().expect("fixture server");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let rows: Value = serde_json::from_slice(&output.stdout).expect("scrape JSON stdout");
    assert_eq!(rows[0]["text"], "visible text");
    let diagnostic: Value =
        serde_json::from_slice(&output.stderr).expect("profile diagnostic JSON");
    assert_eq!(diagnostic["event"], "web.scrape.profile");
    assert_eq!(diagnostic["profileRequested"], "static");
    assert_eq!(diagnostic["profileObtained"], "static");
}
