// SPDX-License-Identifier: Apache-2.0
//! Unified catalog access for Aphrody infrastructure.
//!
//! Provides typed access to:
//! - `infra/config/service-catalog.json` (systemd services, runtimes, proxy links)
//! - yolo `infra/config/host/nginx/routes.json` (`$YOLO_ROOT`; public domain mappings and upstreams)
//! - `infra/config/application-contracts.json` (inter-app architecture constraints)
//! - yolo `infra/config/host/inventory/targets.json` (cross-host infrastructure matrix)

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

pub use crate::local_ai::{
    LocalAiContract, LocalAiEndpoint, LocalAiEnv, LocalAiTarget, load_local_ai,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCatalog {
    pub schema_version: u32,
    pub owner: String,
    pub supervisor: String,
    pub proxy: String,
    pub services: Vec<CatalogService>,
    pub policies: Option<CatalogPolicies>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogService {
    pub id: String,
    pub kind: String,
    pub runtime: String,
    /// Systemd unit. Absent for a service nginx serves from disk (`kind: nginx-static`, route upstream `static:<dir>`):
    /// it has no process to supervise, so it is neither started, stopped nor reported by the lifecycle commands.
    #[serde(default)]
    pub unit: Option<String>,
    /// Omitted means a repository-owned systemd template. OS package units
    /// are validated on their target host, not fabricated in this repository.
    pub unit_source: Option<UnitSource>,
    pub application: Option<String>,
    pub source_repo: Option<String>,
    pub health: Option<String>,
    pub working_directory: Option<String>,
    pub release_root: Option<String>,
    pub additional_upstreams: Option<Vec<String>>,
    pub public: Option<bool>,
    /// Declared public ingress owner. `direct-rust` is restricted by topology
    /// validation to an explicit native Rust site on its host's public 80/443.
    pub public_proxy: Option<String>,
    pub staged: Option<bool>,
    pub required: Option<bool>,
    pub note: Option<String>,
    /// Primary listener, normally loopback/private. Only explicit `direct-rust`
    /// ingress can use a declared host's public 80/443. Optional for compatibility;
    /// when absent, [`CatalogService::effective_port`] derives it from `health`.
    pub port: Option<u16>,
    /// Capability ids this service provides (for AI services, the capability
    /// and gateway ids of `tools/aphrody/config/local-ai.json`).
    pub capabilities: Option<Vec<String>>,
    /// `retired` when the unit was decommissioned from its target host; the
    /// entry stays cataloged (ports, health path, routes) for an eventual
    /// redeploy. Any other value is a validation error.
    pub status: Option<String>,
    /// Required, and only meaningful, when `status` is `retired`.
    pub retired_at: Option<String>,
    /// Host alias running the service (`vps`, `dbfr`); absent means any target.
    pub host: Option<String>,
    /// Docker container running the service: lifecycle commands use `docker`, not systemd.
    pub container: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UnitSource {
    Repository,
    SystemPackage,
}

/// Port of a `scheme://host:port/...` or `host:port` address.
#[must_use]
pub fn address_port(address: &str) -> Option<u16> {
    let rest = address.split_once("://").map_or(address, |(_, rest)| rest);
    let authority = rest.split('/').next()?;
    authority.rsplit_once(':')?.1.parse().ok()
}

impl CatalogService {
    #[must_use]
    pub fn requires_unit_template(&self) -> bool {
        self.unit.is_some() && self.unit_source != Some(UnitSource::SystemPackage)
    }

    /// Declared `port`, else the port of the `health` probe.
    #[must_use]
    pub fn effective_port(&self) -> Option<u16> {
        self.port.or_else(|| self.health.as_deref().and_then(address_port))
    }

    #[must_use]
    pub fn provides(&self, capability: &str) -> bool {
        self.capabilities.as_deref().is_some_and(|list| list.iter().any(|c| c == capability))
    }

    #[must_use]
    pub fn is_staged(&self) -> bool {
        self.staged.unwrap_or(false)
    }

    #[must_use]
    pub fn is_retired(&self) -> bool {
        self.status.as_deref() == Some("retired")
    }

    #[must_use]
    pub fn is_required(&self) -> bool {
        !self.is_retired() && self.required.unwrap_or(!self.is_staged())
    }

    #[must_use]
    pub fn runs_on(&self, target_id: &str) -> bool {
        self.host.as_deref().is_none_or(|host| host == target_id)
    }

    #[must_use]
    pub fn is_supervised(&self) -> bool {
        self.unit.is_some() || self.container.is_some()
    }

    #[must_use]
    pub fn is_oneshot(&self) -> bool {
        self.unit.as_deref().is_some_and(|unit| unit.ends_with(".timer"))
    }

    /// The unit lifecycle commands act on (a timer acts on its service); `None` for a unit-less service.
    #[must_use]
    pub fn systemd_unit_name(&self) -> Option<String> {
        let unit = self.unit.as_deref()?;
        Some(if self.is_oneshot() { unit.replace(".timer", ".service") } else { unit.to_owned() })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPolicies {
    pub one_unit_per_workload: Option<bool>,
    pub one_public_proxy: Option<bool>,
    pub shared_release_pointer: Option<String>,
    pub retired_units: Option<Vec<String>>,
    pub shared_runtimes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetMatrix {
    pub schema_version: u32,
    pub generated_at: String,
    pub targets: Vec<TargetInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    pub id: String,
    pub kind: String,
    pub role: String,
    pub os: String,
    pub host: Option<String>,
    pub consumers: Vec<String>,
    pub ssh_alias: Option<String>,
    pub systemd: Option<bool>,
}

pub fn load_service_catalog(root: &Path) -> Result<ServiceCatalog> {
    let path = root.join("infra/config/service-catalog.json");
    let content =
        fs::read_to_string(&path).with_context(|| format!("lecture de {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("désérialisation de {}", path.display()))
}

/// The cross-host matrix lives in `$APHRODY_ROOT/infra/config/host/inventory/targets.json`.
pub fn load_target_matrix() -> Result<TargetMatrix> {
    let path = crate::validate::host_config_root().join("inventory/targets.json");
    let content =
        fs::read_to_string(&path).with_context(|| format!("lecture de {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("désérialisation de {}", path.display()))
}

pub fn load_raw_json(root: &Path, relative: &str) -> Result<Value> {
    let path = root.join(relative);
    let content =
        fs::read_to_string(&path).with_context(|| format!("lecture de {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("désérialisation de {}", path.display()))
}
