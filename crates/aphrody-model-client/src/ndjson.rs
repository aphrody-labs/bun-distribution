// SPDX-License-Identifier: Apache-2.0
//! Newline-delimited JSON (`application/x-ndjson`) stream decoding.
//!
//! Ollama streams `/api/chat`, `/api/generate` and `/api/pull` as one JSON
//! object per line (`api/client.go` in the Ollama tree scans the body with a
//! line scanner and decodes each line). This module is that scanner for the
//! crate: it buffers **bytes**, not text, so a multi-byte character split
//! across two network chunks is reassembled before it is decoded (a per-chunk
//! `str::from_utf8` would fail on such a boundary).
//!
//! A line is only decoded once its terminating `\n` has arrived, except for
//! the final line of the stream, which is decoded when the body ends. Blank
//! lines are skipped. A single line larger than [`MAX_LINE_BYTES`] fails the
//! stream instead of growing without bound.

use bytes::Bytes;
use futures::{Stream, StreamExt};
use serde_json::Value;

use crate::ModelError;

/// Largest single NDJSON line accepted (Ollama's own client allows 8 MiB).
pub(crate) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

/// Decode one raw line (terminator included or not) into a JSON value.
///
/// `None` for a blank line, `Some(Err)` for a line that is not JSON.
fn decode_line(line: &[u8]) -> Option<Result<Value, ModelError>> {
    let trimmed = line.trim_ascii();
    if trimmed.is_empty() {
        return None;
    }
    Some(serde_json::from_slice::<Value>(trimmed).map_err(ModelError::Decode))
}

/// Turn a byte stream into a stream of JSON values, one per NDJSON line.
///
/// A transport error from `bytes` is forwarded once and ends the stream; so
/// does an undecodable line (the caller learns of the corruption and the rest
/// of the body is dropped, as a half-parsed stream cannot be trusted).
pub(crate) fn ndjson_values<S>(bytes: S) -> impl Stream<Item = Result<Value, ModelError>> + Send
where
    S: Stream<Item = Result<Bytes, ModelError>> + Send + 'static,
{
    struct State<S> {
        stream: std::pin::Pin<Box<S>>,
        buffer: Vec<u8>,
        /// Bytes of `buffer` already searched for a newline.
        scanned: usize,
        ended: bool,
    }

    let state = State {
        stream: Box::pin(bytes),
        buffer: Vec::new(),
        scanned: 0,
        ended: false,
    };

    futures::stream::unfold(state, |mut state| async move {
        loop {
            // A complete line is waiting in the buffer.
            if let Some(offset) = state.buffer[state.scanned..]
                .iter()
                .position(|b| *b == b'\n')
            {
                let end = state.scanned + offset;
                let line: Vec<u8> = state.buffer.drain(..=end).collect();
                state.scanned = 0;
                match decode_line(&line) {
                    Some(Ok(value)) => return Some((Ok(value), state)),
                    Some(Err(error)) => {
                        // Stop after a corrupt line.
                        state.buffer.clear();
                        state.ended = true;
                        return Some((Err(error), state));
                    }
                    None => continue,
                }
            }
            state.scanned = state.buffer.len();

            if state.ended {
                // The body is over: the unterminated tail is the last line.
                let tail = std::mem::take(&mut state.buffer);
                state.scanned = 0;
                return decode_line(&tail).map(|item| (item, state));
            }

            match state.stream.next().await {
                Some(Ok(chunk)) => {
                    state.buffer.extend_from_slice(&chunk);
                    if state.buffer.len() > MAX_LINE_BYTES
                        && !state.buffer[state.scanned..].contains(&b'\n')
                    {
                        state.buffer.clear();
                        state.scanned = 0;
                        state.ended = true;
                        return Some((
                            Err(ModelError::Stream(format!(
                                "ndjson line longer than {MAX_LINE_BYTES} bytes"
                            ))),
                            state,
                        ));
                    }
                }
                Some(Err(error)) => {
                    state.buffer.clear();
                    state.scanned = 0;
                    state.ended = true;
                    return Some((Err(error), state));
                }
                None => state.ended = true,
            }
        }
    })
}

/// The `error` message of a streamed NDJSON object, when it is an error line.
///
/// Ollama reports a failure that occurs after the response started as a final
/// `{"error": "..."}` line (`docs/api/errors.mdx`: "Errors that occur while
/// streaming"); the HTTP status stays 200, so the line is the only signal.
pub(crate) fn error_line(value: &Value) -> Option<&str> {
    value
        .get("error")
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::*;

    fn chunks(parts: &[&[u8]]) -> impl Stream<Item = Result<Bytes, ModelError>> + Send + 'static {
        let owned: Vec<Result<Bytes, ModelError>> = parts
            .iter()
            .map(|part| Ok(Bytes::copy_from_slice(part)))
            .collect();
        futures::stream::iter(owned)
    }

    async fn collect(
        stream: impl Stream<Item = Result<Value, ModelError>> + Send,
    ) -> Vec<Result<Value, ModelError>> {
        stream.collect().await
    }

    #[tokio::test]
    async fn lines_split_across_chunks_are_reassembled() {
        let values = collect(ndjson_values(chunks(&[
            b"{\"a\":1}\n{\"b\"",
            b":2}\n\n{\"c\":3}",
        ])))
        .await
        .into_iter()
        .map(|item| item.expect("line"))
        .collect::<Vec<_>>();
        // The last line has no terminator and is decoded when the body ends.
        assert_eq!(
            values,
            vec![json!({"a": 1}), json!({"b": 2}), json!({"c": 3})]
        );
    }

    #[tokio::test]
    async fn a_multibyte_character_split_between_chunks_survives() {
        let line = "{\"text\":\"h\u{e9}llo \u{4e16}\"}\n".as_bytes();
        // Cut inside the two-byte "e acute" (U+00E9).
        let cut = line
            .iter()
            .position(|b| *b == 0xC3)
            .expect("multibyte lead byte")
            + 1;
        let (head, tail) = line.split_at(cut);
        let values = collect(ndjson_values(chunks(&[head, tail]))).await;
        assert_eq!(values.len(), 1);
        assert_eq!(
            values[0].as_ref().expect("value")["text"],
            "h\u{e9}llo \u{4e16}"
        );
    }

    #[tokio::test]
    async fn crlf_terminators_and_blank_lines_are_tolerated() {
        let values = collect(ndjson_values(chunks(&[
            b"\r\n{\"a\":1}\r\n  \r\n{\"a\":2}\r\n",
        ])))
        .await;
        assert_eq!(values.len(), 2);
        assert_eq!(values[1].as_ref().expect("value")["a"], 2);
    }

    #[tokio::test]
    async fn a_corrupt_line_is_reported_once_and_ends_the_stream() {
        let values = collect(ndjson_values(chunks(&[
            b"{\"a\":1}\nnot json\n{\"a\":2}\n",
        ])))
        .await;
        assert_eq!(values.len(), 2);
        assert!(values[0].is_ok());
        assert!(matches!(values[1], Err(ModelError::Decode(_))));
    }

    #[tokio::test]
    async fn an_empty_body_yields_nothing() {
        assert!(collect(ndjson_values(chunks(&[]))).await.is_empty());
        assert!(collect(ndjson_values(chunks(&[b"\n\n"]))).await.is_empty());
    }

    #[tokio::test]
    async fn a_transport_error_is_forwarded_and_terminates() {
        let items: Vec<Result<Bytes, ModelError>> = vec![
            Ok(Bytes::from_static(b"{\"a\":1}\n")),
            Err(ModelError::Stream("boom".to_string())),
            Ok(Bytes::from_static(b"{\"a\":2}\n")),
        ];
        let values = collect(ndjson_values(futures::stream::iter(items))).await;
        assert_eq!(values.len(), 2);
        assert!(values[0].is_ok());
        assert!(matches!(values[1], Err(ModelError::Stream(_))));
    }

    #[test]
    fn error_lines_are_recognised() {
        assert_eq!(
            error_line(&json!({"error": "model not found"})),
            Some("model not found")
        );
        assert_eq!(error_line(&json!({"error": ""})), None);
        assert_eq!(error_line(&json!({"status": "success"})), None);
    }
}
