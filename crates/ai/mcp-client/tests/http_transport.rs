// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Streamable HTTP transport contract: every request carries the configured headers, the bearer
//! token and the mandated `Accept` value; the raw `tools/call` result survives untouched;
//! redirects are not followed; a malformed header never leaks its value.
//!
//! The fixture is a plain `TcpListener` on loopback, so no network access is needed.

use std::{
    collections::BTreeMap,
    io::{BufRead as _, BufReader, Read as _, Write as _},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

use aphrody_mcp_client::{McpClient, McpClientError, protocol::parse_call_tool_result};
use serde_json::{Value, json};

/// One request observed by the fixture: request line, lower-cased headers, JSON-RPC body.
type Seen = (String, BTreeMap<String, String>, Value);

fn install_crypto_provider() {
    // reqwest is built with `rustls-no-provider`; a process-wide provider has to be installed
    // before the first client exists. A second installation attempt is harmless.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Accept one connection and wrap it for line-oriented reads.
fn accept(listener: &TcpListener) -> BufReader<TcpStream> {
    let (stream, _) = listener.accept().expect("accept MCP request");
    stream.set_read_timeout(Some(Duration::from_secs(5))).expect("read timeout");
    BufReader::new(stream)
}

/// Read one complete HTTP request (head and `Content-Length` body).
fn read_request(reader: &mut BufReader<TcpStream>) -> Seen {
    let mut request_line = String::new();
    reader.read_line(&mut request_line).expect("request line");
    let mut headers = BTreeMap::new();
    let mut length = 0_usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("header line");
        if line == "\r\n" {
            break;
        }
        let (name, value) = line.split_once(':').expect("header format");
        let (name, value) = (name.trim().to_ascii_lowercase(), value.trim().to_owned());
        if name == "content-length" {
            length = value.parse().expect("body length");
        }
        headers.insert(name, value);
    }
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body).expect("request body");
    let request: Value = serde_json::from_slice(&body).expect("JSON-RPC body");
    (request_line.trim().to_owned(), headers, request)
}

/// Serve `expected` sequential requests, answering each by JSON-RPC method.
fn serve(listener: TcpListener, expected: usize) -> thread::JoinHandle<Vec<Seen>> {
    thread::spawn(move || {
        let mut seen = Vec::new();
        for _ in 0..expected {
            let mut reader = accept(&listener);
            let request = read_request(&mut reader);
            let response = match request.2["method"].as_str().expect("method") {
                "initialize" => json!({
                    "jsonrpc": "2.0",
                    "id": request.2["id"],
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "serverInfo": { "name": "fixture", "version": "1" },
                        "capabilities": { "tools": {} }
                    }
                })
                .to_string(),
                "notifications/initialized" => String::new(),
                "tools/list" => json!({
                    "jsonrpc": "2.0",
                    "id": request.2["id"],
                    "result": { "tools": [{
                        "name": "echo",
                        "description": "Echo the text argument",
                        "inputSchema": { "type": "object" }
                    }] }
                })
                .to_string(),
                "tools/call" => json!({
                    "jsonrpc": "2.0",
                    "id": request.2["id"],
                    "result": {
                        "content": [{ "type": "text", "text": "hi" }],
                        "structuredContent": { "answer": 42 }
                    }
                })
                .to_string(),
                other => panic!("unexpected method: {other}"),
            };
            let status = if response.is_empty() { "202 Accepted" } else { "200 OK" };
            write!(
                reader.get_mut(),
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: \
                 {}\r\nConnection: close\r\n\r\n{response}",
                response.len()
            )
            .expect("respond");
            seen.push(request);
        }
        seen
    })
}

#[tokio::test]
async fn headers_accept_and_bearer_reach_every_request_and_the_raw_result_survives() {
    install_crypto_provider();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
    let address = listener.local_addr().expect("fixture address");
    let server = serve(listener, 4);

    let configured = BTreeMap::from([("X-Project".to_owned(), "fixture-workspace".to_owned())]);
    let mut client = McpClient::from_http(
        format!("http://{address}/mcp"),
        Some("fixture-secret".to_owned()),
        Some(&configured),
    )
    .expect("HTTP client");

    let info = client.initialize().await.expect("initialize").clone();
    assert_eq!(info.name, "fixture");
    let tools = client.list_tools().await.expect("tools/list");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "echo");

    let raw = client
        .call_tool_raw("echo", json!({ "text": "hi" }))
        .await
        .expect("tools/call returns the raw result");
    assert_eq!(raw["structuredContent"]["answer"], 42, "fields the typed result drops survive");
    let typed = parse_call_tool_result(&raw).expect("typed view of the same payload");
    assert_eq!(typed.text_content(), "hi");

    let seen = server.join().expect("fixture assertions");
    for (line, headers, _) in &seen {
        assert!(line.starts_with("POST /mcp HTTP/1.1"), "{line}");
        assert_eq!(headers.get("authorization").map(String::as_str), Some("Bearer fixture-secret"));
        assert_eq!(headers.get("x-project").map(String::as_str), Some("fixture-workspace"));
        assert_eq!(
            headers.get("accept").map(String::as_str),
            Some("application/json, text/event-stream")
        );
        assert_eq!(headers.get("content-type").map(String::as_str), Some("application/json"));
    }
    let methods: Vec<&str> =
        seen.iter().filter_map(|(_, _, body)| body["method"].as_str()).collect();
    assert_eq!(methods, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    let call = &seen[3].2;
    assert_eq!(call["params"]["name"], "echo");
    assert_eq!(call["params"]["arguments"]["text"], "hi");
}

#[tokio::test]
async fn redirects_are_reported_not_followed() {
    install_crypto_provider();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
    let address = listener.local_addr().expect("fixture address");
    let server = thread::spawn(move || {
        let mut reader = accept(&listener);
        let _request = read_request(&mut reader);
        reader
            .get_mut()
            .write_all(
                b"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:1/elsewhere\r\n\
                  Content-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .expect("respond");
    });

    let mut client =
        McpClient::from_http(format!("http://{address}/mcp"), Some("fixture-secret".into()), None)
            .expect("HTTP client");
    let error = client.initialize().await.expect_err("a redirect must not be followed");
    assert!(
        matches!(error, McpClientError::HttpStatus { status: 307, .. }),
        "unexpected error: {error}"
    );
    server.join().expect("fixture");
}

#[test]
fn invalid_header_is_rejected_without_leaking_its_value() {
    install_crypto_provider();
    let headers = BTreeMap::from([("X-Secret".to_owned(), "private\nvalue".to_owned())]);
    // `McpClient` is not `Debug`, so `expect_err` is unavailable; match instead.
    let error = match McpClient::from_http("http://127.0.0.1:1/mcp", None, Some(&headers)) {
        Ok(_) => panic!("an invalid header value was accepted"),
        Err(error) => error,
    };
    assert!(matches!(&error, McpClientError::InvalidHeader { name } if name == "X-Secret"));
    let text = error.to_string();
    assert!(text.contains("X-Secret"));
    assert!(!text.contains("private"), "value leaked into: {text}");
}
