// SPDX-License-Identifier: Apache-2.0
//! `SystemSubsystem` implementation for systemd in the Aphrody OS Kernel.

use std::sync::Arc;

use aphrody_subsystem::{
    AgentBus, SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::systemd::{
    journal::{Journal, LogLevel},
    manager::ServiceManager,
};

pub struct SystemdSubsystem {
    manager: Arc<ServiceManager>,
}

impl Default for SystemdSubsystem {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemdSubsystem {
    #[must_use]
    pub fn new() -> Self {
        let journal = Arc::new(Journal::default());
        let manager = Arc::new(ServiceManager::new(journal));
        Self { manager }
    }

    #[must_use]
    pub fn with_manager(manager: Arc<ServiceManager>) -> Self {
        Self { manager }
    }

    #[must_use]
    pub fn manager(&self) -> Arc<ServiceManager> {
        Arc::clone(&self.manager)
    }
}

#[async_trait]
impl SystemSubsystem for SystemdSubsystem {
    fn name(&self) -> &str {
        "systemd"
    }

    fn description(&self) -> &str {
        "Rust-native systemd init, service manager, unit supervisor and journald subsystem"
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "systemd_list_units",
                "List all active and configured systemd units, targets and services",
                json!({
                    "type": "object",
                    "properties": {}
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "systemd_unit_status",
                "Get detailed status, state, PID, uptime, and dependencies of a specific systemd unit",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name, e.g. aphrody-kernel.service" }
                    },
                    "required": ["name"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "systemd_start_unit",
                "Start or activate a systemd service or target",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name to start" }
                    },
                    "required": ["name"]
                }),
            ),
            ToolDefinition::new(
                "systemd_stop_unit",
                "Stop or deactivate a systemd service or target",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name to stop" }
                    },
                    "required": ["name"]
                }),
            ),
            ToolDefinition::new(
                "systemd_restart_unit",
                "Restart a systemd service",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name to restart" }
                    },
                    "required": ["name"]
                }),
            ),
            ToolDefinition::new(
                "systemd_reload_unit",
                "Reload configuration for a systemd service",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name to reload" }
                    },
                    "required": ["name"]
                }),
            ),
            ToolDefinition::new(
                "systemd_journal_query",
                "Query log messages from systemd journald with unit, severity level, and limit filtering",
                json!({
                    "type": "object",
                    "properties": {
                        "unit": { "type": "string", "description": "Optional unit name to filter logs" },
                        "min_level": { "type": "string", "description": "Max log level filter: emerg, alert, crit, err, warning, notice, info, debug" },
                        "since_usec": { "type": "integer", "description": "Microseconds timestamp cutoff" },
                        "limit": { "type": "integer", "description": "Maximum number of log entries (default: 50)" }
                    }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "systemd_load_unit_file",
                "Load and register a new systemd unit from INI text content",
                json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "Unit name (e.g. custom.service)" },
                        "content": { "type": "string", "description": "INI-style unit file content" }
                    },
                    "required": ["name", "content"]
                }),
            ),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "systemd_list_units" => {
                let units = self.manager.list_units();
                Ok(json!({ "units": units, "total": units.len() }))
            }
            "systemd_unit_status" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                let status = self
                    .manager
                    .get_unit_status(name)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(status))
            }
            "systemd_start_unit" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                self.manager
                    .start_unit(name)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "success": true, "unit": name, "action": "started" }))
            }
            "systemd_stop_unit" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                self.manager
                    .stop_unit(name)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "success": true, "unit": name, "action": "stopped" }))
            }
            "systemd_restart_unit" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                self.manager
                    .restart_unit(name)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "success": true, "unit": name, "action": "restarted" }))
            }
            "systemd_reload_unit" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                self.manager
                    .reload_unit(name)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "success": true, "unit": name, "action": "reloaded" }))
            }
            "systemd_journal_query" => {
                let unit = arguments.get("unit").and_then(Value::as_str);
                let level_str = arguments.get("min_level").and_then(Value::as_str);
                let level = match level_str {
                    Some("emerg") => Some(LogLevel::Emerg),
                    Some("alert") => Some(LogLevel::Alert),
                    Some("crit") => Some(LogLevel::Crit),
                    Some("err") => Some(LogLevel::Err),
                    Some("warning") => Some(LogLevel::Warning),
                    Some("notice") => Some(LogLevel::Notice),
                    Some("info") => Some(LogLevel::Info),
                    Some("debug") => Some(LogLevel::Debug),
                    _ => None,
                };
                let since = arguments.get("since_usec").and_then(Value::as_u64);
                let limit = arguments
                    .get("limit")
                    .and_then(Value::as_u64)
                    .map(|l| l as usize)
                    .unwrap_or(50);

                let entries = self.manager.journal().query(unit, level, since, limit);
                Ok(json!({ "entries": entries, "count": entries.len() }))
            }
            "systemd_load_unit_file" => {
                let name = arguments
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `name`".into())
                    })?;
                let content = arguments
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        SubsystemError::InvalidArguments("missing unit `content`".into())
                    })?;
                self.manager
                    .load_unit_ini(name, content)
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "success": true, "unit": name, "action": "loaded" }))
            }
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "systemd_inspect".into(),
            description: "Check status of systemd units and query recent system warnings or errors"
                .into(),
            parameters: vec![],
            steps: vec![
                SkillStep {
                    tool: "systemd_list_units".into(),
                    arguments: json!({}),
                },
                SkillStep {
                    tool: "systemd_journal_query".into(),
                    arguments: json!({ "min_level": "warning", "limit": 20 }),
                },
            ],
        }]
    }

    async fn run(&self, bus: AgentBus) -> Result<(), SubsystemError> {
        let mut sub = bus.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = sub.recv().await {
                if event.kind == "systemd/unit_failed" {
                    log::warn!("Systemd event: unit failed: {:?}", event.payload);
                }
            }
        });
        Ok(())
    }
}
