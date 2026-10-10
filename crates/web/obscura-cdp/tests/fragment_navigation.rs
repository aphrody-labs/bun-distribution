// SPDX-License-Identifier: Apache-2.0
#![cfg(feature = "render")]

use obscura_cdp::{
    dispatch::{CdpContext, dispatch},
    types::CdpRequest,
};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

async fn call(ctx: &mut CdpContext, method: &str, params: Value) -> Value {
    let response = dispatch(
        &CdpRequest {
            id: 1,
            method: method.into(),
            params,
            session_id: Some("fragment-session".into()),
        },
        ctx,
    )
    .await;
    assert!(response.error.is_none(), "{method}: {:?}", response.error);
    response.result.unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn fragment_navigation_scrolls_and_respects_cancelled_clicks() {
    std::env::set_var("OBSCURA_ALLOW_PRIVATE_NETWORK", "1");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 2048];
        socket.read(&mut request).await.unwrap();
        let body = r##"<!doctype html><style>body{margin:0}section{height:1500px}</style>
<a id="link" href="#game%20section">Games</a><a id="cancel" href="#missing">Cancel</a>
<section>Hero</section><section id="game section">Games</section>
<script>document.getElementById('cancel').onclick=e=>e.preventDefault()</script>"##;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    let mut ctx = CdpContext::new();
    let page = ctx.create_page();
    ctx.sessions.insert("fragment-session".into(), page);
    call(&mut ctx, "Page.navigate", json!({"url":format!("http://{address}/"),"waitUntil":"load"}))
        .await;
    for expression in [
        "document.getElementById('link').click()",
        "document.getElementById('link').setAttribute('href',location.origin+location.pathname+'#game%20section');document.getElementById('link').click()",
    ] {
        call(&mut ctx, "Runtime.evaluate", json!({"expression":"scrollTo(0,0)"})).await;
        call(&mut ctx, "Runtime.evaluate", json!({"expression":expression})).await;
        let state = call(&mut ctx, "Runtime.evaluate", json!({"expression":"({hash:location.hash,y:scrollY,top:document.getElementById('game section').getBoundingClientRect().top})","returnByValue":true})).await;
        assert_eq!(state["result"]["value"]["hash"], "#game%20section");
        assert!(state["result"]["value"]["y"].as_f64().unwrap() > 1000.0);
        assert!(state["result"]["value"]["top"].as_f64().unwrap().abs() < 1.0);
    }
    call(&mut ctx, "Runtime.evaluate", json!({"expression":"scrollTo(0,0)"})).await;
    let coordinates = call(&mut ctx,"Runtime.evaluate",json!({"expression":"(()=>{const r=document.getElementById('link').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()","returnByValue":true})).await;
    for kind in ["mousePressed", "mouseReleased"] {
        call(&mut ctx,"Input.dispatchMouseEvent",json!({"type":kind,"x":coordinates["result"]["value"]["x"],"y":coordinates["result"]["value"]["y"],"button":"left","clickCount":1})).await;
    }
    let scroll =
        call(&mut ctx, "Runtime.evaluate", json!({"expression":"scrollY","returnByValue":true}))
            .await;
    assert!(scroll["result"]["value"].as_f64().unwrap() > 1000.0);
    call(
        &mut ctx,
        "Runtime.evaluate",
        json!({"expression":"document.getElementById('cancel').click()"}),
    )
    .await;
    let hash = call(
        &mut ctx,
        "Runtime.evaluate",
        json!({"expression":"location.hash","returnByValue":true}),
    )
    .await;
    assert_eq!(hash["result"]["value"], "#game%20section");
    server.await.unwrap();
}
