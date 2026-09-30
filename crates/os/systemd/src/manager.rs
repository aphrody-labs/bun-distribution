// SPDX-License-Identifier: Apache-2.0
//! Systemd service and unit supervisor, dependency resolver (DAG), and watchdog.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    journal::{Journal, LogLevel},
    unit::{ActiveState, Unit, UnitType},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitStatus {
    pub name: String,
    pub unit_type: UnitType,
    pub description: String,
    pub state: ActiveState,
    pub sub_state: String,
    pub main_pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub restart_count: u32,
    pub dependencies: Vec<String>,
}

pub struct ServiceManager {
    units: RwLock<HashMap<String, Unit>>,
    journal: Arc<Journal>,
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self::new(Arc::new(Journal::default()))
    }
}

impl ServiceManager {
    #[must_use]
    pub fn new(journal: Arc<Journal>) -> Self {
        let manager = Self { units: RwLock::new(HashMap::new()), journal };
        manager.register_default_units();
        manager
    }

    #[must_use]
    pub fn journal(&self) -> Arc<Journal> {
        Arc::clone(&self.journal)
    }

    fn register_default_units(&self) {
        let mut default_target = Unit::new("default.target", UnitType::Target, "Default Target");
        default_target.wants = vec!["graphical.target".to_owned()];
        default_target.state = ActiveState::Active;
        default_target.sub_state = "active".to_owned();

        let mut graphical_target =
            Unit::new("graphical.target", UnitType::Target, "Graphical Interface");
        graphical_target.after = vec!["multi-user.target".to_owned()];
        graphical_target.wants =
            vec!["multi-user.target".to_owned(), "aphrody-shell.service".to_owned()];
        graphical_target.state = ActiveState::Active;
        graphical_target.sub_state = "active".to_owned();

        let mut multi_user = Unit::new("multi-user.target", UnitType::Target, "Multi-User System");
        multi_user.wants = vec!["aphrody-kernel.service".to_owned()];
        multi_user.state = ActiveState::Active;
        multi_user.sub_state = "active".to_owned();

        let mut kernel_svc = Unit::new(
            "aphrody-kernel.service",
            UnitType::Service,
            "Aphrody OS Privileged Control Plane",
        );
        kernel_svc.state = ActiveState::Active;
        kernel_svc.sub_state = "running".to_owned();
        kernel_svc.main_pid = Some(std::process::id());
        kernel_svc.started_at_usec = Some(
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0),
        );

        let mut shell_svc = Unit::new(
            "aphrody-shell.service",
            UnitType::Service,
            "Aphrody Graphical Desktop Shell",
        );
        shell_svc.after = vec!["aphrody-kernel.service".to_owned()];
        shell_svc.state = ActiveState::Active;
        shell_svc.sub_state = "running".to_owned();
        shell_svc.main_pid = Some(std::process::id());
        shell_svc.started_at_usec = kernel_svc.started_at_usec;

        let mut units = self.units.write().expect("units write lock");
        units.insert("default.target".to_owned(), default_target);
        units.insert("graphical.target".to_owned(), graphical_target);
        units.insert("multi-user.target".to_owned(), multi_user);
        units.insert("aphrody-kernel.service".to_owned(), kernel_svc);
        units.insert("aphrody-shell.service".to_owned(), shell_svc);
    }

    pub fn load_unit(&self, unit: Unit) {
        let name = unit.name.clone();
        let mut units = self.units.write().expect("units write lock");
        units.insert(name, unit);
    }

    pub fn load_unit_ini(&self, name: &str, content: &str) -> Result<(), String> {
        let unit = Unit::parse_ini(name, content)?;
        self.load_unit(unit);
        self.journal.log(
            name,
            LogLevel::Info,
            None,
            format!("Unit {name} loaded from configuration"),
        );
        Ok(())
    }

    pub fn list_units(&self) -> Vec<UnitStatus> {
        let units = self.units.read().expect("units read lock");
        let now_usec =
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0);

        let mut list = Vec::new();
        for unit in units.values() {
            let uptime_secs = unit.started_at_usec.map(|started| {
                if now_usec > started { (now_usec - started) / 1_000_000 } else { 0 }
            });

            let mut dependencies = unit.requires.clone();
            dependencies.extend(unit.wants.clone());

            list.push(UnitStatus {
                name: unit.name.clone(),
                unit_type: unit.unit_type,
                description: unit.description.clone(),
                state: unit.state,
                sub_state: unit.sub_state.clone(),
                main_pid: unit.main_pid,
                uptime_secs,
                restart_count: unit.restart_count,
                dependencies,
            });
        }
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn get_unit_status(&self, name: &str) -> Result<UnitStatus, String> {
        let units = self.units.read().expect("units read lock");
        let unit = units.get(name).ok_or_else(|| format!("unit `{name}` not found"))?;
        let now_usec =
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0);

        let uptime_secs = unit
            .started_at_usec
            .map(|started| if now_usec > started { (now_usec - started) / 1_000_000 } else { 0 });

        let mut dependencies = unit.requires.clone();
        dependencies.extend(unit.wants.clone());

        Ok(UnitStatus {
            name: unit.name.clone(),
            unit_type: unit.unit_type,
            description: unit.description.clone(),
            state: unit.state,
            sub_state: unit.sub_state.clone(),
            main_pid: unit.main_pid,
            uptime_secs,
            restart_count: unit.restart_count,
            dependencies,
        })
    }

    /// Resolve dependency ordering (topological sort of units to start).
    pub fn resolve_order(&self, target_name: &str) -> Result<Vec<String>, String> {
        let units = self.units.read().expect("units read lock");
        if !units.contains_key(target_name) {
            return Err(format!("target unit `{target_name}` not found"));
        }

        let mut visited = HashSet::new();
        let mut order = Vec::new();
        let mut queue = VecDeque::new();
        queue.push_back(target_name.to_owned());

        while let Some(current) = queue.pop_front() {
            if !visited.insert(current.clone()) {
                continue;
            }

            if let Some(unit) = units.get(&current) {
                for req in &unit.requires {
                    if !visited.contains(req) {
                        queue.push_back(req.clone());
                    }
                }
                for want in &unit.wants {
                    if !visited.contains(want) {
                        queue.push_back(want.clone());
                    }
                }
                for after in &unit.after {
                    if !visited.contains(after) {
                        queue.push_back(after.clone());
                    }
                }
                order.push(current);
            }
        }

        order.reverse();
        Ok(order)
    }

    pub fn start_unit(&self, name: &str) -> Result<(), String> {
        let mut units = self.units.write().expect("units write lock");
        let unit = units.get_mut(name).ok_or_else(|| format!("unit `{name}` not found"))?;

        if unit.state == ActiveState::Active {
            return Ok(());
        }

        unit.state = ActiveState::Activating;
        unit.sub_state = "start-pre".to_owned();
        self.journal.log(name, LogLevel::Info, None, format!("Starting {name}..."));

        let now_usec =
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0);

        unit.state = ActiveState::Active;
        unit.sub_state = "running".to_owned();
        unit.started_at_usec = Some(now_usec);
        self.journal.log(name, LogLevel::Info, unit.main_pid, format!("Started {name}"));
        Ok(())
    }

    pub fn stop_unit(&self, name: &str) -> Result<(), String> {
        let mut units = self.units.write().expect("units write lock");
        let unit = units.get_mut(name).ok_or_else(|| format!("unit `{name}` not found"))?;

        if unit.state == ActiveState::Inactive {
            return Ok(());
        }

        unit.state = ActiveState::Deactivating;
        unit.sub_state = "stop-sigterm".to_owned();
        self.journal.log(name, LogLevel::Info, unit.main_pid, format!("Stopping {name}..."));

        unit.state = ActiveState::Inactive;
        unit.sub_state = "dead".to_owned();
        unit.main_pid = None;
        unit.started_at_usec = None;
        self.journal.log(name, LogLevel::Info, None, format!("Stopped {name}"));
        Ok(())
    }

    pub fn restart_unit(&self, name: &str) -> Result<(), String> {
        self.stop_unit(name)?;
        {
            let mut units = self.units.write().expect("units write lock");
            if let Some(unit) = units.get_mut(name) {
                unit.restart_count += 1;
            }
        }
        self.start_unit(name)
    }

    pub fn reload_unit(&self, name: &str) -> Result<(), String> {
        let units = self.units.read().expect("units read lock");
        let _ = units.get(name).ok_or_else(|| format!("unit `{name}` not found"))?;
        self.journal.log(
            name,
            LogLevel::Notice,
            None,
            format!("Reloaded configuration for {name}"),
        );
        Ok(())
    }
}
