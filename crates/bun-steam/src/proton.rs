// SPDX-License-Identifier: Apache-2.0
//! Proton management: compatibility tool discovery, release selection for Valve Proton, GE-Proton
//! and proton-cachyos, and the Proton launch environment (ntsync, DXVK / vkd3d-proton / Mesa
//! shader caches, llvmpipe threads, gamemode, official anti-cheat runtimes).
//!
//! Anti-cheat support goes only through the official Proton runtimes: Steam apps
//! [`EAC_RUNTIME_APP_ID`] and [`BATTLEYE_RUNTIME_APP_ID`], or the Lutris runtime index that
//! umu/Heroic use outside Steam. Nothing here patches or disables an anti-cheat.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::vdf::parse_vdf;

/// Steam app id of the Proton EasyAntiCheat runtime.
pub const EAC_RUNTIME_APP_ID: u32 = 1_826_330;
/// Steam app id of the Proton BattlEye runtime.
pub const BATTLEYE_RUNTIME_APP_ID: u32 = 1_161_040;
/// Steam app id of the Steam Linux Runtime 3.0 (sniper) container used by Proton 8+.
pub const STEAM_LINUX_RUNTIME_SNIPER_APP_ID: u32 = 1_628_350;
/// Lutris runtime index that lists `eac_runtime` and `battleye_runtime` for umu/Heroic.
pub const LUTRIS_RUNTIME_INDEX: &str = "https://lutris.net/api/runtimes";

/// Valve Proton builds distributed as Steam tools (install with `steamcmd +app_update <id>`).
pub const VALVE_PROTON_APPS: &[(&str, u32)] = &[
    ("Proton Experimental", 1_493_710),
    ("Proton Hotfix", 2_180_100),
    ("Proton 10.0", 3_658_110),
    ("Proton 9.0", 2_805_730),
    ("Proton 8.0", 2_348_590),
];

/// GitHub repository of GE-Proton releases (`GE-ProtonX-Y.tar.gz`).
pub const GE_PROTON_REPO: &str = "GloriousEggroll/proton-ge-custom";
/// GitHub repository of proton-cachyos releases (`proton-cachyos-*-x86_64[_v3].tar.xz`).
pub const PROTON_CACHYOS_REPO: &str = "CachyOS/proton-cachyos";

/// Family of a compatibility tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompatToolKind {
    /// Valve Proton (Steam tool app).
    Valve,
    /// GloriousEggroll GE-Proton.
    GeProton,
    /// CachyOS proton-cachyos.
    ProtonCachyos,
    /// Steam Linux Runtime container.
    SteamLinuxRuntime,
    /// Anything else (Luxtorpeda, Boxtron, custom builds).
    Other,
}

/// Classifies a tool directory or internal name.
#[must_use]
pub fn classify(name: &str) -> CompatToolKind {
    let lower = name.to_ascii_lowercase();
    if lower.contains("cachyos") {
        CompatToolKind::ProtonCachyos
    } else if lower.starts_with("ge-proton") || lower.contains("proton-ge") {
        CompatToolKind::GeProton
    } else if lower.starts_with("steamlinuxruntime") || lower.starts_with("steam linux runtime") {
        CompatToolKind::SteamLinuxRuntime
    } else if lower.starts_with("proton") {
        CompatToolKind::Valve
    } else {
        CompatToolKind::Other
    }
}

/// Where a compatibility tool was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompatToolSource {
    /// `<steam>/compatibilitytools.d` or a `STEAM_EXTRA_COMPAT_TOOLS_PATHS` entry.
    CompatibilityToolsD,
    /// `<library>/steamapps/common` (Valve tools installed by Steam).
    SteamApps,
}

/// An installed compatibility tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompatTool {
    /// Internal name used in `CompatToolMapping` (directory name for Valve tools).
    pub name: String,
    /// Display name from `compatibilitytool.vdf`, when present.
    pub display_name: Option<String>,
    /// Tool directory.
    pub path: PathBuf,
    /// Tool family.
    pub kind: CompatToolKind,
    /// Discovery location.
    pub source: CompatToolSource,
    /// `version` file contents (first line), when present.
    pub version: Option<String>,
}

fn read_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("version")).ok()?;
    text.lines()
        .next()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
}

/// Reads `compatibilitytool.vdf` of a custom tool: `(internal name, display name)`.
fn read_compat_manifest(dir: &Path) -> Option<(String, Option<String>)> {
    let text = std::fs::read_to_string(dir.join("compatibilitytool.vdf")).ok()?;
    let doc = parse_vdf(&text).ok()?;
    let tools = doc
        .get_path(&["compatibilitytools", "compat_tools"])?
        .entries()?;
    let (name, body) = tools.first()?;
    Some((
        name.clone(),
        body.get_str("display_name").map(str::to_owned),
    ))
}

/// Custom tool directories: `<steam_root>/compatibilitytools.d` plus every
/// `STEAM_EXTRA_COMPAT_TOOLS_PATHS` entry.
#[must_use]
pub fn compat_tool_dirs(steam_root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![steam_root.join("compatibilitytools.d")];
    if let Some(extra) = std::env::var_os("STEAM_EXTRA_COMPAT_TOOLS_PATHS") {
        dirs.extend(std::env::split_paths(&extra).filter(|p| !p.as_os_str().is_empty()));
    }
    dirs.dedup();
    dirs
}

/// Discovers compatibility tools in custom tool directories and in the `steamapps/common` of
/// every library (`libraries` are library roots, as in `libraryfolders.vdf`).
#[must_use]
pub fn discover_compat_tools(tool_dirs: &[PathBuf], libraries: &[PathBuf]) -> Vec<CompatTool> {
    let mut tools = Vec::new();
    for dir in tool_dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let (name, display_name) =
                read_compat_manifest(&path).unwrap_or_else(|| (dir_name.clone(), None));
            tools.push(CompatTool {
                kind: classify(&dir_name),
                version: read_version(&path),
                name,
                display_name,
                path,
                source: CompatToolSource::CompatibilityToolsD,
            });
        }
    }
    for library in libraries {
        let common = library.join("steamapps").join("common");
        let Ok(entries) = std::fs::read_dir(&common) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir_name = entry.file_name().to_string_lossy().into_owned();
            let kind = classify(&dir_name);
            if !matches!(
                kind,
                CompatToolKind::Valve | CompatToolKind::SteamLinuxRuntime
            ) {
                continue;
            }
            let path = entry.path();
            if !path.join("proton").is_file() && !path.join("toolmanifest.vdf").is_file() {
                continue;
            }
            tools.push(CompatTool {
                version: read_version(&path),
                name: valve_internal_name(&dir_name),
                display_name: Some(dir_name),
                path,
                kind,
                source: CompatToolSource::SteamApps,
            });
        }
    }
    tools.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    tools.dedup_by(|a, b| a.path == b.path);
    tools
}

/// Internal `CompatToolMapping` name of a Valve tool directory (`Proton 9.0` -> `proton_9`,
/// `Proton - Experimental` -> `proton_experimental`, `Proton Hotfix` -> `proton_hotfix`).
#[must_use]
pub fn valve_internal_name(dir_name: &str) -> String {
    let lower = dir_name.to_ascii_lowercase();
    if lower.contains("experimental") {
        return "proton_experimental".into();
    }
    if lower.contains("hotfix") {
        return "proton_hotfix".into();
    }
    let digits: String = lower
        .trim_start_matches("proton")
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        lower.replace([' ', '-', '.'], "_")
    } else {
        format!("proton_{digits}")
    }
}

/// Whether the CPU implements x86-64-v3 (AVX2, BMI1/2, FMA, F16C, LZCNT, MOVBE), the baseline of
/// the `x86_64_v3` proton-cachyos build.
#[must_use]
pub fn cpu_supports_x86_64_v3() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2")
            && std::arch::is_x86_feature_detected!("bmi1")
            && std::arch::is_x86_feature_detected!("bmi2")
            && std::arch::is_x86_feature_detected!("fma")
            && std::arch::is_x86_feature_detected!("f16c")
            && std::arch::is_x86_feature_detected!("lzcnt")
            && std::arch::is_x86_feature_detected!("movbe")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Picks the release asset to install for a tool family among a GitHub release's asset names:
/// GE-Proton `.tar.gz`; proton-cachyos `x86_64_v3` when `x86_64_v3` holds, else the generic
/// `x86_64` build. Checksum and signature files are ignored.
#[must_use]
pub fn select_release_asset<'a>(
    kind: CompatToolKind,
    assets: &[&'a str],
    x86_64_v3: bool,
) -> Option<&'a str> {
    let archives = assets.iter().copied().filter(|name| {
        let lower = name.to_ascii_lowercase();
        (lower.ends_with(".tar.gz") || lower.ends_with(".tar.xz") || lower.ends_with(".tar.zst"))
            && !lower.contains("sha")
    });
    match kind {
        CompatToolKind::GeProton => archives.into_iter().find(|n| n.starts_with("GE-Proton")),
        CompatToolKind::ProtonCachyos => {
            let list: Vec<&str> = archives.collect();
            let v3 = list.iter().copied().find(|n| n.contains("x86_64_v3"));
            let generic = list
                .iter()
                .copied()
                .find(|n| n.contains("x86_64") && !n.contains("_v"));
            if x86_64_v3 { v3.or(generic) } else { generic }
        }
        _ => None,
    }
}

/// Host capabilities that shape the launch environment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostProbe {
    /// `/dev/ntsync` exists (Linux 6.14+ NT synchronization driver).
    pub ntsync: bool,
    /// `gamemoderun` on `PATH`.
    pub gamemoderun: Option<PathBuf>,
    /// Logical CPU count.
    pub cpus: usize,
    /// No GPU render node: Mesa falls back to llvmpipe / lavapipe.
    pub software_rendering: bool,
}

fn find_on_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|p| p.is_file())
}

/// Probes the current host.
#[must_use]
pub fn probe_host() -> HostProbe {
    let render_node = std::fs::read_dir("/dev/dri")
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with("renderD"))
        })
        .unwrap_or(false);
    HostProbe {
        ntsync: Path::new("/dev/ntsync").exists(),
        gamemoderun: if cfg!(unix) {
            find_on_path("gamemoderun")
        } else {
            None
        },
        cpus: std::thread::available_parallelism().map_or(1, usize::from),
        software_rendering: cfg!(unix) && !render_node,
    }
}

/// Launch tuning requested by the caller.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchTuning {
    /// Root for DXVK / vkd3d-proton / Mesa caches (`<root>/dxvk`, `<root>/vkd3d`, `<root>/mesa`).
    pub cache_root: Option<PathBuf>,
    /// Force `PROTON_USE_NTSYNC` on (`Some(true)`) or off; `None` follows the host probe.
    pub ntsync: Option<bool>,
    /// llvmpipe worker threads; `None` uses every CPU on software-rendering hosts.
    pub llvmpipe_threads: Option<usize>,
    /// Wrap with `gamemoderun` when available.
    pub gamemode: bool,
    /// Extracted EasyAntiCheat runtime (app 1826330 or the Lutris `eac_runtime`).
    pub eac_runtime: Option<PathBuf>,
    /// Extracted BattlEye runtime (app 1161040 or the Lutris `battleye_runtime`).
    pub battleye_runtime: Option<PathBuf>,
}

/// Environment and wrapper for a Proton launch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchPlan {
    /// Variables, sorted by name.
    pub env: Vec<(String, String)>,
    /// Command prefix (e.g. `gamemoderun`).
    pub wrapper: Vec<String>,
}

impl LaunchPlan {
    /// Steam per-game launch options: `VAR=value ... [wrapper] %command%`.
    #[must_use]
    pub fn steam_launch_options(&self) -> String {
        let mut parts: Vec<String> = self
            .env
            .iter()
            .map(|(k, v)| {
                if v.chars().any(|c| c.is_whitespace() || c == '"') {
                    format!("{k}=\"{}\"", v.replace('"', "\\\""))
                } else {
                    format!("{k}={v}")
                }
            })
            .collect();
        parts.extend(self.wrapper.iter().cloned());
        parts.push("%command%".into());
        parts.join(" ")
    }
}

/// Builds the Proton launch environment from the requested tuning and the host probe.
#[must_use]
pub fn launch_plan(tuning: &LaunchTuning, host: &HostProbe) -> LaunchPlan {
    let mut env = std::collections::BTreeMap::new();
    if tuning.ntsync.unwrap_or(host.ntsync) {
        env.insert("PROTON_USE_NTSYNC".to_owned(), "1".to_owned());
    }
    if let Some(root) = &tuning.cache_root {
        let path = |sub: &str| root.join(sub).to_string_lossy().into_owned();
        env.insert("DXVK_STATE_CACHE_PATH".to_owned(), path("dxvk"));
        env.insert("VKD3D_SHADER_CACHE_PATH".to_owned(), path("vkd3d"));
        env.insert("MESA_SHADER_CACHE_DIR".to_owned(), path("mesa"));
    }
    if host.software_rendering || tuning.llvmpipe_threads.is_some() {
        let threads = tuning.llvmpipe_threads.unwrap_or(host.cpus).max(1);
        env.insert("LP_NUM_THREADS".to_owned(), threads.to_string());
    }
    if let Some(eac) = &tuning.eac_runtime {
        env.insert(
            "PROTON_EAC_RUNTIME".to_owned(),
            eac.to_string_lossy().into_owned(),
        );
    }
    if let Some(be) = &tuning.battleye_runtime {
        env.insert(
            "PROTON_BATTLEYE_RUNTIME".to_owned(),
            be.to_string_lossy().into_owned(),
        );
    }
    let wrapper = match (&host.gamemoderun, tuning.gamemode) {
        (Some(_), true) => vec!["gamemoderun".to_owned()],
        _ => Vec::new(),
    };
    LaunchPlan {
        env: env.into_iter().collect(),
        wrapper,
    }
}

/// The `STEAM_COMPAT_*` / `SteamAppId` variables Proton's launcher reads outside the Steam client
/// (`proton run`, umu, direct `wine` launches).
#[must_use]
pub fn steam_compat_env(
    app_id: u32,
    compat_data: &Path,
    client_install: &Path,
    install_path: &Path,
) -> Vec<(String, String)> {
    let app = app_id.to_string();
    let path = |p: &Path| p.to_string_lossy().into_owned();
    vec![
        ("STEAM_COMPAT_APP_ID".to_owned(), app.clone()),
        (
            "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_owned(),
            path(client_install),
        ),
        ("STEAM_COMPAT_DATA_PATH".to_owned(), path(compat_data)),
        ("STEAM_COMPAT_INSTALL_PATH".to_owned(), path(install_path)),
        ("STEAM_COMPAT_LIBRARY_PATHS".to_owned(), path(install_path)),
        ("SteamAppId".to_owned(), app.clone()),
        ("SteamGameId".to_owned(), app),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_tool_families() {
        assert_eq!(classify("GE-Proton11-9"), CompatToolKind::GeProton);
        assert_eq!(
            classify("proton-cachyos-10.0-20260901-slr-x86_64_v3"),
            CompatToolKind::ProtonCachyos
        );
        assert_eq!(classify("Proton 9.0"), CompatToolKind::Valve);
        assert_eq!(
            classify("SteamLinuxRuntime_sniper"),
            CompatToolKind::SteamLinuxRuntime
        );
        assert_eq!(valve_internal_name("Proton 9.0"), "proton_9");
        assert_eq!(
            valve_internal_name("Proton - Experimental"),
            "proton_experimental"
        );
    }

    #[test]
    fn selects_cachyos_v3_asset() {
        let assets = [
            "proton-cachyos-10.0-20260901-slr-x86_64.tar.xz",
            "proton-cachyos-10.0-20260901-slr-x86_64_v3.tar.xz",
            "proton-cachyos-10.0-20260901-slr-x86_64_v3.tar.xz.sha512sum",
        ];
        assert_eq!(
            select_release_asset(CompatToolKind::ProtonCachyos, &assets, true),
            Some("proton-cachyos-10.0-20260901-slr-x86_64_v3.tar.xz")
        );
        assert_eq!(
            select_release_asset(CompatToolKind::ProtonCachyos, &assets, false),
            Some("proton-cachyos-10.0-20260901-slr-x86_64.tar.xz")
        );
        let ge = ["GE-Proton11-9.sha512sum", "GE-Proton11-9.tar.gz"];
        assert_eq!(
            select_release_asset(CompatToolKind::GeProton, &ge, true),
            Some("GE-Proton11-9.tar.gz")
        );
    }

    #[test]
    fn builds_launch_options() {
        let host = HostProbe {
            ntsync: true,
            gamemoderun: Some(PathBuf::from("/usr/bin/gamemoderun")),
            cpus: 12,
            software_rendering: true,
        };
        let tuning = LaunchTuning {
            cache_root: Some(PathBuf::from("/games/cache")),
            gamemode: true,
            ..LaunchTuning::default()
        };
        let plan = launch_plan(&tuning, &host);
        let options = plan.steam_launch_options();
        assert!(options.contains("PROTON_USE_NTSYNC=1"));
        assert!(options.contains("LP_NUM_THREADS=12"));
        assert!(options.ends_with("gamemoderun %command%"));
    }
}
