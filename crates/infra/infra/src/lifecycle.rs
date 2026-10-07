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

/// Explicit host aliases always select SSH, including on Linux/WSL.
/// Only the reserved `local` target selects this host's systemd instance.
pub fn is_local_target(target_id: &str) -> bool {
    target_id == "local"
}

pub fn execute_lifecycle(
    root: &Path,
    action: ServiceAction,
    id: Option<&str>,
    target_id: &str,
) -> Result<Vec<ServiceActionResult>> {
    let catalog = load_service_catalog(root)?;

    let selected: Vec<_> = catalog
        .services
        .iter()
        .filter(|s| id.map_or(s.unit.is_some(), |wanted| s.id == wanted))
        .collect();

    if selected.is_empty() {
        bail!("aucun service correspondant à l'identifiant: {}", id.unwrap_or("<tous>"));
    }
    if let Some(service) = selected.iter().find(|s| s.unit.is_none()) {
        bail!("le service {} n'a pas d'unité systemd (servi par nginx)", service.id);
    }

    let is_local = is_local_target(target_id);
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
        let Some(unit) = service.systemd_unit_name() else { continue };

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
    // A unit-less service (served by nginx) has nothing to query: it is left out of the listing and, asked by id,
    // reported as such rather than as a stopped unit.
    let selected: Vec<_> = catalog
        .services
        .iter()
        .filter(|s| id.map_or(s.unit.is_some(), |wanted| s.id == wanted))
        .collect();

    let is_local = is_local_target(target_id);
    let mut statuses = Vec::new();

    for service in selected {
        // Status describes the catalogued unit itself. In particular, a timer
        // must be queried as `*.timer`; mapping it to its associated service
        // reports an active timer as inactive whenever its service is idle.
        let Some(unit) = service.unit.clone() else {
            statuses.push(ServiceStatusResult {
                id: service.id.clone(),
                unit: String::new(),
                active: false,
                state: "no-unit".to_owned(),
                enabled: None,
            });
            continue;
        };
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

#[cfg(test)]
mod tests {
    use super::{ServiceAction, execute_lifecycle, get_service_statuses, is_local_target};

    /// A catalog holding one site nginx serves from disk, which has no unit: none of these calls may reach a host.
    fn unit_less_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().expect("fixture directory");
        std::fs::create_dir_all(root.path().join("tools").join("config")).expect("fixture config directory");
        std::fs::write(
            root.path().join("tools/config/service-catalog.json"),
            r#"{ "schemaVersion": 1, "owner": "infra", "supervisor": "systemd", "proxy": "nginx",
                 "services": [{ "id": "creator", "kind": "nginx-static", "runtime": "none" }] }"#,
        )
        .expect("fixture catalog");
        root
    }

    #[test]
    fn a_unit_less_service_is_reported_not_queried() {
        let root = unit_less_root();
        let statuses = get_service_statuses(root.path(), "vps", Some("creator")).expect("status");
        assert_eq!(statuses.len(), 1);
        assert_eq!((statuses[0].state.as_str(), statuses[0].active), ("no-unit", false));
        assert!(get_service_statuses(root.path(), "vps", None).expect("listing").is_empty());
    }

    #[test]
    fn a_unit_less_service_cannot_be_started_or_stopped() {
        let root = unit_less_root();
        let error = execute_lifecycle(root.path(), ServiceAction::Restart, Some("creator"), "vps")
            .expect_err("no unit to restart");
        assert!(error.to_string().contains("pas d'unité"), "{error}");
        assert!(execute_lifecycle(root.path(), ServiceAction::Restart, None, "vps").is_err());
    }

    #[test]
    fn remote_aliases_never_select_local_systemd() {
        assert!(is_local_target("local"));
        assert!(!is_local_target("vps"));
        assert!(!is_local_target("dbfr"));
    }
}
