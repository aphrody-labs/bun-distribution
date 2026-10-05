// SPDX-License-Identifier: Apache-2.0
//! The OpenAI-compatible chat-completions client shared by every gateway adapter that speaks that
//! wire format (BYOK proxy, Vercel AI Gateway, Cloudflare AI Gateway, Google Antigravity).
//!
//! An adapter owns its configuration (key, base URL, endpoint path, model normalisation) and hands
//! the resolved endpoint and bearer token to [`chat`] / [`chat_stream`]; the request body, the
//! status handling and the SSE framing live here once.

use bytes::Bytes;
use futures::{Stream, StreamExt};
use reqwest::Client;
use url::Url;

use crate::{
    ChatChunk, ChatRequest, ChatResponse, ChunkStream, GatewayError, build_openai_body,
    extract_content, extract_model, extract_total_tokens, parse_sse_line,
};

/// POSTs a non-streaming chat completion and returns the parsed reply.
pub(crate) async fn chat(
    client: &Client,
    url: Url,
    bearer: &str,
    mut req: ChatRequest,
) -> Result<ChatResponse, GatewayError> {
    req.stream = false;
    let resp = post(client, url, bearer, &req).await?;
    let v: serde_json::Value = resp.json().await?;
    Ok(ChatResponse {
        content: extract_content(&v).unwrap_or_default(),
        model: extract_model(&v),
        total_tokens: extract_total_tokens(&v),
    })
}

/// POSTs a streaming chat completion and returns the SSE chunks as a stream.
pub(crate) async fn chat_stream(
    client: &Client,
    url: Url,
    bearer: &str,
    mut req: ChatRequest,
) -> Result<ChunkStream, GatewayError> {
    req.stream = true;
    let resp = post(client, url, bearer, &req).await?;
    Ok(Box::pin(sse_bytes_to_chunks(resp.bytes_stream())))
}

/// Sends the request and maps a non-success status to [`GatewayError::UpstreamStatus`].
async fn post(
    client: &Client,
    url: Url,
    bearer: &str,
    req: &ChatRequest,
) -> Result<reqwest::Response, GatewayError> {
    let resp = client.post(url).bearer_auth(bearer).json(&build_openai_body(req)).send().await?;
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Err(GatewayError::UpstreamStatus { status, body })
}

/// Converts a raw byte stream from an SSE response into parsed [`ChatChunk`]s.
///
/// Handles partial line buffering across `Bytes` frames, which is the normal case for streaming
/// HTTP/2 responses.
fn sse_bytes_to_chunks(
    stream: impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
) -> impl Stream<Item = Result<ChatChunk, GatewayError>> + Send {
    let mut buf = String::new();
    stream.flat_map(move |result| {
        let items: Vec<Result<ChatChunk, GatewayError>> = match result {
            Err(e) => vec![Err(GatewayError::Transport(e))],
            Ok(bytes) => {
                buf.push_str(&String::from_utf8_lossy(&bytes));
                let mut chunks = Vec::new();
                while let Some(nl) = buf.find('\n') {
                    let line = buf[..nl].trim_end_matches('\r').to_owned();
                    buf.drain(..=nl);
                    match parse_sse_line(&line) {
                        Ok(Some(c)) => {
                            let done = c.finish;
                            chunks.push(Ok(c));
                            if done {
                                break;
                            }
                        },
                        Ok(None) => {},
                        Err(e) => {
                            chunks.push(Err(e));
                            break;
                        },
                    }
                }
                chunks
            },
        };
        futures::stream::iter(items)
    })
}

#[cfg(test)]
mod tests {
    use futures::TryStreamExt;

    use super::*;

    fn frames(
        parts: &[&str],
    ) -> impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static {
        let owned: Vec<Result<Bytes, reqwest::Error>> =
            parts.iter().map(|p| Ok(Bytes::from((*p).to_owned()))).collect();
        futures::stream::iter(owned)
    }

    #[tokio::test]
    async fn sse_lines_split_across_frames_are_reassembled() {
        let stream = sse_bytes_to_chunks(frames(&[
            "data: {\"choices\":[{\"delta\":{\"content\":\"hel",
            "lo\"}}]}\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"},\"finish_reason\":\"stop\"}]}\n",
        ]));
        let chunks: Vec<ChatChunk> = stream.try_collect().await.expect("clean stream");
        let text: String = chunks.iter().map(|c| c.delta.as_str()).collect();
        assert_eq!(text, "hello world");
        assert!(chunks.last().is_some_and(|c| c.finish));
    }

    #[tokio::test]
    async fn done_marker_ends_the_frame_and_keepalives_are_skipped() {
        let stream = sse_bytes_to_chunks(frames(&[": keepalive\ndata: [DONE]\ndata: ignored\n"]));
        let chunks: Vec<ChatChunk> = stream.try_collect().await.expect("clean stream");
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].finish);
    }
}
