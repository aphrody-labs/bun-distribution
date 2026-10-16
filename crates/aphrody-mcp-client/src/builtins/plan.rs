// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Built-in `update_plan` tool for autonomous agents.

use std::sync::Arc;

use aphrody_toolcall::{ToolDefinition, ToolError, ToolExecutor, ToolExposure, ToolOutput};
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use tokio::sync::RwLock;

/// Storage for the active execution plan.
#[derive(Clone, Default)]
pub struct PlanState {
    plan: Arc<RwLock<Option<String>>>,
    current_step: Arc<RwLock<Option<String>>>,
}

impl PlanState {
    /// Create a new empty plan state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Read the latest plan markdown, if any.
    pub async fn current_plan(&self) -> Option<String> {
        self.plan.read().await.clone()
    }

    /// Read the active step, if any.
    pub async fn current_step(&self) -> Option<String> {
        self.current_step.read().await.clone()
    }
}

/// Built-in tool allowing an agent to maintain an explicit plan and checklist.
pub struct UpdatePlanTool {
    definition: ToolDefinition,
    state: PlanState,
}

impl UpdatePlanTool {
    /// Create a new `update_plan` tool instance sharing `state`.
    #[must_use]
    pub fn new(state: PlanState) -> Self {
        let schema = aphrody_toolcall::JsonSchema::object(
            [
                (
                    "plan".to_string(),
                    aphrody_toolcall::JsonSchema::string(Some(
                        "The full markdown task plan with checkboxes: [ ] for open, [x] for done."
                            .to_string(),
                    )),
                ),
                (
                    "current_step".to_string(),
                    aphrody_toolcall::JsonSchema::string(Some(
                        "Summary or name of the step currently being executed.".to_string(),
                    )),
                ),
            ]
            .into_iter()
            .collect(),
            Some(vec!["plan".to_string()]),
            None,
        );

        let definition = ToolDefinition::new(
            "update_plan",
            "Update or record the agent's multi-step execution plan and current progress.",
            schema,
        )
        .with_exposure(ToolExposure::Direct);

        Self { definition, state }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl ToolExecutor for UpdatePlanTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let plan_text = arguments.get("plan").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "update_plan".to_string(),
                message: "missing required argument `plan` (string)".to_string(),
            }
        })?;

        let step_text =
            arguments.get("current_step").and_then(JsonValue::as_str).map(ToOwned::to_owned);

        // Count checklist items:
        let completed =
            plan_text.lines().filter(|l| l.contains("[x]") || l.contains("[X]")).count();
        let pending = plan_text.lines().filter(|l| l.contains("[ ]")).count();

        // Update state:
        *self.state.plan.write().await = Some(plan_text.to_string());
        *self.state.current_step.write().await = step_text.clone();

        let mut reply = format!("Plan updated: {completed} completed, {pending} pending.");
        if let Some(step) = step_text {
            reply.push_str(&format!(" Current step: {step}"));
        }

        Ok(ToolOutput::ok(reply))
    }
}
