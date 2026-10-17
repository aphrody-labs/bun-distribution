// SPDX-License-Identifier: Apache-2.0
//! Aphrody OVH — Native in-process OVHcloud engine for Aphrody Infra.

pub mod client;
pub mod console;
pub mod dns;
pub mod domain;
pub mod email;
pub mod iam;
pub mod ops;
pub mod profile;
pub mod services;
pub mod vps;

use std::path::PathBuf;

use anyhow::Context;
use clap::Subcommand;
pub use client::{ApiVersion, AuthMode, OvhClient, OvhCredentials, sha1_hex, sign_request};
pub use dns::{DnsAuditReport, DnsManager, DnsRecord, DnsZoneInfo};
pub use domain::{DnssecKey, DomainInfo, DomainManager};
pub use email::{EmailDnsAuditReport, EmailDomainInfo, EmailManager, EmailRedirection};
pub use iam::{IamManager, SyncReport};
pub use profile::{
    CredentialSource, ProfileInfo, known_profiles, load_legacy_credentials,
    load_profile_credentials, load_profile_credentials_with_source, parse_credentials_text,
};
pub use services::{RenewOrder, RenewQuote, ServiceInfo, ServicesManager, evaluate_service};
pub use vps::{
    VpsBilling, VpsHealthStatus, VpsInfo, VpsIp, VpsManager, VpsStatus, is_expired_error,
};

#[derive(Debug, Subcommand, Clone)]
pub enum OvhCommand {
    /// List known profile configurations.
    Profiles,
    /// Diagnostic health check on configured credentials.
    Status {
        #[arg(long)]
        profile: Option<String>,
    },
    /// DNS zone and records management.
    Dns {
        #[command(subcommand)]
        subcommand: OvhDnsSubcommand,
    },
    /// VPS inventory and inspection.
    Vps {
        #[command(subcommand)]
        subcommand: OvhVpsSubcommand,
    },
    /// Email domain status, redirections and deliverability audit.
    Email {
        #[command(subcommand)]
        subcommand: OvhEmailSubcommand,
    },
    /// Authentication mode and identity of the credentials in use.
    Auth {
        #[command(subcommand)]
        subcommand: OvhAuthSubcommand,
    },
    /// Every service of the account (domains, DNS, email, VPS, IP, cloud): list (default), watch
    /// and renew.
    Services {
        #[arg(long, global = true)]
        profile: Option<String>,
        /// Machine-readable output of the listing.
        #[arg(long)]
        json: bool,
        #[command(subcommand)]
        subcommand: Option<OvhServicesSubcommand>,
    },
    /// Registered domain names: inventory, renewal and automatic renewal.
    Domain {
        #[command(subcommand)]
        subcommand: OvhDomainSubcommand,
    },
    /// IAM policy and resource groups of the service account.
    Iam {
        #[command(subcommand)]
        subcommand: OvhIamSubcommand,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhAuthSubcommand {
    /// Effective authentication mode, account and identity (no secret is printed).
    Status {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        profile: Option<String>,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhServicesSubcommand {
    /// Check every service: exit 0 if healthy, 1 if alerts, 2 on error.
    Watch {
        /// Alert when a manually renewed service expires within this many days.
        #[arg(long, default_value_t = ops::DEFAULT_ALERT_DAYS)]
        days: i64,
        /// Print nothing when everything is healthy.
        #[arg(long)]
        alerts_only: bool,
        /// Send the alerts through `aphrody notify`.
        #[arg(long)]
        notify: bool,
    },
    /// Renew a service by id or resource name: quote by default (dry run), --apply orders,
    /// --apply --pay also pays with the default registered payment method.
    Renew {
        /// Service id, or exact resource name when it is unique.
        service: String,
        /// Renewal period offered by OVH (P1M, P3M, P6M, P1Y, ...); default: the first offer.
        #[arg(long)]
        period: Option<String>,
        #[arg(long)]
        apply: bool,
        #[arg(long, requires = "apply")]
        pay: bool,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhDomainSubcommand {
    /// List registered domains with state, expiration and renewal.
    List {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Registration details of a domain (state, expiration, DNSSEC, lock, name servers).
    Info {
        domain: String,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Renew a domain: quote by default (dry run), --apply orders, --apply --pay also pays.
    Renew {
        domain: String,
        /// Renewal period offered by OVH (P1Y, P2Y, ...); default: the first offer.
        #[arg(long)]
        period: Option<String>,
        #[arg(long)]
        apply: bool,
        #[arg(long, requires = "apply")]
        pay: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Switch automatic renewal on or off (plan by default, requires --apply).
    Autorenew {
        domain: String,
        #[arg(long, conflicts_with = "off")]
        on: bool,
        #[arg(long)]
        off: bool,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Switch to external DNS and replace registrar name servers (plan by default).
    Nameservers {
        domain: String,
        /// Name server host names, at least two (e.g. duke.ns.cloudflare.com veda.ns.cloudflare.com).
        #[arg(required = true, num_args = 2..)]
        hosts: Vec<String>,
        /// Assert the previously published DS cache TTL has fully expired.
        #[arg(long)]
        ds_cache_expired: bool,
        #[arg(long, requires = "ds_cache_expired")]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// DNSSEC at the registrar: show state, stop OVH-hosted signing (--disable-hosted) or
    /// publish an external provider's keys (--key, repeatable). Plan by default, requires --apply.
    Dnssec {
        domain: String,
        #[arg(long, conflicts_with = "keys")]
        disable_hosted: bool,
        /// `<flags> <algorithm> <tag> <public key>` of the provider key-signing key.
        #[arg(long = "key", value_name = "KEY")]
        keys: Vec<String>,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhIamSubcommand {
    /// Keep policy `aphrody-automation` and groups `aphrody-all*` covering every account
    /// resource (plan by default, requires --apply).
    Sync {
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhDnsSubcommand {
    /// List all managed DNS zones.
    Zones {
        #[arg(long)]
        profile: Option<String>,
    },
    /// Show metadata and DNSSEC status for a zone.
    Info {
        zone: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// List DNS records in a zone.
    Records {
        zone: String,
        #[arg(long)]
        r#type: Option<String>,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Add a DNS record (requires --apply).
    Add {
        zone: String,
        r#type: String,
        subdomain: String,
        target: String,
        #[arg(long, default_value_t = 300)]
        ttl: u32,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Delete a DNS record by ID (requires --apply).
    Delete {
        zone: String,
        record_id: u64,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Refresh zone to propagate updates to nameservers.
    Refresh {
        zone: String,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Switch selected A records to target IP (requires --apply; default apex + www).
    SetA {
        zone: String,
        target_ip: String,
        /// Exact relative name; repeat to select several. Use @ for apex.
        #[arg(long = "subdomain")]
        subdomains: Vec<String>,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Audit DNSSEC and production subdomain invariants.
    Audit {
        zone: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Export zone in standard BIND format (stdout, or --output FILE).
    Export {
        zone: String,
        #[arg(long)]
        output: Option<PathBuf>,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Back up every zone of the account as <DIR>/<zone>.zone (BIND format).
    Backup {
        #[arg(long)]
        dir: PathBuf,
        #[arg(long)]
        profile: Option<String>,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhVpsSubcommand {
    /// List VPS services.
    List {
        #[arg(long)]
        profile: Option<String>,
    },
    /// Inspect hardware specs and datacenter location for a VPS.
    Info {
        service_name: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// List IPs and routing configuration for a VPS.
    Ips {
        service_name: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Get operational ping and status.
    Status {
        service_name: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Start a stopped VPS (requires --apply).
    Start {
        service_name: String,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// KVM console URL (noVNC). The session token stays masked without --show; --open drives it
    /// in Bun.WebView and can type text (e.g. `--type "systemctl restart ssh" --enter`).
    Console {
        service_name: String,
        #[arg(long)]
        show: bool,
        #[arg(long)]
        open: bool,
        #[arg(long, requires = "open")]
        r#type: Option<String>,
        #[arg(long, requires = "open")]
        enter: bool,
        #[arg(long, requires = "open")]
        screenshot: Option<PathBuf>,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Boot into OVH rescue: set netboot rescue then reboot (requires --apply).
    Rescue {
        service_name: String,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Show or set the netboot mode; setting reboots the VPS (requires --apply).
    Netboot {
        service_name: String,
        mode: Option<vps::NetbootMode>,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Recent VPS tasks (reboot, netboot, console...).
    Tasks {
        service_name: String,
        #[arg(long)]
        json: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Reboot a VPS (requires --apply).
    Reboot {
        service_name: String,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Renew a VPS: quote by default (dry run), --apply orders, --apply --pay also pays with the
    /// default registered payment method. Ordering and paying are financial commitments.
    Renew {
        service_name: String,
        /// Renewal period (ISO 8601 duration offered by OVH: P1M, P3M, P6M, P12M).
        #[arg(long, default_value = "P1M")]
        period: String,
        #[arg(long)]
        apply: bool,
        #[arg(long, requires = "apply")]
        pay: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Manage deleteAtExpiration flag. When true, the VPS is deleted at expiration if not renewed.
    SetDeleteAtExpiration {
        service_name: String,
        /// Set deleteAtExpiration to false (preserve VPS beyond expiration date).
        #[arg(long)]
        preserve: bool,
        /// Set deleteAtExpiration to true (delete VPS at expiration).
        #[arg(long)]
        delete: bool,
        #[arg(long)]
        apply: bool,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Check VPS expiration status: exit 0 if all healthy, 1 if alerts present, 2 on error.
    Watch {
        /// Specific VPS to check; if absent, checks all VPS.
        service_name: Option<String>,
        /// Only report alerts (expiry < N days, deleteAtExpiration=true, stopped state, manual renewal).
        #[arg(long)]
        alerts_only: bool,
        /// Send alerts via aphrody notify channels.
        #[arg(long)]
        notify: bool,
        #[arg(long)]
        profile: Option<String>,
    },
}

#[derive(Debug, Subcommand, Clone)]
pub enum OvhEmailSubcommand {
    /// Inspect domain email service and plan.
    Domain {
        domain: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// List email redirections (aliases/forwarders).
    Redirections {
        domain: String,
        #[arg(long)]
        profile: Option<String>,
    },
    /// Comprehensive email deliverability audit (MX, SPF, DMARC, DKIM).
    Audit {
        domain: String,
        #[arg(long)]
        profile: Option<String>,
    },
}

async fn vps_netboot(
    profile: Option<&str>,
    service_name: &str,
    mode: vps::NetbootMode,
    apply: bool,
) -> anyhow::Result<()> {
    let (client, used) = ops::client_for_vps(profile, service_name).await?;
    let manager = VpsManager::new(&client);
    let current = manager.netboot(service_name).await?;
    println!(
        "VPS {service_name} (profil {used}): netboot {current} -> {}, puis redémarrage",
        mode.as_str()
    );
    if !apply {
        println!("[PLAN] Passez --apply pour confirmer.");
        return Ok(());
    }
    manager.set_netboot(service_name, mode).await?;
    let task = manager.reboot(service_name, true).await?;
    println!(
        "Netboot {} appliqué, redémarrage envoyé (Task ID: {task:?}).",
        mode.as_str()
    );
    Ok(())
}

impl OvhCommand {
    pub async fn execute(&self) -> anyhow::Result<()> {
        match self {
            OvhCommand::Profiles => {
                let profiles = known_profiles();
                println!("{:<18} {:<18} {:<10} DOMAINE(S)", "PROFIL", "NOM", "RÉGION");
                println!("{:-<18} {:-<18} {:-<10} {:-<20}", "", "", "", "");
                for p in &profiles {
                    println!(
                        "{:<18} {:<18} {:<10} {}",
                        p.id,
                        p.name,
                        p.region,
                        p.domains.join(", ")
                    );
                }
                Ok(())
            }
            OvhCommand::Status { profile } => {
                let p = profile.as_deref();
                match load_profile_credentials(p) {
                    Ok(creds) => {
                        let client = OvhClient::new(creds)?;
                        let drift = client.sync_time().await?;
                        println!("Profil: {}", p.unwrap_or("défaut"));
                        println!("Statut: AUTHENTIFIÉ");
                        println!("Mode d'authentification: {}", client.auth_mode().label());
                        println!("Endpoint: {}", client.base_url());
                        println!("Décalage d'horloge OVH: {}s", drift);
                    }
                    Err(e) => {
                        println!("Profil: {}", p.unwrap_or("défaut"));
                        println!("Statut: NON CONFIGURÉ ({e})");
                    }
                }
                Ok(())
            }
            OvhCommand::Dns { subcommand } => match subcommand {
                OvhDnsSubcommand::Zones { profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let zones = dns.list_zones().await?;
                    println!("Zones DNS ({}):", zones.len());
                    for z in zones {
                        println!("  - {z}");
                    }
                    Ok(())
                }
                OvhDnsSubcommand::Info { zone, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let info = dns.get_zone(zone).await?;
                    println!("Zone: {}", info.name);
                    println!(
                        "DNSSEC: {}",
                        if info.dnssec_supported {
                            "supporté"
                        } else {
                            "non"
                        }
                    );
                    println!("Serveurs de noms: {}", info.name_servers.join(", "));
                    Ok(())
                }
                OvhDnsSubcommand::Records {
                    zone,
                    r#type,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let records = dns.list_records(zone, r#type.as_deref()).await?;
                    println!(
                        "{:<8} {:<6} {:<24} {:<8} CIBLE",
                        "ID", "TYPE", "SOUS-DOMAINE", "TTL"
                    );
                    println!("{:-<8} {:-<6} {:-<24} {:-<8} {:-<30}", "", "", "", "", "");
                    for r in records {
                        let sub = if r.sub_domain.is_empty() {
                            "@"
                        } else {
                            &r.sub_domain
                        };
                        println!(
                            "{:<8} {:<6} {:<24} {:<8} {}",
                            r.id, r.field_type, sub, r.ttl, r.target
                        );
                    }
                    Ok(())
                }
                OvhDnsSubcommand::Add {
                    zone,
                    r#type,
                    subdomain,
                    target,
                    ttl,
                    apply,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    if !apply {
                        println!(
                            "[PLAN] Création enregistrement {type} '{subdomain}.{zone}' -> '{target}' (TTL: {ttl})"
                        );
                        println!("Passez --apply pour exécuter la modification.");
                        return Ok(());
                    }
                    let res = dns
                        .add_record(zone, r#type, subdomain, target, *ttl, true)
                        .await?;
                    if let Some(r) = res {
                        println!("Enregistrement créé avec succès (ID: {}).", r.id);
                    }
                    Ok(())
                }
                OvhDnsSubcommand::Delete {
                    zone,
                    record_id,
                    apply,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    if !apply {
                        println!(
                            "[PLAN] Suppression enregistrement ID {record_id} sur la zone '{zone}'."
                        );
                        println!("Passez --apply pour exécuter la suppression.");
                        return Ok(());
                    }
                    dns.delete_record(zone, *record_id, true).await?;
                    println!("Enregistrement {record_id} supprimé et zone rafraîchie.");
                    Ok(())
                }
                OvhDnsSubcommand::Refresh {
                    zone,
                    apply,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    if !apply {
                        println!(
                            "[PLAN] Rafraîchissement de la zone '{zone}' vers les serveurs de noms."
                        );
                        println!("Passez --apply pour appliquer le rechargement SOA.");
                        return Ok(());
                    }
                    dns.refresh_zone(zone).await?;
                    println!("Zone '{zone}' rafraîchie avec succès.");
                    Ok(())
                }
                OvhDnsSubcommand::SetA {
                    zone,
                    target_ip,
                    subdomains,
                    apply,
                    profile,
                } => {
                    target_ip
                        .parse::<std::net::Ipv4Addr>()
                        .context("A record target must be an IPv4 address")?;
                    let selected = dns::a_subdomains(subdomains)?;
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    if !apply {
                        println!(
                            "[PLAN] Bascule A records ({}) de '{zone}' vers {target_ip}",
                            selected
                                .iter()
                                .map(|name| if name.is_empty() { "@" } else { name.as_str() })
                                .collect::<Vec<_>>()
                                .join(", ")
                        );
                        println!("Passez --apply pour exécuter.");
                        return Ok(());
                    }
                    let updated = dns
                        .set_a_subdomains(zone, target_ip, &selected, true)
                        .await?;
                    println!(
                        "Bascule A effectuée avec succès ({} enregistrements sélectionnés ; identifiants et TTL conservés).",
                        updated.len()
                    );
                    Ok(())
                }
                OvhDnsSubcommand::Audit { zone, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let report = dns.audit_zone(zone).await?;
                    println!("Rapport d'audit DNS: {}", report.zone);
                    println!(
                        "DNSSEC: {}",
                        if report.dnssec_activated {
                            "ACTIVÉ"
                        } else {
                            "DÉSACTIVÉ"
                        }
                    );
                    println!(
                        "Anycast: {}",
                        if report.has_dns_anycast { "OUI" } else { "NON" }
                    );
                    println!("Total enregistrements: {}", report.total_records);
                    if !report.missing_production_subdomains.is_empty() {
                        println!("Sous-domaines de production manquants:");
                        for sub in &report.missing_production_subdomains {
                            println!("  - {sub}");
                        }
                    }
                    if !report.warnings.is_empty() {
                        println!("Avertissements:");
                        for w in &report.warnings {
                            println!("  - {w}");
                        }
                    }
                    Ok(())
                }
                OvhDnsSubcommand::Export {
                    zone,
                    output,
                    profile,
                } => ops::dns_export(profile.as_deref(), zone, output.as_deref()).await,
                OvhDnsSubcommand::Backup { dir, profile } => {
                    ops::dns_backup(profile.as_deref(), dir).await
                }
            },
            OvhCommand::Vps { subcommand } => match subcommand {
                OvhVpsSubcommand::List { profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let list = vps.list_vps().await?;
                    println!("Services VPS ({}):", list.len());
                    for s in list {
                        println!("  - {s}");
                    }
                    Ok(())
                }
                OvhVpsSubcommand::Info {
                    service_name,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let info = vps.get_vps(service_name).await?;
                    println!("VPS: {}", info.name);
                    if let Some(dn) = info.display_name {
                        println!("Nom affiché: {dn}");
                    }
                    println!("État: {}", info.state);
                    println!("Modèle: {}", info.model);
                    println!("Cluster / Zone: {} ({})", info.cluster, info.zone);
                    println!(
                        "Ressources: {} vCPU, {} Mo RAM, {} Go Disque",
                        info.vcore, info.memory_mb, info.disk_gb
                    );
                    let billing = vps.billing(service_name).await?;
                    println!(
                        "Service: {} (id {}), expiration {}, renouvellement {}, suppression à expiration: {}",
                        billing.status,
                        billing.service_id,
                        billing.expiration,
                        if billing.automatic_renew {
                            "automatique"
                        } else {
                            "manuel"
                        },
                        if billing.delete_at_expiration {
                            "OUI"
                        } else {
                            "non"
                        }
                    );
                    if billing.status == "expired" {
                        println!(
                            "Service expiré: renouveler avec `aphrody ovh vps renew {service_name}`."
                        );
                    }
                    Ok(())
                }
                OvhVpsSubcommand::Ips {
                    service_name,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let ips = vps.get_ips(service_name).await?;
                    for ip in ips {
                        println!(
                            "IP: {:<20} Version: {:<6} Type: {:<10} Reverse: {}",
                            ip.ip,
                            ip.version,
                            ip.r#type,
                            ip.reverse.unwrap_or_else(|| "-".into())
                        );
                    }
                    Ok(())
                }
                OvhVpsSubcommand::Status {
                    service_name,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let status = match vps.get_status(service_name).await {
                        Ok(status) => status,
                        Err(error) if vps::is_expired_error(&error) => {
                            let billing = vps.billing(service_name).await?;
                            anyhow::bail!(
                                "VPS {service_name} expiré depuis {} (service {}): renouveler avec `aphrody ovh vps renew {service_name}`",
                                billing.expiration,
                                billing.service_id
                            );
                        }
                        Err(error) => return Err(error),
                    };
                    println!("VPS: {service_name}");
                    println!("État: {}", status.state);
                    println!("Ping: {}", if status.ping { "OK" } else { "ÉCHEC" });
                    println!("Up: {}", if status.up { "OUI" } else { "NON" });
                    Ok(())
                }
                OvhVpsSubcommand::Console {
                    service_name,
                    show,
                    open,
                    r#type,
                    enter,
                    screenshot,
                    profile,
                } => {
                    let (client, used) =
                        ops::client_for_vps(profile.as_deref(), service_name).await?;
                    let url = VpsManager::new(&client).console_url(service_name).await?;
                    let shown = if *show {
                        url.clone()
                    } else {
                        vps::redact_console_url(&url)
                    };
                    println!("Console KVM {service_name} (profil {used}): {shown}");
                    if *open {
                        let input = console::ConsoleInput {
                            text: r#type.clone(),
                            enter: *enter,
                            screenshot: screenshot.clone(),
                        };
                        println!("{}", console::open(&url, &input)?);
                    }
                    Ok(())
                }
                OvhVpsSubcommand::Rescue {
                    service_name,
                    apply,
                    profile,
                } => {
                    vps_netboot(
                        profile.as_deref(),
                        service_name,
                        vps::NetbootMode::Rescue,
                        *apply,
                    )
                    .await
                }
                OvhVpsSubcommand::Netboot {
                    service_name,
                    mode,
                    apply,
                    profile,
                } => match mode {
                    Some(mode) => {
                        vps_netboot(profile.as_deref(), service_name, *mode, *apply).await
                    }
                    None => {
                        let (client, used) =
                            ops::client_for_vps(profile.as_deref(), service_name).await?;
                        let mode = VpsManager::new(&client).netboot(service_name).await?;
                        println!("VPS {service_name} (profil {used}): netboot {mode}");
                        Ok(())
                    }
                },
                OvhVpsSubcommand::Tasks {
                    service_name,
                    json,
                    profile,
                } => {
                    let (client, used) =
                        ops::client_for_vps(profile.as_deref(), service_name).await?;
                    let tasks = VpsManager::new(&client).tasks(service_name).await?;
                    if *json {
                        println!("{}", serde_json::to_string_pretty(&tasks)?);
                        return Ok(());
                    }
                    println!("Tâches VPS {service_name} (profil {used}): {}", tasks.len());
                    for t in tasks {
                        println!(
                            "  {:<12} {:<24} {:<10} {:>3}%  {}",
                            t.id, t.r#type, t.state, t.progress, t.date
                        );
                    }
                    Ok(())
                }
                OvhVpsSubcommand::Reboot {
                    service_name,
                    apply,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    if !apply {
                        println!("[PLAN] Redémarrage matériel du VPS '{service_name}'");
                        println!("Passez --apply pour confirmer.");
                        return Ok(());
                    }
                    let task_id = vps.reboot(service_name, true).await?;
                    println!(
                        "Tâche de redémarrage envoyée avec succès (Task ID: {:?}).",
                        task_id
                    );
                    Ok(())
                }
                OvhVpsSubcommand::Start {
                    service_name,
                    apply,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    if !apply {
                        println!("[PLAN] Démarrage du VPS '{service_name}'");
                        println!("Passez --apply pour confirmer.");
                        return Ok(());
                    }
                    let task_id = vps.start(service_name).await?;
                    println!(
                        "Tâche de démarrage envoyée avec succès (Task ID: {:?}).",
                        task_id
                    );
                    Ok(())
                }
                OvhVpsSubcommand::Renew {
                    service_name,
                    period,
                    apply,
                    pay,
                    profile,
                } => {
                    let client = ops::client_for(profile.as_deref())?;
                    let billing = VpsManager::new(&client).billing(service_name).await?;
                    println!(
                        "VPS {service_name}: statut {}, expiration {}",
                        billing.status, billing.expiration
                    );
                    ops::renew_flow(
                        client,
                        &ops::RenewRequest {
                            profile: profile.as_deref(),
                            service_id: billing.service_id,
                            label: service_name,
                            period: Some(period.as_str()),
                            apply: *apply,
                            pay: *pay,
                        },
                    )
                    .await
                }
                OvhVpsSubcommand::SetDeleteAtExpiration {
                    service_name,
                    preserve,
                    delete,
                    apply,
                    profile,
                } => {
                    if !preserve && !delete {
                        anyhow::bail!("Indiquez --preserve ou --delete");
                    }
                    if *preserve && *delete {
                        anyhow::bail!("Indiquez --preserve ou --delete, pas les deux");
                    }
                    let flag = *preserve; // preserve=true => deleteAtExpiration=false
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let billing = vps.billing(service_name).await?;
                    if !apply {
                        println!(
                            "[PLAN] Définir deleteAtExpiration={} pour {} (expiration {})",
                            !flag, service_name, billing.expiration
                        );
                        println!("Passez --apply pour confirmer.");
                        return Ok(());
                    }
                    vps.set_delete_at_expiration(service_name, !flag).await?;
                    println!("deleteAtExpiration={} défini pour {}", !flag, service_name);
                    Ok(())
                }
                OvhVpsSubcommand::Watch {
                    service_name,
                    alerts_only,
                    notify,
                    profile,
                } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let services = if let Some(name) = service_name {
                        vec![name.clone()]
                    } else {
                        vps.list_vps().await?
                    };
                    let alert_threshold = 14; // Alerte si < 14 jours jusqu'à expiration
                    let mut exit_code = 0;
                    let mut report = Vec::new();
                    let mut report_names: Vec<String> = Vec::new();

                    for svc in services {
                        if let Ok(billing) = vps.billing(&svc).await {
                            let info = vps.get_vps(&svc).await.ok();
                            let state = info.as_ref().map(|i| i.state.as_str());
                            let health =
                                VpsHealthStatus::new(svc.clone(), &billing, state, alert_threshold);
                            if !health.alerts.is_empty() {
                                exit_code = 1;
                                report.push((svc, health.alerts));
                            }
                        }
                    }

                    if exit_code == 0 && !alerts_only {
                        println!("Tous les VPS sont sains.");
                    } else if exit_code == 1 {
                        println!("Alertes VPS détectées:");
                        report_names = report.iter().map(|(name, _)| name.clone()).collect();
                        for (name, alerts) in report {
                            println!("\n{}", name);
                            for alert in alerts {
                                println!("  ! {}", alert);
                            }
                        }
                    }

                    if *notify
                        && exit_code == 1
                        && let Err(error) = ops::send_notification(&format!(
                            "Alertes VPS OVH: {}",
                            report_names.join(", ")
                        ))
                    {
                        eprintln!("Notification non envoyée: {error:#}");
                    }

                    std::process::exit(exit_code);
                }
            },
            OvhCommand::Auth { subcommand } => match subcommand {
                OvhAuthSubcommand::Status { json, profile } => {
                    ops::auth_status(profile.as_deref(), *json).await
                }
            },
            OvhCommand::Services {
                profile,
                json,
                subcommand,
            } => match subcommand {
                None => ops::services_list(profile.as_deref(), *json).await,
                Some(OvhServicesSubcommand::Watch {
                    days,
                    alerts_only,
                    notify,
                }) => {
                    // Exit codes: 0 healthy, 1 alerts, 2 error.
                    match ops::services_watch(profile.as_deref(), *days, *alerts_only, *notify)
                        .await
                    {
                        Ok(code) => std::process::exit(code),
                        Err(error) => {
                            eprintln!("Erreur: {error:#}");
                            std::process::exit(2);
                        }
                    }
                }
                Some(OvhServicesSubcommand::Renew {
                    service,
                    period,
                    apply,
                    pay,
                }) => {
                    ops::services_renew(
                        profile.as_deref(),
                        service,
                        period.as_deref(),
                        *apply,
                        *pay,
                    )
                    .await
                }
            },
            OvhCommand::Domain { subcommand } => match subcommand {
                OvhDomainSubcommand::List { json, profile } => {
                    ops::domain_list(profile.as_deref(), *json).await
                }
                OvhDomainSubcommand::Info {
                    domain,
                    json,
                    profile,
                } => ops::domain_info(profile.as_deref(), domain, *json).await,
                OvhDomainSubcommand::Renew {
                    domain,
                    period,
                    apply,
                    pay,
                    profile,
                } => {
                    ops::domain_renew(profile.as_deref(), domain, period.as_deref(), *apply, *pay)
                        .await
                }
                OvhDomainSubcommand::Autorenew {
                    domain,
                    on,
                    off,
                    apply,
                    profile,
                } => ops::domain_autorenew(profile.as_deref(), domain, *on, *off, *apply).await,
                OvhDomainSubcommand::Nameservers {
                    domain,
                    hosts,
                    apply,
                    ds_cache_expired,
                    profile,
                } => {
                    ops::domain_nameservers(
                        profile.as_deref(),
                        domain,
                        hosts,
                        *apply,
                        *ds_cache_expired,
                    )
                    .await
                }
                OvhDomainSubcommand::Dnssec {
                    domain,
                    disable_hosted,
                    keys,
                    json,
                    apply,
                    profile,
                } => {
                    ops::domain_dnssec(
                        profile.as_deref(),
                        domain,
                        &ops::DnssecChange {
                            disable_hosted: *disable_hosted,
                            keys,
                            apply: *apply,
                        },
                        *json,
                    )
                    .await
                }
            },
            OvhCommand::Iam { subcommand } => match subcommand {
                OvhIamSubcommand::Sync { apply, profile } => {
                    ops::iam_sync(profile.as_deref(), *apply).await
                }
            },
            OvhCommand::Email { subcommand } => match subcommand {
                OvhEmailSubcommand::Domain { domain, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let email = EmailManager::new(&client);
                    let d = email.get_domain(domain).await?;
                    println!("Domaine email: {}", d.domain);
                    println!("Statut: {}", d.status);
                    println!("Offre: {}", d.offer);
                    Ok(())
                }
                OvhEmailSubcommand::Redirections { domain, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let email = EmailManager::new(&client);
                    let list = email.list_redirections(domain).await?;
                    println!("{:<12} {:<30} -> VERS", "ID", "DEPUIS");
                    println!("{:-<12} {:-<30}    {:-<30}", "", "", "");
                    for r in list {
                        println!("{:<12} {:<30} -> {}", r.id, r.from, r.to);
                    }
                    Ok(())
                }
                OvhEmailSubcommand::Audit { domain, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let email = EmailManager::new(&client);
                    let report = email.audit_email_dns(domain).await?;
                    println!("Audit délivrabilité email: {}", report.domain);
                    println!("Statut global: {}", report.status);
                    println!("MX valide: {}", if report.mx_valid { "OUI" } else { "NON" });
                    println!(
                        "SPF valide: {}",
                        if report.spf_valid { "OUI" } else { "NON" }
                    );
                    println!(
                        "DMARC valide: {}",
                        if report.dmarc_valid { "OUI" } else { "NON" }
                    );
                    println!(
                        "Sélecteurs DKIM: {} trouvés ({})",
                        report.dkim_selectors_count,
                        if report.dkim_valid { "OK" } else { "MANQUANT" }
                    );
                    if !report.recommendations.is_empty() {
                        println!("Recommandations:");
                        for rec in &report.recommendations {
                            println!("  - {rec}");
                        }
                    }
                    Ok(())
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::assert_matches;

    #[test]
    fn test_sha1_hex_computation() {
        assert_eq!(sha1_hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(
            sha1_hex("aphrody"),
            "1a9c55099105fe738f75ed2b220beaf809702dd8"
        );
    }

    #[test]
    fn test_sign_request_format() {
        let sig = sign_request(
            "as",
            "ck",
            "GET",
            "https://eu.api.ovh.com/1.0/domain/zone",
            "",
            1700000000,
        );
        assert!(sig.starts_with("$1$"));
        assert_eq!(sig.len(), 43); // "$1$" + 40 hex chars
    }

    #[test]
    fn test_parse_credentials_bash_format() {
        let bash_txt = r#"
export OVH_APPLICATION_KEY="ak_test"
export OVH_APPLICATION_SECRET="as_test"
export OVH_CONSUMER_KEY="ck_test"
"#;
        let parsed = parse_credentials_text(bash_txt).expect("parses bash format");
        assert_eq!(parsed.application_key, "ak_test");
        assert_eq!(parsed.application_secret, "as_test");
        assert_eq!(parsed.consumer_key, "ck_test");
    }

    #[test]
    fn test_parse_credentials_ini_format() {
        let ini_txt = r#"
[ovh-eu]
application_key = ak_ini
application_secret = as_ini
consumer_key = ck_ini
"#;
        let parsed = parse_credentials_text(ini_txt).expect("parses ini format");
        assert_eq!(parsed.application_key, "ak_ini");
        assert_eq!(parsed.application_secret, "as_ini");
        assert_eq!(parsed.consumer_key, "ck_ini");
    }

    #[derive(clap::Parser)]
    struct Harness {
        #[command(subcommand)]
        command: OvhCommand,
    }

    #[test]
    fn renew_quotes_by_default_and_pay_requires_apply() {
        use clap::Parser;
        let quote = Harness::try_parse_from(["ovh", "vps", "renew", "vps-1"]).unwrap();
        assert_matches!(
            quote.command,
            OvhCommand::Vps { subcommand: OvhVpsSubcommand::Renew { apply: false, pay: false, ref period, .. } }
                if period == "P1M"
        );
        assert!(Harness::try_parse_from(["ovh", "vps", "renew", "vps-1", "--pay"]).is_err());
        assert!(
            Harness::try_parse_from(["ovh", "vps", "renew", "vps-1", "--apply", "--pay"]).is_ok()
        );
    }

    #[test]
    fn expired_service_is_recognised() {
        let error = anyhow::anyhow!(
            "OVH GET /vps/x/status -> HTTP 460: {{\"message\":\"This service is expired\"}}"
        );
        assert!(is_expired_error(&error));
        assert!(!is_expired_error(&anyhow::anyhow!(
            "OVH GET /vps -> HTTP 403: denied"
        )));
    }

    #[test]
    fn auth_and_services_commands_parse() {
        use clap::Parser;

        let status = Harness::try_parse_from(["ovh", "auth", "status", "--json"]).unwrap();
        assert_matches!(
            status.command,
            OvhCommand::Auth {
                subcommand: OvhAuthSubcommand::Status { json: true, .. }
            }
        );

        let list = Harness::try_parse_from(["ovh", "services", "--json"]).unwrap();
        assert_matches!(
            list.command,
            OvhCommand::Services {
                json: true,
                subcommand: None,
                ..
            }
        );

        let watch = Harness::try_parse_from([
            "ovh",
            "services",
            "watch",
            "--days",
            "30",
            "--alerts-only",
            "--notify",
            "--profile",
            "aphrody.com",
        ])
        .unwrap();
        assert_matches!(
            watch.command,
            OvhCommand::Services {
                profile: Some(ref p),
                subcommand: Some(OvhServicesSubcommand::Watch {
                    days: 30,
                    alerts_only: true,
                    notify: true
                }),
                ..
            } if p == "aphrody.com"
        );
        let default_days = Harness::try_parse_from(["ovh", "services", "watch"]).unwrap();
        assert_matches!(
            default_days.command,
            OvhCommand::Services {
                subcommand: Some(OvhServicesSubcommand::Watch { days: 14, .. }),
                ..
            }
        );

        let renew = Harness::try_parse_from(["ovh", "services", "renew", "69570856"]).unwrap();
        assert_matches!(
            renew.command,
            OvhCommand::Services {
                subcommand: Some(OvhServicesSubcommand::Renew {
                    apply: false,
                    pay: false,
                    period: None,
                    ..
                }),
                ..
            }
        );
        assert!(Harness::try_parse_from(["ovh", "services", "renew", "x", "--pay"]).is_err());
        assert!(
            Harness::try_parse_from([
                "ovh", "services", "renew", "x", "--period", "P1Y", "--apply", "--pay"
            ])
            .is_ok()
        );
    }

    #[test]
    fn domain_and_iam_commands_parse() {
        use clap::Parser;

        assert!(Harness::try_parse_from(["ovh", "domain", "list", "--json"]).is_ok());
        assert!(Harness::try_parse_from(["ovh", "domain", "info", "aphrody.com"]).is_ok());
        let renew = Harness::try_parse_from([
            "ovh",
            "domain",
            "renew",
            "aphrody.com",
            "--period",
            "P1Y",
            "--apply",
        ])
        .unwrap();
        assert_matches!(
            renew.command,
            OvhCommand::Domain {
                subcommand: OvhDomainSubcommand::Renew {
                    apply: true,
                    pay: false,
                    ..
                }
            }
        );
        assert!(Harness::try_parse_from(["ovh", "domain", "renew", "a.com", "--pay"]).is_err());

        let on = Harness::try_parse_from(["ovh", "domain", "autorenew", "a.com", "--on"]).unwrap();
        assert_matches!(
            on.command,
            OvhCommand::Domain {
                subcommand: OvhDomainSubcommand::Autorenew {
                    on: true,
                    off: false,
                    apply: false,
                    ..
                }
            }
        );
        assert!(
            Harness::try_parse_from(["ovh", "domain", "autorenew", "a.com", "--on", "--off"])
                .is_err()
        );

        let ns = Harness::try_parse_from([
            "ovh",
            "domain",
            "nameservers",
            "a.com",
            "duke.ns.cloudflare.com",
            "veda.ns.cloudflare.com",
        ])
        .unwrap();
        assert_matches!(
            ns.command,
            OvhCommand::Domain {
                subcommand: OvhDomainSubcommand::Nameservers { apply: false, ref hosts, .. }
            } if hosts.len() == 2
        );
        assert!(
            Harness::try_parse_from(["ovh", "domain", "nameservers", "a.com", "x.b.c"]).is_err()
        );
        assert!(
            Harness::try_parse_from([
                "ovh",
                "domain",
                "nameservers",
                "a.com",
                "ns1.example.net",
                "ns2.example.net",
                "--apply"
            ])
            .is_err()
        );
        assert!(
            Harness::try_parse_from([
                "ovh",
                "domain",
                "nameservers",
                "a.com",
                "ns1.example.net",
                "ns2.example.net",
                "--apply",
                "--ds-cache-expired"
            ])
            .is_ok()
        );
        let ds = Harness::try_parse_from([
            "ovh",
            "domain",
            "dnssec",
            "a.com",
            "--key",
            "257 13 2371 AA==",
            "--apply",
        ])
        .unwrap();
        assert_matches!(
            ds.command,
            OvhCommand::Domain {
                subcommand: OvhDomainSubcommand::Dnssec {
                    disable_hosted: false,
                    apply: true,
                    ref keys,
                    ..
                }
            } if keys.len() == 1
        );
        assert!(
            Harness::try_parse_from([
                "ovh",
                "domain",
                "dnssec",
                "a.com",
                "--disable-hosted",
                "--key",
                "257 13 1 AA=="
            ])
            .is_err()
        );

        let sync = Harness::try_parse_from(["ovh", "iam", "sync"]).unwrap();
        assert_matches!(
            sync.command,
            OvhCommand::Iam {
                subcommand: OvhIamSubcommand::Sync { apply: false, .. }
            }
        );
        assert!(Harness::try_parse_from(["ovh", "iam", "sync", "--apply"]).is_ok());

        let export =
            Harness::try_parse_from(["ovh", "dns", "export", "a.com", "--output", "a.zone"])
                .unwrap();
        assert_matches!(
            export.command,
            OvhCommand::Dns {
                subcommand: OvhDnsSubcommand::Export {
                    output: Some(_),
                    ..
                }
            }
        );
        assert!(Harness::try_parse_from(["ovh", "dns", "backup", "--dir", "/tmp/z"]).is_ok());
        assert!(Harness::try_parse_from(["ovh", "dns", "backup"]).is_err());
    }

    #[test]
    fn console_rescue_netboot_tasks_parse() {
        use clap::Parser;

        let console = Harness::try_parse_from([
            "ovh",
            "vps",
            "console",
            "vps-1",
            "--open",
            "--type",
            "systemctl restart ssh",
            "--enter",
        ])
        .unwrap();
        assert_matches!(
            console.command,
            OvhCommand::Vps { subcommand: OvhVpsSubcommand::Console { open: true, enter: true, show: false, ref r#type, .. } }
                if r#type.as_deref() == Some("systemctl restart ssh")
        );
        // Typing needs a browser session.
        assert!(
            Harness::try_parse_from(["ovh", "vps", "console", "vps-1", "--type", "x"]).is_err()
        );
        let rescue = Harness::try_parse_from(["ovh", "vps", "rescue", "vps-1"]).unwrap();
        assert_matches!(
            rescue.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::Rescue { apply: false, .. }
            }
        );
        let netboot =
            Harness::try_parse_from(["ovh", "vps", "netboot", "vps-1", "local", "--apply"])
                .unwrap();
        assert_matches!(
            netboot.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::Netboot {
                    mode: Some(vps::NetbootMode::Local),
                    apply: true,
                    ..
                }
            }
        );
        let tasks = Harness::try_parse_from(["ovh", "vps", "tasks", "vps-1", "--json"]).unwrap();
        assert_matches!(
            tasks.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::Tasks { json: true, .. }
            }
        );
    }

    #[test]
    fn new_vps_commands_parse_correctly() {
        use clap::Parser;

        // Test `start` subcommand
        let start = Harness::try_parse_from(["ovh", "vps", "start", "vps-1"]).unwrap();
        assert_matches!(
            start.command,
            OvhCommand::Vps { subcommand: OvhVpsSubcommand::Start { apply: false, ref service_name, .. } }
                if service_name == "vps-1"
        );

        // Test `set-delete-at-expiration` with --preserve
        let preserve = Harness::try_parse_from([
            "ovh",
            "vps",
            "set-delete-at-expiration",
            "vps-1",
            "--preserve",
        ])
        .unwrap();
        assert_matches!(
            preserve.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::SetDeleteAtExpiration {
                    preserve: true,
                    delete: false,
                    ..
                }
            }
        );

        // Test `set-delete-at-expiration` with --delete
        let delete = Harness::try_parse_from([
            "ovh",
            "vps",
            "set-delete-at-expiration",
            "vps-1",
            "--delete",
        ])
        .unwrap();
        assert_matches!(
            delete.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::SetDeleteAtExpiration {
                    preserve: false,
                    delete: true,
                    ..
                }
            }
        );

        // Test `watch` with no arguments (all VPS)
        let watch = Harness::try_parse_from(["ovh", "vps", "watch"]).unwrap();
        assert_matches!(
            watch.command,
            OvhCommand::Vps {
                subcommand: OvhVpsSubcommand::Watch {
                    service_name: None,
                    alerts_only: false,
                    ..
                }
            }
        );

        // Test `watch` with specific VPS and flags
        let watch_alerts =
            Harness::try_parse_from(["ovh", "vps", "watch", "vps-1", "--alerts-only", "--notify"])
                .unwrap();
        assert_matches!(
            watch_alerts.command,
            OvhCommand::Vps { subcommand: OvhVpsSubcommand::Watch { service_name: Some(ref name), alerts_only: true, notify: true, .. } }
                if name == "vps-1"
        );
    }
}
