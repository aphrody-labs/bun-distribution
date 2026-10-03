// SPDX-License-Identifier: Apache-2.0
//! Multi-account profile resolution for OVHcloud infrastructure.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::client::OvhCredentials;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub region: String,
    pub domains: Vec<String>,
}

pub fn known_profiles() -> Vec<ProfileInfo> {
    vec![
        ProfileInfo {
            id: "aphrody.com".into(),
            name: "Aphrody Core".into(),
            region: "ovh-eu".into(),
            domains: vec!["aphrody.com".into()],
        },
        ProfileInfo {
            id: "rosegriffon.fr".into(),
            name: "Rose Griffon".into(),
            region: "ovh-eu".into(),
            domains: vec!["rosegriffon.fr".into()],
        },
        ProfileInfo {
            id: "dragonballfr.com".into(),
            name: "Dragon Ball FR".into(),
            region: "ovh-eu".into(),
            domains: vec!["dragonballfr.com".into()],
        },
    ]
}

pub fn parse_credentials_text(content: &str) -> Option<OvhCredentials> {
    let mut vars = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        // 1. Check export VAR="VAL" or VAR=VAL
        let stripped = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        if let Some((k, v)) = stripped.split_once('=') {
            let key =
                k.trim().trim_start_matches("dns_ovh_").trim_start_matches("OVH_").to_lowercase();
            let val = v.trim().trim_matches('"').trim_matches('\'').trim();
            vars.insert(key, val.to_string());
        }
    }

    let ak = vars.get("application_key").or_else(|| vars.get("app_key"))?;
    let as_ = vars.get("application_secret").or_else(|| vars.get("app_secret"))?;
    let ck = vars.get("consumer_key")?;
    let ep = vars.get("endpoint").cloned().unwrap_or_else(|| "ovh-eu".into());

    Some(OvhCredentials {
        application_key: ak.clone(),
        application_secret: as_.clone(),
        consumer_key: ck.clone(),
        endpoint: ep,
    })
}

pub fn load_profile_credentials(profile_or_domain: Option<&str>) -> Result<OvhCredentials> {
    // Check environment variables first
    let env_ak =
        std::env::var("OVH_APPLICATION_KEY").or_else(|_| std::env::var("OVH_APP_KEY")).ok();
    let env_as =
        std::env::var("OVH_APPLICATION_SECRET").or_else(|_| std::env::var("OVH_APP_SECRET")).ok();
    let env_ck = std::env::var("OVH_CONSUMER_KEY").ok();
    let env_ep = std::env::var("OVH_ENDPOINT").unwrap_or_else(|_| "ovh-eu".into());

    if profile_or_domain.is_none()
        && let (Some(ak), Some(as_), Some(ck)) = (&env_ak, &env_as, &env_ck)
    {
        return Ok(OvhCredentials {
            application_key: ak.clone(),
            application_secret: as_.clone(),
            consumer_key: ck.clone(),
            endpoint: env_ep,
        });
    }

    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    let home_path = Path::new(&home);

    let target = profile_or_domain.unwrap_or("aphrody.com").to_lowercase();

    // Candidate search files based on target domain / profile
    let mut candidate_paths = Vec::new();

    // rpbey.fr was sold and dropped from the aphrody.com account (docs/PLAN.md); its
    // credential-path match is gone too.
    if target.contains("aphrody") || target == "vps" {
        candidate_paths.push(home_path.join(".bash_secrets"));
        candidate_paths.push(home_path.join(".config/ovh/aphrody.conf"));
    } else if target.contains("rosegriffon") || target == "rg" {
        candidate_paths.push(home_path.join(".ovh.conf"));
        candidate_paths.push(home_path.join(".config/ovh/rosegriffon.conf"));
    } else if target.contains("dragonball") || target.contains("dbfr") {
        candidate_paths.push(home_path.join(".config/ovh/dbfr.conf"));
        candidate_paths.push(PathBuf::from("/etc/letsencrypt/ovh-dbfr.ini"));
    }

    // Direct path check if profile_or_domain is a file path
    if let Some(p) = profile_or_domain {
        let explicit = Path::new(p);
        if explicit.exists() {
            candidate_paths.insert(0, explicit.to_path_buf());
        }
    }

    candidate_paths.push(home_path.join(".ovh.conf"));

    for path in &candidate_paths {
        if path.exists()
            && let Ok(content) = std::fs::read_to_string(path)
            && let Some(creds) = parse_credentials_text(&content)
        {
            return Ok(creds);
        }
    }

    if let (Some(ak), Some(as_), Some(ck)) = (env_ak, env_as, env_ck) {
        return Ok(OvhCredentials {
            application_key: ak,
            application_secret: as_,
            consumer_key: ck,
            endpoint: env_ep,
        });
    }

    bail!(
        "could not find valid OVH credentials for profile '{}'. Checked paths: {:?}",
        profile_or_domain.unwrap_or("default"),
        candidate_paths
    );
}
