// SPDX-License-Identifier: Apache-2.0
//! Sovereign secret management, encryption at rest, memory redaction, and leakage audit.

pub mod contract;
pub mod crypto;
pub mod envelope;
pub mod redaction;
pub mod scanner;
pub mod systemd;

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use clap::Subcommand;

pub use contract::{SecretValidationReport, SecretsContract};
pub use envelope::EncryptedManifest;
pub use redaction::SecretString;
pub use scanner::{SecretAuditFinding, SecretScanner};

#[derive(Debug, Subcommand, Clone)]
pub enum SecretsCommand {
    /// Deep audit of repository tree and files for unencrypted secrets and tokens.
    Audit {
        #[arg(long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Validate secret presence for a service against tools/config/secrets-contract.json.
    Check {
        #[arg(long)]
        service: String,
        #[arg(long)]
        env_file: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Encrypt an unencrypted environment file into an EncryptedManifest (.enc.json).
    Encrypt {
        #[arg(long)]
        service: String,
        #[arg(long = "in")]
        in_file: PathBuf,
        #[arg(long = "out")]
        out_file: PathBuf,
        #[arg(long)]
        password: Option<String>,
    },
    /// Decrypt an EncryptedManifest to verify integrity or inspect schema.
    Decrypt {
        #[arg(long = "in")]
        in_file: PathBuf,
        #[arg(long = "out")]
        out_file: Option<PathBuf>,
        #[arg(long)]
        password: Option<String>,
    },
    /// Safely provision a decrypted environment file for systemd with 0400 permissions.
    Render {
        #[arg(long)]
        service: String,
        #[arg(long = "in")]
        in_file: PathBuf,
        #[arg(long = "out")]
        out_file: PathBuf,
        #[arg(long)]
        password: Option<String>,
        #[arg(long)]
        apply: bool,
    },
}

impl SecretsCommand {
    pub fn execute(&self, root: &Path) -> Result<()> {
        match self {
            SecretsCommand::Audit { path, json } => {
                let target_dir = if path.is_absolute() {
                    path.clone()
                } else {
                    root.join(path)
                };

                let scanner = SecretScanner::new();
                let findings = scanner.scan_directory(&target_dir)?;

                if *json {
                    println!("{}", serde_json::to_string_pretty(&findings)?);
                } else {
                    println!(
                        "Scan de sécurité des secrets sur : {}",
                        target_dir.display()
                    );
                    if findings.is_empty() {
                        println!("Statut : AUCUNE FUITE DÉTECTÉE (dépôt propre et conforme)");
                    } else {
                        println!(
                            "ATTENTION : {} fuite(s) ou anomalie(s) détectée(s) :",
                            findings.len()
                        );
                        for f in &findings {
                            println!(
                                "  [{}] {}:{} — {} ({})",
                                f.severity, f.file, f.line, f.description, f.snippet
                            );
                        }
                    }
                }
                Ok(())
            }
            SecretsCommand::Check {
                service,
                env_file,
                json,
            } => {
                let contract_path = root.join("tools/config/secrets-contract.json");
                let contract = SecretsContract::load(&contract_path)?;

                let env_map = if let Some(p) = env_file {
                    let target_path = if p.is_absolute() {
                        p.clone()
                    } else {
                        root.join(p)
                    };
                    systemd::parse_env_file(&target_path)?
                } else {
                    // Check standard environment variables in current process
                    std::env::vars().collect()
                };

                let report = contract.validate_service(service, &env_map)?;

                if *json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!(
                        "Vérification du contrat de secrets pour '{}' :",
                        report.service
                    );
                    println!("  Statut global       : {}", report.status);
                    println!("  Variables déclarées : {}", report.total_declared);
                    println!("  Variables valides   : {}", report.present_count);
                    if !report.missing_required.is_empty() {
                        println!(
                            "  Variables requises MANQUANTES : {:?}",
                            report.missing_required
                        );
                    }
                    if !report.empty_values.is_empty() {
                        println!(
                            "  Variables vides (définies mais sans valeur) : {:?}",
                            report.empty_values
                        );
                    }
                }
                Ok(())
            }
            SecretsCommand::Encrypt {
                service,
                in_file,
                out_file,
                password,
            } => {
                let in_path = if in_file.is_absolute() {
                    in_file.clone()
                } else {
                    root.join(in_file)
                };
                let out_path = if out_file.is_absolute() {
                    out_file.clone()
                } else {
                    root.join(out_file)
                };

                let pwd = match password {
                    Some(p) => p.clone(),
                    None => std::env::var("APHRODY_SECRETS_PASSWORD").context(
                        "Password required (via --password or APHRODY_SECRETS_PASSWORD env)",
                    )?,
                };

                let env_map = systemd::parse_env_file(&in_path)?;
                let manifest = EncryptedManifest::encrypt(service, &env_map, &pwd)?;

                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }

                let json_content = serde_json::to_string_pretty(&manifest)?;
                fs::write(&out_path, json_content)?;

                println!("Enveloppe chiffrée générée avec succès : {:?}", out_path);
                println!("  Service : {}", manifest.service);
                println!("  Clés chiffrées : {}", manifest.data.len());
                Ok(())
            }
            SecretsCommand::Decrypt {
                in_file,
                out_file,
                password,
            } => {
                let in_path = if in_file.is_absolute() {
                    in_file.clone()
                } else {
                    root.join(in_file)
                };
                let pwd = match password {
                    Some(p) => p.clone(),
                    None => std::env::var("APHRODY_SECRETS_PASSWORD").context(
                        "Password required (via --password or APHRODY_SECRETS_PASSWORD env)",
                    )?,
                };

                let content = fs::read_to_string(&in_path)
                    .with_context(|| format!("cannot read encrypted manifest at {:?}", in_path))?;
                let manifest: EncryptedManifest = serde_json::from_str(&content)?;
                let decrypted = manifest.decrypt(&pwd)?;

                println!(
                    "Déchiffrement réussi de l'enveloppe '{}' :",
                    manifest.service
                );
                println!("  Nombre de secrets déchiffrés : {}", decrypted.len());
                for (k, v) in &decrypted {
                    println!("  - {:<24} : {}", k, v.masked_preview());
                }

                if let Some(out_p) = out_file {
                    let out_path = if out_p.is_absolute() {
                        out_p.clone()
                    } else {
                        root.join(out_p)
                    };
                    systemd::render_env_file(&decrypted, &out_path, true)?;
                    println!("Exporté vers : {:?}", out_path);
                }

                Ok(())
            }
            SecretsCommand::Render {
                service,
                in_file,
                out_file,
                password,
                apply,
            } => {
                let in_path = if in_file.is_absolute() {
                    in_file.clone()
                } else {
                    root.join(in_file)
                };
                let out_path = if out_file.is_absolute() {
                    out_file.clone()
                } else {
                    root.join(out_file)
                };

                let pwd = match password {
                    Some(p) => p.clone(),
                    None => std::env::var("APHRODY_SECRETS_PASSWORD").context(
                        "Password required (via --password or APHRODY_SECRETS_PASSWORD env)",
                    )?,
                };

                let content = fs::read_to_string(&in_path)
                    .with_context(|| format!("cannot read encrypted manifest at {:?}", in_path))?;
                let manifest: EncryptedManifest = serde_json::from_str(&content)?;

                if manifest.service != *service {
                    bail!(
                        "manifest service '{}' does not match requested service '{}'",
                        manifest.service,
                        service
                    );
                }

                let decrypted = manifest.decrypt(&pwd)?;
                let status_msg = systemd::render_env_file(&decrypted, &out_path, *apply)?;
                println!("{status_msg}");

                Ok(())
            }
        }
    }
}
