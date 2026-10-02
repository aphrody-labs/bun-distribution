// SPDX-License-Identifier: Apache-2.0
//! What mistral.rs sends back, as the neutral types of this crate.
//!
//! [`classify`] decides what each upstream `Response` means for the stream; [`decode_chunk`]
//! flattens a streamed chunk into the plain [`RawChunk`] that `events::StreamState` consumes.
//! Both are pure: the tests build the mistral.rs response types by hand.

use aphrody_model_client::ModelError;
use mistralrs::core::ServiceUnavailableError;
use mistralrs::error::Error as SdkError;
use mistralrs::{ChatCompletionChunkResponse, Response, ToolCallResponse, Usage};

use crate::events::{RawChunk, RawToolCall, RawUsage};

/// What one upstream `Response` means for the stream.
pub(crate) enum Step {
    /// Content, a tool call, a finish reason or usage.
    Chunk(RawChunk),
    /// Progress of a feature this crate never switches on (agentic tools, search, files).
    Skip,
    /// The engine failed the request.
    Failed(ModelError),
}

/// Sort one upstream response of a streaming chat request.
///
/// Errors carry the status the same condition would have on an HTTP wire: a request mistral.rs
/// rejects is a `400`, a failure inside the engine a `500`, an engine that reports itself
/// unavailable (out of KV cache blocks, for example) a `503`.
pub(crate) fn classify(response: Response) -> Step {
    match response {
        Response::Chunk(chunk) => Step::Chunk(decode_chunk(chunk)),
        Response::ValidationError(error) => Step::Failed(api(400, error.to_string())),
        Response::InternalError(error) => {
            let unavailable = error.downcast_ref::<ServiceUnavailableError>().is_some();
            Step::Failed(api(if unavailable { 503 } else { 500 }, error.to_string()))
        },
        Response::ModelError(message, _partial) => Step::Failed(api(500, message)),
        Response::AgenticToolCallProgress { .. }
        | Response::BlockDenoisingProgress(_)
        | Response::File(_) => Step::Skip,
        _ => Step::Failed(ModelError::Stream(
            "mistral.rs answered a chat request with something other than a chat chunk".to_owned(),
        )),
    }
}

/// The error of a request mistral.rs refused before it produced a stream.
pub(crate) fn sdk_error(error: &SdkError) -> ModelError {
    let status = match error {
        SdkError::RequestValidation(_) => 400,
        _ => 500,
    };
    api(status, error.to_string())
}

fn api(status: u16, message: String) -> ModelError {
    ModelError::Api { status, message }
}

/// One streamed chunk as plain data. Only the first choice is read: every request asks for one.
pub(crate) fn decode_chunk(chunk: ChatCompletionChunkResponse) -> RawChunk {
    let mut raw = RawChunk { usage: chunk.usage.map(raw_usage), ..RawChunk::default() };
    if let Some(choice) = chunk.choices.into_iter().next() {
        raw.finish_reason = choice.finish_reason;
        raw.content = choice.delta.content;
        raw.reasoning = choice.delta.reasoning_content;
        raw.tool_calls =
            choice.delta.tool_calls.unwrap_or_default().into_iter().map(raw_tool_call).collect();
    }
    raw
}

fn raw_tool_call(call: ToolCallResponse) -> RawToolCall {
    RawToolCall { id: call.id, name: call.function.name, arguments: call.function.arguments }
}

fn raw_usage(usage: Usage) -> RawUsage {
    let cached = usage.prompt_tokens_details.map_or(0, |details| details.cached_tokens);
    RawUsage {
        prompt_tokens: count(usage.prompt_tokens),
        completion_tokens: count(usage.completion_tokens),
        total_tokens: count(usage.total_tokens),
        cached_tokens: count(cached),
    }
}

fn count(tokens: usize) -> u64 {
    u64::try_from(tokens).unwrap_or(u64::MAX)
}

/// Hand-built mistral.rs responses, for the tests of this module and of `stream`.
#[cfg(test)]
pub(crate) mod fixtures {
    use mistralrs::core::PromptTokensDetails;
    use mistralrs::{
        CalledFunction, ChatCompletionChunkResponse, ChunkChoice, Delta, Response,
        ToolCallResponse, ToolCallType, Usage,
    };

    pub(crate) fn delta(content: Option<&str>) -> Delta {
        Delta {
            content: content.map(str::to_owned),
            role: "assistant".to_owned(),
            tool_calls: None,
            reasoning_content: None,
        }
    }

    pub(crate) fn usage(prompt: usize, completion: usize, cached: Option<usize>) -> Usage {
        let details = cached.map(|cached_tokens| PromptTokensDetails { cached_tokens });
        Usage {
            completion_tokens: completion,
            prompt_tokens: prompt,
            total_tokens: prompt + completion,
            prompt_tokens_details: details,
            avg_tok_per_sec: 0.0,
            avg_prompt_tok_per_sec: 0.0,
            avg_compl_tok_per_sec: 0.0,
            total_time_sec: 0.0,
            total_prompt_time_sec: 0.0,
            total_completion_time_sec: 0.0,
        }
    }

    pub(crate) fn chunk(
        delta: Delta,
        finish_reason: Option<&str>,
        usage: Option<Usage>,
    ) -> ChatCompletionChunkResponse {
        ChatCompletionChunkResponse {
            id: "1".to_owned(),
            choices: vec![ChunkChoice {
                finish_reason: finish_reason.map(str::to_owned),
                stop_sequence: None,
                index: 0,
                delta,
                logprobs: None,
            }],
            created: 0,
            model: "m".to_owned(),
            system_fingerprint: "local".to_owned(),
            object: "chat.completion.chunk".to_owned(),
            usage,
            adapter_generation: None,
            session_id: None,
        }
    }

    /// A streamed text delta.
    pub(crate) fn text(content: &str) -> Response {
        Response::Chunk(chunk(delta(Some(content)), None, None))
    }

    /// The last chunk of a turn: no content, the finish reason and the usage.
    pub(crate) fn last(finish_reason: &str, usage: Usage) -> Response {
        Response::Chunk(chunk(delta(None), Some(finish_reason), Some(usage)))
    }

    /// The chunk in which the engine delivers one completed tool call and ends the turn.
    pub(crate) fn tool_call(id: &str, name: &str, arguments: &str) -> Response {
        let mut streamed = delta(None);
        streamed.tool_calls = Some(vec![ToolCallResponse {
            index: 0,
            id: id.to_owned(),
            tp: ToolCallType::Function,
            function: CalledFunction { name: name.to_owned(), arguments: arguments.to_owned() },
        }]);
        Response::Chunk(chunk(streamed, Some("tool_calls"), Some(usage(8, 3, None))))
    }
}

#[cfg(test)]
mod tests {
    use mistralrs::core::BlockDenoisingProgress;
    use mistralrs::{CalledFunction, ChatCompletionResponse, Delta, ToolCallType};

    use super::fixtures::{chunk, delta, usage};
    use super::*;

    fn failed(step: Step) -> (u16, String) {
        match step {
            Step::Failed(ModelError::Api { status, message }) => (status, message),
            Step::Failed(other) => panic!("expected an Api error, got {other:?}"),
            Step::Chunk(_) | Step::Skip => panic!("expected a failure"),
        }
    }

    #[test]
    fn text_reasoning_and_tool_calls_decode_into_a_raw_chunk() {
        let streamed = Delta {
            content: Some("hello".to_owned()),
            role: "assistant".to_owned(),
            tool_calls: Some(vec![ToolCallResponse {
                index: 0,
                id: "call-1".to_owned(),
                tp: ToolCallType::Function,
                function: CalledFunction {
                    name: "ls".to_owned(),
                    arguments: r#"{"path":"."}"#.to_owned(),
                },
            }]),
            reasoning_content: Some("think".to_owned()),
        };
        let raw = decode_chunk(chunk(streamed, None, None));
        assert_eq!(raw.content.as_deref(), Some("hello"));
        assert_eq!(raw.reasoning.as_deref(), Some("think"));
        assert_eq!(
            raw.tool_calls,
            vec![RawToolCall {
                id: "call-1".to_owned(),
                name: "ls".to_owned(),
                arguments: r#"{"path":"."}"#.to_owned(),
            }]
        );
        assert_eq!((raw.finish_reason, raw.usage), (None, None));
    }

    #[test]
    fn the_finish_reason_and_usage_ride_the_last_chunk() {
        let last = chunk(delta(None), Some("length"), Some(usage(10, 4, Some(6))));
        let raw = decode_chunk(last);
        assert_eq!(raw.finish_reason.as_deref(), Some("length"));
        assert_eq!(
            raw.usage,
            Some(RawUsage {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
                cached_tokens: 6,
            })
        );
        // No prefix-cache hit: the details are absent and the count is zero.
        let cold = decode_chunk(chunk(delta(None), Some("stop"), Some(usage(3, 1, None))));
        assert_eq!(cold.usage.map(|usage| usage.cached_tokens), Some(0));
    }

    #[test]
    fn a_chunk_without_choices_still_carries_its_usage() {
        let mut bare = chunk(delta(None), None, Some(usage(1, 2, None)));
        bare.choices.clear();
        let raw = decode_chunk(bare);
        assert_eq!((raw.content, raw.finish_reason), (None, None));
        assert_eq!(raw.usage.map(|usage| usage.total_tokens), Some(3));
    }

    #[test]
    fn a_chunk_response_is_classified_as_a_chunk() {
        let Step::Chunk(raw) = classify(Response::Chunk(chunk(delta(Some("hi")), None, None)))
        else {
            panic!("expected a chunk");
        };
        assert_eq!(raw.content.as_deref(), Some("hi"));
    }

    #[test]
    fn engine_failures_map_onto_http_statuses() {
        let (status, message) = failed(classify(Response::ValidationError("too long".into())));
        assert_eq!((status, message.as_str()), (400, "too long"));

        let (status, message) = failed(classify(Response::InternalError("kernel panic".into())));
        assert_eq!((status, message.as_str()), (500, "kernel panic"));

        let busy = Response::InternalError(Box::new(ServiceUnavailableError("no blocks".into())));
        let (status, message) = failed(classify(busy));
        assert_eq!((status, message.as_str()), (503, "no blocks"));

        let partial = ChatCompletionResponse {
            id: "1".to_owned(),
            choices: Vec::new(),
            created: 0,
            model: "m".to_owned(),
            system_fingerprint: "local".to_owned(),
            object: "chat.completion".to_owned(),
            usage: usage(1, 1, None),
            adapter_generation: None,
            agentic_tool_calls: None,
            files: None,
            session_id: None,
        };
        let broken = Response::ModelError("nan logits".into(), partial);
        let (status, message) = failed(classify(broken));
        assert_eq!((status, message.as_str()), (500, "nan logits"));
    }

    #[test]
    fn progress_is_skipped_and_foreign_responses_fail_the_stream() {
        let progress = BlockDenoisingProgress {
            index: 0,
            step: 1,
            total_steps: 4,
            tokens: Vec::new(),
            text: String::new(),
            finished: false,
            final_block: false,
        };
        assert!(matches!(classify(Response::BlockDenoisingProgress(progress)), Step::Skip));

        let speech =
            Response::Speech { pcm: std::sync::Arc::new(Vec::new()), rate: 16_000, channels: 1 };
        assert!(matches!(classify(speech), Step::Failed(ModelError::Stream(_))));
    }

    #[test]
    fn refused_requests_map_validation_to_400_and_the_rest_to_500() {
        let status = |error: SdkError| match sdk_error(&error) {
            ModelError::Api { status, .. } => status,
            other => panic!("expected an Api error, got {other:?}"),
        };
        assert_eq!(status(SdkError::RequestValidation("empty".to_owned())), 400);
        assert_eq!(status(SdkError::Channel("closed".to_owned())), 500);
    }
}
