// SPDX-License-Identifier: Apache-2.0
//! WebSocket transport owned by the page's resource table and HTTP policy.
use std::{borrow::Cow, cell::RefCell, collections::HashMap, rc::Rc};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use deno_core::{CancelFuture, CancelHandle, JsBuffer, OpState, Resource, op2, v8};
use deno_error::JsErrorBox;
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use obscura_net::{SameSiteContext, same_site};
use tokio::sync::Mutex;
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{
        Message,
        handshake::{client::generate_key, derive_accept_key},
        protocol::{CloseFrame, Role, WebSocketConfig},
    },
};

use crate::ops::{
    SharedState, cached_request_client, enforce_context_request_policy, realm_state,
    validate_fetch_url,
};

const MAX_SOCKETS: usize = 32;
const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
type Socket = WebSocketStream<reqwest::Upgraded>;

struct SocketResource {
    context: SharedState,
    cancel: Rc<CancelHandle>,
    reader: Mutex<Option<SplitStream<Socket>>>,
    writer: Mutex<Option<SplitSink<Socket, Message>>>,
}

impl Resource for SocketResource {
    fn name(&self) -> Cow<'_, str> {
        Cow::Borrowed("webSocket")
    }
    fn close(self: Rc<Self>) {
        self.cancel.cancel();
    }
}

fn error(message: impl ToString) -> JsErrorBox {
    JsErrorBox::generic(message.to_string())
}
fn resource(state: &Rc<RefCell<OpState>>, rid: u32) -> Result<Rc<SocketResource>, JsErrorBox> {
    state.borrow().resource_table.get(rid).map_err(error)
}

#[op2(nofast)]
pub(crate) fn op_websocket_create(
    scope: &mut v8::PinScope,
    state: &mut OpState,
) -> Result<u32, JsErrorBox> {
    if state.resource_table.names().filter(|(_, name)| name == "webSocket").count() >= MAX_SOCKETS {
        return Err(error("WebSocket connection limit exceeded"));
    }
    let context = realm_state(scope, state);
    Ok(state.resource_table.add(SocketResource {
        context,
        cancel: CancelHandle::new_rc(),
        reader: Mutex::new(None),
        writer: Mutex::new(None),
    }))
}

#[op2]
#[string]
pub(crate) async fn op_websocket_connect(
    state: Rc<RefCell<OpState>>,
    rid: u32,
    #[string] raw_url: String,
    #[serde] protocols: Vec<String>,
) -> Result<String, JsErrorBox> {
    let socket = resource(&state, rid)?;
    let (client, jar, document_url, inherited_origin) = {
        let shared = socket.context.borrow();
        let document_url = if shared.url.starts_with("about:") {
            shared.about_base_url.clone().unwrap_or_else(|| shared.url.clone())
        } else {
            shared.url.clone()
        };
        (
            shared.http_client.clone(),
            shared.cookie_jar.clone(),
            document_url,
            shared.inherited_origin.clone(),
        )
    };
    let mut url = url::Url::parse(&raw_url).map_err(error)?;
    if raw_url.len() > 16_384
        || !matches!(url.scheme(), "ws" | "wss")
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("Invalid WebSocket URL"));
    }
    let secure = url.scheme() == "wss";
    let initiator = url::Url::parse(&document_url).ok();
    if !secure && initiator.as_ref().is_some_and(|url| url.scheme() == "https") {
        return Err(error("Mixed-content WebSocket blocked"));
    }
    url.set_scheme(if secure { "https" } else { "http" })
        .map_err(|_| error("Invalid WebSocket scheme"))?;
    validate_fetch_url(&url, client.as_ref().is_some_and(|client| client.allow_private_network))
        .map_err(error)?;
    if protocols.len() > 16
        || protocols.iter().any(|p| {
            p.is_empty()
                || p.len() > 256
                || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
        })
        || protocols.iter().enumerate().any(|(i, p)| protocols[..i].contains(p))
    {
        return Err(error("Invalid WebSocket protocols"));
    }
    let origin = inherited_origin.unwrap_or_else(|| {
        initiator
            .as_ref()
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_else(|| "null".into())
    });
    let key = generate_key();
    let mut headers = HashMap::from([
        ("Connection".into(), "Upgrade".into()),
        ("Upgrade".into(), "websocket".into()),
        ("Sec-WebSocket-Version".into(), "13".into()),
        ("Sec-WebSocket-Key".into(), key.clone()),
        ("Origin".into(), origin),
    ]);
    if !protocols.is_empty() {
        headers.insert("Sec-WebSocket-Protocol".into(), protocols.join(", "));
    }
    if let Some(jar) = &jar {
        let context = if initiator.as_ref().is_some_and(|source| same_site(source, &url)) {
            SameSiteContext::SameSite
        } else {
            SameSiteContext::CrossSite
        };
        let cookies = jar.get_cookie_header_in_context(&url, context);
        if !cookies.is_empty() {
            headers.insert("Cookie".into(), cookies);
        }
    }
    if let Some(client) = &client {
        headers.insert("User-Agent".into(), client.user_agent.read().await.clone());
    }
    enforce_context_request_policy(&client, url.as_str(), "GET", &headers).await?;
    let http = if let Some(client) = client {
        client.request_client().await
    } else {
        cached_request_client(None).map_err(error)?
    };
    let mut request = http.get(url.clone()).version(reqwest::Version::HTTP_11);
    for (name, value) in &headers {
        request = request.header(name, value);
    }
    let connect = async {
        let response = request.send().await.map_err(error)?;
        let h = response.headers();
        let header = |name| h.get(name).and_then(|value| value.to_str().ok()).unwrap_or("");
        if response.status() != reqwest::StatusCode::SWITCHING_PROTOCOLS
            || !header("upgrade").eq_ignore_ascii_case("websocket")
            || !header("connection").split(',').any(|v| v.trim().eq_ignore_ascii_case("upgrade"))
            || header("sec-websocket-accept") != derive_accept_key(key.as_bytes())
            || h.contains_key("sec-websocket-extensions")
        {
            return Err(error("Invalid WebSocket upgrade response"));
        }
        let protocol = header("sec-websocket-protocol").to_string();
        if (!protocols.is_empty() && protocol.is_empty())
            || (!protocol.is_empty() && !protocols.contains(&protocol))
        {
            return Err(error("Invalid WebSocket protocol selection"));
        }
        if let Some(jar) = &jar {
            for cookie in h.get_all("set-cookie") {
                if let Ok(cookie) = cookie.to_str() {
                    jar.set_cookie(cookie, &url);
                }
            }
        }
        let upgraded = response.upgrade().await.map_err(error)?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let (writer, reader) =
            WebSocketStream::from_raw_socket(upgraded, Role::Client, Some(config)).await.split();
        *socket.reader.lock().await = Some(reader);
        *socket.writer.lock().await = Some(writer);
        Ok(protocol)
    };
    connect
        .or_cancel(socket.cancel.clone())
        .await
        .map_err(|_| error("WebSocket connection cancelled"))?
}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum SocketEvent {
    Text { text: String },
    Binary { data: String },
    Close { code: u16, reason: String, clean: bool },
}

#[op2]
#[serde]
pub(crate) async fn op_websocket_read(
    state: Rc<RefCell<OpState>>,
    rid: u32,
) -> Result<SocketEvent, JsErrorBox> {
    let socket = resource(&state, rid)?;
    let read = async {
        let mut guard = socket.reader.lock().await;
        let reader = guard.as_mut().ok_or_else(|| error("WebSocket is not connected"))?;
        loop {
            match reader.next().await.transpose().map_err(error)? {
                Some(Message::Text(text)) => {
                    return Ok(SocketEvent::Text { text: text.to_string() });
                },
                Some(Message::Binary(data)) => {
                    return Ok(SocketEvent::Binary { data: BASE64.encode(data) });
                },
                Some(Message::Close(frame)) => {
                    if let Some(writer) = socket.writer.lock().await.as_mut() {
                        let _ = writer.flush().await;
                    }
                    return Ok(SocketEvent::Close {
                        code: frame.as_ref().map_or(1005, |f| f.code.into()),
                        reason: frame.map_or_else(String::new, |f| f.reason.to_string()),
                        clean: true,
                    });
                },
                Some(Message::Ping(_)) => {
                    if let Some(writer) = socket.writer.lock().await.as_mut() {
                        writer.flush().await.map_err(error)?;
                    }
                },
                Some(_) => {},
                None => {
                    return Ok(SocketEvent::Close {
                        code: 1006,
                        reason: String::new(),
                        clean: false,
                    });
                },
            }
        }
    };
    read.or_cancel(socket.cancel.clone()).await.map_err(|_| error("WebSocket read cancelled"))?
}

#[op2]
pub(crate) async fn op_websocket_send(
    state: Rc<RefCell<OpState>>,
    rid: u32,
    #[buffer] bytes: JsBuffer,
    text: bool,
) -> Result<(), JsErrorBox> {
    let socket = resource(&state, rid)?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(error("WebSocket message limit exceeded"));
    }
    let message = if text {
        Message::Text(String::from_utf8(bytes.to_vec()).map_err(error)?.into())
    } else {
        Message::Binary(bytes.to_vec().into())
    };
    let send = async {
        socket
            .writer
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| error("WebSocket is not connected"))?
            .send(message)
            .await
            .map_err(error)
    };
    send.or_cancel(socket.cancel.clone()).await.map_err(|_| error("WebSocket send cancelled"))?
}

#[op2]
pub(crate) async fn op_websocket_close(
    state: Rc<RefCell<OpState>>,
    rid: u32,
    code: u16,
    #[string] reason: String,
) -> Result<(), JsErrorBox> {
    let socket = resource(&state, rid)?;
    if !(code == 1000 || (3000..=4999).contains(&code)) || reason.len() > 123 {
        return Err(error("Invalid WebSocket close frame"));
    }
    let close = async {
        socket
            .writer
            .lock()
            .await
            .as_mut()
            .ok_or_else(|| error("WebSocket is not connected"))?
            .send(Message::Close(Some(CloseFrame { code: code.into(), reason: reason.into() })))
            .await
            .map_err(error)
    };
    close.or_cancel(socket.cancel.clone()).await.map_err(|_| error("WebSocket close cancelled"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::ObscuraJsRuntime;
    use obscura_net::{CookieJar, ObscuraHttpClient};
    use std::{sync::Arc, time::Duration};
    use tokio::{net::TcpListener, time::timeout};

    fn runtime(url: &str, allow_private: bool) -> ObscuraJsRuntime {
        let jar = Arc::new(CookieJar::new());
        jar.set_cookie("ws_fixture=synthetic; Path=/; HttpOnly", &url::Url::parse(url).unwrap());
        let client =
            Arc::new(ObscuraHttpClient::with_full_options(jar.clone(), None, allow_private));
        let mut runtime = ObscuraJsRuntime::new();
        runtime.set_dom(obscura_dom::parse_html("<html><body></body></html>"));
        runtime.set_url(url);
        runtime.set_cookie_jar(jar);
        runtime.set_http_client(client);
        runtime.run_page_init();
        runtime
    }

    #[tokio::test(flavor = "current_thread")]
    async fn websocket_transports_text_binary_cookies_and_clean_close() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let origin = format!("http://{address}");
        let expected_origin = origin.clone();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      response| {
                    assert_eq!(request.headers()["origin"], expected_origin);
                    assert!(
                        request.headers()["cookie"]
                            .to_str()
                            .unwrap()
                            .contains("ws_fixture=synthetic")
                    );
                    Ok(response)
                },
            )
            .await
            .unwrap();
            let text = socket.next().await.unwrap().unwrap();
            assert_eq!(text, Message::Text("echo-日本語".into()));
            socket.send(text).await.unwrap();
            let binary = socket.next().await.unwrap().unwrap();
            assert_eq!(binary, Message::Binary(vec![1, 2, 3].into()));
            socket.send(binary).await.unwrap();
            socket
                .close(Some(CloseFrame { code: 3001.into(), reason: "done".into() }))
                .await
                .unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Close(_)))));
        });
        let mut runtime = runtime(&origin, true);
        runtime.evaluate(&format!(r#"(()=>{{
            globalThis.result={{messages:[],close:null,error:false}};
            const keepAlive=setInterval(()=>{{}},10);
            const ws=new WebSocket('ws://{address}/echo');ws.binaryType='arraybuffer';
            ws.onopen=()=>ws.send('echo-日本語');
            ws.onerror=()=>result.error=true;
            ws.onmessage=e=>{{
                if(!(e instanceof MessageEvent))result.error=true;
                if(typeof e.data==='string'){{result.messages.push(e.data);const bytes=new Uint8Array([9,1,2,3,9]);ws.send(bytes.subarray(1,4));bytes.fill(8)}}
                else result.messages.push([...new Uint8Array(e.data)]);
            }};
            ws.onclose=e=>{{if(!(e instanceof CloseEvent))result.error=true;result.close={{code:e.code,reason:e.reason,clean:e.wasClean}};clearInterval(keepAlive)}};
        }})()"#)).unwrap();
        runtime.run_event_loop_bounded(2_000).await.unwrap();
        assert_eq!(
            runtime.evaluate("result").unwrap(),
            serde_json::json!({
                "messages": ["echo-日本語", [1,2,3]], "error":false,
                "close":{"code":3001,"reason":"done","clean":true}
            })
        );
        timeout(Duration::from_secs(2), server).await.unwrap().unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn websocket_never_reports_open_for_a_rejected_handshake() {
        use tokio::io::AsyncWriteExt;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let mut runtime = runtime(&format!("http://{address}"), true);
        runtime
            .evaluate(&format!(
                r#"(()=>{{
            globalThis.result=[];const keepAlive=setInterval(()=>{{}},10);
            const ws=new WebSocket('ws://{address}/denied');
            ws.onopen=()=>result.push('open');ws.onerror=()=>result.push('error');
            ws.onclose=e=>{{result.push(e.code);clearInterval(keepAlive)}};
        }})()"#
            ))
            .unwrap();
        runtime.run_event_loop_bounded(2_000).await.unwrap();
        assert_eq!(runtime.evaluate("result").unwrap(), serde_json::json!(["error", 1006]));
        timeout(Duration::from_secs(2), server).await.unwrap().unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn websocket_connecting_close_cancels_and_validates_arguments() {
        let mut runtime = runtime("http://example.com/", false);
        runtime.evaluate(r#"(()=>{
            globalThis.result=[];
            for(const args of [[],['ws://'],['ftp://example.com'],['ws://example.com/#'],['ws://example.com/#fragment'],['ws://example.com',['duplicate','duplicate']]]) {
                try {new WebSocket(...args);result.push('accepted')}catch(e){result.push(e.name)}
            }
            const ws=new WebSocket('ws://127.0.0.1:9/');
            ws.onopen=()=>result.push('open');ws.onclose=e=>result.push(e.code);
            try{ws.send('early')}catch(e){result.push(e.name)}
            ws.close();result.push(ws.readyState);
        })()"#).unwrap();
        runtime.run_event_loop_bounded(200).await.unwrap();
        assert_eq!(
            runtime.evaluate("result").unwrap(),
            serde_json::json!([
                "TypeError",
                "SyntaxError",
                "SyntaxError",
                "SyntaxError",
                "SyntaxError",
                "SyntaxError",
                "InvalidStateError",
                1006,
                3
            ])
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn websocket_respects_default_private_network_denial() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut runtime = runtime("http://example.com/", false);
        runtime
            .evaluate(&format!(
                r#"(()=>{{
            globalThis.result=[];const keepAlive=setInterval(()=>{{}},10);
            const ws=new WebSocket('ws://{address}/private');
            ws.onopen=()=>result.push('open');ws.onerror=()=>result.push('error');
            ws.onclose=e=>{{result.push(e.code);clearInterval(keepAlive)}};
        }})()"#
            ))
            .unwrap();
        runtime.run_event_loop_bounded(2_000).await.unwrap();
        assert_eq!(runtime.evaluate("result").unwrap(), serde_json::json!(["error", 1006]));
        assert!(timeout(Duration::from_millis(25), listener.accept()).await.is_err());
    }
}
