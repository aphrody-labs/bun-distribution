// SPDX-License-Identifier: Apache-2.0
//! Generic OVH service management over `/services` (any product: domain, DNS zone, email, VPS,
//! IP, Public Cloud, vRack), plus the renewal order flow shared with [`crate::vps::VpsManager`].

use anyhow::{Result, anyhow, bail};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::OvhClient;

/// Route template of VPS services in `/services/{id}`.
const VPS_ROUTE: &str = "/vps/{serviceName}";

/// One service as reported by `GET /services/{serviceId}`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceInfo {
    pub service_id: u64,
    pub resource_name: String,
    pub display_name: Option<String>,
    /// Plan / product code (`resource.product.name`, else `billing.plan.code`).
    pub plan: String,
    pub description: Option<String>,
    /// Route template of the product API (`/domain/{serviceName}`), when it has one.
    pub route: Option<String>,
    pub resource_state: String,
    pub lifecycle_state: String,
    pub expiration: Option<String>,
    /// `automatic` or `manual`; absent for options renewed with their parent service.
    pub renew_mode: Option<String>,
    pub next_renewal: Option<String>,
    pub pending_actions: Vec<String>,
}

fn text(value: &Value, pointer: &str) -> Option<String> {
    value.pointer(pointer).and_then(Value::as_str).map(ToString::to_string)
}

impl ServiceInfo {
    pub fn from_json(raw: &Value) -> Self {
        let pending_actions = raw
            .pointer("/billing/lifecycle/current/pendingActions")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).map(ToString::to_string).collect())
            .unwrap_or_default();
        Self {
            service_id: raw.get("serviceId").and_then(Value::as_u64).unwrap_or(0),
            resource_name: text(raw, "/resource/name").unwrap_or_default(),
            display_name: text(raw, "/resource/displayName").filter(|n| !n.is_empty()),
            plan: text(raw, "/resource/product/name")
                .or_else(|| text(raw, "/billing/plan/code"))
                .unwrap_or_else(|| "?".into()),
            description: text(raw, "/resource/product/description"),
            route: text(raw, "/route/path"),
            resource_state: text(raw, "/resource/state").unwrap_or_else(|| "unknown".into()),
            lifecycle_state: text(raw, "/billing/lifecycle/current/state")
                .unwrap_or_else(|| "unknown".into()),
            expiration: text(raw, "/billing/expirationDate"),
            renew_mode: text(raw, "/billing/renew/current/mode"),
            next_renewal: text(raw, "/billing/renew/current/nextDate"),
            pending_actions,
        }
    }

    /// Termination at expiration is scheduled (the equivalent of `deleteAtExpiration`).
    pub fn delete_at_expiration(&self) -> bool {
        self.pending_actions
            .iter()
            .any(|a| a == "deleteAtExpiration" || a == "terminateAtExpirationDate")
    }

    pub fn expiration_date(&self) -> Option<NaiveDate> {
        let raw = self.expiration.as_deref()?;
        NaiveDate::parse_from_str(raw.get(..10)?, "%Y-%m-%d").ok()
    }

    pub fn is_vps(&self) -> bool {
        self.route.as_deref() == Some(VPS_ROUTE)
    }
}

/// Alerts for one service: expired or unpaid lifecycle, suspension, manual renewal close to
/// expiry, scheduled termination, and a stopped VPS (`runtime_state`).
///
/// Services without a renewal mode (options renewed with their parent) and legacy free products
/// whose expiration date is stale while still `active` never raise date alerts.
pub fn evaluate_service(
    info: &ServiceInfo,
    runtime_state: Option<&str>,
    today: NaiveDate,
    threshold_days: i64,
) -> Vec<String> {
    let mut alerts = Vec::new();
    let lifecycle = info.lifecycle_state.as_str();
    let mut expired = false;

    match lifecycle {
        "unrenewed" | "terminated" => {
            alerts.push("Service expiré".to_string());
            expired = true;
        },
        "unpaid" => {
            alerts.push("Service impayé".to_string());
            expired = true;
        },
        "error" | "rupture" => {
            alerts.push(format!("Cycle de vie: {lifecycle}"));
            expired = true;
        },
        _ => {},
    }
    if info.resource_state == "suspended" {
        alerts.push("Ressource suspendue".to_string());
    }

    let manual = info.renew_mode.as_deref() == Some("manual");
    if manual
        && !expired
        && let Some(days) = info.expiration_date().map(|d| (d - today).num_days())
    {
        if days <= 0 {
            alerts.push("Service expiré".to_string());
            expired = true;
        } else if days <= threshold_days {
            alerts.push(format!("Expiration dans {days} jour{}", if days == 1 { "" } else { "s" }));
        }
    }

    if !expired {
        if info.delete_at_expiration() {
            alerts.push("Suppression à expiration: OUI (risqué)".to_string());
        }
        if manual {
            alerts.push("Renouvellement manuel (alerte requise)".to_string());
        }
    }
    if runtime_state == Some("stopped") {
        alerts.push("État: ARRÊTÉ".to_string());
    }
    alerts
}

/// Pick the service named `target` (exact, case-insensitive resource name); several matches
/// (a domain also owns a zone, an email and a DNS service) must be disambiguated by id.
pub fn select_by_name<'a>(services: &'a [ServiceInfo], target: &str) -> Result<&'a ServiceInfo> {
    let matches: Vec<&ServiceInfo> =
        services.iter().filter(|s| s.resource_name.eq_ignore_ascii_case(target)).collect();
    match matches.as_slice() {
        [one] => Ok(*one),
        [] => bail!("no OVH service named '{target}' (see `aphrody ovh services`)"),
        many => {
            let list = many
                .iter()
                .map(|s| format!("{} ({})", s.service_id, s.plan))
                .collect::<Vec<_>>()
                .join(", ");
            bail!("'{target}' matches several services, pass the service id: {list}")
        },
    }
}

/// Price of one renewal period, from a dry-run renew order (nothing is ordered).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewQuote {
    pub period: String,
    pub services: Vec<u64>,
    pub price_without_tax: String,
    pub price_with_tax: String,
}

/// A created renewal order, unpaid until [`ServicesManager::pay_order`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenewOrder {
    pub order_id: u64,
    pub url: String,
    pub price_with_tax: String,
}

fn text_field(value: &Value, key: &str) -> String {
    value.get(key).and_then(|v| v.get("text")).and_then(|v| v.as_str()).unwrap_or("?").to_string()
}

/// Offered renewal periods (`GET /service/{id}/renew`), in the order OVH lists them.
pub fn offered_periods(offers: &[Value]) -> Vec<String> {
    offers
        .iter()
        .filter_map(|o| o.get("renewPeriod").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect()
}

/// The offer for `period`, or the first listed one (the shortest) when no period is requested.
pub fn select_offer<'a>(
    offers: &'a [Value],
    service_id: u64,
    period: Option<&str>,
) -> Result<&'a Value> {
    let found = match period {
        Some(p) => offers.iter().find(|o| o.get("renewPeriod").and_then(Value::as_str) == Some(p)),
        None => offers.first(),
    };
    found.ok_or_else(|| {
        anyhow!(
            "no {} renewal offered for service {service_id}; offered: {}",
            period.unwrap_or("default"),
            offered_periods(offers).join(", ")
        )
    })
}

/// Service ids an offer renews: its first strategy's `services`, else the ids of its
/// `servicesDetails`, else the service itself.
pub fn offer_services(offer: &Value, service_id: u64) -> Vec<u64> {
    let ids = |pointer: &str, key: Option<&str>| -> Vec<u64> {
        offer
            .pointer(pointer)
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|item| match key {
                        Some(k) => item.get(k).and_then(Value::as_u64),
                        None => item.as_u64(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let direct = ids("/strategies/0/services", None);
    if !direct.is_empty() {
        return direct;
    }
    let detailed = ids("/strategies/0/servicesDetails", Some("serviceId"));
    if detailed.is_empty() { vec![service_id] } else { detailed }
}

pub struct ServicesManager<'a> {
    client: &'a OvhClient,
}

impl<'a> ServicesManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client }
    }

    pub async fn list_ids(&self) -> Result<Vec<u64>> {
        self.client.get("/services").await
    }

    pub async fn get(&self, service_id: u64) -> Result<ServiceInfo> {
        let raw: Value = self.client.get(&format!("/services/{service_id}")).await?;
        Ok(ServiceInfo::from_json(&raw))
    }

    /// Every service of the account, sorted by id.
    pub async fn list_all(&self) -> Result<Vec<ServiceInfo>> {
        let mut ids = self.list_ids().await?;
        ids.sort_unstable();
        let mut services = Vec::with_capacity(ids.len());
        for id in ids {
            services.push(self.get(id).await?);
        }
        Ok(services)
    }

    /// Resolve a service id or an exact resource name.
    pub async fn resolve(&self, target: &str) -> Result<u64> {
        if let Ok(id) = target.parse::<u64>() {
            return Ok(id);
        }
        let all = self.list_all().await?;
        select_by_name(&all, target).map(|s| s.service_id)
    }

    /// Price one renewal `period` (ISO 8601, e.g. `P1M`, `P1Y`; first offer when `None`) with a
    /// dry-run order: nothing is ordered.
    pub async fn renew_quote(&self, service_id: u64, period: Option<&str>) -> Result<RenewQuote> {
        let offers: Vec<Value> = self.client.get(&format!("/service/{service_id}/renew")).await?;
        let offer = select_offer(&offers, service_id, period)?;
        let chosen = offer
            .get("renewPeriod")
            .and_then(Value::as_str)
            .or(period)
            .ok_or_else(|| anyhow!("renewal offer of service {service_id} has no period"))?
            .to_string();
        let services = offer_services(offer, service_id);
        let body = serde_json::json!({ "dryRun": true, "duration": chosen, "services": services });
        let dry: Value =
            self.client.post(&format!("/service/{service_id}/renew"), Some(body)).await?;
        Ok(RenewQuote {
            period: chosen,
            services,
            price_without_tax: text_field(&dry, "priceWithoutTax"),
            price_with_tax: text_field(&dry, "priceWithTax"),
        })
    }

    /// Create the renewal order of a quote. It stays unpaid until [`Self::pay_order`].
    pub async fn renew(&self, service_id: u64, quote: &RenewQuote) -> Result<RenewOrder> {
        let body = serde_json::json!({
            "dryRun": false,
            "duration": quote.period,
            "services": quote.services,
        });
        let order: Value =
            self.client.post(&format!("/service/{service_id}/renew"), Some(body)).await?;
        Ok(RenewOrder {
            order_id: order.get("orderId").and_then(Value::as_u64).unwrap_or(0),
            url: order.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
            price_with_tax: text_field(&order, "priceWithTax"),
        })
    }

    /// Pay an order with the account's default registered payment method (else the first one).
    pub async fn pay_order(&self, order_id: u64) -> Result<u64> {
        let methods: Value =
            self.client.get(&format!("/me/order/{order_id}/paymentMethods")).await?;
        let default = methods
            .get("paymentMethods")
            .and_then(Value::as_array)
            .and_then(|list| {
                list.iter().find(|m| m.get("default").and_then(Value::as_bool) == Some(true))
            })
            .and_then(|m| m.get("paymentMethodId").and_then(Value::as_u64));
        let id = default
            .or_else(|| methods.pointer("/registered/0").and_then(Value::as_u64))
            .ok_or_else(|| anyhow!("no registered payment method for order {order_id}"))?;
        let _: Value = self
            .client
            .post(
                &format!("/me/order/{order_id}/pay"),
                Some(serde_json::json!({ "paymentMethod": { "id": id } })),
            )
            .await?;
        Ok(id)
    }

    /// Switch the renewal mode (`PUT /services/{id}` with `renew.mode`).
    pub async fn set_renew_mode(&self, service_id: u64, automatic: bool) -> Result<()> {
        let mode = if automatic { "automatic" } else { "manual" };
        let _: Value = self
            .client
            .put(
                &format!("/services/{service_id}"),
                Some(serde_json::json!({ "renew": { "mode": mode } })),
            )
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn fixture(lifecycle: &str, mode: Option<&str>, expiration: &str) -> ServiceInfo {
        ServiceInfo::from_json(&json!({
            "serviceId": 42,
            "route": { "path": "/domain/{serviceName}" },
            "billing": {
                "expirationDate": expiration,
                "lifecycle": { "current": { "state": lifecycle, "pendingActions": [] } },
                "renew": { "current": { "mode": mode } }
            },
            "resource": { "name": "example.test", "state": "active",
                          "product": { "name": "com-product", "description": "Domain .com" } }
        }))
    }

    #[test]
    fn parses_a_service_payload() {
        let info = fixture("active", Some("automatic"), "2027-09-04T13:42:27Z");
        assert_eq!(info.service_id, 42);
        assert_eq!(info.resource_name, "example.test");
        assert_eq!(info.plan, "com-product");
        assert_eq!(info.renew_mode.as_deref(), Some("automatic"));
        assert_eq!(info.expiration_date(), Some(day("2027-09-04")));
        assert!(!info.is_vps());
        // Child option: no renewal mode, no route.
        let option =
            ServiceInfo::from_json(&json!({ "serviceId": 7, "billing": {}, "resource": {} }));
        assert_eq!(option.renew_mode, None);
        assert_eq!(option.lifecycle_state, "unknown");
    }

    #[test]
    fn healthy_automatic_service_has_no_alert() {
        let info = fixture("active", Some("automatic"), "2026-10-06T00:00:00Z");
        assert!(evaluate_service(&info, None, day("2026-10-05"), 14).is_empty());
    }

    #[test]
    fn stale_dates_of_children_and_free_products_stay_quiet() {
        let child = fixture("active", None, "2026-01-03T00:00:00Z");
        assert!(evaluate_service(&child, None, day("2026-10-05"), 14).is_empty());
    }

    #[test]
    fn manual_renewal_alerts_within_the_threshold() {
        let info = fixture("active", Some("manual"), "2026-10-15T00:00:00Z");
        let alerts = evaluate_service(&info, None, day("2026-10-05"), 14);
        assert!(alerts.iter().any(|a| a == "Expiration dans 10 jours"));
        assert!(alerts.iter().any(|a| a.contains("Renouvellement manuel")));
        let far = fixture("active", Some("manual"), "2027-01-01T00:00:00Z");
        let far_alerts = evaluate_service(&far, None, day("2026-10-05"), 14);
        assert_eq!(far_alerts, vec!["Renouvellement manuel (alerte requise)".to_string()]);
        let tomorrow = fixture("active", Some("manual"), "2026-10-06T00:00:00Z");
        assert!(
            evaluate_service(&tomorrow, None, day("2026-10-05"), 14)
                .contains(&"Expiration dans 1 jour".to_string())
        );
    }

    #[test]
    fn expired_lifecycle_and_suspension_alert_without_noise() {
        let mut info = fixture("unrenewed", Some("manual"), "2026-10-01T10:25:27Z");
        info.resource_state = "suspended".into();
        let alerts = evaluate_service(&info, Some("stopped"), day("2026-10-05"), 14);
        assert_eq!(
            alerts,
            vec![
                "Service expiré".to_string(),
                "Ressource suspendue".to_string(),
                "État: ARRÊTÉ".to_string()
            ]
        );
        let manual_past = fixture("active", Some("manual"), "2026-10-01T00:00:00Z");
        assert_eq!(
            evaluate_service(&manual_past, None, day("2026-10-05"), 14),
            vec!["Service expiré".to_string()]
        );
    }

    #[test]
    fn scheduled_termination_is_flagged() {
        let mut info = fixture("active", Some("automatic"), "2027-01-01T00:00:00Z");
        info.pending_actions = vec!["terminateAtExpirationDate".into()];
        assert!(info.delete_at_expiration());
        let alerts = evaluate_service(&info, None, day("2026-10-05"), 14);
        assert!(alerts.iter().any(|a| a.contains("Suppression à expiration")));
    }

    #[test]
    fn names_resolve_uniquely_or_report_candidates() {
        let mut zone = fixture("active", Some("automatic"), "2027-01-01T00:00:00Z");
        zone.service_id = 1;
        zone.resource_name = "aphrody.com".into();
        zone.plan = "zone".into();
        let mut domain = zone.clone();
        domain.service_id = 2;
        domain.plan = "com-product".into();
        let mut vps = zone.clone();
        vps.service_id = 3;
        vps.resource_name = "vps-1".into();
        let all = vec![zone, domain, vps];
        assert_eq!(select_by_name(&all, "VPS-1").unwrap().service_id, 3);
        let ambiguous = select_by_name(&all, "aphrody.com").unwrap_err().to_string();
        assert!(ambiguous.contains("1 (zone)") && ambiguous.contains("2 (com-product)"));
        assert!(select_by_name(&all, "missing").is_err());
    }

    #[test]
    fn renewal_offers_are_selected_by_period() {
        let offers = vec![
            json!({ "renewPeriod": "P1Y", "strategies": [{ "services": [75523385] }] }),
            json!({ "renewPeriod": "P2Y", "strategies": [{ "servicesDetails": [
                { "serviceId": 5 }, { "serviceId": 6 }] }] }),
        ];
        assert_eq!(select_offer(&offers, 9, None).unwrap()["renewPeriod"], "P1Y");
        let p2 = select_offer(&offers, 9, Some("P2Y")).unwrap();
        assert_eq!(offer_services(p2, 9), vec![5, 6]);
        assert_eq!(offer_services(&offers[0], 9), vec![75523385]);
        assert_eq!(offer_services(&json!({}), 9), vec![9]);
        let error = select_offer(&offers, 9, Some("P3M")).unwrap_err().to_string();
        assert!(error.contains("P1Y, P2Y"));
        assert_eq!(offered_periods(&offers), vec!["P1Y", "P2Y"]);
    }
}
