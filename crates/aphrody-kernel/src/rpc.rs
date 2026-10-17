// SPDX-License-Identifier: Apache-2.0
//! JSON-RPC dispatch for one connection.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use serde_json::{Map, Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::{
    Event, Kernel, SKILL_TOOL_PREFIX, SubsystemError, ToolDefinition, remote::RemoteSubsystem,
};

pub(crate) const PROTOCOL_VERSION: &str = "2025-06-18";
const INSTRUCTIONS: &str = "Aphrody OS kernel. Tools come from subsystems (shell: Nushell, \
                            aphrody_web: Obscura and configured Aphrody Web MCP, window: the \
                            desktop, and any process registered through \
                            system/register_subsystem). nu_eval returns structured JSON; pass \
                            data through `vars`. skill_<name> tools run composite skills.";

/// One connected peer: its outbound queue, the requests the kernel sent it, and the
/// subsystems it registered (removed when it disconnects).
pub struct Session {
    pub(crate) outbound: mpsc::Sender<Value>,
    pub(crate) pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    pub(crate) next_id: Arc<AtomicU64>,
    pub(crate) registered: Mutex<Vec<String>>,
    pub(crate) subscribed: Arc<AtomicBool>,
    pub(crate) subscription: Mutex<Vec<String>>,
    pub(crate) scope: Mutex<Option<crate::auth::SessionScope>>,
}

impl Session {
    #[must_use]
    pub fn new(outbound: mpsc::Sender<Value>) -> Self {
        Self {
            outbound,
            pending: Arc::default(),
            next_id: Arc::new(AtomicU64::new(1)),
            registered: Mutex::default(),
            subscribed: Arc::default(),
            subscription: Mutex::default(),
            scope: Mutex::default(),
        }
    }

    /// Whether this session receives `event` as a `system/event` notification.
    pub(crate) fn wants(&self, event: &Event) -> bool {
        if !self.subscribed.load(Ordering::Relaxed) {
            return false;
        }
        let prefixes = self
            .subscription
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        prefixes.is_empty()
            || prefixes
                .iter()
                .any(|prefix| event.kind.starts_with(prefix.as_str()))
    }

    /// Deliver a response the peer sent to one of the kernel's requests.
    pub(crate) fn resolve(&self, message: Value) {
        let Some(id) = message.get("id").map(id_key) else {
            return;
        };
        let sender = self
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id);
        if let Some(sender) = sender {
            let _ = sender.send(message);
        }
    }

    pub(crate) fn set_scope(&self, scope: crate::auth::SessionScope) {
        *self
            .scope
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(scope);
    }

    pub(crate) fn scope(&self) -> Option<crate::auth::SessionScope> {
        self.scope
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Fail every outstanding kernel request and unregister this peer's subsystems.
    pub(crate) async fn close(&self, kernel: &Kernel) {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        let names = std::mem::take(
            &mut *self
                .registered
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        for name in names {
            kernel.unregister(&name).await;
        }
    }
}

pub(crate) fn id_key(id: &Value) -> String {
    match id {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

/// The MCP `CallToolResult` for a subsystem outcome. Tool failures are results with
/// `isError`, as MCP specifies, so the model sees them.
pub(crate) fn call_result(outcome: Result<Value, SubsystemError>) -> Value {
    match outcome {
        // Already a CallToolResult (Obscura, remote MCP-native subsystems): pass it through so
        // image and resource content reach the client unchanged.
        Ok(mut value) if is_call_result(&value) => {
            if value.get("isError").is_none() {
                value["isError"] = json!(false);
            }
            value
        }
        Ok(value) => {
            let text = match &value {
                Value::String(text) => text.clone(),
                other => serde_json::to_string_pretty(other).unwrap_or_default(),
            };
            let structured = if value.is_object() {
                value
            } else {
                json!({ "result": value })
            };
            json!({ "content": [{ "type": "text", "text": text }], "structuredContent": structured, "isError": false })
        }
        Err(error) => {
            json!({ "content": [{ "type": "text", "text": error.to_string() }], "isError": true })
        }
    }
}

/// Whether `value` is an MCP `CallToolResult`: a non-empty `content` array of typed parts and
/// no other keys than the result's own.
fn is_call_result(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let typed_parts = object
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|parts| {
            !parts.is_empty()
                && parts
                    .iter()
                    .all(|part| part.get("type").and_then(Value::as_str).is_some())
        });
    typed_parts
        && object.keys().all(|key| {
            matches!(
                key.as_str(),
                "content" | "isError" | "structuredContent" | "_meta"
            )
        })
}

/// The value inside a `CallToolResult` (the inverse of [`call_result`]).
pub(crate) fn from_call_result(result: &Value) -> Result<Value, SubsystemError> {
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(SubsystemError::Failed(text));
    }
    if let Some(structured) = result.get("structuredContent") {
        if let Some(inner) = structured
            .as_object()
            .filter(|map| map.len() == 1)
            .and_then(|map| map.get("result"))
        {
            return Ok(inner.clone());
        }
        return Ok(structured.clone());
    }
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

pub(crate) fn skill_tool(subsystem: &str, skill: &crate::SkillManifest) -> ToolDefinition {
    let properties: Map<String, Value> = skill
        .parameters
        .iter()
        .map(|name| {
            (
                name.clone(),
                json!({ "description": format!("Skill parameter `{name}`.") }),
            )
        })
        .collect();
    ToolDefinition::new(
        format!("{SKILL_TOOL_PREFIX}{}", skill.name),
        format!(
            "Skill ({subsystem}): {} Steps: {}.",
            skill.description,
            skill
                .steps
                .iter()
                .map(|s| s.tool.as_str())
                .collect::<Vec<_>>()
                .join(" -> ")
        ),
        json!({ "type": "object", "properties": properties, "required": skill.parameters }),
    )
}

impl Kernel {
    async fn scope_allows_call(&self, scope: &crate::auth::SessionScope, tool: &str) -> bool {
        if scope.allows_tool(tool) {
            return true;
        }
        let Some(name) = tool.strip_prefix(SKILL_TOOL_PREFIX) else {
            return false;
        };
        self.skills()
            .await
            .into_iter()
            .find(|(_, skill)| skill.name == name)
            .is_some_and(|(_, skill)| skill.steps.iter().all(|step| scope.allows_tool(&step.tool)))
    }

    /// Handle one inbound message. Returns the response for a request, `None` otherwise.
    pub async fn handle(&self, message: Value, session: &Arc<Session>) -> Option<Value> {
        let Some(method) = message
            .get("method")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            // A response to a request the kernel sent (remote tool call).
            if message.get("id").is_some()
                && (message.get("result").is_some() || message.get("error").is_some())
            {
                session.resolve(message);
            }
            return None;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let Some(id) = message.get("id").cloned() else {
            return None; // notifications: initialized, cancelled, ...
        };
        let outcome = self.dispatch(&method, params, session).await;
        Some(match outcome {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => error(id, code, message),
        })
    }

    async fn dispatch(
        &self,
        method: &str,
        params: Value,
        session: &Arc<Session>,
    ) -> Result<Value, (i64, String)> {
        let invalid = |message: String| (-32602, message);
        let forbidden = |message: String| (-32003, message);
        if method != "initialize" && method != "ping" && session.scope().is_none() {
            return Err((
                -32001,
                "initialize with a valid auth token before this request".into(),
            ));
        }
        match method {
            "initialize" => {
                let scope = self
                    .authenticate(crate::auth::token_from_initialize(&params))
                    .ok_or_else(|| (-32001, "invalid or missing authentication token".into()))?;
                let principal = scope.principal.clone();
                session.set_scope(scope);
                Ok(json!({
                    "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
                    "capabilities": {
                        "tools": { "listChanged": true },
                        "experimental": { "aphrody-os": { "skills": true, "events": true, "subsystems": true, "authenticated": self.requires_authentication() } }
                    },
                    "serverInfo": { "name": "aphrody-os", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS,
                    "_meta": { "aphrody-os": { "principal": principal } },
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => {
                let scope = session.scope().expect("authenticated request has a scope");
                let cached = self.mcp_tools().await;
                let mut tools = cached
                    .iter()
                    .filter_map(|tool| {
                        let name = tool.get("name")?.as_str()?;
                        (!name.starts_with(SKILL_TOOL_PREFIX) && scope.allows_tool(name))
                            .then(|| tool.clone())
                    })
                    .collect::<Vec<_>>();
                tools.extend(
                    self.skills()
                        .await
                        .into_iter()
                        .filter_map(|(subsystem, skill)| {
                            skill
                                .steps
                                .iter()
                                .all(|step| scope.allows_tool(&step.tool))
                                .then(|| skill_tool(&subsystem, &skill).to_mcp())
                        }),
                );
                Ok(json!({ "tools": tools }))
            }
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("tools/call requires `name`".into()))?;
                let scope = session.scope().expect("authenticated request has a scope");
                if !self.scope_allows_call(&scope, name).await {
                    return Err(forbidden(format!(
                        "principal `{}` cannot call `{name}`",
                        scope.principal
                    )));
                }
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match self.call(name, arguments).await {
                    Err(SubsystemError::UnknownTool(tool)) => {
                        Err(invalid(format!("unknown tool: {tool}")))
                    }
                    outcome => Ok(call_result(outcome)),
                }
            }
            "a2a/message/send" => {
                let source = params
                    .get("sourceAgent")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let target = match params.get("target") {
                    None => "aphrody-kernel",
                    Some(Value::String(target)) if !target.trim().is_empty() => target.as_str(),
                    _ => return Err(invalid("target must be a non-empty peer name".into())),
                };
                let tool = params
                    .get("tool")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("a2a/message/send requires `tool`".into()))?;
                let scope = session.scope().expect("authenticated request has a scope");
                if !self.scope_allows_call(&scope, tool).await || !scope.publish_events {
                    return Err(forbidden(format!(
                        "principal `{}` cannot send this A2A message",
                        scope.principal
                    )));
                }
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let result = match self.call_target(target, tool, arguments).await {
                    Err(SubsystemError::UnknownTool(name)) => {
                        return Err(invalid(format!("unknown tool: {name}")));
                    }
                    Err(SubsystemError::InvalidArguments(message)) => {
                        return Err(invalid(message));
                    }
                    outcome => call_result(outcome),
                };
                self.bus().publish(crate::Event {
                    source: source.to_owned(),
                    kind: "a2a/message".into(),
                    payload: json!({ "target": target, "tool": tool, "result": result }),
                });
                Ok(json!({ "accepted": true, "target": target, "result": result }))
            }
            "skills/list" => {
                let scope = session.scope().expect("authenticated request has a scope");
                Ok(json!({
                "skills": self.skills().await.into_iter().filter(|(_, skill)| {
                    skill.steps.iter().all(|step| scope.allows_tool(&step.tool))
                }).map(|(subsystem, skill)| {
                    let mut value = serde_json::to_value(skill).unwrap_or_default();
                    value["subsystem"] = json!(subsystem);
                    value
                }).collect::<Vec<_>>()
                }))
            }
            "skills/run" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("skills/run requires `name`".into()))?;
                let scope = session.scope().expect("authenticated request has a scope");
                if let Some((_, skill)) = self
                    .skills()
                    .await
                    .into_iter()
                    .find(|(_, skill)| skill.name == name)
                    && !skill.steps.iter().all(|step| scope.allows_tool(&step.tool))
                {
                    return Err(forbidden(format!(
                        "principal `{}` cannot run `{name}`",
                        scope.principal
                    )));
                }
                let skill_params = params
                    .get("params")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                self.run_skill(name, &skill_params)
                    .await
                    .map_err(|error| (-32000, error.to_string()))
            }
            "system/subsystems" => Ok(json!({ "subsystems": self.subsystems().await })),
            "system/audit_status" => Ok(self.audit_status()),
            "system/subsystem_tools" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("system/subsystem_tools requires `name`".into()))?;
                let tools = self
                    .subsystem_tools(name)
                    .await
                    .ok_or_else(|| invalid(format!("unknown subsystem: {name}")))?;
                let scope = session.scope().expect("authenticated request has a scope");
                Ok(json!({
                    "subsystem": name,
                    "tools": tools.into_iter().filter(|tool| scope.allows_tool(&tool.name)).map(|tool| tool.to_mcp()).collect::<Vec<_>>(),
                }))
            }
            "system/register_subsystem" => {
                let scope = session.scope().expect("authenticated request has a scope");
                if !scope.register_subsystems {
                    return Err(forbidden(format!(
                        "principal `{}` cannot register subsystems",
                        scope.principal
                    )));
                }
                let remote = RemoteSubsystem::from_params(&params, session).map_err(invalid)?;
                let name = remote.name_owned();
                let tools = remote.tool_count();
                self.insert(Arc::new(remote), true)
                    .await
                    .map_err(|error| invalid(error.to_string()))?;
                session
                    .registered
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(name.clone());
                Ok(json!({ "registered": name, "tools": tools }))
            }
            "system/subscribe" => {
                let kinds: Vec<String> = params
                    .get("kinds")
                    .and_then(Value::as_array)
                    .map(|kinds| {
                        kinds
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                *session
                    .subscription
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) = kinds;
                session.subscribed.store(true, Ordering::Relaxed);
                Ok(json!({ "subscribed": true }))
            }
            "system/publish" => {
                let scope = session.scope().expect("authenticated request has a scope");
                if !scope.publish_events {
                    return Err(forbidden(format!(
                        "principal `{}` cannot publish events",
                        scope.principal
                    )));
                }
                let kind = params
                    .get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("system/publish requires `kind`".into()))?;
                let source = session
                    .registered
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "client".into());
                let delivered = self.bus.publish(Event {
                    source,
                    kind: kind.to_owned(),
                    payload: params.get("payload").cloned().unwrap_or(Value::Null),
                });
                Ok(json!({ "delivered": delivered }))
            }
            other => Err((-32601, format!("method not found: {other}"))),
        }
    }
}
