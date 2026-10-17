// SPDX-License-Identifier: Apache-2.0
//! Command bodies of `aphrody ovh auth|services|domain|iam`, plus the renewal flow and the alert
//! notification shared with `aphrody ovh vps`. Kept apart from the clap definitions in `lib.rs`.

use aphrody_proc::NoWindow as _;
use std::{collections::BTreeSet, path::Path};

use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Value, json};

use crate::{
    client::{AuthMode, OvhClient},
    dns::DnsManager,
    domain::{DnssecKey, DomainInfo, DomainManager, name_server_hosts},
    iam::{IamManager, SyncReport},
    profile::{
        load_legacy_credentials, load_profile_credentials, load_profile_credentials_with_source,
    },
    services::{RenewQuote, ServiceInfo, ServicesManager, evaluate_service},
    vps::VpsManager,
};

/// Default alert threshold in days before expiration (`[billing] vps_alert_threshold_days`).
pub const DEFAULT_ALERT_DAYS: i64 = 14;

/// Build a client for a profile with the best available authentication mode.
pub fn client_for(profile: Option<&str>) -> Result<OvhClient> {
    OvhClient::new(load_profile_credentials(profile)?)
}

/// Client of the account that owns a VPS: the explicit profile, else the first known profile
/// whose `/vps` list contains the service (each account only sees its own services, so the
/// default `~/.ovh.conf` answers 404 for a VPS of another account).
pub async fn client_for_vps(profile: Option<&str>, service: &str) -> Result<(OvhClient, String)> {
    if let Some(p) = profile {
        return Ok((client_for(Some(p))?, p.to_owned()));
    }
    let mut tried = Vec::new();
    for info in crate::profile::known_profiles() {
        let Ok(client) = client_for(Some(&info.id)) else {
            continue;
        };
        match VpsManager::new(&client).list_vps().await {
            Ok(list) if list.iter().any(|s| s == service) => return Ok((client, info.id)),
            Ok(_) => tried.push(info.id),
            Err(e) => tried.push(format!("{} ({e})", info.id)),
        }
    }
    bail!(
        "VPS {service} not found in any OVH profile (tried: {})",
        tried.join(", ")
    )
}

fn is_forbidden(error: &anyhow::Error) -> bool {
    error.to_string().contains("HTTP 403")
}

fn print_json<T: serde::Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

/// Hide the OAuth2 client id inside a credential identity URN
/// (`urn:v1:eu:identity:credential:ACCOUNT/oauth2-ID` becomes `.../oauth2-***`).
pub fn mask_identity(identity: &str) -> String {
    match identity.find("/oauth2-") {
        Some(index) => format!("{}/oauth2-***", &identity[..index]),
        None => identity.to_string(),
    }
}

// ---------------------------------------------------------------------------------------------
// auth status
// ---------------------------------------------------------------------------------------------

pub async fn auth_status(profile: Option<&str>, json: bool) -> Result<()> {
    let (creds, source) = load_profile_credentials_with_source(profile)?;
    let client = OvhClient::new(creds)?;
    let details: Value = client
        .get("/auth/details")
        .await
        .context("GET /auth/details failed")?;
    let text = |key: &str| {
        details
            .get(key)
            .and_then(Value::as_str)
            .map(ToString::to_string)
    };
    let account = text("account").or_else(|| text("user"));
    let identities: Vec<String> = details
        .get("identities")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(mask_identity)
                .collect()
        })
        .unwrap_or_default();

    if json {
        return print_json(&json!({
            "profile": profile.unwrap_or("default"),
            "authMode": client.auth_mode().label(),
            "endpoint": client.base_url(),
            "source": source.to_string(),
            "method": text("method"),
            "account": account,
            "identities": identities,
        }));
    }
    println!("Profil: {}", profile.unwrap_or("défaut"));
    println!("Mode d'authentification: {}", client.auth_mode().label());
    println!("Endpoint: {}", client.base_url());
    println!("Source des identifiants: {source}");
    println!("Compte: {}", account.as_deref().unwrap_or("?"));
    println!(
        "Méthode (API): {}",
        text("method").as_deref().unwrap_or("?")
    );
    for identity in identities {
        println!("Identité: {identity}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// services
// ---------------------------------------------------------------------------------------------

fn short_date(value: Option<&str>) -> String {
    value.and_then(|v| v.get(..10)).unwrap_or("-").to_string()
}

/// Fixed-width table of services: id, resource, plan, state, expiration, renewal, deletion.
pub fn format_services_table(services: &[ServiceInfo]) -> String {
    let mut out = format!(
        "{:<10} {:<42} {:<28} {:<20} {:<11} {:<10} SUPPR.\n",
        "ID", "RESSOURCE", "TYPE / OFFRE", "ÉTAT", "EXPIRATION", "RENOUVEL."
    );
    for s in services {
        let state = if s.resource_state == "active" && s.lifecycle_state == "active" {
            "active".to_string()
        } else {
            format!("{}/{}", s.resource_state, s.lifecycle_state)
        };
        out.push_str(&format!(
            "{:<10} {:<42} {:<28} {:<20} {:<11} {:<10} {}\n",
            s.service_id,
            s.resource_name,
            s.plan,
            state,
            short_date(s.expiration.as_deref()),
            s.renew_mode.as_deref().unwrap_or("-"),
            if s.delete_at_expiration() {
                "OUI"
            } else {
                "non"
            }
        ));
    }
    out
}

pub async fn services_list(profile: Option<&str>, json: bool) -> Result<()> {
    let client = client_for(profile)?;
    let all = ServicesManager::new(&client).list_all().await?;
    if json {
        return print_json(&all);
    }
    println!("Services OVH ({}):", all.len());
    print!("{}", format_services_table(&all));
    Ok(())
}

/// Alert text for the services that have alerts, one block per service.
pub fn format_alert_report(alerting: &[(ServiceInfo, Vec<String>)]) -> String {
    let mut out = format!("Alertes OVH détectées ({} service(s)):\n", alerting.len());
    for (service, alerts) in alerting {
        out.push_str(&format!(
            "\n{} [{}] (id {})\n",
            service.resource_name, service.plan, service.service_id
        ));
        for alert in alerts {
            out.push_str(&format!("  ! {alert}\n"));
        }
    }
    out
}

/// Exit code of `services watch`: 0 healthy, 1 alerts (2 is reserved for errors).
pub fn watch_exit_code(alerting: usize) -> i32 {
    i32::from(alerting > 0)
}

/// Check every service of the account; returns the services with their alerts (alerts only).
pub async fn collect_alerts(
    client: &OvhClient,
    days: i64,
) -> Result<(usize, Vec<(ServiceInfo, Vec<String>)>)> {
    let today = chrono::Local::now().date_naive();
    let all = ServicesManager::new(client).list_all().await?;
    let vps = VpsManager::new(client);
    let mut alerting = Vec::new();
    for service in &all {
        // A stopped VPS is only visible on its own API; an expired one refuses it (HTTP 460).
        let runtime = if service.is_vps() {
            vps.get_vps(&service.resource_name)
                .await
                .ok()
                .map(|v| v.state)
        } else {
            None
        };
        let alerts = evaluate_service(service, runtime.as_deref(), today, days);
        if !alerts.is_empty() {
            alerting.push((service.clone(), alerts));
        }
    }
    Ok((all.len(), alerting))
}

/// `services watch`: returns the process exit code (0 healthy, 1 alerts).
pub async fn services_watch(
    profile: Option<&str>,
    days: i64,
    alerts_only: bool,
    notify: bool,
) -> Result<i32> {
    let client = client_for(profile)?;
    let (checked, alerting) = collect_alerts(&client, days).await?;
    let code = watch_exit_code(alerting.len());
    if alerting.is_empty() {
        if !alerts_only {
            println!("Tous les services OVH sont sains ({checked} vérifiés).");
        }
        return Ok(code);
    }
    let report = format_alert_report(&alerting);
    print!("{report}");
    if notify && let Err(error) = send_notification(&report) {
        eprintln!("Notification non envoyée: {error:#}");
    }
    Ok(code)
}

// ---------------------------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------------------------

/// Channel of `aphrody notify`: `APHRODY_OVH_NOTIFY_CHANNEL`, else the first configured one.
pub fn notify_channel(env: &dyn Fn(&str) -> Option<String>) -> Option<&'static str> {
    let set = |key: &str| env(key).is_some_and(|v| !v.is_empty());
    if let Some(choice) = env("APHRODY_OVH_NOTIFY_CHANNEL") {
        return match choice.as_str() {
            "slack" => Some("slack"),
            "telegram" => Some("telegram"),
            "matrix" => Some("matrix"),
            _ => None,
        };
    }
    if set("SLACK_BOT_TOKEN") {
        Some("slack")
    } else if set("TELEGRAM_BOT_TOKEN") {
        Some("telegram")
    } else if set("MATRIX_ACCESS_TOKEN") {
        Some("matrix")
    } else {
        None
    }
}

/// Send a message through `aphrody notify` (channels are configured by the environment).
pub fn send_notification(message: &str) -> Result<()> {
    let channel = notify_channel(&|key| std::env::var(key).ok()).ok_or_else(|| {
        anyhow!(
            "no notify channel configured (SLACK_BOT_TOKEN, TELEGRAM_BOT_TOKEN or MATRIX_ACCESS_TOKEN; override with APHRODY_OVH_NOTIFY_CHANNEL)"
        )
    })?;
    let status = std::process::Command::new("aphrody")
        .no_window()
        .args(["notify", "--channel", channel, "--message", message])
        .status()
        .context("cannot run `aphrody notify`")?;
    if !status.success() {
        bail!("`aphrody notify --channel {channel}` exited with {status}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// renewal
// ---------------------------------------------------------------------------------------------

pub struct RenewRequest<'a> {
    pub profile: Option<&'a str>,
    pub service_id: u64,
    /// Human label of the service (resource name).
    pub label: &'a str,
    pub period: Option<&'a str>,
    pub apply: bool,
    pub pay: bool,
}

/// Quote a renewal. The service account is refused on the legacy `/service/{id}/renew` routes
/// (HTTP 403, checked live), so that call falls back to application key credentials when the
/// profile has them.
async fn quote_with_fallback(
    client: OvhClient,
    request: &RenewRequest<'_>,
) -> Result<(OvhClient, RenewQuote)> {
    let first = ServicesManager::new(&client)
        .renew_quote(request.service_id, request.period)
        .await;
    match first {
        Ok(quote) => Ok((client, quote)),
        Err(error) if client.auth_mode() == AuthMode::OAuth2 && is_forbidden(&error) => {
            let legacy = load_legacy_credentials(request.profile).ok_or_else(|| {
                anyhow!(
                    "the service account cannot call /service/{}/renew ({error}) and no application key credentials are configured",
                    request.service_id
                )
            })?;
            eprintln!(
                "Note: le compte de service n'a pas accès à /service/{}/renew; repli sur la clé d'application.",
                request.service_id
            );
            let fallback = OvhClient::new(legacy)?;
            let quote = ServicesManager::new(&fallback)
                .renew_quote(request.service_id, request.period)
                .await?;
            Ok((fallback, quote))
        }
        Err(error) => Err(error),
    }
}

/// Quote by default; `apply` orders; `apply` and `pay` also pays (a financial commitment).
pub async fn renew_flow(client: OvhClient, request: &RenewRequest<'_>) -> Result<()> {
    let (client, quote) = quote_with_fallback(client, request).await?;
    let manager = ServicesManager::new(&client);
    println!(
        "Renouvellement {} de {} (service {}): {} HT, {} TTC, services {:?}",
        quote.period,
        request.label,
        request.service_id,
        quote.price_without_tax,
        quote.price_with_tax,
        quote.services
    );
    if !request.apply {
        println!("[PLAN] Aucune commande créée. --apply commande, --apply --pay paie aussi.");
        return Ok(());
    }
    let order = manager.renew(request.service_id, &quote).await?;
    println!(
        "Commande {} créée ({}): {}",
        order.order_id, order.price_with_tax, order.url
    );
    if request.pay {
        let method = manager.pay_order(order.order_id).await?;
        println!(
            "Commande {} payée avec le moyen de paiement {method}.",
            order.order_id
        );
    } else {
        println!("Commande non payée: payer dans l'espace client ou relancer avec --pay.");
    }
    Ok(())
}

pub async fn services_renew(
    profile: Option<&str>,
    target: &str,
    period: Option<&str>,
    apply: bool,
    pay: bool,
) -> Result<()> {
    let client = client_for(profile)?;
    let manager = ServicesManager::new(&client);
    let service_id = manager.resolve(target).await?;
    let info = manager.get(service_id).await?;
    println!(
        "Service {} ({}): {}/{}, expiration {}, renouvellement {}",
        info.resource_name,
        info.plan,
        info.resource_state,
        info.lifecycle_state,
        short_date(info.expiration.as_deref()),
        info.renew_mode.as_deref().unwrap_or("-")
    );
    let label = info.resource_name.clone();
    renew_flow(
        client,
        &RenewRequest {
            profile,
            service_id,
            label: &label,
            period,
            apply,
            pay,
        },
    )
    .await
}

// ---------------------------------------------------------------------------------------------
// domains
// ---------------------------------------------------------------------------------------------

fn format_domain(info: &DomainInfo) -> String {
    format!(
        "Domaine: {}\nService: {}\nÉtat: {} ({})\nOffre: {}\nExpiration: {}\nRenouvellement: {} (prochain {})\nDNSSEC: {}\nVerrou de transfert: {}\nServeurs de noms ({}): {}\n",
        info.domain,
        info.service_id,
        info.state,
        info.suspension_state,
        info.offer,
        short_date(Some(info.expiration.as_str())),
        info.renewal_state,
        short_date(Some(info.renewal_date.as_str())),
        info.dnssec_state,
        info.transfer_lock,
        info.name_server_type,
        info.name_servers.join(", ")
    )
}

pub async fn domain_list(profile: Option<&str>, json: bool) -> Result<()> {
    let client = client_for(profile)?;
    let manager = DomainManager::new(&client);
    let mut infos = Vec::new();
    for name in manager.list().await? {
        infos.push(manager.info(&name).await?);
    }
    if json {
        return print_json(&infos);
    }
    println!(
        "{:<30} {:<12} {:<11} {:<18} {:<10} VERROU",
        "DOMAINE", "ÉTAT", "EXPIRATION", "RENOUVELLEMENT", "DNSSEC"
    );
    for d in &infos {
        println!(
            "{:<30} {:<12} {:<11} {:<18} {:<10} {}",
            d.domain,
            d.state,
            short_date(Some(d.expiration.as_str())),
            d.renewal_state,
            d.dnssec_state,
            d.transfer_lock
        );
    }
    Ok(())
}

pub async fn domain_info(profile: Option<&str>, domain: &str, json: bool) -> Result<()> {
    let client = client_for(profile)?;
    let info = DomainManager::new(&client).info(domain).await?;
    if json {
        return print_json(&info);
    }
    print!("{}", format_domain(&info));
    Ok(())
}

pub async fn domain_renew(
    profile: Option<&str>,
    domain: &str,
    period: Option<&str>,
    apply: bool,
    pay: bool,
) -> Result<()> {
    let client = client_for(profile)?;
    let info = DomainManager::new(&client).info(domain).await?;
    println!(
        "Domaine {}: expiration {}, renouvellement {}",
        info.domain,
        short_date(Some(info.expiration.as_str())),
        info.renewal_state
    );
    renew_flow(
        client,
        &RenewRequest {
            profile,
            service_id: info.service_id,
            label: domain,
            period,
            apply,
            pay,
        },
    )
    .await
}

pub async fn domain_autorenew(
    profile: Option<&str>,
    domain: &str,
    on: bool,
    off: bool,
    apply: bool,
) -> Result<()> {
    if on == off {
        bail!("Indiquez --on ou --off (exactement un)");
    }
    let client = client_for(profile)?;
    let info = DomainManager::new(&client).info(domain).await?;
    println!(
        "Domaine {}: renouvellement actuel {} (service {})",
        info.domain, info.renewal_state, info.service_id
    );
    if info.auto_renew() == on {
        println!("Déjà dans l'état demandé, rien à faire.");
        return Ok(());
    }
    if !apply {
        println!(
            "[PLAN] Renouvellement automatique {} pour {domain}. Passez --apply pour confirmer.",
            if on { "activé" } else { "désactivé" }
        );
        return Ok(());
    }
    ServicesManager::new(&client)
        .set_renew_mode(info.service_id, on)
        .await?;
    let after = DomainManager::new(&client).info(domain).await?;
    println!("Renouvellement de {domain}: {}", after.renewal_state);
    Ok(())
}

pub async fn domain_nameservers(
    profile: Option<&str>,
    domain: &str,
    hosts: &[String],
    apply: bool,
    ds_cache_expired: bool,
) -> Result<()> {
    let hosts = name_server_hosts(hosts)?;
    validate_nameserver_apply(apply, ds_cache_expired)?;
    let client = client_for(profile)?;
    let manager = DomainManager::new(&client);
    let info = manager.info(domain).await?;
    println!(
        "Domaine {}: serveurs de noms actuels ({}) {}",
        info.domain,
        info.name_server_type,
        info.name_servers.join(", ")
    );
    let plan = nameserver_plan(&info, &hosts)?;
    if !plan.set_external_type && !plan.replace_servers {
        println!("Déjà dans l'état demandé, rien à faire.");
        return Ok(());
    }
    if !apply {
        if plan.set_external_type {
            println!("[PLAN] PUT /domain/{domain} avec {{\"nameServerType\":\"external\"}}.");
            println!("[PLAN] Relire le domaine et exiger nameServerType=external avant la suite.");
        }
        if plan.replace_servers {
            let payload = json!({
                "nameServer": hosts.iter().map(|host| json!({ "host": host })).collect::<Vec<_>>()
            });
            println!(
                "[PLAN] POST /domain/{domain}/nameServers/update avec {payload}; suivre l'ID DomainDnsUpdate retourné."
            );
        }
        println!(
            "Le DS doit être absent et son TTL expiré. Appliquer avec --apply --ds-cache-expired."
        );
        return Ok(());
    }
    if !manager.ds_records(domain).await?.is_empty() {
        bail!("DS encore publié pour {domain}; stop avant toute modification OVH");
    }

    if plan.set_external_type || plan.replace_servers {
        ensure_no_pending_dns_update(&manager, domain).await?;
    }

    let mut current_info = info;
    if plan.set_external_type {
        manager.set_external_name_server_type(domain).await?;
        current_info = manager.info(domain).await?;
        if current_info.name_server_type != "external" {
            bail!(
                "OVH n'a pas confirmé nameServerType=external (état reçu : {}); déclaration des NS non envoyée",
                current_info.name_server_type
            );
        }
        println!("Type DNS confirmé : external.");
    }

    if !plan.replace_servers || nameservers_equal(&current_info.name_servers, &hosts) {
        println!("Serveurs de noms déjà conformes après vérification; aucun POST nécessaire.");
        return Ok(());
    }

    let task = manager.set_name_servers(domain, &hosts).await?;
    let task_id = task
        .get("id")
        .map(ToString::to_string)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "OVH n'a pas renvoyé l'ID de tâche; inspectez les tâches DNS avant toute relance"
            )
        })?;
    println!(
        "Tâche registrar {} : {}",
        task_id,
        task.get("status").and_then(Value::as_str).unwrap_or("?")
    );
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NameserverPlan {
    set_external_type: bool,
    replace_servers: bool,
}

fn nameservers_equal(left: &[String], right: &[String]) -> bool {
    let mut left = left.to_vec();
    left.sort();
    let mut right = right.to_vec();
    right.sort();
    left == right
}

fn nameserver_plan(info: &DomainInfo, hosts: &[String]) -> Result<NameserverPlan> {
    let set_external_type = match info.name_server_type.as_str() {
        "hosted" | "hosting" => true,
        "external" => false,
        other => bail!("type de DNS OVH non pris en charge pour le cutover: {other}"),
    };
    Ok(NameserverPlan {
        set_external_type,
        replace_servers: !nameservers_equal(&info.name_servers, hosts),
    })
}

fn validate_nameserver_apply(apply: bool, ds_cache_expired: bool) -> Result<()> {
    if apply && !ds_cache_expired {
        bail!("--apply requiert --ds-cache-expired après vérification de l'expiration du TTL DS");
    }
    Ok(())
}

fn is_pending_dns_update(task: &Value) -> bool {
    task.get("function").and_then(Value::as_str) == Some("DomainDnsUpdate")
        && matches!(
            task.get("status").and_then(Value::as_str),
            Some("todo" | "doing" | "error")
        )
}

async fn ensure_no_pending_dns_update(manager: &DomainManager<'_>, domain: &str) -> Result<()> {
    for id in manager.task_ids(domain).await? {
        let task = manager.task(domain, id).await?;
        if is_pending_dns_update(&task) {
            bail!(
                "tâche DomainDnsUpdate {} en statut {}; inspectez-la avant toute nouvelle déclaration",
                task.get("id")
                    .map(ToString::to_string)
                    .unwrap_or_else(|| id.to_string()),
                task.get("status").and_then(Value::as_str).unwrap_or("?")
            );
        }
    }
    Ok(())
}

/// Requested registrar DNSSEC change: stop OVH-hosted signing, or publish provider keys.
pub struct DnssecChange<'a> {
    pub disable_hosted: bool,
    pub keys: &'a [String],
    pub apply: bool,
}

pub async fn domain_dnssec(
    profile: Option<&str>,
    domain: &str,
    change: &DnssecChange<'_>,
    json_output: bool,
) -> Result<()> {
    let keys = change
        .keys
        .iter()
        .map(|k| DnssecKey::parse(k))
        .collect::<Result<Vec<_>>>()?;
    let client = client_for(profile)?;
    let manager = DomainManager::new(&client);
    let info = manager.info(domain).await?;
    let published = manager.ds_records(domain).await?;
    // Absent when the zone is not hosted on OVH DNS.
    let hosted = manager.hosted_dnssec(domain).await.ok();
    if json_output && !change.disable_hosted && keys.is_empty() {
        return print_json(&json!({
            "domain": info.domain,
            "registrarDnssec": info.dnssec_state,
            "hostedDnssec": hosted,
            "nameServerType": info.name_server_type,
            "nameServers": info.name_servers,
            "dsRecords": published,
        }));
    }
    println!(
        "Domaine {}: DNSSEC registrar {}, signature OVH {}, {} clé(s) DS publiée(s)",
        info.domain,
        info.dnssec_state,
        hosted.as_deref().unwrap_or("absente"),
        published.len()
    );
    for key in &published {
        println!(
            "  DS tag {} algorithme {} flags {} ({})",
            key.tag,
            key.algorithm,
            key.flags,
            key.status.as_deref().unwrap_or("?")
        );
    }
    if change.disable_hosted {
        match hosted.as_deref() {
            Some("disabled" | "disableInProgress") | None => {
                println!("Signature OVH déjà retirée ou en cours de retrait, rien à faire.");
            }
            _ if !change.apply => {
                println!(
                    "[PLAN] Désactiver la signature DNSSEC OVH de {domain}. Passez --apply pour confirmer."
                );
            }
            _ => {
                manager.disable_hosted_dnssec(domain).await?;
                let after = manager.hosted_dnssec(domain).await?;
                println!("Signature DNSSEC OVH de {domain}: {after}");
            }
        }
        return Ok(());
    }
    if keys.is_empty() {
        return Ok(());
    }
    let same = keys.len() == published.len()
        && keys.iter().all(|k| {
            published.iter().any(|p| {
                p.tag == k.tag
                    && p.algorithm == k.algorithm
                    && p.flags == k.flags
                    && p.public_key == k.public_key
            })
        });
    if same {
        println!("Clés DS déjà publiées, rien à faire.");
        return Ok(());
    }
    if !change.apply {
        for key in &keys {
            println!(
                "[PLAN] Publier DS tag {} algorithme {} flags {}",
                key.tag, key.algorithm, key.flags
            );
        }
        println!("Passez --apply pour confirmer.");
        return Ok(());
    }
    if info.name_server_type == "anycast" || hosted.as_deref() == Some("enabled") {
        bail!("{domain} est encore servi et signé par OVH : basculez les serveurs de noms d'abord");
    }
    let task = manager.set_ds_records(domain, &keys).await?;
    println!(
        "Tâche registrar {} : {}",
        task.get("id").map(ToString::to_string).unwrap_or_default(),
        task.get("status").and_then(Value::as_str).unwrap_or("?")
    );
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// zones: export and backup
// ---------------------------------------------------------------------------------------------

pub async fn dns_export(profile: Option<&str>, zone: &str, output: Option<&Path>) -> Result<()> {
    let client = client_for(profile)?;
    let bind = DnsManager::new(&client).export_zone(zone).await?;
    match output {
        Some(path) => {
            std::fs::write(path, &bind)
                .with_context(|| format!("cannot write {}", path.display()))?;
            println!("Zone {zone} exportée vers {}", path.display());
        }
        None => println!("{bind}"),
    }
    Ok(())
}

/// Export every DNS zone of the account to `<dir>/<zone>.zone` (BIND format).
pub async fn dns_backup(profile: Option<&str>, dir: &Path) -> Result<()> {
    let client = client_for(profile)?;
    let dns = DnsManager::new(&client);
    std::fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    let zones = dns.list_zones().await?;
    for zone in &zones {
        let bind = dns.export_zone(zone).await?;
        let path = dir.join(format!("{zone}.zone"));
        std::fs::write(&path, bind).with_context(|| format!("cannot write {}", path.display()))?;
        println!("  - {zone} -> {}", path.display());
    }
    println!(
        "{} zone(s) sauvegardée(s) dans {}",
        zones.len(),
        dir.display()
    );
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// IAM
// ---------------------------------------------------------------------------------------------

/// Human summary of an IAM sync plan.
pub fn format_sync_report(report: &SyncReport) -> String {
    let mut out = format!("Ressources IAM du compte: {}\n", report.resource_count);
    for group in &report.groups {
        let wanted: BTreeSet<&String> = group.resource_ids.iter().collect();
        let status = match &group.existing {
            None => "à créer".to_string(),
            Some(existing) => {
                let current: BTreeSet<&String> = existing.resource_ids.iter().collect();
                if current == wanted {
                    "à jour".to_string()
                } else {
                    format!(
                        "à mettre à jour (+{} -{})",
                        wanted.difference(&current).count(),
                        current.difference(&wanted).count()
                    )
                }
            }
        };
        out.push_str(&format!(
            "Groupe {}: {} ressource(s), {status}\n",
            group.name,
            group.resource_ids.len()
        ));
    }
    let policy_status = match (&report.policy.existing, report.policy.needs_write) {
        (None, _) => "à créer",
        (Some(_), true) => "à mettre à jour",
        (Some(_), false) => "à jour",
    };
    out.push_str(&format!(
        "Politique {}: {} ressource(s), {} identité(s), {policy_status}\n",
        crate::iam::POLICY_NAME,
        report.policy.resource_urns.len(),
        report.policy.identities.len()
    ));
    out
}

pub async fn iam_sync(profile: Option<&str>, apply: bool) -> Result<()> {
    let client = client_for(profile)?;
    let report = IamManager::new(&client).sync(apply).await?;
    print!("{}", format_sync_report(&report));
    let pending = report.groups.iter().any(|g| g.needs_write()) || report.policy.needs_write;
    if report.applied {
        println!("Appliqué.");
    } else if pending {
        println!("[PLAN] Aucune modification écrite. Passez --apply pour synchroniser.");
    } else {
        println!("Déjà synchronisé.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::iam::{GroupPlan, IamGroup, IamPolicy, PolicyPlan};

    #[test]
    fn identity_masking_hides_the_client_id() {
        let masked = mask_identity("urn:v1:eu:identity:credential:eu0000-ovh/oauth2-EU.secretid");
        assert_eq!(
            masked,
            "urn:v1:eu:identity:credential:eu0000-ovh/oauth2-***"
        );
        assert_eq!(
            mask_identity("urn:v1:eu:identity:user:abc"),
            "urn:v1:eu:identity:user:abc"
        );
    }

    #[test]
    fn watch_exit_codes() {
        assert_eq!(watch_exit_code(0), 0);
        assert_eq!(watch_exit_code(3), 1);
    }

    #[test]
    fn notify_channel_selection() {
        let none = |_: &str| None;
        assert_eq!(notify_channel(&none), None);
        let slack = |k: &str| (k == "SLACK_BOT_TOKEN").then(|| "x".to_string());
        assert_eq!(notify_channel(&slack), Some("slack"));
        let telegram = |k: &str| (k == "TELEGRAM_BOT_TOKEN").then(|| "x".to_string());
        assert_eq!(notify_channel(&telegram), Some("telegram"));
        let forced = |k: &str| match k {
            "APHRODY_OVH_NOTIFY_CHANNEL" => Some("matrix".to_string()),
            "SLACK_BOT_TOKEN" => Some("x".to_string()),
            _ => None,
        };
        assert_eq!(notify_channel(&forced), Some("matrix"));
        let bad = |k: &str| (k == "APHRODY_OVH_NOTIFY_CHANNEL").then(|| "fax".to_string());
        assert_eq!(notify_channel(&bad), None);
    }

    fn service(name: &str) -> ServiceInfo {
        ServiceInfo::from_json(&json!({
            "serviceId": 7,
            "resource": { "name": name, "state": "suspended", "product": { "name": "vps-x" } },
            "billing": { "expirationDate": "2026-10-01T00:00:00Z",
                         "lifecycle": { "current": { "state": "unrenewed" } },
                         "renew": { "current": { "mode": "manual" } } }
        }))
    }

    #[test]
    fn tables_and_alert_reports_are_readable() {
        let s = service("vps-1");
        let table = format_services_table(std::slice::from_ref(&s));
        assert!(table.contains("vps-1") && table.contains("suspended/unrenewed"));
        assert!(table.contains("2026-10-01") && table.contains("manual"));
        let report = format_alert_report(&[(s, vec!["Service expiré".to_string()])]);
        assert!(report.contains("vps-1 [vps-x] (id 7)") && report.contains("  ! Service expiré"));
    }

    #[test]
    fn sync_report_summarises_the_plan() {
        let existing = IamGroup {
            id: "g".into(),
            name: "aphrody-all".into(),
            urn: "urn:g".into(),
            resource_ids: vec!["a".into(), "b".into()],
        };
        let report = SyncReport {
            groups: vec![
                GroupPlan {
                    name: "aphrody-all".into(),
                    existing: Some(existing),
                    resource_ids: vec!["a".into(), "c".into()],
                },
                GroupPlan {
                    name: "aphrody-all-2".into(),
                    existing: None,
                    resource_ids: vec!["d".into()],
                },
            ],
            policy: PolicyPlan {
                existing: Some(IamPolicy {
                    id: "p".into(),
                    name: "aphrody-automation".into(),
                    identities: vec!["i".into()],
                    resource_urns: vec![],
                    allow_all: true,
                }),
                identities: vec!["i".into()],
                resource_urns: vec!["urn:acc".into(), "urn:g".into()],
                needs_write: true,
            },
            resource_count: 4,
            applied: false,
        };
        let text = format_sync_report(&report);
        assert!(text.contains("Groupe aphrody-all: 2 ressource(s), à mettre à jour (+1 -1)"));
        assert!(text.contains("Groupe aphrody-all-2: 1 ressource(s), à créer"));
        assert!(text.contains(
            "Politique aphrody-automation: 2 ressource(s), 1 identité(s), à mettre à jour"
        ));
    }

    fn domain_info(name_server_type: &str, name_servers: &[&str]) -> DomainInfo {
        DomainInfo::from_json(&json!({
            "domain": "example.com",
            "nameServerType": name_server_type,
            "nameServers": name_servers.iter().map(|host| json!({ "nameServer": host })).collect::<Vec<_>>()
        }))
    }

    #[test]
    fn nameserver_plan_switches_hosted_before_replacing_servers() {
        let info = domain_info("hosting", &["dns109.ovh.net", "ns109.ovh.net"]);
        let plan = nameserver_plan(
            &info,
            &[
                "duke.ns.cloudflare.com".into(),
                "veda.ns.cloudflare.com".into(),
            ],
        )
        .expect("supported type");

        assert!(plan.set_external_type);
        assert!(plan.replace_servers);
    }

    #[test]
    fn nameserver_plan_is_idempotent_after_external_declaration() {
        let info = domain_info(
            "external",
            &["duke.ns.cloudflare.com", "veda.ns.cloudflare.com"],
        );
        let plan = nameserver_plan(
            &info,
            &[
                "veda.ns.cloudflare.com".into(),
                "duke.ns.cloudflare.com".into(),
            ],
        )
        .expect("supported type");

        assert!(!plan.set_external_type);
        assert!(!plan.replace_servers);
    }

    #[test]
    fn nameserver_apply_requires_ds_cache_expiration_attestation() {
        assert!(validate_nameserver_apply(true, false).is_err());
        assert!(validate_nameserver_apply(true, true).is_ok());
        assert!(validate_nameserver_apply(false, false).is_ok());
    }

    #[test]
    fn pending_dns_update_detects_nonterminal_tasks_only() {
        assert!(is_pending_dns_update(
            &json!({ "function": "DomainDnsUpdate", "status": "todo" })
        ));
        assert!(is_pending_dns_update(
            &json!({ "function": "DomainDnsUpdate", "status": "error" })
        ));
        assert!(!is_pending_dns_update(
            &json!({ "function": "DomainDnsUpdate", "status": "done" })
        ));
        assert!(!is_pending_dns_update(
            &json!({ "function": "DomainRenew", "status": "doing" })
        ));
    }
}
