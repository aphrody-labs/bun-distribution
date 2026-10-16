// SPDX-License-Identifier: Apache-2.0
//! The contract every Aphrody OS subsystem implements.
//!
//! A subsystem (shell, browser, window manager, a Bun or uv process, ...) contributes three
//! things to the agentic fabric:
//!
//! 1. **Tools** — MCP tools ([`ToolDefinition`]) the kernel publishes and routes to
//!    [`SystemSubsystem::call`].
//! 2. **Skills** — reusable macros ([`SkillManifest`]): an ordered list of tool calls whose
//!    arguments are templated by the skill's parameters.
//! 3. **A sub-agent** — [`SystemSubsystem::run`], a background routine started by the kernel that
//!    reacts to and publishes [`Event`]s on the shared [`AgentBus`].
//!
//! Tool names are global: the kernel refuses a subsystem whose tool name is already taken, so
//! each subsystem prefixes its tools (`nu_eval`, `browser_navigate`, `window_focus`).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::sync::broadcast;

/// A tool published to MCP clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema of the arguments object.
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    /// Whether the tool only reads state (MCP `readOnlyHint`).
    #[serde(default, rename = "readOnly")]
    pub read_only: bool,
}

impl ToolDefinition {
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
            read_only: false,
        }
    }

    #[must_use]
    pub fn read_only(mut self) -> Self {
        self.read_only = true;
        self
    }

    /// The MCP `tools/list` entry for this tool.
    #[must_use]
    pub fn to_mcp(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": { "readOnlyHint": self.read_only },
        })
    }
}

/// One step of a skill: a tool call whose string arguments may contain `{{param}}`
/// placeholders (a skill parameter) or `{{previous}}` (the previous step's result as JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillStep {
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
}

/// A named, parameterised sequence of tool calls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillManifest {
    pub name: String,
    pub description: String,
    /// Parameter names; each must be supplied when the skill runs.
    #[serde(default)]
    pub parameters: Vec<String>,
    pub steps: Vec<SkillStep>,
}

impl SkillManifest {
    /// Arguments of `step` with every placeholder replaced. A string that is exactly one
    /// placeholder takes the parameter's JSON value; an embedded placeholder is replaced by
    /// its text form. Unknown placeholders are an error, so a typo never reaches a tool.
    ///
    /// # Errors
    /// [`SubsystemError::InvalidArguments`] for a missing parameter or unknown placeholder.
    pub fn render_step(
        &self,
        step: &SkillStep,
        params: &Map<String, Value>,
        previous: Option<&Value>,
    ) -> Result<Value, SubsystemError> {
        for required in &self.parameters {
            if !params.contains_key(required) {
                return Err(SubsystemError::InvalidArguments(format!(
                    "skill {} requires parameter `{required}`",
                    self.name
                )));
            }
        }
        render(&step.arguments, params, previous)
    }
}

fn lookup(
    name: &str,
    params: &Map<String, Value>,
    previous: Option<&Value>,
) -> Result<Value, SubsystemError> {
    if name == "previous" {
        return previous.cloned().ok_or_else(|| {
            SubsystemError::InvalidArguments("`{{previous}}` used in the first step".into())
        });
    }
    params.get(name).cloned().ok_or_else(|| {
        SubsystemError::InvalidArguments(format!("unknown placeholder `{{{{{name}}}}}`"))
    })
}

fn render(
    template: &Value,
    params: &Map<String, Value>,
    previous: Option<&Value>,
) -> Result<Value, SubsystemError> {
    Ok(match template {
        Value::String(text) => {
            let trimmed = text.trim();
            if let Some(name) = trimmed
                .strip_prefix("{{")
                .and_then(|t| t.strip_suffix("}}"))
                && !name.contains("{{")
                && trimmed.len() == text.len()
            {
                return lookup(name.trim(), params, previous);
            }
            let mut out = String::with_capacity(text.len());
            let mut rest = text.as_str();
            while let Some(start) = rest.find("{{") {
                out.push_str(&rest[..start]);
                let after = &rest[start + 2..];
                let end = after.find("}}").ok_or_else(|| {
                    SubsystemError::InvalidArguments(format!("unclosed placeholder in `{text}`"))
                })?;
                match lookup(after[..end].trim(), params, previous)? {
                    Value::String(value) => out.push_str(&value),
                    other => out.push_str(&other.to_string()),
                }
                rest = &after[end + 2..];
            }
            out.push_str(rest);
            Value::String(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| render(item, params, previous))
                .collect::<Result<_, _>>()?,
        ),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| Ok((key.clone(), render(value, params, previous)?)))
                .collect::<Result<_, SubsystemError>>()?,
        ),
        other => other.clone(),
    })
}

/// Something that happened in a subsystem, broadcast to every sub-agent and subscriber.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// Subsystem that published the event.
    pub source: String,
    /// Event kind, such as `window/focused` or `shell/eval_failed`.
    pub kind: String,
    #[serde(default)]
    pub payload: Value,
}

/// The shared event bus. Cloning shares the channel.
#[derive(Debug, Clone)]
pub struct AgentBus {
    sender: broadcast::Sender<Event>,
}

impl AgentBus {
    /// A bus that keeps up to `capacity` undelivered events per subscriber.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.max(1));
        Self { sender }
    }

    /// Publish an event; returns how many subscribers received it.
    pub fn publish(&self, event: Event) -> usize {
        self.sender.send(event).unwrap_or(0)
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }
}

impl Default for AgentBus {
    fn default() -> Self {
        Self::new(1024)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SubsystemError {
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("invalid arguments: {0}")]
    InvalidArguments(String),
    #[error("{0}")]
    Failed(String),
    #[error("subsystem unavailable: {0}")]
    Unavailable(String),
}

/// A pluggable part of the OS exposed to agents.
#[async_trait]
pub trait SystemSubsystem: Send + Sync {
    /// Unique subsystem name (`shell`, `browser`, `window`, ...).
    fn name(&self) -> &str;

    /// One sentence describing what the subsystem controls.
    fn description(&self) -> &str;

    /// The tools this subsystem serves.
    fn tools(&self) -> Vec<ToolDefinition>;

    /// Execute one of [`Self::tools`].
    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError>;

    /// Composite actions built from tools (of any subsystem).
    fn skills(&self) -> Vec<SkillManifest> {
        Vec::new()
    }

    /// The sub-agent: a routine started once by the kernel. Subsystems without a background
    /// routine keep this default, which returns immediately.
    async fn run(&self, bus: AgentBus) -> Result<(), SubsystemError> {
        let _ = bus;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill() -> SkillManifest {
        SkillManifest {
            name: "largest".into(),
            description: "d".into(),
            parameters: vec!["path".into(), "count".into()],
            steps: vec![SkillStep {
                tool: "nu_eval".into(),
                arguments: json!({"code": "ls {{path}} | first {{count}}", "vars": {"path": "{{path}}", "n": "{{count}}"}}),
            }],
        }
    }

    #[test]
    fn whole_placeholder_keeps_json_type_and_embedded_one_is_text() {
        let params: Map<String, Value> =
            serde_json::from_value(json!({"path": "C:/src", "count": 5})).expect("params");
        let rendered = skill()
            .render_step(&skill().steps[0], &params, None)
            .expect("render");
        assert_eq!(
            rendered,
            json!({"code": "ls C:/src | first 5", "vars": {"path": "C:/src", "n": 5}})
        );
    }

    #[test]
    fn missing_parameter_and_unknown_placeholder_are_rejected() {
        let only_path: Map<String, Value> =
            serde_json::from_value(json!({"path": "x"})).expect("params");
        assert!(
            skill()
                .render_step(&skill().steps[0], &only_path, None)
                .is_err()
        );
        let step = SkillStep {
            tool: "t".into(),
            arguments: json!({"a": "{{nope}}"}),
        };
        let all: Map<String, Value> =
            serde_json::from_value(json!({"path": "x", "count": 1})).expect("params");
        assert!(skill().render_step(&step, &all, None).is_err());
    }

    #[test]
    fn previous_result_is_available_after_the_first_step() {
        let step = SkillStep {
            tool: "t".into(),
            arguments: json!({"input": "{{previous}}"}),
        };
        let all: Map<String, Value> =
            serde_json::from_value(json!({"path": "x", "count": 1})).expect("params");
        let rendered = skill()
            .render_step(&step, &all, Some(&json!([1, 2])))
            .expect("render");
        assert_eq!(rendered, json!({"input": [1, 2]}));
    }

    #[tokio::test]
    async fn bus_delivers_to_every_subscriber() {
        let bus = AgentBus::new(8);
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        let event = Event {
            source: "shell".into(),
            kind: "k".into(),
            payload: json!(1),
        };
        assert_eq!(bus.publish(event.clone()), 2);
        assert_eq!(a.recv().await.expect("a"), event);
        assert_eq!(b.recv().await.expect("b"), event);
    }
}
