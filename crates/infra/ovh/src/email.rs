// SPDX-License-Identifier: Apache-2.0
//! Native OVH Email domain and deliverability audit.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{client::OvhClient, dns::DnsManager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailDomainInfo {
    pub domain: String,
    pub status: String,
    pub offer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRedirection {
    pub id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailDnsAuditReport {
    pub domain: String,
    pub mx_valid: bool,
    pub mx_records: Vec<String>,
    pub spf_valid: bool,
    pub spf_record: Option<String>,
    pub dmarc_valid: bool,
    pub dmarc_record: Option<String>,
    pub dkim_valid: bool,
    pub dkim_selectors_count: usize,
    pub status: String,
    pub recommendations: Vec<String>,
}

pub struct EmailManager<'a> {
    client: &'a OvhClient,
    dns: DnsManager<'a>,
}

impl<'a> EmailManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client, dns: DnsManager::new(client) }
    }

    pub async fn get_domain(&self, domain: &str) -> Result<EmailDomainInfo> {
        let raw: serde_json::Value = self.client.get(&format!("/email/domain/{domain}")).await?;
        Ok(EmailDomainInfo {
            domain: raw.get("domain").and_then(|v| v.as_str()).unwrap_or(domain).to_string(),
            status: raw.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            offer: raw.get("offer").and_then(|v| v.as_str()).unwrap_or("mxplan").to_string(),
        })
    }

    pub async fn list_redirections(&self, domain: &str) -> Result<Vec<EmailRedirection>> {
        let ids: Vec<String> =
            self.client.get(&format!("/email/domain/{domain}/redirection")).await?;
        let mut list = Vec::new();
        for id in ids {
            if let Ok(red) = self
                .client
                .get::<EmailRedirection>(&format!("/email/domain/{domain}/redirection/{id}"))
                .await
            {
                list.push(red);
            }
        }
        Ok(list)
    }

    pub async fn audit_email_dns(&self, domain: &str) -> Result<EmailDnsAuditReport> {
        let records = self.dns.list_records(domain, None).await?;

        let mx_records: Vec<String> = records
            .iter()
            .filter(|r| r.field_type == "MX" && (r.sub_domain.is_empty() || r.sub_domain == "@"))
            .map(|r| r.target.clone())
            .collect();
        let mx_valid = mx_records.iter().any(|t| t.contains("mail.ovh.net"));

        let spf_record = records
            .iter()
            .find(|r| {
                (r.field_type == "SPF" || r.field_type == "TXT")
                    && (r.sub_domain.is_empty() || r.sub_domain == "@")
                    && r.target.contains("v=spf1")
            })
            .map(|r| r.target.clone());
        let spf_valid = spf_record.as_ref().map(|s| s.contains("mx.ovh.com")).unwrap_or(false);

        let dmarc_record = records
            .iter()
            .find(|r| {
                r.field_type == "TXT" && r.sub_domain == "_dmarc" && r.target.contains("v=DMARC1")
            })
            .map(|r| r.target.clone());
        let dmarc_valid = dmarc_record.is_some();

        let dkim_selectors =
            records.iter().filter(|r| r.sub_domain.contains("._domainkey")).count();
        let dkim_valid = dkim_selectors >= 2;

        let mut recommendations = Vec::new();
        if !mx_valid {
            recommendations.push("Configure OVH MX mail servers in DNS".into());
        }
        if !spf_valid {
            recommendations.push("Publish valid SPF record with include:mx.ovh.com".into());
        }
        if !dmarc_valid {
            recommendations.push("Publish DMARC record on _dmarc TXT".into());
        }
        if !dkim_valid {
            recommendations.push("Publish DKIM CNAME selectors ovhmo-selector-1 and 2".into());
        }

        let status = if !mx_valid || !spf_valid {
            "CRITICAL".into()
        } else if !dmarc_valid || !dkim_valid {
            "WARNING".into()
        } else {
            "SECURE".into()
        };

        Ok(EmailDnsAuditReport {
            domain: domain.to_string(),
            mx_valid,
            mx_records,
            spf_valid,
            spf_record,
            dmarc_valid,
            dmarc_record,
            dkim_valid,
            dkim_selectors_count: dkim_selectors,
            status,
            recommendations,
        })
    }
}
