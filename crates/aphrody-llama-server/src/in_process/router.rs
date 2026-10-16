// SPDX-License-Identifier: Apache-2.0
//! Turns the raw text an in-process model decodes, one token at a time, into
//! unified [`ModelStreamEvent`]s.
//!
//! A local model has no server in front of it to do three jobs the hosted
//! providers do for us, so they live here, in one pure and testable place:
//!
//! 1. **Reasoning split.** `<think>…</think>` becomes
//!    [`ModelStreamEvent::ReasoningDelta`], everything else
//!    [`ModelStreamEvent::TextDelta`]. Tags are recognised across token
//!    boundaries (`</thi` + `nk>`), never leaked into the visible text.
//! 2. **Stop strings.** The text is cut at the first stop sequence, and a tail
//!    that *could still become* one is held back instead of being streamed.
//! 3. **Tool calls.** Models without a structured `tool_calls` field write the
//!    call as text (`<tool_call>{…}</tool_call>`, `[TOOL_CALLS][…]`, bare
//!    JSON). Once such a marker starts, the rest of the output is held and,
//!    at the end, handed to `aphrody-toolcall-repair` (the repository's one
//!    inline-call extractor) and re-emitted as
//!    [`ModelStreamEvent::ToolCall`]. Only calls naming a *declared* tool are
//!    accepted, and an output cut short by the token limit is never turned
//!    into an executable call.

use std::sync::atomic::{AtomicU64, Ordering};

use aphrody_model_client::{ModelStreamEvent, TokenUsage};
use aphrody_toolcall_repair::{extract_any, strip_tool_calls};

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";
/// Markers after which the rest of the output is held back as a tool call.
const TOOL_MARKERS: [&str; 4] = ["<tool_call>", "[TOOL_CALLS]", "<|python_tag|>", "<function="];

/// Why generation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Finish {
    /// The model emitted an end-of-generation token, or a stop string matched.
    Stop,
    /// The token budget or the context ran out.
    Length,
}

impl Finish {
    fn as_reason(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Length => "length",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Marker {
    ThinkOpen,
    ThinkClose,
    Tool,
}

/// A fresh tool-call id, unique within this process.
pub(crate) fn new_call_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    format!("call_{nanos:x}_{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// What the router needs to know about the request.
#[derive(Debug, Clone, Default)]
pub(crate) struct RouterConfig {
    /// Names of the declared tools. Empty disables tool-call extraction.
    pub tools: Vec<String>,
    /// Stop sequences.
    pub stops: Vec<String>,
    /// The prompt already opened a `<think>` block (some templates end the
    /// generation prompt with it), so the output starts inside reasoning.
    pub think_open: bool,
}

/// Incremental router; see the module documentation.
#[derive(Debug)]
pub(crate) struct Router {
    tools: Vec<String>,
    stops: Vec<String>,
    /// Decoded text not yet emitted: it may end in a partial marker.
    pending: String,
    in_think: bool,
    /// Once set, everything that follows is the textual tool call.
    holding_tools: bool,
    tool_text: String,
    /// Visible content has started (leading whitespace is dropped until then).
    seen_content: bool,
    stopped: bool,
    /// Everything decoded, before any cut, for auditing.
    raw: String,
}

impl Router {
    pub(crate) fn new(config: RouterConfig) -> Self {
        Self {
            tools: config.tools,
            stops: config.stops.into_iter().filter(|stop| !stop.is_empty()).collect(),
            pending: String::new(),
            in_think: config.think_open,
            holding_tools: false,
            tool_text: String::new(),
            seen_content: false,
            stopped: false,
            raw: String::new(),
        }
    }

    /// Everything the model decoded so far, uncut.
    #[cfg(test)]
    pub(crate) fn raw(&self) -> &str {
        &self.raw
    }

    /// A stop string matched: generation should end.
    pub(crate) fn stopped(&self) -> bool {
        self.stopped
    }

    /// Feed the next decoded piece; returns the events that can be emitted now.
    pub(crate) fn push(&mut self, piece: &str) -> Vec<ModelStreamEvent> {
        self.raw.push_str(piece);
        self.pending.push_str(piece);
        let mut events = Vec::new();
        self.drain(false, &mut events);
        events
    }

    /// End of generation: flush what was held, extract tool calls and close
    /// the stream with the completion event.
    pub(crate) fn finish(
        &mut self,
        finish: Finish,
        prompt_tokens: usize,
        completion_tokens: usize,
    ) -> Vec<ModelStreamEvent> {
        let mut events = Vec::new();
        self.drain(true, &mut events);

        let mut called = false;
        if self.holding_tools {
            let held = std::mem::take(&mut self.tool_text);
            let calls = if finish == Finish::Length || self.tools.is_empty() {
                // Never repair an interrupted response into an executable call.
                Vec::new()
            } else {
                let mut calls = extract_any(&held);
                calls.retain(|call| self.tools.iter().any(|tool| tool == &call.name));
                calls
            };
            if calls.is_empty() {
                self.emit(&held, &mut events);
            } else {
                let prose = strip_tool_calls(&held, &calls);
                self.emit(&prose, &mut events);
                for call in calls {
                    called = true;
                    events.push(ModelStreamEvent::ToolCall {
                        id: new_call_id(),
                        name: call.name,
                        arguments: call.arguments,
                    });
                }
            }
        }

        let total = prompt_tokens.saturating_add(completion_tokens);
        let reason = if called { "tool_calls" } else { finish.as_reason() };
        events.push(ModelStreamEvent::Completed {
            usage: Some(TokenUsage::new(
                u64::try_from(prompt_tokens).unwrap_or(u64::MAX),
                u64::try_from(completion_tokens).unwrap_or(u64::MAX),
                u64::try_from(total).unwrap_or(u64::MAX),
            )),
            finish_reason: Some(reason.to_owned()),
        });
        events
    }

    fn emit(&mut self, text: &str, events: &mut Vec<ModelStreamEvent>) {
        if text.is_empty() {
            return;
        }
        if self.in_think {
            events.push(ModelStreamEvent::ReasoningDelta(text.to_owned()));
            return;
        }
        let text = if self.seen_content { text } else { text.trim_start() };
        if text.is_empty() {
            return;
        }
        self.seen_content = true;
        events.push(ModelStreamEvent::TextDelta(text.to_owned()));
    }

    fn next_marker(&self) -> Option<(usize, Marker)> {
        if self.in_think {
            return self.pending.find(THINK_CLOSE).map(|at| (at, Marker::ThinkClose));
        }
        let mut best = self.pending.find(THINK_OPEN).map(|at| (at, Marker::ThinkOpen));
        if !self.tools.is_empty() {
            for marker in TOOL_MARKERS {
                if let Some(at) = self.pending.find(marker)
                    && best.is_none_or(|(earliest, _)| at < earliest)
                {
                    best = Some((at, Marker::Tool));
                }
            }
        }
        best
    }

    /// The longest tail of `pending` that is a proper prefix of something this
    /// router would act on: it must not be streamed yet.
    fn held_tail(&self) -> usize {
        let mut structural: Vec<&str> = Vec::with_capacity(5);
        if self.in_think {
            structural.push(THINK_CLOSE);
        } else {
            structural.push(THINK_OPEN);
            if !self.tools.is_empty() {
                structural.extend(TOOL_MARKERS);
            }
        }
        structural
            .into_iter()
            .chain(self.stops.iter().map(String::as_str))
            .map(|candidate| partial_suffix(&self.pending, candidate))
            .max()
            .unwrap_or(0)
    }

    fn drain(&mut self, flush: bool, events: &mut Vec<ModelStreamEvent>) {
        loop {
            if self.stopped {
                self.pending.clear();
                return;
            }
            if self.holding_tools {
                self.tool_text.push_str(&self.pending);
                self.pending.clear();
                return;
            }

            let stop_at =
                self.stops.iter().filter_map(|stop| self.pending.find(stop.as_str())).min();
            let marker = self.next_marker();

            // A stop string wins when it comes first.
            if let Some(at) = stop_at
                && marker.is_none_or(|(marker_at, _)| at <= marker_at)
            {
                let head = self.pending[..at].to_owned();
                self.emit(&head, events);
                self.pending.clear();
                self.stopped = true;
                return;
            }

            if let Some((at, kind)) = marker {
                let head = self.pending[..at].to_owned();
                self.emit(&head, events);
                match kind {
                    Marker::ThinkOpen => {
                        self.pending.replace_range(..at + THINK_OPEN.len(), "");
                        self.in_think = true;
                    },
                    Marker::ThinkClose => {
                        self.pending.replace_range(..at + THINK_CLOSE.len(), "");
                        self.in_think = false;
                    },
                    Marker::Tool => {
                        // Keep the marker: the extractor needs it.
                        self.pending.replace_range(..at, "");
                        self.holding_tools = true;
                    },
                }
                continue;
            }

            // Content that starts like JSON while tools are declared may be a
            // bare-JSON tool call: decide once the output ends.
            if !self.in_think && !self.tools.is_empty() && !self.seen_content {
                match starts_like_json_call(self.pending.trim_start()) {
                    Some(true) => {
                        self.holding_tools = true;
                        continue;
                    },
                    // Too short to tell: the next character decides.
                    None if !flush => return,
                    _ => {},
                }
            }

            if flush {
                let all = std::mem::take(&mut self.pending);
                self.emit(&all, events);
                return;
            }
            let keep = self.held_tail();
            let split = self.pending.len() - keep;
            if split > 0 {
                let ready = self.pending[..split].to_owned();
                self.pending.replace_range(..split, "");
                self.emit(&ready, events);
            }
            return;
        }
    }
}

/// Whether `text` (already left-trimmed) starts like a bare-JSON tool call:
/// `{…` or `[{…`. `None` while it is too short to tell.
fn starts_like_json_call(text: &str) -> Option<bool> {
    let mut chars = text.chars();
    match chars.next() {
        Some('{') => Some(true),
        Some('[') => chars.as_str().trim_start().chars().next().map(|next| next == '{'),
        Some(_) => Some(false),
        None => None,
    }
}

/// Length in bytes of the longest proper prefix of `candidate` that `text`
/// ends with (`0` when there is none).
fn partial_suffix(text: &str, candidate: &str) -> usize {
    (1..candidate.len())
        .rev()
        .filter(|&len| candidate.is_char_boundary(len))
        .find(|&len| text.ends_with(&candidate[..len]))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::*;

    fn run(config: RouterConfig, pieces: &[&str], finish: Finish) -> Vec<ModelStreamEvent> {
        let mut router = Router::new(config);
        let mut events = Vec::new();
        for piece in pieces {
            events.extend(router.push(piece));
        }
        events.extend(router.finish(finish, 10, 5));
        events
    }

    fn text_of(events: &[ModelStreamEvent]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                ModelStreamEvent::TextDelta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn reasoning_of(events: &[ModelStreamEvent]) -> String {
        events
            .iter()
            .filter_map(|event| match event {
                ModelStreamEvent::ReasoningDelta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn calls_of(events: &[ModelStreamEvent]) -> Vec<(String, serde_json::Value)> {
        events
            .iter()
            .filter_map(|event| match event {
                ModelStreamEvent::ToolCall { name, arguments, .. } => {
                    Some((name.clone(), arguments.clone()))
                },
                _ => None,
            })
            .collect()
    }

    fn finish_reason_of(events: &[ModelStreamEvent]) -> Option<String> {
        match events.last() {
            Some(ModelStreamEvent::Completed { finish_reason, .. }) => finish_reason.clone(),
            _ => None,
        }
    }

    fn tools(names: &[&str]) -> RouterConfig {
        RouterConfig {
            tools: names.iter().map(|name| (*name).to_owned()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn plain_text_streams_through_and_completes_with_usage() {
        let events = run(RouterConfig::default(), &["Hel", "lo ", "world"], Finish::Stop);
        assert_eq!(text_of(&events), "Hello world");
        let Some(ModelStreamEvent::Completed { usage: Some(usage), finish_reason }) = events.last()
        else {
            panic!("no completion: {events:?}");
        };
        assert_eq!((usage.input_tokens, usage.output_tokens, usage.total_tokens), (10, 5, 15));
        assert_eq!(finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn reasoning_is_split_even_when_the_tags_straddle_tokens() {
        let events = run(
            RouterConfig::default(),
            &["<th", "ink>plan the ", "answer</thi", "nk>\n\nFinal ", "answer"],
            Finish::Stop,
        );
        assert_eq!(reasoning_of(&events), "plan the answer");
        assert_eq!(text_of(&events), "Final answer", "whitespace after </think> is dropped");
    }

    #[test]
    fn a_prompt_that_already_opened_the_think_block_starts_in_reasoning() {
        let config = RouterConfig { think_open: true, ..Default::default() };
        let events = run(config, &["thinking...</think>done"], Finish::Stop);
        assert_eq!(reasoning_of(&events), "thinking...");
        assert_eq!(text_of(&events), "done");
    }

    #[test]
    fn a_lookalike_that_never_completes_is_flushed_as_text() {
        let events = run(RouterConfig::default(), &["a <thi"], Finish::Stop);
        assert_eq!(text_of(&events), "a <thi");
    }

    #[test]
    fn stop_strings_cut_the_output_and_hold_back_a_possible_prefix() {
        let config = RouterConfig { stops: vec!["END".to_owned()], ..Default::default() };
        let mut router = Router::new(config);
        let mut events = router.push("keep E");
        // `E` could start `END`: it must not have been streamed yet.
        assert_eq!(text_of(&events), "keep ");
        events.extend(router.push("ND and the rest"));
        assert!(router.stopped());
        assert_eq!(text_of(&events), "keep ");
        assert_eq!(router.raw(), "keep END and the rest");
    }

    #[test]
    fn a_held_prefix_that_is_not_the_stop_string_is_released() {
        let config = RouterConfig { stops: vec!["END".to_owned()], ..Default::default() };
        let events = run(config, &["a E", "x"], Finish::Stop);
        assert_eq!(text_of(&events), "a Ex");
    }

    #[test]
    fn a_hermes_tool_call_becomes_a_tool_call_event() {
        let events = run(
            tools(&["read_file"]),
            &[
                "Let me look.\n<tool_",
                r#"call>{"name":"read_file","arguments":{"path":"a.rs"}}</tool_call>"#,
            ],
            Finish::Stop,
        );
        assert_eq!(text_of(&events).trim_end(), "Let me look.");
        assert_eq!(calls_of(&events), vec![("read_file".to_owned(), json!({"path": "a.rs"}))]);
        assert_eq!(finish_reason_of(&events).as_deref(), Some("tool_calls"));
    }

    #[test]
    fn a_call_to_an_undeclared_tool_is_text_not_a_call() {
        let raw = r#"<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>"#;
        let events = run(tools(&["read_file"]), &[raw], Finish::Stop);
        assert!(calls_of(&events).is_empty());
        assert_eq!(text_of(&events), raw);
    }

    #[test]
    fn bare_json_is_a_call_only_when_it_names_a_declared_tool() {
        let call = r#"{"name":"search","arguments":{"q":"x"}}"#;
        let events = run(tools(&["search"]), &[call], Finish::Stop);
        assert_eq!(calls_of(&events), vec![("search".to_owned(), json!({"q": "x"}))]);

        let answer = r#"{"name":"Ada","age":36}"#;
        let events = run(tools(&["search"]), &[answer], Finish::Stop);
        assert!(calls_of(&events).is_empty());
        assert_eq!(text_of(&events), answer, "a JSON answer is still delivered, just not streamed");
    }

    #[test]
    fn a_bracketed_answer_that_is_not_an_array_of_objects_still_streams() {
        let mut router = Router::new(tools(&["search"]));
        let events = router.push("[1] first point");
        assert_eq!(text_of(&events), "[1] first point", "no JSON-call hold-back for `[1]`");
    }

    #[test]
    fn a_tool_call_cut_by_the_token_limit_is_never_executable() {
        let cut = r#"<tool_call>{"name":"search","arguments":{"q":"hel"#;
        let events = run(tools(&["search"]), &[cut], Finish::Length);
        assert!(calls_of(&events).is_empty());
        assert_eq!(text_of(&events), cut);
        assert_eq!(finish_reason_of(&events).as_deref(), Some("length"));
    }

    #[test]
    fn without_declared_tools_a_marker_is_ordinary_text() {
        let raw = r#"<tool_call>{"name":"search","arguments":{}}</tool_call>"#;
        let events = run(RouterConfig::default(), &[raw], Finish::Stop);
        assert_eq!(text_of(&events), raw);
    }

    #[test]
    fn call_ids_are_unique() {
        assert_ne!(new_call_id(), new_call_id());
    }

    #[test]
    fn partial_suffix_matches_only_proper_prefixes() {
        assert_eq!(partial_suffix("abc<th", THINK_OPEN), 3);
        assert_eq!(partial_suffix("abc<think>", THINK_OPEN), 0, "a full match is not partial");
        assert_eq!(partial_suffix("abc", THINK_OPEN), 0);
        // Multi-byte candidates are only cut on character boundaries.
        assert_eq!(partial_suffix("x終", "終了"), "終".len());
    }
}
