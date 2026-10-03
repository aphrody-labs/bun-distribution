// SPDX-License-Identifier: Apache-2.0
//! Aphrody OVH — Native in-process OVHcloud engine for Aphrody Infra.

pub mod client;
pub mod dns;
pub mod email;
pub mod profile;
pub mod vps;

pub use client::{OvhClient, OvhCredentials, sha1_hex, sign_request};
pub use dns::{DnsAuditReport, DnsManager, DnsRecord, DnsZoneInfo};
pub use email::{EmailDnsAuditReport, EmailDomainInfo, EmailManager, EmailRedirection};
pub use profile::{ProfileInfo, known_profiles, load_profile_credentials, parse_credentials_text};
pub use vps::{VpsInfo, VpsIp, VpsManager, VpsStatus};

use anyhow::Context;
use clap::Subcommand;

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
    /// Export zone in standard BIND format.
    Export {
        zone: String,
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
    /// Reboot a VPS (requires --apply).
    Reboot {
        service_name: String,
        #[arg(long)]
        apply: bool,
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
            },
            OvhCommand::Status { profile } => {
                let p = profile.as_deref();
                match load_profile_credentials(p) {
                    Ok(creds) => {
                        let client = OvhClient::new(creds)?;
                        let drift = client.sync_time().await?;
                        println!("Profil: {}", p.unwrap_or("défaut"));
                        println!("Statut: AUTHENTIFIÉ");
                        println!("Endpoint: {}", client.base_url());
                        println!("Décalage d'horloge OVH: {}s", drift);
                    },
                    Err(e) => {
                        println!("Profil: {}", p.unwrap_or("défaut"));
                        println!("Statut: NON CONFIGURÉ ({e})");
                    },
                }
                Ok(())
            },
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
                },
                OvhDnsSubcommand::Info { zone, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let info = dns.get_zone(zone).await?;
                    println!("Zone: {}", info.name);
                    println!("DNSSEC: {}", if info.dnssec_supported { "supporté" } else { "non" });
                    println!("Serveurs de noms: {}", info.name_servers.join(", "));
                    Ok(())
                },
                OvhDnsSubcommand::Records { zone, r#type, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let records = dns.list_records(zone, r#type.as_deref()).await?;
                    println!("{:<8} {:<6} {:<24} {:<8} CIBLE", "ID", "TYPE", "SOUS-DOMAINE", "TTL");
                    println!("{:-<8} {:-<6} {:-<24} {:-<8} {:-<30}", "", "", "", "", "");
                    for r in records {
                        let sub = if r.sub_domain.is_empty() { "@" } else { &r.sub_domain };
                        println!(
                            "{:<8} {:<6} {:<24} {:<8} {}",
                            r.id, r.field_type, sub, r.ttl, r.target
                        );
                    }
                    Ok(())
                },
                OvhDnsSubcommand::Add { zone, r#type, subdomain, target, ttl, apply, profile } => {
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
                    let res = dns.add_record(zone, r#type, subdomain, target, *ttl, true).await?;
                    if let Some(r) = res {
                        println!("Enregistrement créé avec succès (ID: {}).", r.id);
                    }
                    Ok(())
                },
                OvhDnsSubcommand::Delete { zone, record_id, apply, profile } => {
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
                },
                OvhDnsSubcommand::Refresh { zone, apply, profile } => {
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
                },
                OvhDnsSubcommand::SetA { zone, target_ip, subdomains, apply, profile } => {
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
                    let updated = dns.set_a_subdomains(zone, target_ip, &selected, true).await?;
                    println!(
                        "Bascule A effectuée avec succès ({} enregistrements sélectionnés ; identifiants et TTL conservés).",
                        updated.len()
                    );
                    Ok(())
                },
                OvhDnsSubcommand::Audit { zone, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let report = dns.audit_zone(zone).await?;
                    println!("Rapport d'audit DNS: {}", report.zone);
                    println!(
                        "DNSSEC: {}",
                        if report.dnssec_activated { "ACTIVÉ" } else { "DÉSACTIVÉ" }
                    );
                    println!("Anycast: {}", if report.has_dns_anycast { "OUI" } else { "NON" });
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
                },
                OvhDnsSubcommand::Export { zone, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let dns = DnsManager::new(&client);
                    let bind = dns.export_zone(zone).await?;
                    println!("{bind}");
                    Ok(())
                },
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
                },
                OvhVpsSubcommand::Info { service_name, profile } => {
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
                    Ok(())
                },
                OvhVpsSubcommand::Ips { service_name, profile } => {
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
                },
                OvhVpsSubcommand::Status { service_name, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    let status = vps.get_status(service_name).await?;
                    println!("VPS: {service_name}");
                    println!("État: {}", status.state);
                    println!("Ping: {}", if status.ping { "OK" } else { "ÉCHEC" });
                    println!("Up: {}", if status.up { "OUI" } else { "NON" });
                    Ok(())
                },
                OvhVpsSubcommand::Reboot { service_name, apply, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let vps = VpsManager::new(&client);
                    if !apply {
                        println!("[PLAN] Redémarrage matériel du VPS '{service_name}'");
                        println!("Passez --apply pour confirmer.");
                        return Ok(());
                    }
                    let task_id = vps.reboot(service_name, true).await?;
                    println!("Tâche de redémarrage envoyée avec succès (Task ID: {:?}).", task_id);
                    Ok(())
                },
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
                },
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
                },
                OvhEmailSubcommand::Audit { domain, profile } => {
                    let creds = load_profile_credentials(profile.as_deref())?;
                    let client = OvhClient::new(creds)?;
                    let email = EmailManager::new(&client);
                    let report = email.audit_email_dns(domain).await?;
                    println!("Audit délivrabilité email: {}", report.domain);
                    println!("Statut global: {}", report.status);
                    println!("MX valide: {}", if report.mx_valid { "OUI" } else { "NON" });
                    println!("SPF valide: {}", if report.spf_valid { "OUI" } else { "NON" });
                    println!("DMARC valide: {}", if report.dmarc_valid { "OUI" } else { "NON" });
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
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha1_hex_computation() {
        assert_eq!(sha1_hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(sha1_hex("aphrody"), "1a9c55099105fe738f75ed2b220beaf809702dd8");
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
}
