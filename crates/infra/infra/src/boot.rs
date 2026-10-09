// SPDX-License-Identifier: Apache-2.0
//! Persistence at boot: one declarative desired state for systemd units, Docker containers,
//! Windows scheduled tasks and Windows services (`aphrody infra boot plan|apply|audit`).
//!
//! Desired state = non-retired `services` of `tools/config/service-catalog.json` (unit or container
//! plus `host`) merged with its `boot.entries` section (timers, sockets, scheduled tasks, services).
//! `audit` reads the real state, `plan` lists the commands that would correct it, `apply` runs them.

use crate::catalog::{CatalogService, load_service_catalog};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// What must survive a reboot.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BootKind {
    /// systemd service, timer or socket: enabled, active and (long-running services) `Restart=`.
    #[serde(rename_all = "camelCase")]
    Systemd { unit: String },
    /// Docker container with a restart policy (`always` or `unless-stopped`), running.
    #[serde(rename_all = "camelCase")]
    Docker { container: String },
    /// Windows scheduled task with the declared triggers and restart-on-failure.
    #[serde(rename_all = "camelCase")]
    ScheduledTask {
        name: String,
        #[serde(default = "default_task_path")]
        path: String,
        /// `atStartup` and/or `atLogon`.
        triggers: Vec<String>,
        /// Only used when the task is missing and must be registered.
        #[serde(default)]
        execute: Option<String>,
        #[serde(default)]
        arguments: Option<String>,
        /// `system` (LocalSystem) or `user` (current user, S4U unless `atLogon` needs a desktop).
        #[serde(default = "default_principal")]
        principal: String,
    },
    /// Windows service: start type Automatic, running, optional failure-restart actions.
    #[serde(rename_all = "camelCase")]
    WindowsService {
        name: String,
        #[serde(default)]
        restart_on_failure: bool,
    },
}

fn default_task_path() -> String {
    "\\Aphrody\\".to_owned()
}

fn default_principal() -> String {
    "system".to_owned()
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BootEntry {
    pub host: String,
    #[serde(flatten)]
    pub kind: BootKind,
    /// Reason why the entry is audited but never corrected by `apply`
    /// (work owned by someone else, pending deploy).
    #[serde(default)]
    pub hold: Option<String>,
}

impl BootEntry {
    #[must_use]
    pub fn label(&self) -> String {
        let name = match &self.kind {
            BootKind::Systemd { unit } => unit,
            BootKind::Docker { container } => container,
            BootKind::ScheduledTask { name, .. } | BootKind::WindowsService { name, .. } => name,
        };
        format!("{}:{name}", self.host)
    }

    fn is_windows(&self) -> bool {
        matches!(self.kind, BootKind::ScheduledTask { .. } | BootKind::WindowsService { .. })
    }
}

/// Entries derived from the supervised, non-retired catalog services plus `boot.entries`;
/// a service with a container is audited as a container (its unit, if any, is a wrapper
/// declared explicitly), an explicit entry wins over a derived one.
pub fn load_entries(root: &Path) -> Result<Vec<BootEntry>> {
    let catalog = load_service_catalog(root)?;
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(
        root.join("tools/config/service-catalog.json"),
    )?)?;
    let explicit: Vec<BootEntry> = match raw.pointer("/boot/entries") {
        Some(v) => serde_json::from_value(v.clone()).context("boot.entries invalide")?,
        None => Vec::new(),
    };
    Ok(merge_entries(&catalog.services, explicit))
}

#[must_use]
pub fn merge_entries(services: &[CatalogService], explicit: Vec<BootEntry>) -> Vec<BootEntry> {
    let mut out = explicit;
    for s in services.iter().filter(|s| !s.is_retired()) {
        let Some(host) = s.host.clone() else { continue };
        let kind = match (&s.container, &s.unit) {
            (Some(c), _) => BootKind::Docker { container: c.clone() },
            (None, Some(u)) => BootKind::Systemd { unit: u.clone() },
            _ => continue,
        };
        let entry = BootEntry { host, kind, hold: None };
        if !out.iter().any(|e| e.host == entry.host && e.kind == entry.kind) {
            out.push(entry);
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Finding {
    pub entry: String,
    pub problem: String,
    /// Script that corrects the drift on the target (sh, or PowerShell for Windows entries);
    /// `None` when the source unit/artifact itself must change.
    pub fix: Option<String>,
    pub held: Option<String>,
}

/// Raw observation of one entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observed {
    Props(HashMap<String, String>),
    Json(Value),
    Missing,
}

fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn pq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[must_use]
pub fn evaluate(entry: &BootEntry, observed: &Observed) -> Vec<Finding> {
    let label = entry.label();
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    match (&entry.kind, observed) {
        (BootKind::Systemd { unit }, Observed::Props(p)) => {
            let get = |k: &str| p.get(k).map_or("", String::as_str);
            if get("LoadState") == "not-found" {
                out.push((format!("unité {unit} absente de l'hôte (déploiement requis)"), None));
            } else {
                let enabled =
                    matches!(get("UnitFileState"), "enabled" | "enabled-runtime" | "alias");
                let indirect = get("UnitFileState") == "indirect" && unit.contains('@');
                let active = get("ActiveState") == "active";
                if !enabled && !indirect {
                    out.push((
                        format!("non activé au boot ({})", get("UnitFileState")),
                        Some(format!("sudo -n systemctl enable --now {}", q(unit))),
                    ));
                } else if !active {
                    out.push((
                        format!("activé mais {}", get("ActiveState")),
                        Some(format!(
                            "sudo -n systemctl reset-failed {u} ; sudo -n systemctl start {u}",
                            u = q(unit)
                        )),
                    ));
                }
                let long_running = unit.ends_with(".service")
                    && get("Type") != "oneshot"
                    && get("RemainAfterExit") != "yes";
                if long_running
                    && !matches!(get("Restart"), "always" | "on-failure" | "on-abnormal")
                {
                    out.push((
                        format!("Restart={} (auto-redémarrage absent dans l'unité source)", get("Restart")),
                        None,
                    ));
                }
            }
        },
        (BootKind::Docker { container }, Observed::Props(p)) => {
            let get = |k: &str| p.get(k).map_or("", String::as_str);
            let policy_ok = matches!(get("restart"), "always" | "unless-stopped");
            if !policy_ok {
                out.push((
                    format!("restart policy '{}'", get("restart")),
                    Some(format!("docker update --restart unless-stopped {}", q(container))),
                ));
            }
            if get("running") != "true" {
                out.push((
                    format!("conteneur arrêté ({})", get("status")),
                    Some(format!("docker start {}", q(container))),
                ));
            }
        },
        (BootKind::ScheduledTask { name, path, triggers, .. }, Observed::Json(j)) => {
            let have: Vec<&str> =
                j["Triggers"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let missing: Vec<&String> =
                triggers.iter().filter(|t| !have.contains(&t.as_str())).collect();
            let restart = j["RestartCount"].as_u64().unwrap_or(0);
            let enabled = j["Enabled"].as_bool().unwrap_or(false);
            let running = j["State"].as_str() == Some("Running");
            if !missing.is_empty() || restart == 0 || !enabled || !running {
                let mut why = Vec::new();
                if !missing.is_empty() {
                    why.push(format!("déclencheurs manquants {missing:?}"));
                }
                if restart == 0 {
                    why.push("pas de redémarrage sur échec".to_owned());
                }
                if !enabled {
                    why.push("désactivée".to_owned());
                }
                if !running {
                    why.push(format!("état {}", j["State"].as_str().unwrap_or("?")));
                }
                out.push((why.join(", "), Some(task_script(entry, name, path))));
            }
        },
        (BootKind::WindowsService { name, restart_on_failure }, Observed::Json(j)) => {
            let auto = matches!(j["StartMode"].as_str(), Some("Auto"));
            let running = j["State"].as_str() == Some("Running");
            let failure = !*restart_on_failure || j["FailureRestart"].as_bool() == Some(true);
            if !auto || !running || !failure {
                let mut s = format!(
                    "Set-Service -Name {n} -StartupType Automatic; if ((Get-Service {n}).Status -ne 'Running') {{ Start-Service {n} }};",
                    n = pq(name)
                );
                if *restart_on_failure {
                    s.push_str(&format!(
                        " sc.exe failure {n} reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null;",
                        n = pq(name)
                    ));
                }
                out.push((
                    format!(
                        "service: démarrage {} / état {} / restart-on-failure {}",
                        j["StartMode"].as_str().unwrap_or("?"),
                        j["State"].as_str().unwrap_or("?"),
                        failure
                    ),
                    Some(s),
                ));
            }
        },
        (_, Observed::Missing) => {
            out.push(("absent de l'hôte".to_owned(), match &entry.kind {
                BootKind::ScheduledTask { name, path, execute: Some(_), .. } => {
                    Some(task_script(entry, name, path))
                },
                _ => None,
            }));
        },
        _ => out.push(("observation inattendue".to_owned(), None)),
    }
    out.into_iter()
        .map(|(problem, fix)| Finding {
            entry: label.clone(),
            problem,
            fix,
            held: entry.hold.clone(),
        })
        .collect()
}

/// PowerShell that adds the missing triggers to an existing task (or registers it) with
/// restart-on-failure, then starts it.
fn task_script(entry: &BootEntry, name: &str, path: &str) -> String {
    let BootKind::ScheduledTask { triggers, execute, arguments, principal, .. } = &entry.kind
    else {
        return String::new();
    };
    let mut trig = String::new();
    for t in triggers {
        let (type_name, ctor) = match t.as_str() {
            "atStartup" => ("Boot", "New-ScheduledTaskTrigger -AtStartup"),
            "atLogon" => ("Logon", "New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME"),
            _ => continue,
        };
        trig.push_str(&format!(
            "if (-not ($trigs | ? {{ $_.CimClass.CimClassName -like '*{type_name}*' }})) {{ $trigs += ({ctor}) }}; "
        ));
    }
    let principal_ctor = if principal == "system" {
        "New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest"
    } else if triggers.iter().any(|t| t == "atLogon") && !triggers.iter().any(|t| t == "atStartup")
    {
        "New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest"
    } else {
        "New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest"
    };
    let register = match execute {
        Some(exe) => format!(
            "Register-ScheduledTask -TaskName {n} -TaskPath {p} -Action (New-ScheduledTaskAction -Execute {e}{a}) -Trigger $trigs -Settings $set -Principal ({pr}) | Out-Null",
            n = pq(name),
            p = pq(path),
            e = pq(exe),
            a = arguments.as_deref().map_or(String::new(), |a| format!(" -Argument {}", pq(a))),
            pr = principal_ctor,
        ),
        None => format!("throw 'tâche {name} absente et sans commande déclarée'"),
    };
    format!(
        "$ErrorActionPreference='Stop'; $t = Get-ScheduledTask -TaskName {n} -TaskPath {p} -ErrorAction SilentlyContinue; \
$trigs = @(); if ($t) {{ $trigs = @($t.Triggers) }}; {trig}\
$set = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew; \
if ($t) {{ Set-ScheduledTask -TaskName {n} -TaskPath {p} -Trigger $trigs -Settings $set -Principal ({pr}) | Out-Null }} else {{ {register} }}; \
Enable-ScheduledTask -TaskName {n} -TaskPath {p} | Out-Null; \
if ((Get-ScheduledTask -TaskName {n} -TaskPath {p}).State -ne 'Running') {{ Start-ScheduledTask -TaskName {n} -TaskPath {p} }}",
        n = pq(name),
        p = pq(path),
        pr = principal_ctor,
    )
}

/// Probe script for the Linux entries of one host (`@@<index>` header then `key=value` lines).
#[must_use]
pub fn linux_probe(entries: &[(usize, &BootEntry)]) -> String {
    let mut s = String::new();
    for (i, e) in entries {
        match &e.kind {
            BootKind::Systemd { unit } => s.push_str(&format!(
                "echo '@@{i}'; systemctl show {} -p LoadState,UnitFileState,ActiveState,Restart,Type,RemainAfterExit 2>/dev/null; ",
                q(unit)
            )),
            BootKind::Docker { container } => s.push_str(&format!(
                "echo '@@{i}'; docker inspect -f 'restart={{{{.HostConfig.RestartPolicy.Name}}}}{{{{\"\\n\"}}}}running={{{{.State.Running}}}}{{{{\"\\n\"}}}}status={{{{.State.Status}}}}' {} 2>/dev/null; ",
                q(container)
            )),
            _ => {},
        }
    }
    s
}

#[must_use]
pub fn windows_probe(entries: &[(usize, &BootEntry)]) -> String {
    let mut s = String::from("$ErrorActionPreference='SilentlyContinue'; ");
    for (i, e) in entries {
        s.push_str(&format!("Write-Output '@@{i}'; "));
        match &e.kind {
            BootKind::ScheduledTask { name, path, .. } => s.push_str(&format!(
                "$t = Get-ScheduledTask -TaskName {} -TaskPath {}; if ($t) {{ [pscustomobject]@{{ State=[string]$t.State; Enabled=[bool]$t.Settings.Enabled; RestartCount=[int]$t.Settings.RestartCount; Triggers=@($t.Triggers | % {{ $n = $_.CimClass.CimClassName; switch -Wildcard ($n) {{ '*Boot*' {{'atStartup'}} '*Logon*' {{'atLogon'}} default {{$n}} }} }}) }} | ConvertTo-Json -Compress }}; ",
                pq(name),
                pq(path)
            )),
            BootKind::WindowsService { name, restart_on_failure } => s.push_str(&format!(
                "$c = Get-CimInstance Win32_Service -Filter \"Name='{}'\"; if ($c) {{ $f = $true; if ({}) {{ $f = [bool]((sc.exe qfailure {}) -match 'RESTART') }}; [pscustomobject]@{{ StartMode=$c.StartMode; State=$c.State; FailureRestart=$f }} | ConvertTo-Json -Compress }}; ",
                name.replace('\'', ""),
                if *restart_on_failure { "$true" } else { "$false" },
                pq(name)
            )),
            _ => {},
        }
    }
    s
}

/// Parses `@@<index>` blocks into observations; entries without a block are `Missing`.
#[must_use]
pub fn parse_probe(entries: &[(usize, &BootEntry)], output: &str) -> HashMap<usize, Observed> {
    let mut blocks: HashMap<usize, Vec<&str>> = HashMap::new();
    let mut current = None;
    for line in output.lines() {
        if let Some(idx) = line.trim().strip_prefix("@@") {
            current = idx.parse::<usize>().ok();
            if let Some(i) = current {
                blocks.entry(i).or_default();
            }
        } else if let (Some(i), false) = (current, line.trim().is_empty()) {
            blocks.entry(i).or_default().push(line.trim());
        }
    }
    let mut map = HashMap::new();
    for (i, e) in entries {
        let lines = blocks.get(i).cloned().unwrap_or_default();
        let observed = if e.is_windows() {
            lines
                .join("")
                .parse::<Value>()
                .ok()
                .or_else(|| serde_json::from_str(&lines.join("")).ok())
                .map_or(Observed::Missing, Observed::Json)
        } else if lines.is_empty() {
            Observed::Missing
        } else {
            Observed::Props(
                lines
                    .iter()
                    .filter_map(|l| l.split_once('='))
                    .map(|(k, v)| (k.to_owned(), v.to_owned()))
                    .collect(),
            )
        };
        map.insert(*i, observed);
    }
    map
}

fn run_host(host: &str, windows: bool, script: &str) -> Result<String> {
    use crate::lifecycle::{is_local_target, run_on_target};
    let argv: Vec<String> = if windows {
        if !is_local_target(host) {
            bail!("les entrées Windows ne s'exécutent que sur l'hôte local");
        }
        use base64::Engine as _;
        let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        vec![
            "powershell.exe".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-EncodedCommand".into(),
            base64::engine::general_purpose::STANDARD.encode(utf16),
        ]
    } else {
        vec!["sh".into(), "-c".into(), script.into()]
    };
    let out = run_on_target(host, &argv).with_context(|| format!("{host}: exécution"))?;
    if !out.status.success() && out.stdout.is_empty() {
        bail!("{host}: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum BootAction {
    Plan,
    Apply,
    Audit,
}

#[derive(Debug, Serialize)]
pub struct HostReport {
    pub host: String,
    pub checked: usize,
    pub error: Option<String>,
    pub findings: Vec<Finding>,
    pub applied: Vec<String>,
}

fn hosts_of(entries: &[BootEntry], only: Option<&str>) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for e in entries {
        if only.is_none_or(|o| o == e.host) && !hosts.contains(&e.host) {
            hosts.push(e.host.clone());
        }
    }
    hosts
}

fn audit_host(entries: &[BootEntry], host: &str) -> Result<(usize, Vec<Finding>)> {
    let mut findings = Vec::new();
    let mut checked = 0;
    for windows in [false, true] {
        let subset: Vec<(usize, &BootEntry)> = entries
            .iter()
            .enumerate()
            .filter(|(_, e)| e.host == host && e.is_windows() == windows)
            .collect();
        if subset.is_empty() {
            continue;
        }
        let script = if windows { windows_probe(&subset) } else { linux_probe(&subset) };
        let output = run_host(host, windows, &script)?;
        let observed = parse_probe(&subset, &output);
        for (i, e) in &subset {
            checked += 1;
            findings.extend(evaluate(e, &observed[i]));
        }
    }
    Ok((checked, findings))
}

pub fn run_boot(
    root: &Path,
    action: BootAction,
    host: Option<&str>,
    json: bool,
) -> Result<bool> {
    let entries = load_entries(root)?;
    let hosts = hosts_of(&entries, host);
    if hosts.is_empty() {
        bail!("aucune entrée de boot pour l'hôte {}", host.unwrap_or("<tous>"));
    }
    let mut reports = Vec::new();
    for h in hosts {
        let mut report =
            HostReport { host: h.clone(), checked: 0, error: None, findings: vec![], applied: vec![] };
        match audit_host(&entries, &h) {
            Ok((n, findings)) => {
                report.checked = n;
                report.findings = findings;
            },
            Err(e) => report.error = Some(format!("{e:#}")),
        }
        if action == BootAction::Apply && report.error.is_none() {
            for f in report.findings.iter().filter(|f| f.held.is_none()) {
                let Some(fix) = &f.fix else { continue };
                let windows = entries.iter().any(|e| e.label() == f.entry && e.is_windows());
                match run_host(&h, windows, fix) {
                    Ok(_) => report.applied.push(f.entry.clone()),
                    Err(e) => report.applied.push(format!("{} ÉCHEC: {e:#}", f.entry)),
                }
            }
            if !report.applied.is_empty() {
                let (n, findings) = audit_host(&entries, &h)?;
                report.checked = n;
                report.findings = findings;
            }
        }
        reports.push(report);
    }
    let drift = reports.iter().any(|r| r.error.is_some() || r.findings.iter().any(|f| f.held.is_none()));
    if json {
        println!("{}", serde_json::to_string_pretty(&reports)?);
    } else {
        for r in &reports {
            println!("== {} ({} entrées)", r.host, r.checked);
            if let Some(e) = &r.error {
                println!("  ERREUR {e}");
            }
            for f in &r.findings {
                let held = f.held.as_deref().map_or(String::new(), |h| format!(" [retenu: {h}]"));
                println!("  DÉRIVE {}: {}{held}", f.entry, f.problem);
                if action == BootAction::Plan {
                    match (&f.fix, &f.held) {
                        (Some(fix), None) => println!("    -> {fix}"),
                        (Some(_), Some(_)) => println!("    -> (non appliqué)"),
                        (None, _) => println!("    -> correction manuelle (source/déploiement)"),
                    }
                }
            }
            for a in &r.applied {
                println!("  appliqué {a}");
            }
            if r.findings.is_empty() && r.error.is_none() {
                println!("  conforme");
            }
        }
    }
    Ok(drift)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props(pairs: &[(&str, &str)]) -> Observed {
        Observed::Props(pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect())
    }

    fn unit(u: &str) -> BootEntry {
        BootEntry { host: "vps".into(), kind: BootKind::Systemd { unit: u.into() }, hold: None }
    }

    #[test]
    fn systemd_compliant() {
        let e = unit("a.service");
        let o = props(&[
            ("LoadState", "loaded"),
            ("UnitFileState", "enabled"),
            ("ActiveState", "active"),
            ("Restart", "on-failure"),
            ("Type", "simple"),
        ]);
        assert!(evaluate(&e, &o).is_empty());
    }

    #[test]
    fn systemd_disabled_gets_enable_now() {
        let e = unit("a.service");
        let o = props(&[
            ("LoadState", "loaded"),
            ("UnitFileState", "disabled"),
            ("ActiveState", "inactive"),
            ("Restart", "always"),
        ]);
        let f = evaluate(&e, &o);
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.as_deref().unwrap().contains("enable --now 'a.service'"));
    }

    #[test]
    fn systemd_missing_restart_is_manual_and_oneshot_exempt() {
        let base = [("LoadState", "loaded"), ("UnitFileState", "enabled"), ("ActiveState", "active")];
        let mut p = base.to_vec();
        p.push(("Restart", "no"));
        let f = evaluate(&unit("a.service"), &props(&p));
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
        p.push(("Type", "oneshot"));
        assert!(evaluate(&unit("a.service"), &props(&p)).is_empty());
        let mut t = base.to_vec();
        t.push(("Restart", "no"));
        assert!(evaluate(&unit("a.timer"), &props(&t)).is_empty());
    }

    #[test]
    fn systemd_absent_unit_is_manual() {
        let f = evaluate(&unit("a.service"), &props(&[("LoadState", "not-found")]));
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
    }

    #[test]
    fn docker_policy_and_running() {
        let e = BootEntry {
            host: "dbfr".into(),
            kind: BootKind::Docker { container: "c1".into() },
            hold: None,
        };
        assert!(
            evaluate(&e, &props(&[("restart", "unless-stopped"), ("running", "true")])).is_empty()
        );
        let f = evaluate(&e, &props(&[("restart", "no"), ("running", "false"), ("status", "exited")]));
        assert_eq!(f.len(), 2);
        assert!(f[0].fix.as_deref().unwrap().contains("update --restart unless-stopped"));
        assert!(f[1].fix.as_deref().unwrap().contains("docker start"));
    }

    fn task() -> BootEntry {
        BootEntry {
            host: "local".into(),
            kind: BootKind::ScheduledTask {
                name: "T".into(),
                path: "\\Aphrody\\".into(),
                triggers: vec!["atStartup".into()],
                execute: None,
                arguments: None,
                principal: "user".into(),
            },
            hold: None,
        }
    }

    #[test]
    fn task_needs_startup_trigger_and_restart() {
        let ok = Observed::Json(serde_json::json!({"State":"Running","Enabled":true,"RestartCount":999,"Triggers":["atStartup","atLogon"]}));
        assert!(evaluate(&task(), &ok).is_empty());
        let bad = Observed::Json(serde_json::json!({"State":"Running","Enabled":true,"RestartCount":0,"Triggers":["atLogon"]}));
        let f = evaluate(&task(), &bad);
        assert_eq!(f.len(), 1);
        let fix = f[0].fix.as_deref().unwrap();
        assert!(fix.contains("-AtStartup") && fix.contains("RestartCount 999") && fix.contains("S4U"));
    }

    #[test]
    fn missing_task_without_command_has_no_fix_script_registration() {
        let f = evaluate(&task(), &Observed::Missing);
        assert_eq!(f.len(), 1);
        assert!(f[0].fix.is_none());
    }

    #[test]
    fn windows_service_auto_and_failure_actions() {
        let e = BootEntry {
            host: "local".into(),
            kind: BootKind::WindowsService { name: "S".into(), restart_on_failure: true },
            hold: None,
        };
        let ok = Observed::Json(serde_json::json!({"StartMode":"Auto","State":"Running","FailureRestart":true}));
        assert!(evaluate(&e, &ok).is_empty());
        let bad = Observed::Json(serde_json::json!({"StartMode":"Manual","State":"Stopped","FailureRestart":false}));
        let f = evaluate(&e, &bad);
        assert!(f[0].fix.as_deref().unwrap().contains("sc.exe failure"));
    }

    #[test]
    fn hold_is_carried_to_findings() {
        let mut e = unit("a.service");
        e.hold = Some("autre agent".into());
        let f = evaluate(&e, &props(&[("LoadState", "not-found")]));
        assert_eq!(f[0].held.as_deref(), Some("autre agent"));
    }

    #[test]
    fn parse_probe_blocks() {
        let e = unit("a.service");
        let d = BootEntry {
            host: "vps".into(),
            kind: BootKind::Docker { container: "c".into() },
            hold: None,
        };
        let entries = [(0usize, &e), (1usize, &d)];
        let m = parse_probe(&entries, "@@0\nLoadState=loaded\nRestart=always\n@@1\n");
        assert!(matches!(&m[&0], Observed::Props(p) if p["Restart"] == "always"));
        assert_eq!(m[&1], Observed::Missing);
    }

    #[test]
    fn merge_skips_retired_and_prefers_container() {
        let services: Vec<CatalogService> = serde_json::from_value(serde_json::json!([
            {"id":"a","kind":"k","runtime":"r","unit":"a.service","host":"vps"},
            {"id":"b","kind":"k","runtime":"r","unit":"b.service","host":"vps","status":"retired","retiredAt":"2026-10-09"},
            {"id":"c","kind":"k","runtime":"r","unit":"c.service","container":"c-1","host":"dbfr"},
            {"id":"d","kind":"k","runtime":"r","unit":"d.service"}
        ]))
        .unwrap();
        let explicit = vec![unit("a.service")];
        let merged = merge_entries(&services, explicit);
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().any(|e| matches!(&e.kind, BootKind::Docker { container } if container == "c-1")));
    }

    #[test]
    fn entries_deserialize_flat() {
        let e: BootEntry = serde_json::from_value(serde_json::json!(
            {"host":"local","kind":"scheduledTask","name":"X","triggers":["atStartup"]}
        ))
        .unwrap();
        assert!(matches!(e.kind, BootKind::ScheduledTask { ref path, .. } if path == "\\Aphrody\\"));
    }
}
