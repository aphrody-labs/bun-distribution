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
    #[serde(default)]
    minimum_confidence: Option<f64>,
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
        Self::from_env_with_native_endpoint(None)
    }

    /// Use the product's selected chat endpoint without discovering host processes here.
    ///
    /// # Errors
    /// A present but invalid Jev configuration.
    pub fn from_env_with_native_endpoint(endpoint: Option<&str>) -> Result<Option<Self>, JevError> {
        match JevRouter::from_env_with_native_endpoint(endpoint) {
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
        if let Some(threshold) = args.minimum_confidence {
            aphrody_jev::validate_confidence_threshold(threshold).map_err(|error| {
                ToolError::InvalidArguments { tool: JEV_TOOL.into(), message: error.to_string() }
            })?;
        }
        match self.router.decide(&request).await {
            Ok(decision) => {
                let body =
                    aphrody_jev::decision_output(&request, &decision, args.minimum_confidence)
                        .map_err(|error| ToolError::InvalidArguments {
                            tool: JEV_TOOL.into(),
                            message: error.to_string(),
                        })?;
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
        JsonSchema {
            description: Some("Content to judge: text or structured JSON state.".into()),
            ..JsonSchema::default()
        },
    );
    properties.insert(
        "questions".into(),
        JsonSchema::object(BTreeMap::new(), None, Some(AdditionalProperties::Boolean(true))),
    );
    properties.insert(
        "model".into(),
        JsonSchema::string(Some(format!("Model id, default `{DEFAULT_MODEL}`."))),
    );
    properties.insert(
        "minimum_confidence".into(),
        JsonSchema::number(Some(
            "Optional Choice confidence threshold in [0, 1]; lower confidence abstains.".into(),
        )),
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
    async fn rejects_invalid_confidence_before_calling_the_backend() {
        let tool = JevDecideTool::new(unreachable_router());
        let result = tool.handle(json!({"state":{"fixture":true},"questions":{"q":{"type":"noul","instructions":"Fixture?"}},"minimum_confidence":1.1})).await;
        assert!(matches!(result, Err(ToolError::InvalidArguments { .. })));
    }

    #[tokio::test]
    async fn agent_selection_preserves_structured_state_and_raw_answers() {
        use axum::{Json, Router, routing::post};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().route("/v1/systemone", post(|Json(input): Json<serde_json::Value>| async move {
            assert_eq!(input["state"], json!({"fixture":true}));
            Json(json!({"model":"fixture","usage":null,"answers":{"tool":{"type":"choice","choice":"read","confidence":0.7,"probabilities":{"read":0.7,"search":0.3}}}}))
        }));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let router = JevRouter::new(
            None,
            None,
            Some(Endpoint::local(&base, None).unwrap()),
            RoutingPolicy::default(),
        )
        .unwrap();
        let tool = JevDecideTool::new(Arc::new(router));
        for (threshold, selected) in [(0.8, serde_json::Value::Null), (0.6, json!("read"))] {
            let output = tool.handle(json!({"state":{"fixture":true},"questions":{"tool":{"type":"choice","instructions":"Select a tool","criteria":{"read":"Read","search":"Search"}}},"minimum_confidence":threshold})).await.unwrap();
            assert!(!output.is_error);
            let value: serde_json::Value = serde_json::from_str(&output.content).unwrap();
            assert_eq!(value["selections"]["tool"], selected);
            assert_eq!(value["answers"]["tool"]["confidence"], 0.7);
        }
        task.abort();
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
