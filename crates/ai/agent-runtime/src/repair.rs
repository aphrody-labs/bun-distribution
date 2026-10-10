// SPDX-License-Identifier: Apache-2.0
//! Strict recovery of complete inline tool calls from OSS providers.

use std::sync::Arc;

use aphrody_model_client::{
    ChatTurn, ModelCapabilities, ModelClient, ModelError, ModelStream, ModelStreamEvent, ToolDecl,
};
use aphrody_toolcall_repair::{
    PromptProfile, builtin_profiles, extract_inline_tool_calls, select_profile, strip_tool_calls,
};
use futures::{StreamExt as _, TryStreamExt as _};
/// OSS dialect recovery is limited to complete responses made solely of declared tool calls.
/// Prose, examples embedded in explanations and native calls retain their original semantics.
pub(super) struct RepairingModelClient {
    inner: Arc<dyn ModelClient>,
    profile: PromptProfile,
}

impl RepairingModelClient {
    pub(super) fn new(inner: Arc<dyn ModelClient>) -> Self {
        let model = inner.model_id().rsplit(['/', '\\']).next().unwrap_or(inner.model_id());
        let profile = select_profile(model, &[], &builtin_profiles()).clone();
        Self { inner, profile }
    }

    fn recover(
        &self,
        mut events: Vec<ModelStreamEvent>,
        tools: &[ToolDecl],
    ) -> Vec<ModelStreamEvent> {
        if events.iter().any(|event| matches!(event, ModelStreamEvent::ToolCall { .. })) {
            return events;
        }
        // Never repair an interrupted response into an executable call. Providers may emit
        // usage-only completion events, so require an explicit successful finish reason.
        let complete = events.iter().any(|event| match event {
            ModelStreamEvent::Completed { finish_reason: Some(reason), .. } => matches!(
                reason.to_ascii_lowercase().as_str(),
                "stop" | "completed" | "tool_calls" | "function_call"
            ),
            _ => false,
        });
        let interrupted = events.iter().any(|event| match event {
            ModelStreamEvent::Completed { finish_reason: Some(reason), .. } => !matches!(
                reason.to_ascii_lowercase().as_str(),
                "stop" | "completed" | "tool_calls" | "function_call"
            ),
            _ => false,
        });
        if !complete || interrupted {
            return events;
        }
        let text: String = events
            .iter()
            .filter_map(|event| match event {
                ModelStreamEvent::TextDelta(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        let mut candidate = text.trim();
        if let Some((header, body)) = candidate.split_once('\n')
            && matches!(header.trim(), "```" | "```json")
            && let Some(body) = body.trim_end().strip_suffix("```")
        {
            candidate = body.trim();
        }
        let calls = extract_inline_tool_calls(candidate, self.profile.tool_dialect);
        if calls.is_empty()
            || !strip_tool_calls(candidate, &calls).is_empty()
            || calls.iter().any(|call| !tools.iter().any(|tool| tool.name == call.name))
        {
            return events;
        }
        let mut recovered = Vec::new();
        for call in calls {
            let Some(tool) = tools.iter().find(|tool| tool.name == call.name) else {
                return events;
            };
            let (mut arguments, _) =
                aphrody_toolcall_repair::coerce_arguments(&call.arguments, &tool.parameters);
            if call.name == "apply_patch"
                && let Some(patch) = arguments.get("patch").and_then(serde_json::Value::as_str)
                && let Ok(patch) =
                    aphrody_toolcall_repair::normalize_to_codex_patch(patch, &|_| None)
            {
                arguments["patch"] = serde_json::Value::String(patch);
            }
            recovered.push(ModelStreamEvent::ToolCall {
                id: aphrody_agent_proto::Event::new(aphrody_agent_proto::EventMsg::TurnStarted).id,
                name: call.name,
                arguments,
            });
        }
        eprintln!(
            "warning: recovered {} inline tool call(s) using OSS profile {}",
            recovered.len(),
            self.profile.id
        );
        events.retain(|event| !matches!(event, ModelStreamEvent::TextDelta(_)));
        let position = events
            .iter()
            .position(|event| matches!(event, ModelStreamEvent::Completed { .. }))
            .unwrap_or(events.len());
        events.splice(position..position, recovered);
        events
    }
}

#[async_trait::async_trait]
impl ModelClient for RepairingModelClient {
    async fn stream(&self, mut turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let patch_contract = "For apply_patch Add File, every content line starts with + and \
                              there is no @@ hunk header. Example: *** Begin Patch\\n*** Add \
                              File: hello.txt\\n+hello\\n*** End Patch. After any tool call, wait \
                              for its result and continue the task. Never claim a file was \
                              changed before a successful tool result.";
        turn.system = Some(format!(
            "{}\n{patch_contract}\n\n{}",
            self.profile.system_preamble,
            turn.system.as_deref().unwrap_or("")
        ));
        if turn.options.temperature.is_none() {
            turn.options.temperature = self.profile.temperature;
        }
        if turn.options.parallel_tool_calls.is_none() {
            turn.options.parallel_tool_calls = Some(self.profile.parallel_tools);
        }
        let tools = turn.tools.clone();
        // Buffer each response before classifying text: an ordinary streamed code example must
        // never be partly emitted to the user and subsequently executed as a tool call.
        let stream = self.inner.stream(turn).await?;
        let adapter = Self { inner: Arc::clone(&self.inner), profile: self.profile.clone() };
        let recovered = futures::stream::once(async move {
            match stream.try_collect::<Vec<_>>().await {
                Ok(events) => {
                    adapter.recover(events, &tools).into_iter().map(Ok).collect::<Vec<_>>()
                },
                Err(error) => vec![Err(error)],
            }
        })
        .flat_map(futures::stream::iter);
        Ok(Box::pin(recovered))
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }

    fn capabilities(&self) -> ModelCapabilities {
        self.inner.capabilities()
    }
}

#[cfg(test)]
mod tests {
    use aphrody_agent_proto::EventMsg;

    use super::*;
    use crate::{AgentRuntime, ModelChoice, RuntimeConfig, ScriptedTurn, StubModelClient};

    fn tool() -> ToolDecl {
        ToolDecl {
            name: "read_file".into(),
            description: "read a local file".into(),
            parameters: serde_json::json!({"type":"object", "properties":{"path":{"type":"string"}}, "required":["path"]}),
        }
    }

    fn adapter() -> RepairingModelClient {
        RepairingModelClient::new(Arc::new(StubModelClient::new(
            "file:/models/qwen2.5-coder-7b.gguf",
            Vec::new(),
        )))
    }

    #[test]
    fn prose_examples_and_unknown_tools_are_never_executed() {
        let adapter = adapter();
        assert_eq!(adapter.profile.id, "qwen2.5-coder");
        for text in [
            "Example: {\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}",
            "{\"name\":\"unknown_tool\",\"arguments\":{}}",
            "```python\n{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}\n```",
        ] {
            let events = vec![
                ModelStreamEvent::TextDelta(text.into()),
                ModelStreamEvent::Completed { usage: None, finish_reason: Some("stop".into()) },
            ];
            assert_eq!(adapter.recover(events.clone(), &[tool()]), events);
        }
    }

    #[test]
    fn native_call_ids_and_usage_are_preserved() {
        let events = vec![
            ModelStreamEvent::TextDelta(
                "{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}".into(),
            ),
            ModelStreamEvent::ToolCall {
                id: "provider-call".into(),
                name: "read_file".into(),
                arguments: serde_json::json!({"path":"a.txt"}),
            },
            ModelStreamEvent::Completed {
                usage: Some(aphrody_model_client::TokenUsage::new(7, 3, 10)),
                finish_reason: None,
            },
        ];
        assert_eq!(adapter().recover(events.clone(), &[tool()]), events);
    }

    #[test]
    fn truncated_responses_are_never_executed() {
        for reason in [None, Some("length"), Some("content_filter"), Some("incomplete")] {
            let events = vec![
                ModelStreamEvent::TextDelta(
                    "{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}".into(),
                ),
                ModelStreamEvent::Completed {
                    usage: None,
                    finish_reason: reason.map(String::from),
                },
            ];
            assert_eq!(adapter().recover(events.clone(), &[tool()]), events);
        }
    }

    #[test]
    fn recovered_calls_preserve_usage_and_completion_order() {
        let completion = ModelStreamEvent::Completed {
            usage: Some(aphrody_model_client::TokenUsage::new(7, 3, 10)),
            finish_reason: Some("stop".into()),
        };
        let events = adapter().recover(
            vec![
                ModelStreamEvent::TextDelta(
                    "```json\n{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.txt\"}}\n```"
                        .into(),
                ),
                completion.clone(),
            ],
            &[tool()],
        );
        assert_eq!(events.len(), 2);
        assert!(
            matches!(&events[0], ModelStreamEvent::ToolCall { name, .. } if name == "read_file")
        );
        assert_eq!(events[1], completion);
    }

    #[tokio::test]
    async fn recorded_qwen_dialect_executes_tools_and_retries_invalid_patch() {
        let root = tempfile::tempdir().unwrap();
        let invalid = serde_json::json!({"name":"apply_patch", "arguments":{
            "patch":"*** Begin Patch\n*** Add File: hello.txt\n@@\nAPHRODY_OSS_SMOKE\n*** End Patch"
        }});
        let valid = serde_json::json!({"name":"apply_patch", "arguments":{
            "patch":"*** Begin Patch\n*** Add File: hello.txt\n+APHRODY_OSS_SMOKE\n*** End Patch"
        }});
        let read = serde_json::json!({"name":"read_file", "arguments":{"file_path":"hello.txt"}});
        let model = RepairingModelClient::new(Arc::new(StubModelClient::new(
            "file:/models/qwen2.5-coder-7b.gguf",
            vec![
                ScriptedTurn::text(format!("```json\n{invalid}\n```")),
                ScriptedTurn::text(valid.to_string()),
                ScriptedTurn::text(read.to_string()),
                ScriptedTurn::text("VERIFIED_APHRODY_OSS_SMOKE"),
            ],
        )));
        let runtime = AgentRuntime::builder()
            .config(
                RuntimeConfig::new("qwen2.5-coder-7b")
                    .with_cwd(root.path())
                    .with_max_tool_iterations(8),
            )
            .model(ModelChoice::from_client(Arc::new(model)))
            .build()
            .unwrap();
        let result = runtime.run_once("create and verify hello.txt").await.unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("hello.txt")).unwrap().trim(),
            "APHRODY_OSS_SMOKE"
        );
        assert_eq!(result.last_agent_message.as_deref(), Some("VERIFIED_APHRODY_OSS_SMOKE"));
        let results: Vec<_> = result
            .events
            .iter()
            .filter_map(|event| match &event.msg {
                EventMsg::ToolCallEnd { ok, .. } => Some(*ok),
                _ => None,
            })
            .collect();
        assert_eq!(results, vec![false, true, true]);
    }
}
