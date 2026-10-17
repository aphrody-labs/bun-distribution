// SPDX-License-Identifier: Apache-2.0
//! Native OVH DNS Zone and Record management.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::client::OvhClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsZoneInfo {
    pub name: String,
    pub has_dns_anycast: bool,
    pub dnssec_supported: bool,
    // OVH's current zone response uses dnssecActivated. Keep isSigned for
    // older responses and the existing serialized native API contract.
    #[serde(
        rename(serialize = "isSigned", deserialize = "dnssecActivated"),
        alias = "isSigned"
    )]
    pub is_signed: bool,
    #[serde(default)]
    pub name_servers: Vec<String>,
    #[serde(default)]
    pub last_update: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_dnssec_accepts_current_and_legacy_api_fields() {
        for field in ["dnssecActivated", "isSigned"] {
            for activated in [true, false] {
                let mut payload = serde_json::json!({
                    "name": "example.com",
                    "hasDnsAnycast": true,
                    "dnssecSupported": true,
                    "nameServers": ["dns.example.com"],
                    "iam": { "state": "OK" }
                });
                payload[field] = serde_json::json!(activated);
                let info: DnsZoneInfo = serde_json::from_value(payload).expect("zone response");
                assert_eq!(info.is_signed, activated);
                assert_eq!(info.name_servers, ["dns.example.com"]);
                let serialized = serde_json::to_value(info).expect("native response");
                assert_eq!(serialized["isSigned"], activated);
            }
        }
    }

    #[test]
    fn zone_dnssec_missing_or_invalid_state_fails_closed() {
        let payload = serde_json::json!({
            "name": "example.com",
            "hasDnsAnycast": true,
            "dnssecSupported": true
        });
        assert!(serde_json::from_value::<DnsZoneInfo>(payload.clone()).is_err());
        let mut invalid = payload;
        invalid["dnssecActivated"] = serde_json::json!("true");
        assert!(serde_json::from_value::<DnsZoneInfo>(invalid).is_err());
    }

    fn record(id: u64, name: &str, kind: &str) -> DnsRecord {
        DnsRecord {
            id,
            zone: "example.com".into(),
            sub_domain: name.into(),
            field_type: kind.into(),
            target: "203.0.113.1".into(),
            ttl: 300,
        }
    }

    #[test]
    fn a_selection_defaults_and_explicit_names_preserve_ids_and_ttl() {
        let records = vec![
            record(1, "", "A"),
            record(2, "www", "A"),
            record(3, "bot", "A"),
            record(4, "cdn", "A"),
            record(5, "mcp", "A"),
            record(6, "cdn", "AAAA"),
        ];
        let defaults = select_a_records(&records, &[]).expect("default selection");
        assert_eq!(
            defaults.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        let selected = select_a_records(
            &records,
            &["@".into(), "www".into(), "bot".into(), "cdn".into()],
        )
        .expect("explicit selection");
        assert_eq!(
            selected.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        assert!(
            selected
                .iter()
                .all(|r| r.ttl == 300 && r.target == "203.0.113.1")
        );
        assert!(select_a_records(&records, &["missing".into()]).is_err());
    }

    #[test]
    fn a_selectors_are_exact_validated_and_deduplicated() {
        assert_eq!(
            a_subdomains(&["@".into(), "".into(), "BOT".into(), "bot".into()])
                .expect("canonical selectors"),
            vec!["", "bot"]
        );
        for invalid in [
            "*",
            "bot;id",
            "bot/child",
            " www",
            "www.",
            ".www",
            "a..b",
            "-bot",
            "bot-",
            "a_b",
        ] {
            assert!(a_subdomains(&[invalid.into()]).is_err(), "{invalid}");
        }
        assert!(a_subdomains(&["a".repeat(64)]).is_err());
        assert!(a_subdomains(&["assets.cdn".into()]).is_ok());
    }
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

/// Exact relative DNS selectors. Omitted selectors retain apex + www.
pub fn a_subdomains(selectors: &[String]) -> Result<Vec<String>> {
    let defaults = [String::new(), "www".to_owned()];
    let selectors = if selectors.is_empty() {
        &defaults[..]
    } else {
        selectors
    };
    let mut result = Vec::new();
    for selector in selectors {
        let normalized = if selector == "@" {
            String::new()
        } else {
            selector.to_ascii_lowercase()
        };
        if !normalized.is_empty()
            && (normalized.len() > 253
                || normalized.split('.').any(|label| {
                    label.is_empty()
                        || label.len() > 63
                        || label.starts_with('-')
                        || label.ends_with('-')
                        || !label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                }))
        {
            bail!("invalid exact DNS subdomain selector: {selector}");
        }
        if !result.contains(&normalized) {
            result.push(normalized);
        }
    }
    Ok(result)
}

/// Select all requested A records before any write; missing names fail closed.
pub fn select_a_records<'a>(
    records: &'a [DnsRecord],
    selectors: &[String],
) -> Result<Vec<&'a DnsRecord>> {
    let selectors = a_subdomains(selectors)?;
    for selector in &selectors {
        if !records.iter().any(|record| {
            record.field_type == "A" && record.sub_domain.eq_ignore_ascii_case(selector)
        }) {
            bail!(
                "requested DNS A record is missing: {}",
                if selector.is_empty() { "@" } else { selector }
            );
        }
    }
    Ok(records
        .iter()
        .filter(|record| {
            record.field_type == "A"
                && selectors
                    .iter()
                    .any(|selector| record.sub_domain.eq_ignore_ascii_case(selector))
        })
        .collect())
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
        self.client
            .get(&format!("/domain/zone/{zone}/export"))
            .await
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
        self.client
            .get(&format!("/domain/zone/{zone}/record/{id}"))
            .await
    }

    pub async fn list_records(
        &self,
        zone: &str,
        field_type: Option<&str>,
    ) -> Result<Vec<DnsRecord>> {
        let ids = self.list_record_ids(zone, field_type).await?;
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(self.get_record(zone, id).await?);
        }
        records.sort_by(|a, b| {
            a.field_type
                .cmp(&b.field_type)
                .then_with(|| a.sub_domain.cmp(&b.sub_domain))
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
        let record: DnsRecord = self
            .client
            .post(&format!("/domain/zone/{zone}/record"), Some(payload))
            .await?;
        self.refresh_zone(zone).await?;
        Ok(Some(record))
    }

    pub async fn delete_record(&self, zone: &str, id: u64, apply: bool) -> Result<bool> {
        if !apply {
            return Ok(false);
        }
        let _: serde_json::Value = self
            .client
            .delete(&format!("/domain/zone/{zone}/record/{id}"))
            .await?;
        self.refresh_zone(zone).await?;
        Ok(true)
    }

    pub async fn refresh_zone(&self, zone: &str) -> Result<()> {
        let _: serde_json::Value = self
            .client
            .post(
                &format!("/domain/zone/{zone}/refresh"),
                Some(serde_json::json!({})),
            )
            .await?;
        Ok(())
    }

    pub async fn set_a(&self, zone: &str, target_ip: &str, apply: bool) -> Result<Vec<u64>> {
        self.set_a_subdomains(zone, target_ip, &[], apply).await
    }

    pub async fn set_a_subdomains(
        &self,
        zone: &str,
        target_ip: &str,
        selectors: &[String],
        apply: bool,
    ) -> Result<Vec<u64>> {
        target_ip
            .parse::<std::net::Ipv4Addr>()
            .context("A record target must be an IPv4 address")?;
        a_subdomains(selectors)?;
        let records = self.list_records(zone, Some("A")).await?;
        let selected = select_a_records(&records, selectors)?;
        let mut target_ids = Vec::new();
        for r in selected {
            target_ids.push(r.id);
            if apply && r.target != target_ip {
                let payload = serde_json::json!({ "target": target_ip });
                let _: serde_json::Value = self
                    .client
                    .put(
                        &format!("/domain/zone/{zone}/record/{}", r.id),
                        Some(payload),
                    )
                    .await?;
            }
        }
        if apply && !target_ids.is_empty() {
            self.refresh_zone(zone).await?;
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
            let expected = [
                "@",
                "n2b",
                "www",
                "nie",
                "cdn",
                "mcp",
                "bxc",
                "downloads",
                "bot",
                "admin",
            ];
            let found: std::collections::HashSet<String> = records
                .iter()
                .filter(|r| r.field_type == "A" || r.field_type == "CNAME")
                .map(|r| {
                    if r.sub_domain.is_empty() {
                        "@".into()
                    } else {
                        r.sub_domain.clone()
                    }
                })
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
