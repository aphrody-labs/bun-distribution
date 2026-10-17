// SPDX-License-Identifier: Apache-2.0
//! Bounded native ACME DNS01 owner. Never returns account credentials or PEM secrets.
mod storage;
use anyhow::{Result, anyhow, ensure};
use aphrody_ovh::{DnsManager, DnsRecord, OvhClient, load_profile_credentials};
use instant_acme::{
    Account, AuthorizationStatus, ChallengeType, Identifier, LetsEncrypt, NewAccount, NewOrder,
    OrderStatus, RetryPolicy,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::Duration};

pub const HOSTNAME: &str = "vps.aphrody.com";
const ZONE: &str = "aphrody.com";
const TXT_NAME: &str = "_acme-challenge.vps";

#[derive(Clone)]
pub struct IssueOptions {
    pub output: PathBuf,
    pub workspace: PathBuf,
    pub hostname: String,
    pub production: bool,
    pub agree_tos: bool,
    pub profile: Option<String>,
    pub propagation_seconds: u64,
}

impl IssueOptions {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.hostname == HOSTNAME,
            "only vps.aphrody.com is authorized"
        );
        ensure!(self.agree_tos, "explicit --agree-tos is required");
        ensure!(
            (30..=300).contains(&self.propagation_seconds),
            "propagation delay must be 30..300 seconds"
        );
        ensure!(
            self.output.is_absolute() && self.workspace.is_absolute(),
            "explicit absolute output/workspace paths required"
        );
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
struct OwnedRecord {
    id: u64,
    target: String,
}

fn owns(record: &DnsRecord, receipt: &OwnedRecord) -> bool {
    record.id == receipt.id
        && record.zone == ZONE
        && record.sub_domain == TXT_NAME
        && record.field_type == "TXT"
        && record.target.trim_matches('"') == receipt.target
}

#[derive(Serialize, Deserialize)]
pub struct CertificateMetadata {
    pub hostname: String,
    pub production: bool,
    pub issued_unix_seconds: u64,
    pub certificate_sha256: String,
    pub generation: String,
}

struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub async fn issue(options: &IssueOptions) -> Result<CertificateMetadata> {
    options.validate()?;
    let root = storage::output_directory(&options.output, &options.workspace)?;
    let lock_path = root.join("issuance.lock");
    let lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|_| {
            anyhow!("issuance lock exists or cannot be created; inspect before recovering")
        })?;
    let _lock = Lock(lock_path);
    drop(lock_file);
    let client = OvhClient::new(load_profile_credentials(options.profile.as_deref())?)?;
    let dns = DnsManager::new(&client);
    // Recovery happens before creating a new order. Exact receipt mismatch fails closed.
    cleanup(&dns, &root).await?;
    let result =
        tokio::time::timeout(Duration::from_secs(900), issue_inner(options, &root, &dns)).await;
    let cleanup_result = cleanup(&dns, &root).await;
    cleanup_result.map_err(|_| {
        anyhow!("DNS challenge cleanup failed; protected ownership receipt retained")
    })?;
    result.map_err(|_| anyhow!("ACME issuance exceeded bounded 900-second deadline"))?
}

async fn issue_inner(
    options: &IssueOptions,
    root: &std::path::Path,
    dns: &DnsManager<'_>,
) -> Result<CertificateMetadata> {
    let account_name = if options.production {
        "account-production.json"
    } else {
        "account-staging.json"
    };
    let account_path = root.join(account_name);
    let account = if account_path.exists() {
        ensure!(
            !fs::symlink_metadata(&account_path)?
                .file_type()
                .is_symlink(),
            "symlink account refused"
        );
        Account::builder()?
            .from_credentials(serde_json::from_slice(&fs::read(account_path)?)?)
            .await?
    } else {
        let issuer = if options.production {
            LetsEncrypt::Production
        } else {
            LetsEncrypt::Staging
        };
        let (account, credentials) = Account::builder()?
            .create(
                &NewAccount {
                    contact: &["mailto:contact@aphrody.com"],
                    terms_of_service_agreed: true,
                    only_return_existing: false,
                },
                issuer.url().to_owned(),
                None,
            )
            .await?;
        storage::save(root, account_name, &serde_json::to_vec(&credentials)?)?;
        account
    };
    let names = [Identifier::Dns(HOSTNAME.to_owned())];
    let mut order = account.new_order(&NewOrder::new(&names)).await?;
    let mut authorizations = order.authorizations();
    while let Some(result) = authorizations.next().await {
        let mut authorization = result?;
        if authorization.status == AuthorizationStatus::Valid {
            continue;
        }
        ensure!(
            authorization.status == AuthorizationStatus::Pending,
            "authorization is not pending or valid"
        );
        let mut challenge = authorization
            .challenge(ChallengeType::Dns01)
            .ok_or_else(|| anyhow!("issuer has no DNS01 challenge"))?;
        ensure!(
            challenge.identifier().to_string() == HOSTNAME,
            "issuer returned unexpected identifier"
        );
        let target = challenge.key_authorization().dns_value();
        let existing = dns.list_records(ZONE, None).await?;
        ensure!(
            !existing
                .iter()
                .any(|r| r.sub_domain == TXT_NAME && r.field_type != "TXT"),
            "challenge name has a conflicting non-TXT record"
        );
        // Existing identical values are borrowed, never owned or removed.
        if !existing.iter().any(|r| {
            r.sub_domain == TXT_NAME
                && r.field_type == "TXT"
                && r.target.trim_matches('"') == target
        }) {
            backup_zone(dns, root).await?;
            // DnsManager add_record refreshes internally. Persist an intent first for crash diagnosis.
            storage::save(
                root,
                "challenge-intent.json",
                &serde_json::to_vec(
                    &serde_json::json!({"name":TXT_NAME,"target":target,"priorIds":existing.iter().map(|r|r.id).collect::<Vec<_>>()}),
                )?,
            )?;
            let record = dns
                .add_record(ZONE, "TXT", TXT_NAME, &target, 60, true)
                .await?
                .ok_or_else(|| anyhow!("native DNS owner returned no applied record"))?;
            let receipt = OwnedRecord {
                id: record.id,
                target,
            };
            ensure!(
                owns(&record, &receipt),
                "native DNS returned unexpected record"
            );
            storage::save(root, "challenge-owned.json", &serde_json::to_vec(&receipt)?)?;
            fs::remove_file(root.join("challenge-intent.json"))?;
        }
        tokio::time::sleep(Duration::from_secs(options.propagation_seconds)).await;
        challenge.set_ready().await?;
    }
    ensure!(
        order.poll_ready(&RetryPolicy::default()).await? == OrderStatus::Ready,
        "ACME order not ready"
    );
    let key = rcgen::KeyPair::generate()?;
    let mut params = rcgen::CertificateParams::new(vec![HOSTNAME.to_owned()])?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    let csr = params.serialize_request(&key)?;
    order.finalize_csr(csr.der()).await?;
    let certificate = order.poll_certificate(&RetryPolicy::default()).await?;
    let generation = format!("certificate-{}", uuid::Uuid::new_v4());
    let directory = root.join(&generation);
    fs::create_dir(&directory)?;
    let directory = storage::output_directory(&directory, &options.workspace)?;
    storage::save(
        &directory,
        "private-key.pem",
        key.serialize_pem().as_bytes(),
    )?;
    storage::save(&directory, "fullchain.pem", certificate.as_bytes())?;
    let metadata = CertificateMetadata {
        hostname: HOSTNAME.to_owned(),
        production: options.production,
        issued_unix_seconds: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs(),
        certificate_sha256: storage::hash(certificate.as_bytes()),
        generation,
    };
    storage::save(root, "current.json", &serde_json::to_vec_pretty(&metadata)?)?;
    Ok(metadata)
}

async fn backup_zone(dns: &DnsManager<'_>, root: &std::path::Path) -> Result<()> {
    let text = dns.export_zone(ZONE).await?;
    ensure!(!text.trim().is_empty(), "empty zone backup refused");
    let name = format!("zone-{}.bind", uuid::Uuid::new_v4());
    storage::save(root, &name, text.as_bytes())?;
    ensure!(
        storage::hash(&fs::read(root.join(&name))?) == storage::hash(text.as_bytes()),
        "zone backup checksum mismatch"
    );
    storage::save(
        root,
        &format!("{name}.sha256"),
        storage::hash(text.as_bytes()).as_bytes(),
    )?;
    Ok(())
}

async fn cleanup(dns: &DnsManager<'_>, root: &std::path::Path) -> Result<()> {
    let path = root.join("challenge-owned.json");
    ensure!(
        !root.join("challenge-intent.json").exists(),
        "incomplete DNS mutation intent retained; manual exact-ID reconciliation required"
    );
    if !path.exists() {
        return Ok(());
    }
    ensure!(
        !fs::symlink_metadata(&path)?.file_type().is_symlink(),
        "symlink receipt refused"
    );
    let receipt: OwnedRecord = serde_json::from_slice(&fs::read(&path)?)?;
    let records = dns.list_records(ZONE, Some("TXT")).await?;
    if let Some(record) = records.iter().find(|r| r.id == receipt.id) {
        ensure!(
            owns(record, &receipt),
            "owned DNS record changed; deletion refused"
        );
        backup_zone(dns, root).await?;
        dns.delete_record(ZONE, receipt.id, true).await?;
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn inspect(
    output: &std::path::Path,
    workspace: &std::path::Path,
) -> Result<CertificateMetadata> {
    let root = storage::output_directory(output, workspace)?;
    let metadata: CertificateMetadata =
        serde_json::from_slice(&fs::read(root.join("current.json"))?)?;
    ensure!(
        metadata.hostname == HOSTNAME
            && metadata.generation.starts_with("certificate-")
            && !metadata.generation.contains(['/', '\\']),
        "invalid certificate metadata"
    );
    let certificate = fs::read(root.join(&metadata.generation).join("fullchain.pem"))?;
    ensure!(
        storage::hash(&certificate) == metadata.certificate_sha256,
        "certificate checksum mismatch"
    );
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_and_consent_fail_closed() {
        let mut options = IssueOptions {
            output: PathBuf::from("relative"),
            workspace: PathBuf::from("relative"),
            hostname: HOSTNAME.into(),
            production: false,
            agree_tos: false,
            profile: None,
            propagation_seconds: 60,
        };
        assert!(options.validate().is_err());
        options.agree_tos = true;
        assert!(options.validate().is_err());
        options.hostname = "aphrody.com".into();
        assert!(options.validate().is_err());
    }
    #[test]
    fn cleanup_requires_exact_ownership() {
        let receipt = OwnedRecord {
            id: 42,
            target: "digest".into(),
        };
        let mut record = DnsRecord {
            id: 42,
            zone: ZONE.into(),
            sub_domain: TXT_NAME.into(),
            field_type: "TXT".into(),
            target: "\"digest\"".into(),
            ttl: 60,
        };
        assert!(owns(&record, &receipt));
        record.id = 43;
        assert!(!owns(&record, &receipt));
        record.id = 42;
        record.target = "other".into();
        assert!(!owns(&record, &receipt));
        record.target = "digest".into();
        record.sub_domain = "_acme-challenge".into();
        assert!(!owns(&record, &receipt));
    }
    #[test]
    fn workspace_and_relative_output_refused() {
        let workspace = tempfile::tempdir().expect("fixture");
        assert!(storage::output_directory(workspace.path(), workspace.path()).is_err());
        assert!(
            storage::output_directory(std::path::Path::new("relative"), workspace.path()).is_err()
        );
    }
}
