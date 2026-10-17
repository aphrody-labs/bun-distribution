// SPDX-License-Identifier: Apache-2.0
//! `aphrody-systemd`: pure Rust implementation of systemd init, service supervisor, unit DAG and
//! journald.

pub mod journal;
pub mod manager;
pub mod notify;
pub mod subsystem;
pub mod unit;

pub use journal::{Journal, JournalEntry, LogLevel};
pub use manager::{
    HostSystemdBackend, ServiceManager, SystemdSupervisor, UnitStatus, VirtualSupervisor,
};
pub use notify::{
    notify, notify_ready, notify_reloading, notify_status, notify_stopping, notify_watchdog,
    spawn_watchdog_loop, watchdog_usec,
};
pub use subsystem::SystemdSubsystem;
pub use unit::{ActiveState, RestartPolicy, Unit, UnitType};

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use aphrody_subsystem::SystemSubsystem;
    use serde_json::json;

    use super::*;

    #[test]
    fn parse_unit_ini_file() {
        let ini = r#"
[Unit]
Description=Test Web Daemon
After=network.target
Wants=network.target

[Service]
ExecStart=/usr/bin/test-daemon --port 8080
ExecStop=/usr/bin/test-daemon --stop
Restart=on-failure
RestartSec=3
Environment=PORT=8080
Environment=MODE="production"

[Install]
WantedBy=multi-user.target
"#;
        let unit = Unit::parse_ini("test-daemon.service", ini).expect("parse should succeed");
        assert_eq!(unit.name, "test-daemon.service");
        assert_eq!(unit.unit_type, UnitType::Service);
        assert_eq!(unit.description, "Test Web Daemon");
        assert_eq!(unit.after, vec!["network.target"]);
        assert_eq!(unit.wants, vec!["network.target"]);
        assert_eq!(unit.wanted_by, vec!["multi-user.target"]);
        assert_eq!(unit.restart, RestartPolicy::OnFailure);
        assert_eq!(unit.restart_sec, 3);
        assert_eq!(
            unit.environment.get("PORT").map(String::as_str),
            Some("8080")
        );
        assert_eq!(
            unit.environment.get("MODE").map(String::as_str),
            Some("production")
        );
    }

    #[test]
    fn manager_lifecycle_and_journal() {
        let journal = Arc::new(Journal::new(100));
        let manager = ServiceManager::new(journal.clone());

        let units = manager.list_units();
        assert!(units.len() >= 3);
        assert!(units.iter().any(|u| u.name == "graphical.target"));
        assert!(units.iter().any(|u| u.name == "aphrody-kernel.service"));

        // Add a new service
        let unit = Unit::new("custom.service", UnitType::Service, "Custom Test Service");
        manager.load_unit(unit);

        let status = manager.get_unit_status("custom.service").expect("status");
        assert_eq!(status.state, ActiveState::Inactive);

        // Start service
        manager.start_unit("custom.service").expect("start");
        let status = manager.get_unit_status("custom.service").expect("status");
        assert_eq!(status.state, ActiveState::Active);

        // Restart service
        manager.restart_unit("custom.service").expect("restart");
        let status = manager.get_unit_status("custom.service").expect("status");
        assert_eq!(status.state, ActiveState::Active);
        assert_eq!(status.restart_count, 1);

        // Stop service
        manager.stop_unit("custom.service").expect("stop");
        let status = manager.get_unit_status("custom.service").expect("status");
        assert_eq!(status.state, ActiveState::Inactive);

        // Check journal entries
        let entries = journal.query(Some("custom.service"), None, None, 10);
        assert!(entries.len() >= 3);
    }

    #[tokio::test]
    async fn subsystem_tools_dispatch() {
        let subsystem = SystemdSubsystem::new();
        assert_eq!(subsystem.name(), "systemd");

        // List units
        let list_res = subsystem
            .call("systemd_list_units", json!({}))
            .await
            .expect("list");
        assert!(list_res.get("units").is_some());

        // Get status
        let status_res = subsystem
            .call(
                "systemd_unit_status",
                json!({ "name": "aphrody-kernel.service" }),
            )
            .await
            .expect("status");
        assert_eq!(
            status_res.get("state").and_then(|v| v.as_str()),
            Some("active")
        );

        // Journal query
        let journal_res = subsystem
            .call("systemd_journal_query", json!({ "limit": 5 }))
            .await
            .expect("journal");
        assert!(journal_res.get("entries").is_some());
    }
}
