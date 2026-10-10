// SPDX-License-Identifier: Apache-2.0
//! Caller-owned tools integrated into the canonical runtime. Independent
//! implementation from behavior observed in Jan 14a7206 host_tools/rpc.

use aphrody_agent_proto::{Event, EventMsg};
use aphrody_toolcall::{JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolOutput};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::oneshot;

use crate::AppServerError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Declaration {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "empty_schema")]
    parameters: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    capability: Option<Capability>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Capability {
    Read,
    Actuator,
}

fn empty_schema() -> Value {
    json!({"type":"object","properties":{},"additionalProperties":false})
}

#[derive(Debug, Default)]
struct State {
    pending: BTreeMap<String, Pending>,
    notices: VecDeque<Value>,
}

#[derive(Debug)]
struct Pending {
    sender: oneshot::Sender<ToolOutput>,
    permission: bool,
}

/// Per-thread callback registry. No filesystem, credential, or model store.
#[derive(Debug, Clone)]
pub(crate) struct HostTools {
    thread_id: String,
    declarations: Vec<Declaration>,
    state: Arc<Mutex<State>>,
    host_owns_gate: bool,
}

impl HostTools {
    pub(crate) fn declare(thread_id: &str, value: Option<&Value>) -> Result<Self, AppServerError> {
        let declarations: Vec<Declaration> = match value {
            None | Some(Value::Null) => Vec::new(),
            Some(value) => serde_json::from_value(value.clone())?,
        };
        if declarations.len() > 128 {
            return Err(AppServerError::InvalidRequest(
                "host tools exceed 128 declarations".into(),
            ));
        }
        let tools = Self {
            thread_id: thread_id.into(),
            declarations,
            state: Arc::new(Mutex::new(State::default())),
            host_owns_gate: false,
        };
        let mut names = std::collections::BTreeSet::new();
        for declaration in &tools.declarations {
            if declaration.name.trim().is_empty()
                || declaration.name.len() > 4096
                || !names.insert(&declaration.name)
            {
                return Err(AppServerError::InvalidRequest(
                    "host tool name is empty, duplicated, or oversized".into(),
                ));
            }
            if !declaration.parameters.is_object()
                || declaration.parameters.to_string().len() > 65536
            {
                return Err(AppServerError::InvalidRequest(
                    "host tool schema must be an object of at most 64 KiB".into(),
                ));
            }
            jsonschema::validator_for(&declaration.parameters).map_err(|_| {
                AppServerError::InvalidRequest("invalid host tool JSON Schema".into())
            })?;
            let _: JsonSchema =
                serde_json::from_value(declaration.parameters.clone()).map_err(|_| {
                    AppServerError::InvalidRequest(
                        "host tool schema is not representable by the canonical tool contract"
                            .into(),
                    )
                })?;
        }
        Ok(tools)
    }

    pub(crate) fn with_host_permission(mut self, owned: bool) -> Self {
        self.host_owns_gate = owned;
        self
    }

    pub(crate) fn host_owns_gate(&self) -> bool {
        self.host_owns_gate
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.declarations.is_empty()
    }

    pub(crate) fn executors(&self) -> Result<Vec<Arc<dyn ToolExecutor>>, AppServerError> {
        self.declarations
            .iter()
            .map(|declaration| {
                let schema = serde_json::from_value(declaration.parameters.clone())?;
                Ok(Arc::new(HostExecutor {
                    definition: ToolDefinition::new(
                        wire_name(&declaration.name),
                        &declaration.description,
                        schema,
                    ),
                    declaration: declaration.clone(),
                    tools: self.clone(),
                }) as Arc<dyn ToolExecutor>)
            })
            .collect()
    }

    pub(crate) fn view(&self) -> Result<Value, AppServerError> {
        let specs: Vec<_> =
            self.executors()?.into_iter().map(|tool| tool.definition().clone()).collect();
        Ok(json!({"tools":self.declarations,"toolSpecs":specs}))
    }

    pub(crate) fn drain(&self) -> Vec<Value> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .notices
            .drain(..)
            .collect()
    }

    pub(crate) fn contains(&self, request_id: &str) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .contains_key(request_id)
    }

    pub(crate) fn respond(&self, request_id: &str, value: &Value) -> Result<(), AppServerError> {
        if value.to_string().len() > 1_048_576 {
            return Err(AppServerError::InvalidRequest("host tool result exceeds 1 MiB".into()));
        }
        let permission = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .get(request_id)
            .map(|pending| pending.permission)
            .ok_or_else(|| {
                AppServerError::InvalidRequest("host request is no longer pending".into())
            })?;
        let output: ToolOutput = if permission {
            match value.get("decision").and_then(Value::as_str) {
                Some("allow") => ToolOutput::ok("allowed"),
                Some("deny") => ToolOutput::error("host permission denied"),
                _ => {
                    return Err(AppServerError::InvalidRequest(
                        "permission decision must be allow or deny".into(),
                    ));
                },
            }
        } else {
            serde_json::from_value(json!({
                "content":value.get("content").and_then(Value::as_str).ok_or_else(|| AppServerError::InvalidRequest("host result content must be text".into()))?,
                "is_error": value.get("isError").or_else(|| value.get("is_error")).and_then(Value::as_bool).unwrap_or(false),
                "images": value.get("images").cloned().unwrap_or_else(|| json!([]))
            }))?
        };
        let sender = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .remove(request_id)
            .ok_or_else(|| {
                AppServerError::InvalidRequest("host request is no longer pending".into())
            })?;
        sender
            .sender
            .send(output)
            .map_err(|_| AppServerError::InvalidRequest("host call was cancelled".into()))
    }

    pub(crate) fn cancel_all(&self) {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        for (request_id, pending) in std::mem::take(&mut state.pending) {
            let _ = pending.sender.send(ToolOutput::error("host call cancelled"));
            state.notices.push_back(json!({"jsonrpc":"2.0","method":"tool/cancelled","params":{"threadId":self.thread_id,"requestId":request_id}}));
        }
    }
}

fn wire_name(name: &str) -> String {
    if name.len() <= 58 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return format!("host__{name}");
    }
    let hash = name
        .bytes()
        .fold(0xcbf29ce484222325_u64, |hash, b| (hash ^ u64::from(b)).wrapping_mul(0x100000001b3));
    let stem: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    format!("host__{stem}_{hash:016x}")
}

struct PendingGuard {
    tools: HostTools,
    request_id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut state = self.tools.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.pending.remove(&self.request_id).is_some() {
            state.notices.push_back(json!({"jsonrpc":"2.0","method":"tool/cancelled","params":{"threadId":self.tools.thread_id,"requestId":self.request_id}}));
        }
    }
}

struct HostExecutor {
    definition: ToolDefinition,
    declaration: Declaration,
    tools: HostTools,
}

impl HostExecutor {
    async fn exchange(&self, method: &str, arguments: Value, permission: bool) -> ToolOutput {
        let request_id = format!("host-{}", Event::new(EventMsg::TurnStarted).id);
        let (sender, receiver) = oneshot::channel();
        {
            let mut state =
                self.tools.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.pending.len() >= 64 || state.notices.len() >= 128 {
                return ToolOutput::error("host callback queue is full");
            }
            state.pending.insert(request_id.clone(), Pending { sender, permission });
            state.notices.push_back(json!({"jsonrpc":"2.0","id":request_id,"method":method,"params":{"threadId":self.tools.thread_id,"requestId":request_id,"name":self.declaration.name,"arguments":arguments}}));
        }
        let _guard = PendingGuard { tools: self.tools.clone(), request_id };
        match tokio::time::timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(output)) => output,
            Ok(Err(_)) => ToolOutput::error("host disconnected"),
            Err(_) => ToolOutput::error("host callback timed out"),
        }
    }
}

#[async_trait]
impl ToolExecutor for HostExecutor {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let validator = jsonschema::validator_for(&self.declaration.parameters).map_err(|_| {
            ToolError::Execution {
                tool: self.definition.name.clone(),
                message: "invalid host schema".into(),
            }
        })?;
        if !validator.is_valid(&arguments) {
            return Ok(ToolOutput::error("host arguments do not match declared JSON Schema"));
        }
        if !self.tools.host_owns_gate
            && !matches!(self.declaration.capability, Some(Capability::Read))
        {
            let approval = self.exchange("permission/request", arguments.clone(), true).await;
            if approval.is_error {
                return Ok(approval);
            }
        }
        Ok(self.exchange("tool/call", arguments, false).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn callback_is_correlated_single_use_and_schema_validated() {
        let tools=HostTools::declare("fixture-thread",Some(&json!([{"name":"robot.move","parameters":{"type":"object","required":["x"],"properties":{"x":{"type":"integer","minimum":1}},"additionalProperties":false}}]))).unwrap();
        let tools = tools.with_host_permission(true);
        let executor = tools.executors().unwrap().remove(0);
        assert!(executor.handle(json!({"x":0})).await.unwrap().is_error);
        assert!(tools.drain().is_empty());
        let task = tokio::spawn(async move { executor.handle(json!({"x":2})).await.unwrap() });
        tokio::task::yield_now().await;
        let notice = tools.drain().remove(0);
        assert_eq!(notice["method"], "tool/call");
        assert_eq!(notice["params"]["name"], "robot.move");
        let id = notice["id"].as_str().unwrap();
        tools.respond(id, &json!({"content":"moved"})).unwrap();
        assert!(tools.respond(id, &json!({"content":"again"})).is_err());
        assert_eq!(task.await.unwrap().content, "moved");
    }
    #[tokio::test]
    async fn cancellation_releases_waiter_and_rejects_late_result() {
        let tools = HostTools::declare("thread", Some(&json!([{"name":"read"}])))
            .unwrap()
            .with_host_permission(true);
        let executor = tools.executors().unwrap().remove(0);
        let task = tokio::spawn(async move { executor.handle(json!({})).await.unwrap() });
        tokio::task::yield_now().await;
        let notice = tools.drain().remove(0);
        tools.cancel_all();
        assert!(task.await.unwrap().is_error);
        assert_eq!(tools.drain()[0]["method"], "tool/cancelled");
        assert!(!tools.contains(notice["id"].as_str().unwrap()));
    }

    #[tokio::test]
    async fn opaque_tool_requires_explicit_permission_and_deny_never_calls_host() {
        let tools = HostTools::declare(
            "thread",
            Some(&json!([{"name":"actuator","capability":"actuator"}])),
        )
        .unwrap();
        let executor = tools.executors().unwrap().remove(0);
        let task = tokio::spawn(async move { executor.handle(json!({})).await.unwrap() });
        tokio::task::yield_now().await;
        let notice = tools.drain().remove(0);
        assert_eq!(notice["method"], "permission/request");
        tools.respond(notice["id"].as_str().unwrap(), &json!({"decision":"deny"})).unwrap();
        assert!(task.await.unwrap().is_error);
        assert!(tools.drain().is_empty(), "denied actuator must not be called");
    }
}
