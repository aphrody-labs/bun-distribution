// SPDX-License-Identifier: Apache-2.0
//! Integration tests for [`aphrody_a2a_coord::CoordProxy`], the `.coord`
//! JSONL mailbox proxy behind the listener's `/coord` route.
//!
//! Covers:
//!   1. snapshot mode reads all lines (`coord_proxy_serves_jsonl_snapshot`)
//!   2. missing file → empty body, no error (`coord_proxy_missing_file_returns_empty`)
//!   3. SSE envelope is well-formed (`coord_proxy_sse_format`)
//!   4. `tail -f` emits lines appended after subscription
//!      (`coord_proxy_tail_stream_emits_new_lines`, `..._sse_...`)
//!   5. `tail -f` on a missing file waits for it (`coord_proxy_tail_stream_waits_for_missing_file`)

use std::time::Duration;

use aphrody_a2a_coord::proxy::{
    CoordError, CoordProxy, CoordResponseKind, DEFAULT_TAIL_INTERVAL, NDJSON_CONTENT_TYPE,
    SSE_CONTENT_TYPE,
};
use futures::{Stream, StreamExt};
use tempfile::tempdir;
use tokio::io::AsyncWriteExt;

/// Collect a stream into a `Vec<String>`, panicking on the first error.
async fn collect_ok(
    mut stream: impl Stream<Item = Result<String, CoordError>> + Unpin,
) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(item) = stream.next().await {
        out.push(item.expect("stream item should be Ok"));
    }
    out
}

/// Append `bytes` to `path` and flush.
async fn append(path: &std::path::Path, bytes: &[u8]) {
    let mut f = tokio::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .await
        .expect("open append");
    f.write_all(bytes).await.expect("append");
    f.flush().await.expect("flush");
}

#[test]
fn coord_proxy_defaults() {
    let proxy = CoordProxy::new("inbox-from-aphrody.jsonl".into());
    assert_eq!(
        proxy.jsonl_path(),
        std::path::Path::new("inbox-from-aphrody.jsonl")
    );
    assert_eq!(proxy.tail_interval(), DEFAULT_TAIL_INTERVAL);
    let proxy = proxy.with_tail_interval(Duration::from_millis(5));
    assert_eq!(proxy.tail_interval(), Duration::from_millis(5));
}

#[tokio::test]
async fn coord_proxy_serves_jsonl_snapshot() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("inbox-from-aphrody.jsonl");
    // CRLF and blank lines are normalized away.
    let body = "{\"id\":1}\r\n\n{\"id\":2}\n{\"id\":3}\n";
    tokio::fs::write(&path, body).await.expect("write fixture");

    let proxy = CoordProxy::new(path);

    // handle_get_coord with no Accept header → NDJSON snapshot.
    let resp = proxy
        .handle_get_coord(None)
        .await
        .expect("handle_get_coord");
    assert_eq!(resp.status, 200);
    assert_eq!(resp.content_type, NDJSON_CONTENT_TYPE);

    let chunks = collect_ok(resp.body).await;
    assert_eq!(chunks, ["{\"id\":1}\n", "{\"id\":2}\n", "{\"id\":3}\n"]);
}

#[tokio::test]
async fn coord_proxy_missing_file_returns_empty() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("does-not-exist.jsonl");
    assert!(!path.exists(), "fixture must not exist");

    let proxy = CoordProxy::new(path);

    // Snapshot path.
    let resp = proxy
        .handle_get_coord(None)
        .await
        .expect("missing file must NOT error");
    assert_eq!(resp.status, 200);
    let chunks = collect_ok(resp.body).await;
    assert!(chunks.is_empty(), "expected empty body, got {chunks:?}");

    // SSE path.
    let resp = proxy
        .handle_get_coord(Some("text/event-stream"))
        .await
        .expect("missing file (SSE) must NOT error");
    assert_eq!(resp.status, 200);
    assert_eq!(resp.content_type, SSE_CONTENT_TYPE);
    let chunks = collect_ok(resp.body).await;
    assert!(chunks.is_empty(), "expected empty SSE body, got {chunks:?}");
}

#[tokio::test]
async fn coord_proxy_sse_format() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("inbox-from-aphrody.jsonl");
    tokio::fs::write(&path, "{\"a\":1}\n{\"b\":2}\n")
        .await
        .expect("write fixture");

    let proxy = CoordProxy::new(path);
    let resp = proxy
        .handle_get_coord(Some("text/event-stream"))
        .await
        .expect("handle_get_coord SSE");
    assert_eq!(resp.status, 200);
    assert_eq!(resp.content_type, SSE_CONTENT_TYPE);

    let chunks = collect_ok(resp.body).await;
    assert_eq!(chunks, ["data: {\"a\":1}\n\n", "data: {\"b\":2}\n\n"]);

    // Each chunk must be one well-formed SSE event.
    for chunk in &chunks {
        assert!(
            chunk.ends_with("\n\n"),
            "SSE chunk missing terminator: {chunk:?}"
        );
        assert!(
            chunk.starts_with("data: "),
            "SSE chunk missing `data: ` prefix: {chunk:?}"
        );
    }

    // Sanity-check the kind classifier independently.
    assert_eq!(
        CoordResponseKind::from_accept(Some("text/event-stream")),
        CoordResponseKind::Sse
    );
}

#[tokio::test]
async fn coord_proxy_tail_stream_emits_new_lines() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("inbox-from-aphrody.jsonl");

    // Pre-seed the file with one line that must NOT be replayed by tail
    // (tail starts at the current EOF, mirroring `tail -f`).
    tokio::fs::write(&path, "{\"old\":true}\n")
        .await
        .expect("seed file");

    let proxy = CoordProxy::new(path.clone()).with_tail_interval(Duration::from_millis(25));
    let mut tail = proxy.tail_stream().await;

    append(&path, b"{\"new\":1}\n").await;
    let line = tokio::time::timeout(Duration::from_secs(2), tail.next())
        .await
        .expect("tail stream should emit within 2s")
        .expect("tail stream should not end")
        .expect("tail item should be Ok");
    assert_eq!(
        line, "{\"new\":1}\n",
        "tail must emit only the freshly appended line"
    );

    // A line written in two pieces is emitted once, whole.
    append(&path, b"{\"new\":").await;
    tokio::time::sleep(Duration::from_millis(80)).await;
    append(&path, b"2}\n").await;
    let line = tokio::time::timeout(Duration::from_secs(2), tail.next())
        .await
        .expect("tail stream should emit the 2nd line within 2s")
        .expect("tail stream should not end")
        .expect("tail item should be Ok");
    assert_eq!(line, "{\"new\":2}\n");
}

#[tokio::test]
async fn coord_proxy_tail_stream_sse_wraps_lines() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("inbox-from-aphrody.jsonl");
    tokio::fs::write(&path, "").await.expect("create file");

    let proxy = CoordProxy::new(path.clone()).with_tail_interval(Duration::from_millis(25));
    let mut tail = proxy.tail_stream_sse().await;

    append(&path, b"{\"sse\":1}\n{\"sse\":2}\n").await;
    let mut events = Vec::new();
    for _ in 0..2 {
        let event = tokio::time::timeout(Duration::from_secs(2), tail.next())
            .await
            .expect("tail SSE should emit within 2s")
            .expect("tail SSE should not end")
            .expect("tail SSE item should be Ok");
        events.push(event);
    }
    assert_eq!(events, ["data: {\"sse\":1}\n\n", "data: {\"sse\":2}\n\n"]);
}

#[tokio::test]
async fn coord_proxy_tail_stream_waits_for_missing_file() {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("not-yet.jsonl");
    assert!(!path.exists());

    let proxy = CoordProxy::new(path.clone()).with_tail_interval(Duration::from_millis(25));
    let mut tail = proxy.tail_stream().await;

    // Create the file, then append a line after a short delay.
    tokio::time::sleep(Duration::from_millis(50)).await;
    tokio::fs::write(&path, "").await.expect("create empty");
    tokio::time::sleep(Duration::from_millis(80)).await;
    append(&path, b"{\"late\":true}\n").await;

    let item = tokio::time::timeout(Duration::from_secs(2), tail.next())
        .await
        .expect("tail should emit eventually")
        .expect("tail should not end")
        .expect("item should be Ok");
    assert_eq!(item, "{\"late\":true}\n");
}
