// SPDX-License-Identifier: Apache-2.0
//! Native OVH VPS management and inspection.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::client::OvhClient;

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

    pub async fn reboot(&self, service_name: &str, apply: bool) -> Result<Option<u64>> {
        if !apply {
            return Ok(None);
        }
        let task: serde_json::Value =
            self.client.post(&format!("/vps/{service_name}/reboot"), None).await?;
        let id = task.get("id").and_then(|v| v.as_u64());
        Ok(id)
    }
}
