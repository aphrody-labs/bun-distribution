// SPDX-License-Identifier: Apache-2.0
//! A loopback HTTP/1.1 server for tests (feature `test-support`, always on under `cfg(test)`).
//!
//! The X client talks to whatever [`XClientOptions::api_base`](crate::XClientOptions) names, so a
//! test points it at this server instead of x.com: no real host, no real cookie, no network.
//! The server keeps every request it saw, replies with whatever its handler returns (status,
//! headers, JSON, an optional delay) and tracks how many requests were in flight at once, which is
//! how the batch tests prove a concurrency bound.

use std::{
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
};

/// One request received by the server.
#[derive(Debug, Clone)]
pub struct Request {
    /// `GET`, `POST`, ...
    pub method: String,
    /// Path and query exactly as sent (`/i/api/graphql/abc/UserTweets?variables=...`).
    pub target: String,
    /// Header names lower-cased, values as sent.
    pub headers: Vec<(String, String)>,
    /// Body (chunked bodies are decoded).
    pub body: Vec<u8>,
}

impl Request {
    /// The path without its query string.
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or(&self.target)
    }

    /// The last path segment (the GraphQL operation name, or the REST file).
    pub fn last_segment(&self) -> &str {
        self.path().rsplit('/').next().unwrap_or_default()
    }

    /// A header value by case-insensitive name.
    pub fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers.iter().find(|(k, _)| *k == name).map(|(_, v)| v.as_str())
    }

    /// The decoded value of a query parameter.
    pub fn query(&self, key: &str) -> Option<String> {
        let query = self.target.split_once('?')?.1;
        url_pairs(query).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// The body parsed as JSON (`Null` when it is not JSON).
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    /// The body parsed as `application/x-www-form-urlencoded`.
    pub fn form(&self) -> Vec<(String, String)> {
        url_pairs(&String::from_utf8_lossy(&self.body))
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            },
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    },
                    Err(_) => {
                        out.push(b'%');
                        i += 1;
                    },
                }
            },
            other => {
                out.push(other);
                i += 1;
            },
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn url_pairs(text: &str) -> Vec<(String, String)> {
    text.split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect()
}

/// What the server answers.
#[derive(Debug, Clone)]
pub struct Response {
    /// HTTP status.
    pub status: u16,
    /// Extra headers (`content-type: application/json` is added unless present).
    pub headers: Vec<(String, String)>,
    /// Body text.
    pub body: String,
    /// Time to wait before answering (simulates a slow endpoint).
    pub delay: Duration,
}

impl Response {
    /// A JSON reply.
    pub fn json(status: u16, body: Value) -> Self {
        Self { status, headers: Vec::new(), body: body.to_string(), delay: Duration::ZERO }
    }

    /// A 200 JSON reply.
    pub fn ok(body: Value) -> Self {
        Self::json(200, body)
    }

    /// An X error reply: `{"errors":[{"code":<code>,"message":<message>}]}` with `status`.
    pub fn x_error(status: u16, code: i64, message: &str) -> Self {
        Self::json(status, serde_json::json!({ "errors": [{ "code": code, "message": message }] }))
    }

    /// Add a header.
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    /// Add `x-rate-limit-*` headers.
    pub fn with_rate_limit(self, limit: i64, remaining: i64, reset_epoch: i64) -> Self {
        self.with_header("x-rate-limit-limit", &limit.to_string())
            .with_header("x-rate-limit-remaining", &remaining.to_string())
            .with_header("x-rate-limit-reset", &reset_epoch.to_string())
    }

    /// Delay the answer.
    pub fn after(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

type Handler = dyn Fn(&Request) -> Response + Send + Sync;

/// The running server. Dropping it stops it.
pub struct MockServer {
    addr: SocketAddr,
    requests: Arc<Mutex<Vec<Request>>>,
    in_flight: Arc<AtomicUsize>,
    max_in_flight: Arc<AtomicUsize>,
    task: JoinHandle<()>,
}

impl MockServer {
    /// Start a server on a free loopback port; `handler` answers every request.
    pub async fn start(
        handler: impl Fn(&Request) -> Response + Send + Sync + 'static,
    ) -> MockServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind loopback");
        let addr = listener.local_addr().expect("local addr");
        let handler: Arc<Handler> = Arc::new(handler);
        let requests = Arc::new(Mutex::new(Vec::new()));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));
        let task = tokio::spawn({
            let (requests, in_flight, max_in_flight) =
                (requests.clone(), in_flight.clone(), max_in_flight.clone());
            async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else { return };
                    let (handler, requests, in_flight, max_in_flight) = (
                        handler.clone(),
                        requests.clone(),
                        in_flight.clone(),
                        max_in_flight.clone(),
                    );
                    tokio::spawn(async move {
                        let _ = serve(stream, handler, requests, in_flight, max_in_flight).await;
                    });
                }
            }
        });
        MockServer { addr, requests, in_flight, max_in_flight, task }
    }

    /// `http://127.0.0.1:<port>`.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// The value to give `XClientOptions::api_base`.
    pub fn api_base(&self) -> String {
        format!("{}/i/api", self.base_url())
    }

    /// The value to give `XClientOptions::upload_base`.
    pub fn upload_url(&self) -> String {
        format!("{}/i/media/upload.json", self.base_url())
    }

    /// Every request received so far, in arrival order.
    pub fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Requests whose last path segment is `segment` (a GraphQL operation name).
    pub fn requests_for(&self, segment: &str) -> Vec<Request> {
        self.requests().into_iter().filter(|r| r.last_segment() == segment).collect()
    }

    /// Number of requests received.
    pub fn count(&self) -> usize {
        self.requests.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// The highest number of requests being handled at the same moment.
    pub fn max_in_flight(&self) -> usize {
        self.max_in_flight.load(Ordering::SeqCst)
    }

    /// Requests being handled right now.
    pub fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::SeqCst)
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        414 => "URI Too Long",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

async fn serve(
    mut stream: TcpStream,
    handler: Arc<Handler>,
    requests: Arc<Mutex<Vec<Request>>>,
    in_flight: Arc<AtomicUsize>,
    max_in_flight: Arc<AtomicUsize>,
) -> std::io::Result<()> {
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        let Some(request) = read_request(&mut stream, &mut buffer).await? else {
            return Ok(());
        };
        requests.lock().unwrap_or_else(|e| e.into_inner()).push(request.clone());
        let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        max_in_flight.fetch_max(now, Ordering::SeqCst);
        let response = handler(&request);
        if !response.delay.is_zero() {
            tokio::time::sleep(response.delay).await;
        }
        in_flight.fetch_sub(1, Ordering::SeqCst);

        let mut head = format!("HTTP/1.1 {} {}\r\n", response.status, reason(response.status));
        let mut has_type = false;
        for (name, value) in &response.headers {
            has_type |= name.eq_ignore_ascii_case("content-type");
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        if !has_type {
            head.push_str("content-type: application/json\r\n");
        }
        head.push_str(&format!(
            "content-length: {}\r\nconnection: keep-alive\r\n\r\n",
            response.body.len()
        ));
        stream.write_all(head.as_bytes()).await?;
        stream.write_all(response.body.as_bytes()).await?;
        stream.flush().await?;
    }
}

/// Read one request (headers and body) from `stream`, keeping surplus bytes in `buffer` for the
/// next request of a keep-alive connection. `Ok(None)` means the peer closed cleanly.
async fn read_request(
    stream: &mut TcpStream,
    buffer: &mut Vec<u8>,
) -> std::io::Result<Option<Request>> {
    let head_end = loop {
        if let Some(position) = find(buffer, b"\r\n\r\n") {
            break position;
        }
        let mut chunk = [0u8; 8192];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 1 << 20 {
            return Err(std::io::Error::other("request head too large"));
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let start = lines.next().unwrap_or_default();
    let mut parts = start.split(' ');
    let method = parts.next().unwrap_or_default().to_owned();
    let target = parts.next().unwrap_or_default().to_owned();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    buffer.drain(..head_end + 4);

    let lookup = |name: &str| headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
    let body = if lookup("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
        read_chunked(stream, buffer).await?
    } else {
        let length: usize = lookup("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        while buffer.len() < length {
            let mut chunk = [0u8; 8192];
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
        let take = length.min(buffer.len());
        buffer.drain(..take).collect()
    };
    Ok(Some(Request { method, target, headers, body }))
}

async fn read_chunked(stream: &mut TcpStream, buffer: &mut Vec<u8>) -> std::io::Result<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let line_end = loop {
            if let Some(position) = find(buffer, b"\r\n") {
                break position;
            }
            let mut chunk = [0u8; 8192];
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Ok(body);
            }
            buffer.extend_from_slice(&chunk[..read]);
        };
        let size_text = String::from_utf8_lossy(&buffer[..line_end]).into_owned();
        buffer.drain(..line_end + 2);
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("0").trim(), 16)
            .unwrap_or(0);
        while buffer.len() < size + 2 {
            let mut chunk = [0u8; 8192];
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Ok(body);
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
        if size == 0 {
            buffer.drain(..2.min(buffer.len()));
            return Ok(body);
        }
        body.extend_from_slice(&buffer[..size]);
        buffer.drain(..size + 2);
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding_handles_plus_hex_and_garbage() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("%7B%22k%22%3A1%7D"), r#"{"k":1}"#);
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[tokio::test]
    async fn serves_json_records_requests_and_counts_concurrency() {
        let server = MockServer::start(|request| {
            Response::ok(serde_json::json!({ "echo": request.last_segment() }))
                .after(Duration::from_millis(80))
        })
        .await;
        let client = reqwest::Client::new();
        let url = format!("{}/i/api/graphql/q/Op?variables=%7B%7D", server.base_url());
        let started = std::time::Instant::now();
        let (a, b) = tokio::join!(client.get(&url).send(), client.get(&url).send());
        assert!(started.elapsed() < Duration::from_millis(160), "the two requests overlapped");
        let body: Value = a.unwrap().json().await.unwrap();
        assert_eq!(body["echo"], "Op");
        assert_eq!(b.unwrap().status(), 200);
        assert_eq!(server.count(), 2);
        assert_eq!(server.max_in_flight(), 2);
        assert_eq!(server.requests()[0].query("variables").as_deref(), Some("{}"));
    }

    #[tokio::test]
    async fn decodes_form_json_and_custom_headers() {
        let server = MockServer::start(|_| {
            Response::x_error(429, 88, "Rate limit exceeded").with_rate_limit(15, 0, 99)
        })
        .await;
        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/i/api/1.1/friendships/create.json", server.base_url()))
            .header("x-csrf-token", "token")
            .form(&[("user_id", "42")])
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 429);
        assert_eq!(response.headers()["x-rate-limit-remaining"], "0");
        let seen = &server.requests()[0];
        assert_eq!(seen.form(), vec![("user_id".to_owned(), "42".to_owned())]);
        assert_eq!(seen.header("X-CSRF-Token"), Some("token"));
        assert_eq!(seen.last_segment(), "create.json");

        let json = client
            .post(format!("{}/x", server.base_url()))
            .json(&serde_json::json!({ "a": 1 }))
            .send()
            .await
            .unwrap();
        assert_eq!(json.status(), 429);
        assert_eq!(server.requests()[1].json()["a"], 1);
    }
}
