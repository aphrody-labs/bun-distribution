// SPDX-License-Identifier: Apache-2.0
//! Systemd unit representation and INI configuration parser.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitType {
    Service,
    Target,
    Socket,
    Timer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActiveState {
    Active,
    Activating,
    Deactivating,
    Failed,
    Inactive,
    Reloading,
}

impl std::fmt::Display for ActiveState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Activating => write!(f, "activating"),
            Self::Deactivating => write!(f, "deactivating"),
            Self::Failed => write!(f, "failed"),
            Self::Inactive => write!(f, "inactive"),
            Self::Reloading => write!(f, "reloading"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RestartPolicy {
    #[default]
    No,
    Always,
    OnFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub name: String,
    pub unit_type: UnitType,
    pub description: String,
    pub exec_start: Option<String>,
    pub exec_stop: Option<String>,
    pub working_dir: Option<String>,
    pub environment: HashMap<String, String>,
    pub after: Vec<String>,
    pub requires: Vec<String>,
    pub wants: Vec<String>,
    pub wanted_by: Vec<String>,
    pub restart: RestartPolicy,
    pub restart_sec: u64,
    pub state: ActiveState,
    pub sub_state: String,
    pub main_pid: Option<u32>,
    pub started_at_usec: Option<u64>,
    pub restart_count: u32,
}

impl Unit {
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        unit_type: UnitType,
        description: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            unit_type,
            description: description.into(),
            exec_start: None,
            exec_stop: None,
            working_dir: None,
            environment: HashMap::new(),
            after: Vec::new(),
            requires: Vec::new(),
            wants: Vec::new(),
            wanted_by: Vec::new(),
            restart: RestartPolicy::default(),
            restart_sec: 1,
            state: ActiveState::Inactive,
            sub_state: "dead".to_owned(),
            main_pid: None,
            started_at_usec: None,
            restart_count: 0,
        }
    }

    /// Parse a systemd INI-style unit file.
    ///
    /// Supports `[Unit]`, `[Service]`, `[Install]` sections.
    pub fn parse_ini(name: &str, content: &str) -> Result<Self, String> {
        let unit_type = if name.ends_with(".target") {
            UnitType::Target
        } else if name.ends_with(".socket") {
            UnitType::Socket
        } else if name.ends_with(".timer") {
            UnitType::Timer
        } else {
            UnitType::Service
        };

        let mut unit = Unit::new(name, unit_type, name);
        let mut current_section = String::new();

        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            if line.starts_with('[') && line.ends_with(']') {
                current_section = line[1..line.len() - 1].trim().to_ascii_lowercase();
                continue;
            }

            if let Some((key, value)) = line.split_once('=') {
                let k = key.trim().to_ascii_lowercase();
                let v = value.trim();

                match current_section.as_str() {
                    "unit" => match k.as_str() {
                        "description" => unit.description = v.to_owned(),
                        "after" => {
                            unit.after.extend(v.split_whitespace().map(ToString::to_string));
                        },
                        "requires" => {
                            unit.requires.extend(v.split_whitespace().map(ToString::to_string));
                        },
                        "wants" => {
                            unit.wants.extend(v.split_whitespace().map(ToString::to_string));
                        },
                        _ => {},
                    },
                    "service" => match k.as_str() {
                        "execstart" => unit.exec_start = Some(v.to_owned()),
                        "execstop" => unit.exec_stop = Some(v.to_owned()),
                        "workingdirectory" => unit.working_dir = Some(v.to_owned()),
                        "restart" => match v.to_ascii_lowercase().as_str() {
                            "always" => unit.restart = RestartPolicy::Always,
                            "on-failure" => unit.restart = RestartPolicy::OnFailure,
                            _ => unit.restart = RestartPolicy::No,
                        },
                        "restartsec" => {
                            if let Ok(sec) = v.parse::<u64>() {
                                unit.restart_sec = sec;
                            }
                        },
                        "environment" => {
                            if let Some((env_k, env_v)) = v.split_once('=') {
                                unit.environment.insert(
                                    env_k.trim().to_owned(),
                                    env_v.trim().trim_matches('"').to_owned(),
                                );
                            }
                        },
                        _ => {},
                    },
                    "install" if k.as_str() == "wantedby" => {
                        unit.wanted_by.extend(v.split_whitespace().map(ToString::to_string));
                    },
                    _ => {},
                }
            }
        }

        Ok(unit)
    }
}
