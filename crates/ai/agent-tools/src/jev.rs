// SPDX-License-Identifier: Apache-2.0
//! `jev_decide`: typed decisions (Noul, Choice, Score) through the Jev router.
//!
//! The agent passes a state and named questions; the tool returns only
//! validated primitives plus the backend that served them. Routing and local
//! failover are owned by [`aphrody_jev::JevRouter`].

use std::{collections::BTreeMap, sync::Arc};

use aphrody_jev::{DEFAULT_MODEL, JevError, JevRouter, Question, Request};
use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolOutput,
};
use serde::Deserialize;

/// Tool name.
pub const JEV_TOOL: &str = "jev_decide";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DecideArgs {
    state: serde_json::Value,
    questions: BTreeMap<String, Question>,
    #[serde(default)]
    model: Option<String>,
}

/// Answers typed questions about a state with the Jev decision models.
pub struct JevDecideTool {
    router: Arc<JevRouter>,
    definition: ToolDefinition,
}

impl JevDecideTool {
    /// Wrap a configured router.
    #[must_use]
    pub fn new(router: Arc<JevRouter>) -> Self {
        Self { router, definition: definition() }
    }

    /// Build from the environment; `None` when no Jev backend is configured.
    ///
    /// # Errors
    /// A present but invalid configuration (for example a malformed URL).
    pub fn from_env() -> Result<Option<Self>, JevError> {
        match JevRouter::from_env() {
            Ok(router) => Ok(Some(Self::new(Arc::new(router)))),
            Err(JevError::NoBackend) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl ToolExecutor for JevDecideTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: serde_json::Value) -> Result<ToolOutput, ToolError> {
        let args: DecideArgs = serde_json::from_value(arguments).map_err(|error| {
            ToolError::InvalidArguments { tool: JEV_TOOL.into(), message: error.to_string() }
        })?;
        let request = Request {
            state: args.state,
            model: args.model.unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
            questions: args.questions,
        };
        match self.router.decide(&request).await {
            Ok(decision) => {
                let body = serde_json::json!({
                    "served_by": decision.served_by.to_string(),
                    "latency_ms": u64::try_from(decision.latency.as_millis()).unwrap_or(u64::MAX),
                    "failover": decision.failover.map(|f| serde_json::json!({
                        "from": f.from.to_string(),
                        "to": f.to.to_string(),
                        "reason": f.reason,
                    })),
                    "model": decision.response.model,
                    "answers": decision.response.answers,
                    "usage": decision.response.usage,
                });
                Ok(ToolOutput::ok(body.to_string()))
            },
            Err(error @ JevError::InvalidRequest(_)) => Err(ToolError::InvalidArguments {
                tool: JEV_TOOL.into(),
                message: error.to_string(),
            }),
            Err(error) => Ok(ToolOutput::error(format!("{JEV_TOOL}: {error}"))),
        }
    }
}

fn definition() -> ToolDefinition {
    let mut properties = BTreeMap::new();
    properties.insert(
        "state".into(),
        JsonSchema::string(Some(
            "Content to judge: text, or a JSON-encoded object/array for structured state.".into(),
        )),
    );
    properties.insert(
        "questions".into(),
        JsonSchema::object(BTreeMap::new(), None, Some(AdditionalProperties::Boolean(true))),
    );
    properties.insert(
        "model".into(),
        JsonSchema::string(Some(format!("Model id, default `{DEFAULT_MODEL}`."))),
    );
    ToolDefinition::new(
        JEV_TOOL,
        "Answer typed questions about a state without generating text. `questions` maps a name to \
         one of: {\"type\":\"noul\",\"instructions\":\"...\"} (probability of yes), \
         {\"type\":\"choice\",\"instructions\":\"...\",\"criteria\":{\"option\":\"meaning\",...}} \
         (one option, at least two), or \
         {\"type\":\"score\",\"instructions\":\"...\",\"criteria\":[\"lowest \
         level\",...,\"highest level\"]} (position along levels). Use it for routing, \
         classification, guardrails and ranking decisions.",
        JsonSchema::object(
            properties,
            Some(vec!["state".into(), "questions".into()]),
            Some(AdditionalProperties::Boolean(false)),
        ),
    )
}

#[cfg(test)]
mod tests {
    use aphrody_jev::{Endpoint, RoutingPolicy};
    use serde_json::json;

    use super::*;

    fn unreachable_router() -> Arc<JevRouter> {
        let closed = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", listener.local_addr().unwrap())
        };
        Arc::new(
            JevRouter::new(
                None,
                None,
                Some(Endpoint::local(&closed, None).unwrap()),
                RoutingPolicy::default(),
            )
            .unwrap(),
        )
    }

    #[test]
    fn definition_requires_state_and_questions() {
        let tool = JevDecideTool::new(unreachable_router());
        assert_eq!(tool.definition().name, JEV_TOOL);
    }

    #[tokio::test]
    async fn rejects_untyped_question() {
        let tool = JevDecideTool::new(unreachable_router());
        let error = tool
            .handle(json!({
                "state": "text",
                "questions": { "q": { "type": "freeform", "instructions": "Say anything" } }
            }))
            .await
            .unwrap_err();
        assert!(matches!(error, ToolError::InvalidArguments { .. }), "{error}");
    }

    #[tokio::test]
    async fn backend_outage_is_a_tool_error_not_a_crash() {
        let tool = JevDecideTool::new(unreachable_router());
        let output = tool
            .handle(json!({
                "state": "Help! My payouts have been failing for 3 days.",
                "questions": { "urgent": { "type": "noul", "instructions": "Is it urgent?" } }
            }))
            .await
            .unwrap();
        assert!(output.is_error);
        assert!(output.content.contains("jev_decide"));
    }
}
