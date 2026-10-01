// SPDX-License-Identifier: Apache-2.0
//! Pure mapping of mistral.rs' OpenAI-style streaming chunks onto the neutral
//! [`ModelStreamEvent`]s.
//!
//! The `engine` feature decodes each upstream chunk into a [`RawChunk`], plain
//! data with no mistral.rs type in it, and feeds it to a [`StreamState`]. All the
//! rules, what counts as text, when a tool call is complete, how the turn ends,
//! live here and run in the default build's tests.
//!
//! Wire facts this relies on (mistralrs-core `pipeline/sampling.rs` and
//! `sequence.rs`): a streamed tool call arrives *complete* (id, name and the whole
//! arguments text) in one delta, parsed by the engine; the last chunk carries the
//! finish reason and the token usage; the channel then closes.

use std::sync::atomic::{AtomicU64, Ordering};

use aphrody_model_client::{ModelStreamEvent, TokenUsage};
use serde_json::Value;

/// One streamed chunk, reduced to what the neutral events need.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct RawChunk {
    /// Visible text delta.
    pub content: Option<String>,
    /// Reasoning delta (`reasoning_content`).
    pub reasoning: Option<String>,
    /// Tool calls that completed in this chunk.
    pub tool_calls: Vec<RawToolCall>,
    /// Finish reason, on the last chunk of a choice.
    pub finish_reason: Option<String>,
    /// Token accounting, on the last chunk.
    pub usage: Option<RawUsage>,
}

/// A completed tool call as the engine reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawToolCall {
    pub id: String,
    pub name: String,
    /// The arguments as JSON text.
    pub arguments: String,
}

/// Token accounting as the engine reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct RawUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    /// Prompt tokens served from the prefix cache.
    pub cached_tokens: u64,
}

/// Where a stream is, between chunks.
#[derive(Debug, Default)]
pub(crate) struct StreamState {
    tool_calls: usize,
    finish_reason: Option<String>,
    usage: Option<TokenUsage>,
    completed: bool,
}

impl StreamState {
    /// Events for one chunk. Reasoning comes before text because the model emits
    /// it first.
    pub(crate) fn push(&mut self, chunk: RawChunk) -> Vec<ModelStreamEvent> {
        let mut events = Vec::new();
        if let Some(reasoning) = chunk.reasoning.filter(|text| !text.is_empty()) {
            events.push(ModelStreamEvent::ReasoningDelta(reasoning));
        }
        if let Some(text) = chunk.content.filter(|text| !text.is_empty()) {
            events.push(ModelStreamEvent::TextDelta(text));
        }
        for call in chunk.tool_calls {
            self.tool_calls += 1;
            events.push(tool_call_event(call));
        }
        if let Some(reason) = chunk.finish_reason.filter(|reason| !reason.is_empty()) {
            self.finish_reason = Some(reason);
        }
        if let Some(usage) = chunk.usage {
            self.usage = Some(token_usage(usage));
        }
        events
    }

    /// The closing `Completed` event, emitted exactly once, when the upstream
    /// channel closes. A turn that made tool calls and reported no finish reason
    /// ends with `tool_calls`.
    pub(crate) fn finish(&mut self) -> Vec<ModelStreamEvent> {
        if self.completed {
            return Vec::new();
        }
        self.completed = true;
        let finish_reason = self
            .finish_reason
            .take()
            .or_else(|| (self.tool_calls > 0).then(|| "tool_calls".to_owned()));
        vec![ModelStreamEvent::Completed { usage: self.usage.take(), finish_reason }]
    }
}

fn tool_call_event(call: RawToolCall) -> ModelStreamEvent {
    let id = if call.id.is_empty() { generated_call_id(&call.name) } else { call.id };
    ModelStreamEvent::ToolCall {
        id,
        arguments: parse_arguments(&call.arguments),
        name: call.name,
    }
}

/// An id for an engine that sent none, unique within the process so two calls
/// to the same tool never share one.
fn generated_call_id(name: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ordinal = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("call_{name}_{ordinal}")
}

/// JSON arguments text to a value; text that does not parse is kept as a string
/// (the history replays it as written), empty text is `null`.
fn parse_arguments(raw: &str) -> Value {
    if raw.trim().is_empty() {
        return Value::Null;
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_owned()))
}

fn token_usage(usage: RawUsage) -> TokenUsage {
    TokenUsage {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cached_input_tokens: usage.cached_tokens,
        ..TokenUsage::default()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn text(text: &str) -> RawChunk {
        RawChunk { content: Some(text.to_owned()), ..RawChunk::default() }
    }

    #[test]
    fn text_and_reasoning_deltas_pass_through_in_order() {
        let mut state = StreamState::default();
        let events = state.push(RawChunk {
            reasoning: Some("think".into()),
            content: Some("hi".into()),
            ..RawChunk::default()
        });
        assert_eq!(
            events,
            vec![
                ModelStreamEvent::ReasoningDelta("think".into()),
                ModelStreamEvent::TextDelta("hi".into()),
            ]
        );
    }

    #[test]
    fn empty_deltas_are_dropped() {
        let mut state = StreamState::default();
        assert!(state.push(text("")).is_empty());
        assert!(state.push(RawChunk::default()).is_empty());
    }

    #[test]
    fn the_stream_ends_with_one_completed_carrying_reason_and_usage() {
        let mut state = StreamState::default();
        state.push(text("a"));
        state.push(RawChunk {
            finish_reason: Some("stop".into()),
            usage: Some(RawUsage {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                cached_tokens: 6,
            }),
            ..RawChunk::default()
        });
        let end = state.finish();
        assert_eq!(
            end,
            vec![ModelStreamEvent::Completed {
                usage: Some(TokenUsage {
                    input_tokens: 10,
                    output_tokens: 4,
                    total_tokens: 14,
                    cached_input_tokens: 6,
                    reasoning_output_tokens: 0,
                }),
                finish_reason: Some("stop".into()),
            }]
        );
        assert!(state.finish().is_empty(), "Completed is emitted once");
    }

    #[test]
    fn a_stream_with_no_finish_chunk_still_completes() {
        let mut state = StreamState::default();
        state.push(text("partial"));
        assert_eq!(
            state.finish(),
            vec![ModelStreamEvent::Completed { usage: None, finish_reason: None }]
        );
    }

    #[test]
    fn tool_calls_arrive_whole_and_decide_the_finish_reason() {
        let mut state = StreamState::default();
        let events = state.push(RawChunk {
            tool_calls: vec![RawToolCall {
                id: "call-1".into(),
                name: "get_weather".into(),
                arguments: r#"{"city":"Paris"}"#.into(),
            }],
            ..RawChunk::default()
        });
        assert_eq!(
            events,
            vec![ModelStreamEvent::ToolCall {
                id: "call-1".into(),
                name: "get_weather".into(),
                arguments: json!({ "city": "Paris" }),
            }]
        );
        // The engine reported no finish reason: the tool call decides it.
        assert_eq!(
            state.finish(),
            vec![ModelStreamEvent::Completed {
                usage: None,
                finish_reason: Some("tool_calls".into())
            }]
        );
    }

    #[test]
    fn an_explicit_finish_reason_wins_over_the_tool_call_default() {
        let mut state = StreamState::default();
        state.push(RawChunk {
            tool_calls: vec![RawToolCall { id: "c".into(), name: "f".into(), arguments: "{}".into() }],
            finish_reason: Some("length".into()),
            ..RawChunk::default()
        });
        let end = state.finish();
        assert!(matches!(
            &end[0],
            ModelStreamEvent::Completed { finish_reason: Some(reason), .. } if reason == "length"
        ));
    }

    #[test]
    fn missing_call_ids_are_generated_unique_and_named() {
        let call = |name: &str| RawToolCall { id: String::new(), name: name.into(), arguments: String::new() };
        let mut state = StreamState::default();
        let events = state.push(RawChunk { tool_calls: vec![call("ls"), call("ls")], ..RawChunk::default() });
        let ids: Vec<&str> = events
            .iter()
            .map(|event| match event {
                ModelStreamEvent::ToolCall { id, .. } => id.as_str(),
                other => panic!("expected ToolCall, got {other:?}"),
            })
            .collect();
        assert!(ids[0].starts_with("call_ls_") && ids[1].starts_with("call_ls_"));
        assert_ne!(ids[0], ids[1]);
        // Empty arguments text is `null`.
        assert!(matches!(&events[0], ModelStreamEvent::ToolCall { arguments: Value::Null, .. }));
    }

    #[test]
    fn unparsable_arguments_are_kept_as_text() {
        assert_eq!(parse_arguments("{not json"), Value::String("{not json".into()));
        assert_eq!(parse_arguments("  "), Value::Null);
        assert_eq!(parse_arguments(r#"{"a":1}"#), json!({ "a": 1 }));
    }
}
