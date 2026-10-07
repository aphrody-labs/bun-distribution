// SPDX-License-Identifier: Apache-2.0
use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DragonBallDefaults {
    pub per_host_delay_ms: u64,
    pub max_in_flight_per_host: u32,
    pub max_concurrency: usize,
    pub max_depth: u32,
    pub max_pages: usize,
}

impl Default for DragonBallDefaults {
    fn default() -> Self {
        Self {
            per_host_delay_ms: 2000,
            max_in_flight_per_host: 1,
            max_concurrency: 2,
            max_depth: 8,
            max_pages: 50000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragonBallTarget {
    pub id: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub mode: String,
    pub seeds: Vec<String>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    #[serde(default)]
    pub source_refs: Vec<String>,
    pub max_depth: Option<u32>,
    pub per_host_delay_ms: Option<u64>,
    pub max_in_flight_per_host: Option<u32>,
    pub lang: Option<String>,
    pub kind: Option<String>,
    pub goal: Option<String>,
    pub policy: Option<String>,
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragonBallPlan {
    #[serde(default)]
    pub respect_robots: bool,
    pub user_agent: String,
    #[serde(default)]
    pub defaults: DragonBallDefaults,
    pub targets: Vec<DragonBallTarget>,
}

impl Default for DragonBallPlan {
    fn default() -> Self {
        serde_json::from_str(include_str!("plan.json")).expect("embedded Dragon Ball plan is valid")
    }
}

pub fn source_registry() -> serde_json::Value {
    serde_json::from_str(include_str!("registry.json")).expect("embedded source registry is valid")
}

pub fn validate_source_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Dragon Ball source requires a credential-free HTTP(S) URL".into());
    }
    let host = url.host_str().unwrap_or_default();
    if host == "fandom.com" || host.ends_with(".fandom.com") {
        return Err("Fandom is forbidden by Shenron editorial source policy".into());
    }
    if host == "web.archive.org"
        && let Some(archived) = url.path().splitn(4, '/').nth(3)
        && archived.starts_with("http")
    {
        let archived = validate_source_url(archived)?;
        if archived.host_str().is_none() {
            return Err("invalid archived source URL".into());
        }
    }
    if matches!(host, "localhost" | "localhost.localdomain") || host.ends_with(".localhost") {
        return Err("Dragon Ball sources must be public".into());
    }
    if let Some(url::Host::Ipv4(address)) = url.host()
        && (address.is_private()
            || address.is_loopback()
            || address.is_link_local()
            || address.is_unspecified())
    {
        return Err("Dragon Ball sources must be public".into());
    }
    if let Some(url::Host::Ipv6(address)) = url.host()
        && (address.is_loopback()
            || address.is_unspecified()
            || address.is_unique_local()
            || address.is_unicast_link_local())
    {
        return Err("Dragon Ball sources must be public".into());
    }
    Ok(url)
}

impl DragonBallTarget {
    pub fn accepts(&self, url: &Url) -> bool {
        let host = url.host_str().unwrap_or_default();
        let allowed = self.allowed_domains.is_empty()
            || self.allowed_domains.iter().any(|domain| {
                host.eq_ignore_ascii_case(domain)
                    || host
                        .to_ascii_lowercase()
                        .ends_with(&format!(".{}", domain.to_ascii_lowercase()))
            });
        allowed
            && validate_source_url(url.as_str()).is_ok()
            && !self.exclude_patterns.iter().any(|pattern| {
                Regex::new(pattern).is_ok_and(|pattern| pattern.is_match(url.as_str()))
            })
            && (self.include_patterns.is_empty()
                || self.include_patterns.iter().any(|pattern| {
                    Regex::new(pattern).is_ok_and(|pattern| pattern.is_match(url.as_str()))
                }))
    }
}

impl DragonBallPlan {
    pub fn selected_targets(&self, ids: &[String]) -> Result<Vec<&DragonBallTarget>, String> {
        self.validate()?;
        for id in ids {
            if !self.targets.iter().any(|target| target.enabled && target.id == *id) {
                return Err(format!("unknown or disabled Dragon Ball source: {id}"));
            }
        }
        Ok(self
            .targets
            .iter()
            .filter(|target| target.enabled && (ids.is_empty() || ids.contains(&target.id)))
            .collect())
    }
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for target in &self.targets {
            if target.id.is_empty()
                || !target
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
                || !ids.insert(&target.id)
            {
                return Err(format!("invalid or duplicate Dragon Ball target id: {}", target.id));
            }
            if !target.enabled {
                continue;
            }
            if !matches!(
                target.mode.as_str(),
                "" | "crawl" | "catalogue" | "json" | "mediawiki" | "wayback" | "shenron_api"
            ) {
                return Err(format!("unknown target mode: {}", target.mode));
            }
            if target.seeds.is_empty() {
                return Err(format!("{} has no seeds", target.id));
            }
            for pattern in target.include_patterns.iter().chain(&target.exclude_patterns) {
                Regex::new(pattern).map_err(|error| format!("{}: {error}", target.id))?;
            }
            for seed in &target.seeds {
                let url = validate_source_url(seed)?;
                if !target.accepts(&url) {
                    return Err(format!("seed excluded by its target policy: {seed}"));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrated_plan_has_complete_domains_and_forbids_fandom() {
        let plan = DragonBallPlan::default();
        plan.validate().unwrap();
        for id in [
            "official",
            "toei-dragon",
            "toei-dragonz",
            "toei-dragon_gt",
            "toei-dragon_kai",
            "toei-dragon_super",
            "toei-dragonball_daima",
            "jajanken",
            "toriyama-biography",
            "shenron-catalogue",
            "dragonballcn",
            "kanzentai",
            "neoseeker-databooks",
            "guides",
        ] {
            assert!(
                plan.targets.iter().any(|target| target.id == id && target.enabled),
                "missing {id}"
            );
        }
        assert!(
            plan.targets
                .iter()
                .filter(|target| target.id.starts_with("fandom"))
                .all(|target| !target.enabled)
        );
        assert!(validate_source_url("https://dragonball.fandom.com/wiki/Goku").is_err());
        assert!(validate_source_url("https://user:password@dragonballfr.com/").is_err());
        assert!(validate_source_url("http://127.0.0.1/").is_err());
    }
}
