// SPDX-License-Identifier: Apache-2.0
//! Native OVH VPS management and inspection.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{
    client::OvhClient,
    services::{RenewOrder, RenewQuote, ServicesManager},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsInfo {
    pub name: String,
    pub display_name: Option<String>,
    pub state: String,
    pub cluster: String,
    pub zone: String,
    pub model: String,
    pub memory_mb: u64,
    pub vcore: u32,
    pub disk_gb: u64,
    pub sla: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsIp {
    pub ip: String,
    pub version: String,
    pub gateway: Option<String>,
    pub reverse: Option<String>,
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsStatus {
    pub state: String,
    pub ping: bool,
    pub up: bool,
}

/// Billing state of a VPS (`/vps/{name}/serviceInfos`): an expired service refuses every
/// operational call with HTTP 460 until it is renewed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpsBilling {
    pub service_id: u64,
    pub status: String,
    pub expiration: String,
    pub automatic_renew: bool,
    pub delete_at_expiration: bool,
}

/// True when OVH refused a call because the service has expired (HTTP 460).
pub fn is_expired_error(error: &anyhow::Error) -> bool {
    error.to_string().contains("HTTP 460")
}

/// Parse an ISO 8601 date string (YYYY-MM-DD) and compute days until expiration from today.
/// Returns negative if already expired.
fn days_until_expiration(expiration_date: &str) -> Option<i64> {
    use chrono::NaiveDate;
    use std::str::FromStr;

    let exp = NaiveDate::from_str(expiration_date).ok()?;
    let today = chrono::Local::now().naive_local().date();
    Some((exp - today).num_days())
}

/// Health status of a VPS billing state.
#[derive(Debug, Clone)]
pub struct VpsHealthStatus {
    pub service_name: String,
    pub is_healthy: bool,
    pub alerts: Vec<String>,
}

impl VpsHealthStatus {
    /// Create a health report for a VPS.
    pub fn new(
        service_name: String,
        billing: &VpsBilling,
        state: Option<&str>,
        alert_threshold_days: i64,
    ) -> Self {
        let mut alerts = Vec::new();

        // Check expiration
        if billing.status == "expired" {
            alerts.push("Service expiré".to_string());
        } else if let Some(days) = days_until_expiration(&billing.expiration) {
            if days <= 0 {
                alerts.push("Service expiré".to_string());
            } else if days <= alert_threshold_days {
                alerts.push(format!(
                    "Expiration dans {} jour{}",
                    days,
                    if days == 1 { "" } else { "s" }
                ));
            }
        }

        // Check deleteAtExpiration flag
        if billing.delete_at_expiration && billing.status != "expired" {
            alerts.push("Suppression à expiration: OUI (risqué)".to_string());
        }

        // Check manual renewal
        if !billing.automatic_renew && billing.status != "expired" {
            alerts.push("Renouvellement manuel (alerte requise)".to_string());
        }

        // Check if stopped (only if we have state info)
        if let Some("stopped") = state {
            alerts.push("État: ARRÊTÉ".to_string());
        }

        Self { service_name, is_healthy: alerts.is_empty(), alerts }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum NetbootMode {
    Rescue,
    Local,
}

impl NetbootMode {
    pub fn as_str(self) -> &'static str {
        match self {
            NetbootMode::Rescue => "rescue",
            NetbootMode::Local => "local",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VpsTask {
    pub id: u64,
    pub r#type: String,
    pub state: String,
    pub progress: u64,
    pub date: String,
}

/// Hide the session token of a console URL: keep scheme, host and path, mask the query.
pub fn redact_console_url(url: &str) -> String {
    match url.split_once('?') {
        Some((base, _)) => format!("{base}?<redacted>"),
        None => url.to_owned(),
    }
}

pub struct VpsManager<'a> {
    client: &'a OvhClient,
}

impl<'a> VpsManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client }
    }

    pub async fn list_vps(&self) -> Result<Vec<String>> {
        self.client.get("/vps").await
    }

    pub async fn get_vps(&self, service_name: &str) -> Result<VpsInfo> {
        let raw: serde_json::Value = self.client.get(&format!("/vps/{service_name}")).await?;
        let model = raw.get("model");

        Ok(VpsInfo {
            name: raw.get("name").and_then(|v| v.as_str()).unwrap_or(service_name).to_string(),
            display_name: raw.get("displayName").and_then(|v| v.as_str()).map(ToString::to_string),
            state: raw.get("state").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            cluster: raw.get("cluster").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            zone: raw.get("zone").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            model: model
                .and_then(|m| m.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("vps")
                .to_string(),
            memory_mb: model.and_then(|m| m.get("memory")).and_then(|v| v.as_u64()).unwrap_or(0),
            vcore: model.and_then(|m| m.get("vcore")).and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            disk_gb: model.and_then(|m| m.get("disk")).and_then(|v| v.as_u64()).unwrap_or(0),
            sla: if raw.get("slaMonitoring").and_then(|v| v.as_bool()).unwrap_or(false) {
                "active".into()
            } else {
                "standard".into()
            },
        })
    }

    pub async fn get_ips(&self, service_name: &str) -> Result<Vec<VpsIp>> {
        let ip_strings: Vec<String> = self.client.get(&format!("/vps/{service_name}/ips")).await?;
        let mut ips = Vec::new();

        for ip in ip_strings {
            let version = if ip.contains(':') { "v6" } else { "v4" };
            if let Ok(detail) =
                self.client.get::<serde_json::Value>(&format!("/vps/{service_name}/ips/{ip}")).await
            {
                ips.push(VpsIp {
                    ip: ip.clone(),
                    version: version.into(),
                    gateway: detail
                        .get("gateway")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                    reverse: detail
                        .get("reverse")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                    r#type: detail
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("primary")
                        .to_string(),
                });
            } else {
                ips.push(VpsIp {
                    ip,
                    version: version.into(),
                    gateway: None,
                    reverse: None,
                    r#type: "primary".into(),
                });
            }
        }

        Ok(ips)
    }

    pub async fn get_status(&self, service_name: &str) -> Result<VpsStatus> {
        let raw: serde_json::Value =
            self.client.get(&format!("/vps/{service_name}/status")).await?;
        Ok(VpsStatus {
            state: raw.get("state").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            ping: raw.get("ping").and_then(|v| v.as_bool()).unwrap_or(false),
            up: raw.get("up").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    }

    pub async fn billing(&self, service_name: &str) -> Result<VpsBilling> {
        let raw: serde_json::Value =
            self.client.get(&format!("/vps/{service_name}/serviceInfos")).await?;
        let renew = raw.get("renew");
        let flag = |key: &str| renew.and_then(|r| r.get(key)).and_then(|v| v.as_bool());
        Ok(VpsBilling {
            service_id: raw.get("serviceId").and_then(|v| v.as_u64()).unwrap_or(0),
            status: raw.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            expiration: raw.get("expiration").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            automatic_renew: flag("automatic").unwrap_or(false),
            delete_at_expiration: flag("deleteAtExpiration").unwrap_or(false),
        })
    }

    /// Price one renewal `period` (ISO 8601, e.g. `P1M`) with a dry-run order: nothing is ordered.
    pub async fn renew_quote(&self, service_id: u64, period: &str) -> Result<RenewQuote> {
        ServicesManager::new(self.client).renew_quote(service_id, Some(period)).await
    }

    /// Create the renewal order of a quote. It stays unpaid until [`Self::pay_order`].
    pub async fn renew(&self, service_id: u64, quote: &RenewQuote) -> Result<RenewOrder> {
        ServicesManager::new(self.client).renew(service_id, quote).await
    }

    /// Pay an order with the account's default registered payment method (else the first one).
    pub async fn pay_order(&self, order_id: u64) -> Result<u64> {
        ServicesManager::new(self.client).pay_order(order_id).await
    }

    pub async fn reboot(&self, service_name: &str, apply: bool) -> Result<Option<u64>> {
        if !apply {
            return Ok(None);
        }
        let task: serde_json::Value =
            self.client.post(&format!("/vps/{service_name}/reboot"), None).await?;
        let id = task.get("id").and_then(|v| v.as_u64());
        Ok(id)
    }

    /// KVM console URL (POST /vps/{serviceName}/getConsoleUrl). The URL embeds a session token.
    pub async fn console_url(&self, service_name: &str) -> Result<String> {
        let value: serde_json::Value =
            self.client.post(&format!("/vps/{service_name}/getConsoleUrl"), None).await?;
        match value {
            serde_json::Value::String(url) => Ok(url),
            other => other
                .get("url")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
                .ok_or_else(|| anyhow::anyhow!("getConsoleUrl: unexpected response shape")),
        }
    }

    /// Set the netboot mode (`rescue` or `local`) through PUT /vps/{serviceName}.
    pub async fn set_netboot(&self, service_name: &str, mode: NetbootMode) -> Result<()> {
        let _: serde_json::Value = self
            .client
            .put(
                &format!("/vps/{service_name}"),
                Some(serde_json::json!({ "netbootMode": mode.as_str() })),
            )
            .await?;
        Ok(())
    }

    /// Current netboot mode (GET /vps/{serviceName}).
    pub async fn netboot(&self, service_name: &str) -> Result<String> {
        let info: serde_json::Value = self.client.get(&format!("/vps/{service_name}")).await?;
        Ok(info.get("netbootMode").and_then(|v| v.as_str()).unwrap_or("unknown").to_owned())
    }

    /// Tasks of a VPS, newest first (GET /vps/{serviceName}/tasks then each task).
    pub async fn tasks(&self, service_name: &str) -> Result<Vec<VpsTask>> {
        let mut ids: Vec<u64> = self.client.get(&format!("/vps/{service_name}/tasks")).await?;
        ids.sort_unstable_by(|a, b| b.cmp(a));
        let mut tasks = Vec::with_capacity(ids.len().min(20));
        for id in ids.iter().take(20) {
            let t: serde_json::Value =
                self.client.get(&format!("/vps/{service_name}/tasks/{id}")).await?;
            let s = |k: &str| t.get(k).and_then(|v| v.as_str()).unwrap_or("-").to_owned();
            tasks.push(VpsTask {
                id: *id,
                r#type: s("type"),
                state: s("state"),
                progress: t.get("progress").and_then(|v| v.as_u64()).unwrap_or(0),
                date: s("date"),
            });
        }
        Ok(tasks)
    }

    /// Start a stopped VPS (POST /vps/{serviceName}/start).
    pub async fn start(&self, service_name: &str) -> Result<Option<u64>> {
        let task: serde_json::Value =
            self.client.post(&format!("/vps/{service_name}/start"), None).await?;
        let id = task.get("id").and_then(|v| v.as_u64());
        Ok(id)
    }

    /// Update the deleteAtExpiration flag on a VPS service (PUT /vps/{serviceName}/serviceInfos).
    /// This call is rejected by OVH if the service is expired.
    pub async fn set_delete_at_expiration(
        &self,
        service_name: &str,
        delete_at_expiration: bool,
    ) -> Result<()> {
        let _: serde_json::Value = self
            .client
            .put(
                &format!("/vps/{service_name}/serviceInfos"),
                Some(
                    serde_json::json!({ "renew": { "deleteAtExpiration": delete_at_expiration } }),
                ),
            )
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_url_token_is_masked() {
        assert_eq!(
            redact_console_url("https://kvm.example/vnc_auto.html?token=SECRET"),
            "https://kvm.example/vnc_auto.html?<redacted>"
        );
        assert_eq!(redact_console_url("https://kvm.example/x"), "https://kvm.example/x");
    }

    #[test]
    fn healthy_vps_has_no_alerts() {
        let billing = VpsBilling {
            service_id: 123,
            status: "active".to_string(),
            expiration: "2027-01-01".to_string(),
            automatic_renew: true,
            delete_at_expiration: false,
        };
        let health = VpsHealthStatus::new("vps-test".to_string(), &billing, Some("running"), 14);
        assert!(health.is_healthy);
        assert!(health.alerts.is_empty());
    }

    #[test]
    fn alerts_on_manual_renewal() {
        let billing = VpsBilling {
            service_id: 123,
            status: "active".to_string(),
            expiration: "2027-01-01".to_string(),
            automatic_renew: false,
            delete_at_expiration: false,
        };
        let health = VpsHealthStatus::new("vps-test".to_string(), &billing, Some("running"), 14);
        assert!(!health.is_healthy);
        assert!(health.alerts.iter().any(|a| a.contains("Renouvellement manuel")));
    }

    #[test]
    fn alerts_on_delete_at_expiration() {
        let billing = VpsBilling {
            service_id: 123,
            status: "active".to_string(),
            expiration: "2027-01-01".to_string(),
            automatic_renew: true,
            delete_at_expiration: true,
        };
        let health = VpsHealthStatus::new("vps-test".to_string(), &billing, Some("running"), 14);
        assert!(!health.is_healthy);
        assert!(health.alerts.iter().any(|a| a.contains("Suppression à expiration")));
    }

    #[test]
    fn alerts_on_stopped_state() {
        let billing = VpsBilling {
            service_id: 123,
            status: "active".to_string(),
            expiration: "2027-01-01".to_string(),
            automatic_renew: true,
            delete_at_expiration: false,
        };
        let health = VpsHealthStatus::new("vps-test".to_string(), &billing, Some("stopped"), 14);
        assert!(!health.is_healthy);
        assert!(health.alerts.iter().any(|a| a.contains("ARRÊTÉ")));
    }

    #[test]
    fn alerts_on_expired_service() {
        let billing = VpsBilling {
            service_id: 123,
            status: "expired".to_string(),
            expiration: "2026-09-01".to_string(),
            automatic_renew: false,
            delete_at_expiration: true,
        };
        let health = VpsHealthStatus::new("vps-test".to_string(), &billing, Some("stopped"), 14);
        assert!(!health.is_healthy);
        assert!(health.alerts.iter().any(|a| a.contains("Service expiré")));
    }
}
