// SPDX-License-Identifier: Apache-2.0
//! Native OVH DNS Zone and Record management.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::client::OvhClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsZoneInfo {
    pub name: String,
    pub has_dns_anycast: bool,
    pub dnssec_supported: bool,
    pub is_signed: bool,
    #[serde(default)]
    pub name_servers: Vec<String>,
    #[serde(default)]
    pub last_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub id: u64,
    pub zone: String,
    #[serde(default)]
    pub sub_domain: String,
    pub field_type: String,
    pub target: String,
    pub ttl: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsAuditReport {
    pub zone: String,
    pub dnssec_activated: bool,
    pub has_dns_anycast: bool,
    pub name_servers: Vec<String>,
    pub total_records: usize,
    pub missing_production_subdomains: Vec<String>,
    pub warnings: Vec<String>,
}

pub struct DnsManager<'a> {
    client: &'a OvhClient,
}

impl<'a> DnsManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client }
    }

    pub async fn list_zones(&self) -> Result<Vec<String>> {
        self.client.get("/domain/zone").await
    }

    pub async fn get_zone(&self, zone: &str) -> Result<DnsZoneInfo> {
        self.client.get(&format!("/domain/zone/{zone}")).await
    }

    pub async fn export_zone(&self, zone: &str) -> Result<String> {
        self.client.get(&format!("/domain/zone/{zone}/export")).await
    }

    pub async fn list_record_ids(&self, zone: &str, field_type: Option<&str>) -> Result<Vec<u64>> {
        let path = if let Some(ft) = field_type {
            format!("/domain/zone/{zone}/record?fieldType={ft}")
        } else {
            format!("/domain/zone/{zone}/record")
        };
        self.client.get(&path).await
    }

    pub async fn get_record(&self, zone: &str, id: u64) -> Result<DnsRecord> {
        self.client.get(&format!("/domain/zone/{zone}/record/{id}")).await
    }

    pub async fn list_records(
        &self,
        zone: &str,
        field_type: Option<&str>,
    ) -> Result<Vec<DnsRecord>> {
        let ids = self.list_record_ids(zone, field_type).await?;
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            if let Ok(rec) = self.get_record(zone, id).await {
                records.push(rec);
            }
        }
        records.sort_by(|a, b| {
            a.field_type.cmp(&b.field_type).then_with(|| a.sub_domain.cmp(&b.sub_domain))
        });
        Ok(records)
    }

    pub async fn add_record(
        &self,
        zone: &str,
        field_type: &str,
        sub_domain: &str,
        target: &str,
        ttl: u32,
        apply: bool,
    ) -> Result<Option<DnsRecord>> {
        if !apply {
            return Ok(None);
        }
        let payload = serde_json::json!({
            "fieldType": field_type,
            "subDomain": sub_domain,
            "target": target,
            "ttl": ttl,
        });
        let record: DnsRecord =
            self.client.post(&format!("/domain/zone/{zone}/record"), Some(payload)).await?;
        let _ = self.refresh_zone(zone).await;
        Ok(Some(record))
    }

    pub async fn delete_record(&self, zone: &str, id: u64, apply: bool) -> Result<bool> {
        if !apply {
            return Ok(false);
        }
        let _: serde_json::Value =
            self.client.delete(&format!("/domain/zone/{zone}/record/{id}")).await?;
        let _ = self.refresh_zone(zone).await;
        Ok(true)
    }

    pub async fn refresh_zone(&self, zone: &str) -> Result<()> {
        let _: serde_json::Value = self
            .client
            .post(&format!("/domain/zone/{zone}/refresh"), Some(serde_json::json!({})))
            .await?;
        Ok(())
    }

    pub async fn set_a(&self, zone: &str, target_ip: &str, apply: bool) -> Result<Vec<u64>> {
        let records = self.list_records(zone, Some("A")).await?;
        let mut target_ids = Vec::new();
        for r in records {
            if r.sub_domain.is_empty() || r.sub_domain == "www" {
                target_ids.push(r.id);
                if apply && r.target != target_ip {
                    let payload = serde_json::json!({ "target": target_ip });
                    let _: serde_json::Value = self
                        .client
                        .put(&format!("/domain/zone/{zone}/record/{}", r.id), Some(payload))
                        .await?;
                }
            }
        }
        if apply && !target_ids.is_empty() {
            let _ = self.refresh_zone(zone).await;
        }
        Ok(target_ids)
    }

    pub async fn audit_zone(&self, zone: &str) -> Result<DnsAuditReport> {
        let info = self.get_zone(zone).await?;
        let records = self.list_records(zone, None).await?;

        let mut warnings = Vec::new();
        if !info.is_signed && info.dnssec_supported {
            warnings.push("DNSSEC supported but not active".to_string());
        }

        let mut missing_production_subdomains = Vec::new();
        if zone == "aphrody.com" {
            let expected =
                ["@", "n2b", "www", "nie", "api", "cdn", "mcp", "bxc", "downloads", "bot", "admin"];
            let found: std::collections::HashSet<String> = records
                .iter()
                .filter(|r| r.field_type == "A" || r.field_type == "CNAME")
                .map(|r| if r.sub_domain.is_empty() { "@".into() } else { r.sub_domain.clone() })
                .collect();

            for exp in expected {
                if !found.contains(exp) {
                    missing_production_subdomains.push(exp.to_string());
                    warnings.push(format!("Missing production subdomain: {exp}"));
                }
            }
        }

        Ok(DnsAuditReport {
            zone: zone.to_string(),
            dnssec_activated: info.is_signed,
            has_dns_anycast: info.has_dns_anycast,
            name_servers: info.name_servers,
            total_records: records.len(),
            missing_production_subdomains,
            warnings,
        })
    }
}
