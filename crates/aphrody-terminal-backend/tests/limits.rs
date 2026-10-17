// SPDX-License-Identifier: Apache-2.0
//! Serverless hardening: auth, origin, session quota, input cap, output cap and idle TTL
//! against a live [`aphrody_terminal_backend::serve`] on a loopback port.
#![cfg(unix)]

use std::{net::SocketAddr, time::Duration};

use aphrody_terminal_backend::{PtyConfig, serve};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WsError, Message, client::IntoClientRequest, http::HeaderValue},
};

const TOKEN: &str = "t0ken-for-limits-tests";
const WAIT: Duration = Duration::from_secs(20);

async fn start(cfg: PtyConfig) -> SocketAddr {
    let probe = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = probe.local_addr().expect("addr");
    drop(probe);
    let cfg = PtyConfig {
        shell: Some("/bin/cat".to_owned()),
        auth_token: Some(TOKEN.to_owned()),
        ..cfg
    };
    tokio::spawn(async move {
        let _ = serve(addr, cfg).await;
    });
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            return addr;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("server did not start");
}

fn request(
    addr: SocketAddr,
    token: Option<&str>,
    origin: Option<&str>,
) -> tokio_tungstenite::tungstenite::handshake::client::Request {
    let mut req = format!("ws://{addr}/")
        .into_client_request()
        .expect("request");
    if let Some(t) = token {
        req.headers_mut().insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {t}")).unwrap(),
        );
    }
    if let Some(o) = origin {
        req.headers_mut()
            .insert("origin", HeaderValue::from_str(o).unwrap());
    }
    req
}

fn status_of(err: &WsError) -> Option<u16> {
    match err {
        WsError::Http(resp) => Some(resp.status().as_u16()),
        _ => None,
    }
}

/// Reads binary output until `pred` holds on the accumulated text, or the stream ends.
async fn read_until(
    ws: &mut (impl StreamExt<Item = Result<Message, WsError>> + Unpin),
    pred: impl Fn(&str) -> bool,
) -> (String, bool) {
    let mut acc = String::new();
    let res = tokio::time::timeout(WAIT, async {
        while let Some(m) = ws.next().await {
            match m {
                Ok(Message::Binary(b)) => {
                    acc.push_str(&String::from_utf8_lossy(&b));
                    if pred(&acc) {
                        return true;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => return false,
                Ok(_) => {}
            }
        }
        false
    })
    .await;
    (acc, res.expect("timed out waiting for session"))
}

#[tokio::test]
async fn unauthenticated_is_rejected_and_bearer_accepted() {
    let addr = start(PtyConfig::default()).await;
    let err = connect_async(request(addr, None, None))
        .await
        .expect_err("no token");
    assert_eq!(status_of(&err), Some(401));
    let err = connect_async(request(addr, Some("wrong"), None))
        .await
        .expect_err("bad token");
    assert_eq!(status_of(&err), Some(401));
    connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect("good token");
}

#[tokio::test]
async fn foreign_origin_is_rejected() {
    let addr = start(PtyConfig::default()).await;
    let err = connect_async(request(addr, Some(TOKEN), Some("https://evil.example")))
        .await
        .expect_err("origin");
    assert_eq!(status_of(&err), Some(403));
}

#[tokio::test]
async fn session_quota_rejects_then_frees_slot() {
    let addr = start(PtyConfig {
        max_sessions: Some(1),
        ..PtyConfig::default()
    })
    .await;
    let (mut first, _) = connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect("first");
    let err = connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect_err("second");
    assert_eq!(status_of(&err), Some(503));
    let _ = first.close(None).await;
    drop(first);
    let mut ok = false;
    for _ in 0..100 {
        if connect_async(request(addr, Some(TOKEN), None))
            .await
            .is_ok()
        {
            ok = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(ok, "slot was not released after the first session closed");
}

#[tokio::test]
async fn named_session_reconnect_reuses_its_quota_slot() {
    let addr = start(PtyConfig {
        max_sessions: Some(1),
        ..PtyConfig::default()
    })
    .await;
    let named = format!("ws://{addr}/?session=resume-one&token={TOKEN}");
    let (mut first, _) = connect_async(&named).await.expect("first named connection");
    first
        .send(Message::Binary(b"before\n".to_vec().into()))
        .await
        .unwrap();
    assert!(
        read_until(&mut first, |text| text.contains("before"))
            .await
            .1
    );
    first.close(None).await.unwrap();
    drop(first);
    let (mut resumed, _) = connect_async(&named)
        .await
        .expect("reattach named connection");
    resumed
        .send(Message::Binary(b"after\n".to_vec().into()))
        .await
        .unwrap();
    assert!(
        read_until(&mut resumed, |text| text.contains("after"))
            .await
            .1
    );
    let other = format!("ws://{addr}/?session=other&token={TOKEN}");
    let err = connect_async(other)
        .await
        .expect_err("different named session exceeds quota");
    assert_eq!(status_of(&err), Some(503));
    resumed.close(None).await.unwrap();
}

#[tokio::test]
async fn oversize_frame_is_dropped_session_survives() {
    let addr = start(PtyConfig {
        max_input_frame_bytes: Some(64),
        ..PtyConfig::default()
    })
    .await;
    let (mut ws, _) = connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect("connect");
    let big = format!("{}\n", "X".repeat(512));
    ws.send(Message::Binary(big.into_bytes().into()))
        .await
        .expect("send big");
    ws.send(Message::Binary(b"small-ok\n".to_vec().into()))
        .await
        .expect("send small");
    let (seen, found) = read_until(&mut ws, |s| s.contains("small-ok")).await;
    assert!(found, "session died after oversize frame: {seen:?}");
    assert!(
        !seen.contains("XXXX"),
        "oversize frame reached the pty: {seen:?}"
    );
}

#[tokio::test]
async fn output_cap_closes_session() {
    let addr = start(PtyConfig {
        max_output_bytes: Some(32),
        ..PtyConfig::default()
    })
    .await;
    let (mut ws, _) = connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect("connect");
    for _ in 0..8 {
        let _ = ws
            .send(Message::Binary(
                format!("{}\n", "Y".repeat(40)).into_bytes().into(),
            ))
            .await;
    }
    let (_, found) = read_until(&mut ws, |_| false).await;
    assert!(!found, "stream must end once the output cap is exceeded");
}

#[tokio::test]
async fn idle_ttl_closes_session() {
    let addr = start(PtyConfig {
        idle_ttl: Some(Duration::from_millis(800)),
        ..PtyConfig::default()
    })
    .await;
    let (mut ws, _) = connect_async(request(addr, Some(TOKEN), None))
        .await
        .expect("connect");
    let began = std::time::Instant::now();
    let (_, found) = read_until(&mut ws, |_| false).await;
    assert!(!found);
    assert!(
        began.elapsed() < Duration::from_secs(15),
        "TTL did not close the idle session"
    );
}

#[test]
fn defaults_do_not_limit_and_exposed_defaults_fill() {
    let d = PtyConfig::default();
    assert!(d.max_sessions.is_none() && d.idle_ttl.is_none());
    assert!(d.max_input_frame_bytes.is_none() && d.max_output_bytes.is_none());
    let e = d.with_exposed_defaults();
    assert_eq!(
        e.max_sessions,
        Some(aphrody_terminal_backend::EXPOSED_MAX_SESSIONS)
    );
    assert_eq!(e.idle_ttl, Some(aphrody_terminal_backend::EXPOSED_IDLE_TTL));
    assert_eq!(e.max_input_frame_bytes, Some(1024 * 1024));
    assert_eq!(e.max_output_bytes, Some(8 * 1024 * 1024));
}
