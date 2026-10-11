// SPDX-License-Identifier: Apache-2.0
//! Registered domain names (`/domain`): inventory and status. Renewal and the renewal mode go
//! through [`crate::services::ServicesManager`] using the domain's `serviceId`; DNS zones stay in
//! [`crate::dns`].

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::client::OvhClient;

/// Algorithms accepted by the registrar (`dnssec.KeyAlgorithmEnum`).
const DNSSEC_ALGORITHMS: [u8; 11] = [3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16];

/// A DNSSEC key published by the registrar as DS in the parent zone (`dnssec.Key`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnssecKey {
    pub tag: u32,
    pub algorithm: u8,
    pub flags: u16,
    pub public_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

impl DnssecKey {
    /// Parse `<flags> <algorithm> <tag> <public key>`, the values a DNS provider shows for its
    /// key-signing key. Whitespace inside the base64 public key is removed.
    pub fn parse(spec: &str) -> Result<Self> {
        let mut parts = spec.split_whitespace();
        let (Some(flags), Some(algorithm), Some(tag)) = (parts.next(), parts.next(), parts.next())
        else {
            bail!("DNSSEC key must be '<flags> <algorithm> <tag> <public key>'");
        };
        let public_key: String = parts.collect();
        let flags: u16 = flags.parse().map_err(|_| anyhow::anyhow!("invalid flags: {flags}"))?;
        let algorithm: u8 =
            algorithm.parse().map_err(|_| anyhow::anyhow!("invalid algorithm: {algorithm}"))?;
        let tag: u32 = tag.parse().map_err(|_| anyhow::anyhow!("invalid key tag: {tag}"))?;
        if flags != 256 && flags != 257 {
            bail!("DNSSEC flags must be 256 or 257, got {flags}");
        }
        if !DNSSEC_ALGORITHMS.contains(&algorithm) {
            bail!("DNSSEC algorithm {algorithm} is not accepted by the registrar");
        }
        if tag > u32::from(u16::MAX) {
            bail!("DNSSEC key tag out of range: {tag}");
        }
        if public_key.is_empty()
            || !public_key.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
        {
            bail!("DNSSEC public key must be non-empty base64");
        }
        Ok(Self { tag, algorithm, flags, public_key, status: None })
    }
}

/// Exact registrar name-server host names: at least two, lowercase, no trailing dot, unique.
pub fn name_server_hosts(hosts: &[String]) -> Result<Vec<String>> {
    let mut result: Vec<String> = Vec::new();
    for host in hosts {
        let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
        let valid = host.len() <= 253
            && host.split('.').count() >= 2
            && host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            });
        if !valid {
            bail!("invalid name server host: {host}");
        }
        if !result.contains(&host) {
            result.push(host);
        }
    }
    if result.len() < 2 {
        bail!("a domain needs at least two distinct name servers");
    }
    Ok(result)
}

/// Registration state of a domain (`GET /domain/{serviceName}`), without any contact data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainInfo {
    pub domain: String,
    pub service_id: u64,
    pub state: String,
    pub suspension_state: String,
    pub offer: String,
    pub expiration: String,
    pub renewal_date: String,
    /// `automatic_renew`, `manual_renew`, `unpaid`, `cancellation_requested`, ...
    pub renewal_state: String,
    pub dnssec_state: String,
    pub transfer_lock: String,
    pub name_server_type: String,
    pub name_servers: Vec<String>,
}

fn text(raw: &Value, key: &str) -> String {
    raw.get(key).and_then(Value::as_str).unwrap_or("?").to_string()
}

impl DomainInfo {
    pub fn from_json(raw: &Value) -> Self {
        Self {
            domain: text(raw, "domain"),
            service_id: raw.get("serviceId").and_then(Value::as_u64).unwrap_or(0),
            state: text(raw, "state"),
            suspension_state: text(raw, "suspensionState"),
            offer: text(raw, "offer"),
            expiration: text(raw, "expirationDate"),
            renewal_date: text(raw, "renewalDate"),
            renewal_state: text(raw, "renewalState"),
            dnssec_state: text(raw, "dnssecState"),
            transfer_lock: text(raw, "transferLockStatus"),
            name_server_type: text(raw, "nameServerType"),
            name_servers: raw
                .get("nameServers")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|ns| ns.get("nameServer").and_then(Value::as_str))
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub fn auto_renew(&self) -> bool {
        self.renewal_state == "automatic_renew"
    }
}

pub struct DomainManager<'a> {
    client: &'a OvhClient,
}

impl<'a> DomainManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client }
    }

    pub async fn list(&self) -> Result<Vec<String>> {
        self.client.get("/domain").await
    }

    pub async fn info(&self, domain: &str) -> Result<DomainInfo> {
        let raw: Value = self.client.get(&format!("/domain/{domain}")).await?;
        Ok(DomainInfo::from_json(&raw))
    }

    /// DS keys the registrar currently publishes in the parent zone.
    pub async fn ds_records(&self, domain: &str) -> Result<Vec<DnssecKey>> {
        let ids: Vec<u64> = self.client.get(&format!("/domain/{domain}/dsRecord")).await?;
        let mut keys = Vec::with_capacity(ids.len());
        for id in ids {
            keys.push(self.client.get(&format!("/domain/{domain}/dsRecord/{id}")).await?);
        }
        Ok(keys)
    }

    /// Replace the published DS keys; returns the registrar task.
    pub async fn set_ds_records(&self, domain: &str, keys: &[DnssecKey]) -> Result<Value> {
        let keys: Vec<Value> = keys
            .iter()
            .map(|k| {
                json!({
                    "tag": k.tag,
                    "algorithm": k.algorithm,
                    "flags": k.flags,
                    "publicKey": k.public_key,
                })
            })
            .collect();
        self.client.post(&format!("/domain/{domain}/dsRecord"), Some(json!({ "keys": keys }))).await
    }

    /// Replace the registrar name servers; returns the registrar task.
    pub async fn set_name_servers(&self, domain: &str, hosts: &[String]) -> Result<Value> {
        self.client
            .post(
                &format!("/domain/{domain}/nameServers/update"),
                Some(name_servers_payload(hosts)?),
            )
            .await
    }

    /// Select external DNS before changing the registrar's declared name servers.
    pub async fn set_external_name_server_type(&self, domain: &str) -> Result<Value> {
        self.client
            .put(&format!("/domain/{domain}"), Some(external_name_server_type_payload()))
            .await
    }

    /// IDs of tasks associated with this domain name.
    pub async fn task_ids(&self, domain: &str) -> Result<Vec<u64>> {
        self.client.get(&format!("/domain/{domain}/task")).await
    }

    /// Details for a registrar task associated with this domain name.
    pub async fn task(&self, domain: &str, id: u64) -> Result<Value> {
        self.client.get(&format!("/domain/{domain}/task/{id}")).await
    }

    /// Signing state of the zone hosted on OVH DNS (`enabled`, `disableInProgress`, ...).
    pub async fn hosted_dnssec(&self, zone: &str) -> Result<String> {
        let raw: Value = self.client.get(&format!("/domain/zone/{zone}/dnssec")).await?;
        Ok(text(&raw, "status"))
    }

    /// Stop OVH-hosted signing; OVH withdraws its DS from the parent zone first.
    pub async fn disable_hosted_dnssec(&self, zone: &str) -> Result<()> {
        let _: Value = self.client.delete(&format!("/domain/zone/{zone}/dnssec")).await?;
        Ok(())
    }
}

fn name_servers_payload(hosts: &[String]) -> Result<Value> {
    let servers: Vec<Value> =
        name_server_hosts(hosts)?.into_iter().map(|host| json!({ "host": host })).collect();
    Ok(json!({ "nameServer": servers }))
}

fn external_name_server_type_payload() -> Value {
    json!({ "nameServerType": "external" })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_domain_state_without_contacts() {
        let info = DomainInfo::from_json(&json!({
            "domain": "example.test", "serviceId": 75523385, "state": "ok",
            "suspensionState": "not_suspended", "offer": "gold",
            "expirationDate": "2027-09-04T13:42:27Z", "renewalDate": "2027-09-01T13:42:27Z",
            "renewalState": "automatic_renew", "dnssecState": "enabled",
            "transferLockStatus": "locked", "nameServerType": "anycast",
            "nameServers": [{ "nameServer": "dns200.anycast.me" }, { "nameServer": "ns200.anycast.me" }],
            "contactOwner": { "id": "private" }
        }));
        assert_eq!(info.domain, "example.test");
        assert_eq!(info.service_id, 75523385);
        assert!(info.auto_renew());
        assert_eq!(info.name_servers, vec!["dns200.anycast.me", "ns200.anycast.me"]);
        assert!(!serde_json::to_string(&info).unwrap().contains("private"));
        assert!(!DomainInfo::from_json(&json!({ "renewalState": "manual_renew" })).auto_renew());
    }

    #[test]
    fn dnssec_keys_parse_validate_and_round_trip_registrar_payloads() {
        let key = DnssecKey::parse("257 13 2371 mdsswUyr3DPW132mOi8V9xESWE8jTo0d\n xQjjnopKl+GqJxpVXckHAeF+KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==")
            .expect("key");
        assert_eq!((key.flags, key.algorithm, key.tag), (257, 13, 2371));
        assert!(!key.public_key.contains(char::is_whitespace));
        for invalid in
            ["257 13", "255 13 1 AA==", "257 9 1 AA==", "257 13 70000 AA==", "257 13 1 a;b"]
        {
            assert!(DnssecKey::parse(invalid).is_err(), "{invalid}");
        }
        let listed: DnssecKey = serde_json::from_value(json!({
            "id": 7, "tag": 62047, "algorithm": 8, "flags": 257, "publicKey": "AA==", "status": "created"
        }))
        .expect("registrar key");
        assert_eq!(listed.status.as_deref(), Some("created"));
        assert_eq!(serde_json::to_value(&key).unwrap()["publicKey"], key.public_key.as_str());
    }

    #[test]
    fn name_servers_are_normalized_deduplicated_and_at_least_two() {
        assert_eq!(
            name_server_hosts(&["Duke.NS.cloudflare.com.".into(), "veda.ns.cloudflare.com".into()])
                .expect("hosts"),
            vec!["duke.ns.cloudflare.com", "veda.ns.cloudflare.com"]
        );
        assert!(name_server_hosts(&["a.example.com".into(), "A.example.com".into()]).is_err());
        assert!(name_server_hosts(&["localhost".into(), "b.example.com".into()]).is_err());
        assert!(name_server_hosts(&["-a.example.com".into(), "b.example.com".into()]).is_err());
    }

    #[test]
    fn name_servers_update_uses_the_registrar_payload_key() {
        let payload = name_servers_payload(&[
            "Duke.NS.cloudflare.com.".into(),
            "veda.ns.cloudflare.com".into(),
        ])
        .expect("valid name servers");

        assert_eq!(
            payload,
            json!({
                "nameServer": [
                    { "host": "duke.ns.cloudflare.com" },
                    { "host": "veda.ns.cloudflare.com" }
                ]
            })
        );
        assert!(payload.get("nameServers").is_none());
    }

    #[test]
    fn external_dns_setup_uses_the_documented_domain_field() {
        assert_eq!(external_name_server_type_payload(), json!({ "nameServerType": "external" }));
    }
}
