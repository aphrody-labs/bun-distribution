// SPDX-License-Identifier: Apache-2.0
//! A subsystem served by another process over its kernel connection.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::{
    SkillManifest, SubsystemError, SystemSubsystem, ToolDefinition,
    rpc::{Session, from_call_result},
};

/// Upper bound for one call served by a remote subsystem.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(300);

// A disconnected caller cancels its request task. Remove the outstanding remote
// response slot even when the future is dropped before its timeout fires.
struct PendingCall {
    id: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
}

impl Drop for PendingCall {
    fn drop(&mut self) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
    }
}

pub(crate) struct RemoteSubsystem {
    name: String,
    description: String,
    tools: Vec<ToolDefinition>,
    skills: Vec<SkillManifest>,
    outbound: mpsc::Sender<Value>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
}

impl RemoteSubsystem {
    /// Parse `system/register_subsystem` params. Tool schemas are accepted as `inputSchema`
    /// (MCP) or `input_schema`.
    pub(crate) fn from_params(params: &Value, session: &Session) -> Result<Self, String> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            })
            .ok_or("`name` is required: letters, digits, `_` and `-`")?
            .to_owned();
        let runtime = params
            .get("runtime")
            .and_then(Value::as_str)
            .unwrap_or("external");
        let description = params
            .get("description")
            .and_then(Value::as_str)
            .map_or_else(|| format!("Remote subsystem ({runtime})."), str::to_owned);
        let tools = params
            .get("tools")
            .and_then(Value::as_array)
            .ok_or("`tools` must be an array")?
            .iter()
            .map(|tool| {
                let tool_name = tool
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or("every tool needs a `name`")?;
                let schema = tool
                    .get("inputSchema")
                    .or_else(|| tool.get("input_schema"))
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object" }));
                let mut definition = ToolDefinition::new(
                    tool_name,
                    tool.get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    schema,
                );
                definition.read_only = tool
                    .pointer("/annotations/readOnlyHint")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                Ok(definition)
            })
            .collect::<Result<Vec<_>, &str>>()?;
        let skills = match params.get("skills") {
            None | Some(Value::Null) => Vec::new(),
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|error| format!("`skills`: {error}"))?,
        };
        Ok(Self {
            name,
            description,
            tools,
            skills,
            outbound: session.outbound.clone(),
            pending: Arc::clone(&session.pending),
            next_id: Arc::clone(&session.next_id),
        })
    }

    pub(crate) fn name_owned(&self) -> String {
        self.name.clone()
    }

    pub(crate) fn tool_count(&self) -> usize {
        self.tools.len()
    }
}

#[async_trait]
impl SystemSubsystem for RemoteSubsystem {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        self.tools.clone()
    }

    fn skills(&self) -> Vec<SkillManifest> {
        self.skills.clone()
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        let id = format!(
            "aphrody-os:{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id.clone(), sender);
        let _pending_call = PendingCall {
            id: id.clone(),
            pending: Arc::clone(&self.pending),
        };
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": tool, "arguments": arguments },
        });
        if self.outbound.send(request).await.is_err() {
            return Err(SubsystemError::Unavailable(format!(
                "{} disconnected",
                self.name
            )));
        }
        let response = match tokio::time::timeout(REMOTE_TIMEOUT, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                return Err(SubsystemError::Unavailable(format!(
                    "{} disconnected",
                    self.name
                )));
            }
            Err(_) => {
                return Err(SubsystemError::Failed(format!(
                    "{tool} timed out after {}s",
                    REMOTE_TIMEOUT.as_secs()
                )));
            }
        };
        if let Some(error) = response.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("remote error");
            return Err(SubsystemError::Failed(message.to_owned()));
        }
        from_call_result(response.get("result").unwrap_or(&Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelled_call_releases_pending_response_slot() {
        let (outbound, mut queue) = mpsc::channel(8);
        let session = Session::new(outbound);
        let remote = RemoteSubsystem::from_params(
            &json!({"name":"remote", "tools":[{"name":"slow"}]}),
            &session,
        )
        .unwrap();
        let call = tokio::spawn(async move { remote.call("slow", json!({})).await });
        queue.recv().await.expect("outbound request");
        call.abort();
        let _ = call.await;
        assert!(session.pending.lock().unwrap().is_empty());
    }
}
