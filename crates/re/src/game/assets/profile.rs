// SPDX-License-Identifier: Apache-2.0
//! Per-game profiles: how an install is mounted (archive order, owner delegation, excluded
//! folders) and which decryption material is acceptable. Profiles carry no key material: a
//! key is either supplied by the user at run time or held by the owner a title is delegated to.

use serde::Serialize;

use super::engine::{Engine, EngineReport};

/// Where decryption material may come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum KeyPolicy {
    /// Nothing is decrypted; encrypted containers are listed and refused.
    None,
    /// The user may supply keys for this run (`--aes-key`, `--hca-key`, environment).
    UserProvided,
    /// The archive layer belongs to a title owner that holds its own license; the generic
    /// layer neither sees nor extends its key material.
    DelegatedOwner {
        /// Owner crate.
        owner: &'static str,
        /// License under which the owner operates.
        license: &'static str,
    },
}

/// How the install is mounted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MountMode {
    /// Discover containers, mount them in [`Profile::order`] order, then loose files.
    Generic,
    /// Inazuma Eleven: Victory Road through `aphrody-nie-formats::vfs` (`data/cpk_list.cfg.bin`
    /// and its packs), plus loose files outside `data/`.
    Level5Ievr,
}

/// A mount and key profile.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Stable identifier (`ievr`, `dbxv2`, `unreal`, ...).
    pub id: &'static str,
    /// Display name.
    pub name: &'static str,
    /// Steam app ids that select this profile automatically.
    pub steam_app_ids: &'static [u32],
    /// Engine family.
    pub engine: Engine,
    /// Mount strategy.
    pub mode: MountMode,
    /// Container name patterns in priority order (first mounted path wins). `*` matches any
    /// run of characters; matching is case-insensitive on the path relative to the root.
    pub order: &'static [&'static str],
    /// Loose-file prefixes not mounted (case-insensitive, relative to the root).
    pub loose_excludes: &'static [&'static str],
    /// Key policy.
    pub keys: KeyPolicy,
}

/// Built-in profiles. Title profiles first, engine profiles after.
pub const PROFILES: &[Profile] = &[
    Profile {
        id: "ievr",
        name: "INAZUMA ELEVEN: Victory Road (Level-5)",
        steam_app_ids: &[2_799_860],
        engine: Engine::Level5,
        mode: MountMode::Level5Ievr,
        order: &[],
        loose_excludes: &["data/"],
        keys: KeyPolicy::DelegatedOwner {
            owner: "aphrody-nie-formats",
            license: "docs/licenses/iecode/nie/LICENSE",
        },
    },
    Profile {
        id: "dbxv2",
        name: "DRAGON BALL XENOVERSE 2 (Dimps, CRI)",
        steam_app_ids: &[454_650],
        engine: Engine::Cri,
        mode: MountMode::Generic,
        // XV2Patcher loose `data/` overrides first, then the patch and DLC packs over the base.
        order: &[
            "data/*",
            "cpk/data2.cpk",
            "cpk/data2_*.cpk",
            "cpk/data_d*.cpk",
            "cpk/data1.cpk",
            "cpk/data0.cpk",
            "cpk/data.cpk",
            "cpk/data_*.cpk",
            "cpk/movie*.cpk",
        ],
        loose_excludes: &[],
        keys: KeyPolicy::None,
    },
    Profile {
        id: "unreal",
        name: "Unreal Engine (pak, IoStore)",
        steam_app_ids: &[],
        engine: Engine::Unreal,
        mode: MountMode::Generic,
        // Patch paks (`*_P.pak`) override base paks.
        order: &["*_p.utoc", "*_p.pak", "*.utoc", "*.pak"],
        loose_excludes: &[],
        keys: KeyPolicy::UserProvided,
    },
    Profile {
        id: "unity",
        name: "Unity (UnityFS bundles, serialized files)",
        steam_app_ids: &[],
        engine: Engine::Unity,
        mode: MountMode::Generic,
        order: &[],
        loose_excludes: &[],
        keys: KeyPolicy::None,
    },
    Profile {
        id: "cri",
        name: "CRI Middleware (plain CPK)",
        steam_app_ids: &[],
        engine: Engine::Cri,
        mode: MountMode::Generic,
        order: &[],
        loose_excludes: &[],
        keys: KeyPolicy::UserProvided,
    },
    Profile {
        id: "renpy",
        name: "Ren'Py",
        steam_app_ids: &[],
        engine: Engine::RenPy,
        mode: MountMode::Generic,
        order: &[],
        loose_excludes: &[],
        keys: KeyPolicy::None,
    },
    Profile {
        id: "godot",
        name: "Godot (GDPC)",
        steam_app_ids: &[],
        engine: Engine::Godot,
        mode: MountMode::Generic,
        order: &[],
        loose_excludes: &[],
        keys: KeyPolicy::None,
    },
    Profile {
        id: "generic",
        name: "Generic (loose files, ZIP)",
        steam_app_ids: &[],
        engine: Engine::Generic,
        mode: MountMode::Generic,
        order: &[],
        loose_excludes: &[],
        keys: KeyPolicy::UserProvided,
    },
];

/// Profile by id.
#[must_use]
pub fn by_id(id: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|profile| profile.id.eq_ignore_ascii_case(id))
}

/// Profile for a detection report: Steam app id first, then the primary engine. Level-5 games
/// other than IEVR fall back to the generic profile (no key material is shared across titles).
#[must_use]
pub fn select(report: &EngineReport) -> &'static Profile {
    if let Some(id) = report.steam_app_id
        && let Some(profile) = PROFILES.iter().find(|p| p.steam_app_ids.contains(&id))
    {
        return profile;
    }
    let fallback = by_id("generic").unwrap_or(&PROFILES[PROFILES.len() - 1]);
    match report.primary {
        Some(Engine::Unreal) => by_id("unreal").unwrap_or(fallback),
        Some(Engine::Unity) => by_id("unity").unwrap_or(fallback),
        Some(Engine::Cri) => by_id("cri").unwrap_or(fallback),
        Some(Engine::RenPy) => by_id("renpy").unwrap_or(fallback),
        Some(Engine::Godot) => by_id("godot").unwrap_or(fallback),
        _ => fallback,
    }
}

/// Case-insensitive glob with `*` wildcards.
#[must_use]
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let text = text.to_ascii_lowercase();
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let mut rest = text.as_str();
    for (index, part) in parts.iter().enumerate() {
        if index == 0 {
            let Some(after) = rest.strip_prefix(part) else { return false };
            rest = after;
        } else if index == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            let Some(at) = rest.find(part) else { return false };
            rest = &rest[at + part.len()..];
        }
    }
    true
}

impl Profile {
    /// Mount rank of a container path (lower mounts first, so it wins).
    #[must_use]
    pub fn rank(&self, path: &str) -> usize {
        self.order.iter().position(|pattern| glob_match(pattern, path)).unwrap_or(self.order.len())
    }

    /// True when a loose path is mounted.
    #[must_use]
    pub fn loose_allowed(&self, path: &str) -> bool {
        let lower = path.to_ascii_lowercase();
        !self.loose_excludes.iter().any(|prefix| lower.starts_with(prefix))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs_and_ranks() {
        assert!(glob_match("cpk/data_d*.cpk", "cpk/DATA_D12_dlc.cpk"));
        assert!(!glob_match("cpk/data.cpk", "cpk/data1.cpk"));
        assert!(glob_match("*_p.pak", "Content/Paks/Mod_P.pak"));
        let dbxv2 = by_id("dbxv2").unwrap();
        assert!(dbxv2.rank("cpk/data2.cpk") < dbxv2.rank("cpk/data.cpk"));
        assert!(dbxv2.rank("cpk/data_d12_dlc.cpk") < dbxv2.rank("cpk/data1.cpk"));
        assert!(!by_id("ievr").unwrap().loose_allowed("data/packs/x.cpk"));
    }
}
