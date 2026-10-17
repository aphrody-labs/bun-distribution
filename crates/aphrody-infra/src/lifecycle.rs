// SPDX-License-Identifier: Apache-2.0
//! Service lifecycle management for Aphrody infrastructure.
//!
//! Controls systemd units or Docker containers locally or remotely through transparent SSH dispatch.

use crate::catalog::load_service_catalog;
use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
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

/// Argv run on the target for a container-backed service; `None` when the action has no Docker form.
fn container_command(action: ServiceAction, container: &str) -> Option<Vec<String>> {
    let args: &[&str] = match action {
        ServiceAction::Status => &[
            "inspect",
            "--format",
            "{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}",
        ],
        ServiceAction::Start => &["start"],
        ServiceAction::Stop => &["stop"],
        ServiceAction::Restart => &["restart"],
        ServiceAction::Journal => &["logs", "--tail", "30"],
        _ => return None,
    };
    let mut argv = vec!["docker".to_owned()];
    argv.extend(args.iter().map(|a| (*a).to_owned()));
    argv.push(container.to_owned());
    Some(argv)
}

pub(crate) fn run_on_target(
    target_id: &str,
    argv: &[String],
) -> std::io::Result<std::process::Output> {
    if is_local_target(target_id) {
        Command::new(&argv[0]).no_window().args(&argv[1..]).output()
    } else {
        let remote = argv
            .iter()
            .map(|a| format!("'{}'", a.replace('\'', r"'\''")))
            .collect::<Vec<_>>()
            .join(" ");
        Command::new("ssh")
            .no_window()
            .args(["-o", "BatchMode=yes", target_id, &remote])
            .output()
    }
}

/// Healthy, or running without a health check.
fn container_state_is_up(state: &str) -> bool {
    state == "running" || state == "running/healthy"
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
        .filter(|s| {
            id.map_or(
                s.is_supervised() && !s.is_retired() && s.runs_on(target_id),
                |wanted| s.id == wanted,
            )
        })
        .collect();

    if selected.is_empty() {
        bail!(
            "aucun service correspondant à l'identifiant: {}",
            id.unwrap_or("<tous>")
        );
    }
    if let Some(service) = selected.iter().find(|s| !s.is_supervised()) {
        bail!(
            "le service {} n'a pas d'unité systemd (servi par nginx)",
            service.id
        );
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
        }
    };

    let mut results = Vec::new();

    for service in selected {
        let sid = &service.id;
        if let Some(container) = service.container.as_deref() {
            let Some(argv) = container_command(action, container) else {
                bail!("{sid}: action {cmd_str} sans équivalent pour le conteneur {container}");
            };
            let out = run_on_target(target_id, &argv)
                .with_context(|| format!("{target_id}: {}", argv.join(" ")))?;
            let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if action == ServiceAction::Journal {
                text.push_str(String::from_utf8_lossy(&out.stderr).trim_end());
            }
            let success = out.status.success()
                && (action != ServiceAction::Status || container_state_is_up(&text));
            results.push(ServiceActionResult {
                id: sid.clone(),
                unit: format!("docker:{container}"),
                action: cmd_str.to_string(),
                success,
                message: Some(if text.is_empty() {
                    if success { "ok" } else { "failed" }.into()
                } else {
                    text
                }),
            });
            continue;
        }
        let Some(unit) = service.systemd_unit_name() else {
            continue;
        };

        if action == ServiceAction::Journal {
            let out = if is_local {
                Command::new("journalctl")
                    .no_window()
                    .args(["-u", &unit, "-n", "30", "--no-pager"])
                    .output()?
            } else {
                Command::new("ssh")
                    .no_window()
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
                .no_window()
                .args([cmd_str, &unit])
                .output()
                .with_context(|| format!("exécution de systemctl {cmd_str} {unit}"))?;
            (
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stdout).trim().to_string(),
            )
        } else {
            let out = Command::new("ssh")
                .no_window()
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
                if success {
                    Some("ok".to_string())
                } else {
                    Some("failed".to_string())
                }
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
        .filter(|s| {
            id.map_or(
                s.is_supervised() && !s.is_retired() && s.runs_on(target_id),
                |wanted| s.id == wanted,
            )
        })
        .collect();

    let is_local = is_local_target(target_id);
    let mut statuses = Vec::new();

    for service in selected {
        if let Some(container) = service.container.as_deref() {
            let argv = container_command(ServiceAction::Status, container)
                .expect("status has a docker form");
            let (active, state) = match run_on_target(target_id, &argv) {
                Ok(o) if o.status.success() => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    (container_state_is_up(&s), s)
                }
                Ok(_) => (false, "absent".to_string()),
                Err(_) => (false, "unknown".to_string()),
            };
            statuses.push(ServiceStatusResult {
                id: service.id.clone(),
                unit: format!("docker:{container}"),
                active,
                state,
                enabled: None,
            });
            continue;
        }
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
            let out = Command::new("systemctl")
                .no_window()
                .args(["is-active", &unit])
                .output()
                .ok();
            match out {
                Some(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    (
                        o.status.success(),
                        if s.is_empty() {
                            "inactive".to_string()
                        } else {
                            s
                        },
                    )
                }
                None => (false, "unknown".to_string()),
            }
        } else {
            let out = Command::new("ssh")
                .no_window()
                .args([
                    "-o",
                    "BatchMode=yes",
                    target_id,
                    &format!("systemctl is-active {}", unit),
                ])
                .output()
                .ok();
            match out {
                Some(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    (
                        o.status.success(),
                        if s.is_empty() {
                            "inactive".to_string()
                        } else {
                            s
                        },
                    )
                }
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
    use super::{
        ServiceAction, container_command, container_state_is_up, execute_lifecycle,
        get_service_statuses, is_local_target,
    };

    /// A catalog holding one site nginx serves from disk, which has no unit: none of these calls may reach a host.
    fn unit_less_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().expect("fixture directory");
        std::fs::create_dir_all(root.path().join("tools").join("config"))
            .expect("fixture config directory");
        std::fs::write(
            root.path().join("infra/config/service-catalog.json"),
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
        assert_eq!(
            (statuses[0].state.as_str(), statuses[0].active),
            ("no-unit", false)
        );
        assert!(
            get_service_statuses(root.path(), "vps", None)
                .expect("listing")
                .is_empty()
        );
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
    fn listing_keeps_live_services_of_the_target_host() {
        let root = tempfile::tempdir().expect("fixture directory");
        std::fs::create_dir_all(root.path().join("infra/config")).expect("fixture config");
        std::fs::write(
            root.path().join("infra/config/service-catalog.json"),
            r#"{ "schemaVersion": 1, "owner": "infra", "supervisor": "systemd", "proxy": "nginx",
                 "services": [
                   { "id": "old", "kind": "x", "runtime": "bun", "unit": "old.service", "host": "dbfr",
                     "status": "retired", "retiredAt": "2026-10-09" },
                   { "id": "vps-only", "kind": "x", "runtime": "bun", "unit": "v.service", "host": "vps" } ] }"#,
        )
        .expect("fixture catalog");
        assert!(
            get_service_statuses(root.path(), "dbfr", None)
                .expect("listing")
                .is_empty()
        );
        assert!(execute_lifecycle(root.path(), ServiceAction::Restart, None, "dbfr").is_err());
    }

    #[test]
    fn container_services_use_docker() {
        let argv = container_command(ServiceAction::Restart, "aphrody-chat-1").expect("restart");
        assert_eq!(argv, ["docker", "restart", "aphrody-chat-1"]);
        assert!(container_command(ServiceAction::Enable, "aphrody-chat-1").is_none());
        assert!(container_state_is_up("running/healthy"));
        assert!(!container_state_is_up("running/unhealthy"));
        assert!(!container_state_is_up("exited"));
    }

    #[test]
    fn remote_aliases_never_select_local_systemd() {
        assert!(is_local_target("local"));
        assert!(!is_local_target("vps"));
        assert!(!is_local_target("dbfr"));
    }
}
