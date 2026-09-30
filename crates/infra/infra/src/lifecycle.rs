// SPDX-License-Identifier: Apache-2.0
//! Service lifecycle management for Aphrody infrastructure.
//!
//! Controls systemd units locally or remotely through transparent SSH dispatch.

use crate::catalog::load_service_catalog;
use anyhow::{Context, Result, bail};
use clap::ValueEnum;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceAction {
    Catalog,
    Status,
    Start,
    Stop,
    Restart,
    Enable,
    Disable,
    Journal,
    Health,
    Prewarm,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatusResult {
    pub id: String,
    pub unit: String,
    pub active: bool,
    pub state: String,
    pub enabled: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceActionResult {
    pub id: String,
    pub unit: String,
    pub action: String,
    pub success: bool,
    pub message: Option<String>,
}

pub fn execute_lifecycle(
    root: &Path,
    action: ServiceAction,
    id: Option<&str>,
    target_id: &str,
) -> Result<Vec<ServiceActionResult>> {
    let catalog = load_service_catalog(root)?;

    let selected: Vec<_> =
        catalog.services.iter().filter(|s| id.is_none_or(|wanted| s.id == wanted)).collect();

    if selected.is_empty() {
        bail!("aucun service correspondant à l'identifiant: {}", id.unwrap_or("<tous>"));
    }

    let is_local = target_id == "local" || (cfg!(target_os = "linux") && target_id == "vps");
    let cmd_str = match action {
        ServiceAction::Catalog => bail!("action catalog traitée en amont"),
        ServiceAction::Status => "is-active",
        ServiceAction::Start => "start",
        ServiceAction::Stop => "stop",
        ServiceAction::Restart => "restart",
        ServiceAction::Enable => "enable",
        ServiceAction::Disable => "disable",
        ServiceAction::Journal => "journal",
        ServiceAction::Health | ServiceAction::Prewarm => {
            bail!("action traitée par le contrôleur Infra")
        },
    };

    let mut results = Vec::new();

    for service in selected {
        let sid = &service.id;
        let unit = service.systemd_unit_name();

        if action == ServiceAction::Journal {
            let out = if is_local {
                Command::new("journalctl").args(["-u", &unit, "-n", "30", "--no-pager"]).output()?
            } else {
                Command::new("ssh")
                    .args([
                        "-o",
                        "BatchMode=yes",
                        target_id,
                        &format!("journalctl -u {} -n 30 --no-pager", unit),
                    ])
                    .output()?
            };
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            results.push(ServiceActionResult {
                id: sid.clone(),
                unit: unit.clone(),
                action: "journal".to_string(),
                success: out.status.success(),
                message: Some(text),
            });
            continue;
        }

        let (code, output) = if is_local {
            let out = Command::new("systemctl")
                .args([cmd_str, &unit])
                .output()
                .with_context(|| format!("exécution de systemctl {cmd_str} {unit}"))?;
            (
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            )
        } else {
            let out = Command::new("ssh")
                .args([
                    "-o",
                    "BatchMode=yes",
                    target_id,
                    &format!("systemctl {} {}", cmd_str, unit),
                ])
                .output()
                .with_context(|| format!("ssh {target_id} systemctl {cmd_str} {unit}"))?;
            (
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            )
        };

        let success = code == 0;
        results.push(ServiceActionResult {
            id: sid.clone(),
            unit: unit.clone(),
            action: cmd_str.to_string(),
            success,
            message: if output.is_empty() {
                if success { Some("ok".to_string()) } else { Some("failed".to_string()) }
            } else {
                Some(output)
            },
        });
    }

    Ok(results)
}

pub fn get_service_statuses(
    root: &Path,
    target_id: &str,
    id: Option<&str>,
) -> Result<Vec<ServiceStatusResult>> {
    let catalog = load_service_catalog(root)?;
    let selected: Vec<_> =
        catalog.services.iter().filter(|s| id.is_none_or(|wanted| s.id == wanted)).collect();

    let is_local = target_id == "local" || (cfg!(target_os = "linux") && target_id == "vps");
    let mut statuses = Vec::new();

    for service in selected {
        let unit = service.systemd_unit_name();
        let (active, state) = if is_local {
            let out = Command::new("systemctl").args(["is-active", &unit]).output().ok();
            match out {
                Some(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    (o.status.success(), if s.is_empty() { "inactive".to_string() } else { s })
                },
                None => (false, "unknown".to_string()),
            }
        } else {
            let out = Command::new("ssh")
                .args(["-o", "BatchMode=yes", target_id, &format!("systemctl is-active {}", unit)])
                .output()
                .ok();
            match out {
                Some(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    (o.status.success(), if s.is_empty() { "inactive".to_string() } else { s })
                },
                None => (false, "unknown".to_string()),
            }
        };

        statuses.push(ServiceStatusResult {
            id: service.id.clone(),
            unit,
            active,
            state,
            enabled: None,
        });
    }

    Ok(statuses)
}
