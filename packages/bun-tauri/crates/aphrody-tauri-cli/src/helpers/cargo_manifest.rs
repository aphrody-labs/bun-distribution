// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use serde::Deserialize;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use crate::{error::Context, interface::rust::get_workspace_dir};

#[derive(Clone, Deserialize)]
pub struct CargoLockPackage {
    pub name: String,
    pub version: String,
    pub source: Option<String>,
}

#[derive(Deserialize)]
pub struct CargoLock {
    pub package: Vec<CargoLockPackage>,
}

#[derive(Clone, Deserialize)]
pub struct CargoManifestDependencyPackage {
    pub package: Option<String>,
    pub version: Option<String>,
    pub git: Option<String>,
    pub branch: Option<String>,
    pub rev: Option<String>,
    pub path: Option<PathBuf>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum CargoManifestDependency {
    Version(String),
    Package(CargoManifestDependencyPackage),
}

#[derive(Deserialize)]
pub struct CargoManifestPackage {
    pub version: String,
}

#[derive(Deserialize)]
pub struct CargoManifest {
    pub package: CargoManifestPackage,
    pub dependencies: HashMap<String, CargoManifestDependency>,
}

pub fn cargo_manifest_and_lock(tauri_dir: &Path) -> (Option<CargoManifest>, Option<CargoLock>) {
    let manifest: Option<CargoManifest> = fs::read_to_string(tauri_dir.join("Cargo.toml"))
        .ok()
        .and_then(|manifest_contents| toml::from_str(&manifest_contents).ok());

    let lock: Option<CargoLock> = get_workspace_dir(tauri_dir)
        .ok()
        .and_then(|p| fs::read_to_string(p.join("Cargo.lock")).ok())
        .and_then(|s| toml::from_str(&s).ok());

    (manifest, lock)
}
#[derive(Default)]
pub struct CrateVersion {
    pub version: Option<String>,
    pub git: Option<String>,
    pub git_branch: Option<String>,
    pub git_rev: Option<String>,
    pub path: Option<PathBuf>,
    pub lock_version: Option<String>,
}

impl CrateVersion {
    pub fn has_version(&self) -> bool {
        self.version.is_some() || self.git.is_some() || self.path.is_some()
    }
}

impl std::fmt::Display for CrateVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(g) = &self.git {
            if let Some(version) = &self.version {
                write!(f, "{g} ({version})")?;
            } else {
                write!(f, "git:{g}")?;
                if let Some(branch) = &self.git_branch {
                    write!(f, "&branch={branch}")?;
                } else if let Some(rev) = &self.git_rev {
                    write!(f, "#rev={rev}")?;
                }
            }
        } else if let Some(p) = &self.path {
            write!(f, "path:{}", p.display())?;
            if let Some(version) = &self.version {
                write!(f, " ({version})")?;
            }
        } else if let Some(version) = &self.version {
            write!(f, "{version}")?;
        } else {
            return write!(f, "No version detected");
        }

        if let Some(lock_version) = &self.lock_version {
            write!(f, " ({lock_version})")?;
        }

        Ok(())
    }
}

// Reference: https://github.com/rust-lang/crates.io/blob/98c83c8231cbcd15d6b8f06d80a00ad462f71585/src/views.rs#L274
#[derive(serde::Deserialize)]
struct CrateMetadata {
    /// The "default" version of this crate.
    ///
    /// This version will be displayed by default on the crate's page.
    pub default_version: Option<String>,
}

// Reference: https://github.com/rust-lang/crates.io/blob/98c83c8231cbcd15d6b8f06d80a00ad462f71585/src/controllers/krate/metadata.rs#L44
#[derive(serde::Deserialize)]
struct CrateIoGetResponse {
    /// The crate metadata.
    #[serde(rename = "crate")]
    krate: CrateMetadata,
}

/// Fetches the default version of the given crate from crates.io.
///
/// Returns `Ok(None)` if crates.io does not report a default version for the crate.
pub fn crate_latest_version(name: &str) -> crate::Result<Option<semver::Version>> {
    // Reference: https://github.com/rust-lang/crates.io/blob/98c83c8231cbcd15d6b8f06d80a00ad462f71585/src/controllers/krate/metadata.rs#L88
    let url = format!("https://crates.io/api/v1/crates/{name}?include");
    let mut response = super::http::get(&url)
        .with_context(|| format!("failed to fetch crate metadata from {url}"))?;
    let metadata: CrateIoGetResponse = serde_json::from_reader(response.body_mut().as_reader())
        .with_context(|| format!("failed to parse crate metadata from {url}"))?;
    metadata
        .krate
        .default_version
        .map(|version| {
            semver::Version::parse(&version)
                .with_context(|| format!("failed to parse version `{version}` of crate `{name}`"))
        })
        .transpose()
}

pub fn crate_version(
    tauri_dir: &Path,
    manifest: Option<&CargoManifest>,
    lock: Option<&CargoLock>,
    name: &str,
) -> CrateVersion {
    let mut version = CrateVersion::default();

    // Aphrody forks publish the crates as `aphrody-<name>` while apps keep the upstream
    // dependency key, so the lock file may list either package name.
    let prefixed_name = format!("aphrody-{name}");
    let crate_lock_packages: Vec<CargoLockPackage> = lock
        .as_ref()
        .map(|lock| {
            lock.package
                .iter()
                .filter(|p| p.name == name || p.name == prefixed_name)
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    if crate_lock_packages.len() == 1 {
        let crate_lock_package = crate_lock_packages.first().unwrap();
        if let Some(s) = crate_lock_package
            .source
            .as_ref()
            .filter(|s| s.starts_with("git"))
        {
            version.git = Some(s.clone());
        }

        version.version = Some(crate_lock_package.version.clone());
    } else {
        if let Some(dep) = manifest.and_then(|m| m.dependencies.get(name).cloned()) {
            match dep {
                CargoManifestDependency::Version(v) => version.version = Some(v),
                CargoManifestDependency::Package(p) => {
                    if let Some(v) = p.version {
                        version.version = Some(v);
                    } else if let Some(p) = p.path {
                        let manifest_path = tauri_dir.join(&p).join("Cargo.toml");
                        let v = fs::read_to_string(manifest_path)
                            .ok()
                            .and_then(|m| toml::from_str::<CargoManifest>(&m).ok())
                            .map(|m| m.package.version);
                        version.version = v;
                        version.path = Some(p);
                    } else if let Some(g) = p.git {
                        version.git = Some(g);
                        version.git_branch = p.branch;
                        version.git_rev = p.rev;
                    }
                }
            }
        }

        // multiple versions of the crate are locked, list them all
        if !crate_lock_packages.is_empty() {
            let lock_version = crate_lock_packages
                .iter()
                .map(|p| p.version.clone())
                .collect::<Vec<String>>()
                .join(", ");

            if !lock_version.is_empty() {
                version.lock_version = Some(lock_version);
            }
        }
    }

    version
}

pub(crate) const UPSTREAM_API_GENERATION: u64 = 3;

pub(crate) fn tauri_api_generation(
    manifest: &CargoManifest,
    lock: Option<&CargoLock>,
    version: &semver::Version,
) -> u64 {
    let renamed = match manifest.dependencies.get("tauri") {
        Some(CargoManifestDependency::Package(package)) => {
            package.package.as_deref() == Some("aphrody-tauri")
        }
        Some(_) => false,
        None => manifest.dependencies.contains_key("aphrody-tauri"),
    };
    let locked_fork = lock.is_some_and(|lock| {
        lock.package.iter().any(|package| {
            package.name == "aphrody-tauri" && package.version == version.to_string()
        }) && !lock
            .package
            .iter()
            .any(|package| package.name == "tauri" && package.version == version.to_string())
    });
    if renamed || locked_fork {
        UPSTREAM_API_GENERATION
    } else {
        version.major
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lock_package(version: &str) -> CargoLockPackage {
        CargoLockPackage {
            name: "tauri".into(),
            version: version.into(),
            source: None,
        }
    }

    #[test]
    fn fork_release_does_not_select_legacy_api_migrations() {
        let fork: CargoManifest = toml::from_str(
            r#"[package]
version = "1.0.0"
[dependencies]
tauri = { package = "aphrody-tauri", version = "1.4.4" }
"#,
        )
        .unwrap();
        let upstream: CargoManifest = toml::from_str(
            r#"[package]
version = "1.0.0"
[dependencies]
tauri = "1.4.4"
"#,
        )
        .unwrap();
        let metadata: serde_json::Value =
            serde_json::from_str(include_str!("../../metadata-v2.json")).unwrap();
        assert_eq!(metadata["upstream-api-generation"], UPSTREAM_API_GENERATION);
        assert_eq!(metadata["tauri"], "1.4.4");
        let version = semver::Version::parse("1.4.4").unwrap();
        assert_eq!(tauri_api_generation(&fork, None, &version), 3);
        assert_eq!(tauri_api_generation(&upstream, None, &version), 1);
        let mut mixed: CargoManifest = toml::from_str(
      "[package]\nversion = \"1.0.0\"\n[dependencies]\ntauri = \"1.4.4\"\naphrody-tauri = \"1.4.4\"\n",
    )
    .unwrap();
        assert_eq!(tauri_api_generation(&mixed, None, &version), 1);
        mixed.dependencies.remove("tauri");
        assert_eq!(tauri_api_generation(&mixed, None, &version), 3);
        let lock = CargoLock {
            package: vec![CargoLockPackage {
                name: "aphrody-tauri".into(),
                version: "1.4.4".into(),
                source: None,
            }],
        };
        assert_eq!(tauri_api_generation(&upstream, Some(&lock), &version), 3);
        let ambiguous = CargoLock {
            package: vec![lock.package[0].clone(), lock_package("1.4.4")],
        };
        assert_eq!(
            tauri_api_generation(&upstream, Some(&ambiguous), &version),
            1
        );
        assert_eq!(tauri_api_generation(&fork, Some(&ambiguous), &version), 3);
    }

    #[test]
    fn crate_version_lists_all_locked_versions() {
        let lock = CargoLock {
            package: vec![lock_package("2.0.0"), lock_package("2.1.0")],
        };
        let version = crate_version(Path::new("."), None, Some(&lock), "tauri");
        assert_eq!(version.lock_version.as_deref(), Some("2.0.0, 2.1.0"));

        let lock = CargoLock {
            package: vec![lock_package("2.1.0")],
        };
        let version = crate_version(Path::new("."), None, Some(&lock), "tauri");
        assert_eq!(version.version.as_deref(), Some("2.1.0"));
        assert!(version.lock_version.is_none());
    }
}
