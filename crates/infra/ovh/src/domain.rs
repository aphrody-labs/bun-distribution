// SPDX-License-Identifier: Apache-2.0
//! Registered domain names (`/domain`): inventory and status. Renewal and the renewal mode go
//! through [`crate::services::ServicesManager`] using the domain's `serviceId`; DNS zones stay in
//! [`crate::dns`].

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::OvhClient;

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
}
