//! Canonical emulator backend contracts.
//!
//! The crate provides a read-only backend registry and a minimal, deterministic headless
//! lifecycle. It does not yet contain a bootable console core: DS, 3DS and Wii runners remain
//! independently licensed programs, while format decoding and Inazuma data ownership stay in
//! IECODE libraries.
//!
//! [`BackendRegistry`] is the common API for CLI, MCP, desktop and future bindings. Registry
//! queries only inspect static metadata; they do not probe the filesystem, start a process,
//! download a runner, or access a ROM. A host may use the selected [`Backend`] as input to its
//! own explicitly authorized runtime adapter.
//!
//! Native Rust backends are DS/Wii integration candidates. C/C++ runners are represented as
//! [`BackendKind::DynamicLibrary`] candidates, and [`BackendKind::Wasm`] is reserved for a browser
//! binding; none of these descriptors proves that a core has been linked or boot-tested.
//! [`AdapterStatus`] records the measured integration state. No subprocess backend exists.
//!
//! ```
//! use aphrody_nie_emu::{Capability, Platform, REGISTRY};
//!
//! let backend = REGISTRY.select(Platform::Wii, Capability::Debug);
//! assert_eq!(backend.map(|backend| backend.id), Some("gecko-wii"));
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

/// Linked Nintendo DS runtime owner.
pub mod dust;
/// Pure, host-independent lifecycle for future console cores.
pub mod headless;

/// Supported Inazuma Eleven platform families in this pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    /// Nintendo DS and DSi-compatible game images.
    Ds,
    /// Nintendo 3DS game containers and extracted RomFS.
    ThreeDs,
    /// Nintendo Wii disc images and extracted partitions.
    Wii,
    /// Nintendo Switch game and homebrew images.
    Switch,
    /// Steam distribution and PC compatibility, not a console emulator.
    Steam,
    /// Android package or Android-hosted 3DS runtime.
    Android,
}

/// How a backend is connected to the Rust pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendKind {
    /// Rust code linked into the host process.
    NativeRust,
    /// An external runner imported through a library or FFI boundary.
    DynamicLibrary,
    /// A backend compiled for an in-process WebAssembly host.
    Wasm,
    /// A format/runtime reference that is not an in-process emulator core.
    ReferenceOnly,
}

/// A backend's measured capability boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    /// Boots or executes a game image.
    Execute,
    /// Starts a selected runner through the host's launch adapter.
    Launch,
    /// Reads or writes a supported save format through the canonical save owner.
    Save,
    /// Observes a live runner or process memory through a guarded memory adapter.
    Memory,
    /// Runs a homebrew or fixture executable.
    Homebrew,
    /// Provides a debugger or memory observation surface.
    Debug,
    /// Reads a platform container without executing it.
    Inspect,
    /// Extracts a platform container into a read-only staging area.
    Extract,
    /// Applies a validated mod overlay or package.
    Mod,
}

/// The common in-process operations exposed by every platform adapter boundary.
pub const COMMON_CAPABILITIES: &[Capability] = &[
    Capability::Execute,
    Capability::Inspect,
    Capability::Save,
    Capability::Memory,
    Capability::Mod,
];

/// Whether a platform capability is implemented, retained as a reference, or not available.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterStatus {
    /// The IECODE owner or its declared external adapter can perform this operation.
    Available,
    /// The entry is useful as a measured compatibility/oracle boundary but is not an owner.
    ReferenceOnly,
    /// No adapter is currently registered for this platform and capability.
    Unavailable,
}

/// One platform/capability binding in the canonical adapter matrix.
///
/// An adapter record is a contract for a caller; it is not an executable handle. `owner` names
/// the IECODE library or external tool responsible for the boundary, and `backend_id` links to a
/// runner descriptor when one exists. Neither field causes a process launch or file access.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Adapter {
    /// Stable adapter identifier.
    pub id: &'static str,
    /// Platform covered by this adapter.
    pub platform: Platform,
    /// Operation covered by this adapter.
    pub capability: Capability,
    /// Optional runner descriptor used by this adapter.
    pub backend_id: Option<&'static str>,
    /// Canonical owner or external compatibility tool.
    pub owner: &'static str,
    /// Measured availability boundary.
    pub status: AdapterStatus,
}

impl Adapter {
    /// Reports whether this entry is an available adapter.
    #[must_use]
    pub const fn is_available(&self) -> bool {
        matches!(self.status, AdapterStatus::Available)
    }
}

/// Immutable description of one backend; no filesystem or process access occurs here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Backend {
    /// Stable backend identifier.
    pub id: &'static str,
    /// Platform served by this backend.
    pub platform: Platform,
    /// Integration mode.
    pub kind: BackendKind,
    /// Repository or canonical source URL.
    pub source: &'static str,
    /// Capabilities explicitly measured for this backend.
    pub capabilities: &'static [Capability],
    /// Optional library or FFI symbol hint; loading is performed by a host adapter.
    pub library_hint: Option<&'static str>,
}

impl Backend {
    /// Reports whether this backend declares `capability`.
    #[must_use]
    pub fn supports(&self, capability: Capability) -> bool {
        self.capabilities.contains(&capability)
    }

    /// Reports whether this descriptor describes an executable upstream runtime.
    ///
    /// This is metadata only. A `true` result does not imply IECODE integration or launch it.
    #[must_use]
    pub fn is_runtime(&self) -> bool {
        self.kind != BackendKind::ReferenceOnly && self.supports(Capability::Execute)
    }

    /// Reports whether this backend can be hosted in-process by the common API.
    #[must_use]
    pub const fn is_in_process(&self) -> bool {
        matches!(
            self.kind,
            BackendKind::NativeRust | BackendKind::DynamicLibrary | BackendKind::Wasm
        )
    }
}

const DUST_CAPABILITIES: &[Capability] =
    &[Capability::Execute, Capability::Homebrew, Capability::Inspect];
const GECKO_CAPABILITIES: &[Capability] =
    &[Capability::Execute, Capability::Homebrew, Capability::Debug, Capability::Memory];
const AZAHAR_CAPABILITIES: &[Capability] = &[Capability::Execute, Capability::Inspect];
const DOLPHIN_CAPABILITIES: &[Capability] = &[Capability::Execute, Capability::Inspect];
const NXEMU_CAPABILITIES: &[Capability] = &[Capability::Execute, Capability::Homebrew];
const PROTON_CAPABILITIES: &[Capability] = &[Capability::Launch];
const INSPECT_CAPABILITIES: &[Capability] = &[Capability::Inspect];
const WINDS_INAZUMA_CAPABILITIES: &[Capability] =
    &[Capability::Execute, Capability::Inspect, Capability::Memory, Capability::Debug];

static BACKENDS: &[Backend] = &[
    Backend {
        id: "dust",
        platform: Platform::Ds,
        kind: BackendKind::NativeRust,
        source: "crates/emu/core",
        capabilities: DUST_CAPABILITIES,
        library_hint: Some("dust"),
    },
    Backend {
        // The maintained DS reference is the official melonDS core pinned in docs/emulation/MELONDS-UPSTREAM.md.
        id: "melonds",
        platform: Platform::Ds,
        kind: BackendKind::ReferenceOnly,
        source: "https://github.com/melonDS-emu/melonDS/tree/906e9ebb27da8c6a715cd7abab4abfe8a8d29427",
        capabilities: WINDS_INAZUMA_CAPABILITIES,
        library_hint: Some("melonds"),
    },
    Backend {
        id: "azahar",
        platform: Platform::ThreeDs,
        kind: BackendKind::DynamicLibrary,
        source: "https://github.com/azahar-emu/azahar",
        capabilities: AZAHAR_CAPABILITIES,
        library_hint: Some("azahar"),
    },
    Backend {
        id: "gecko-wii",
        platform: Platform::Wii,
        kind: BackendKind::NativeRust,
        source: "emulators/gecko",
        capabilities: GECKO_CAPABILITIES,
        library_hint: Some("gecko-wii"),
    },
    Backend {
        id: "dolphin",
        platform: Platform::Wii,
        kind: BackendKind::DynamicLibrary,
        source: "https://github.com/dolphin-emu/dolphin",
        capabilities: DOLPHIN_CAPABILITIES,
        library_hint: Some("dolphin-emu"),
    },
    Backend {
        // Candidate only: no Switch core is linked into IECODE yet.
        id: "nxemu",
        platform: Platform::Switch,
        kind: BackendKind::ReferenceOnly,
        source: "https://github.com/N3xoX1/nxemu",
        capabilities: NXEMU_CAPABILITIES,
        library_hint: None,
    },
    Backend {
        // Proton is a PC compatibility tool, not a Steam emulator or an embedded IECODE core.
        id: "proton",
        platform: Platform::Steam,
        kind: BackendKind::ReferenceOnly,
        source: "https://github.com/ValveSoftware/Proton",
        capabilities: PROTON_CAPABILITIES,
        library_hint: None,
    },
    Backend {
        id: "android-inspection",
        platform: Platform::Android,
        kind: BackendKind::ReferenceOnly,
        source: "https://github.com/iBotPeaches/Apktool",
        capabilities: INSPECT_CAPABILITIES,
        library_hint: None,
    },
];

/// Read-only view over one canonical set of backend descriptors.
///
/// Constructing a registry does not perform discovery. This small value is `Copy`, so a caller
/// can pass it through a CLI, MCP or GUI adapter without introducing shared mutable state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendRegistry {
    backends: &'static [Backend],
    adapters: &'static [Adapter],
}

impl BackendRegistry {
    /// Creates a registry over a static descriptor set.
    #[must_use]
    pub const fn new(backends: &'static [Backend]) -> Self {
        Self { backends, adapters: &[] }
    }

    /// Adds a static capability/adapters matrix to this registry.
    #[must_use]
    pub const fn with_adapters(mut self, adapters: &'static [Adapter]) -> Self {
        self.adapters = adapters;
        self
    }

    /// Returns every descriptor in registry order.
    #[must_use]
    pub const fn all(&self) -> &'static [Backend] {
        self.backends
    }

    /// Returns every registered platform/capability adapter in stable order.
    #[must_use]
    pub const fn adapters(&self) -> &'static [Adapter] {
        self.adapters
    }

    /// Finds a descriptor by its stable identifier.
    #[must_use]
    pub fn find(&self, id: &str) -> Option<&'static Backend> {
        self.all().iter().find(|candidate| candidate.id == id)
    }

    /// Finds the first descriptor for a platform that declares a capability.
    #[must_use]
    pub fn select(&self, platform: Platform, capability: Capability) -> Option<&'static Backend> {
        self.all()
            .iter()
            .find(|candidate| candidate.platform == platform && candidate.supports(capability))
    }

    /// Finds the adapter for one platform/capability pair.
    #[must_use]
    pub fn adapter(&self, platform: Platform, capability: Capability) -> Option<&'static Adapter> {
        self.adapters()
            .iter()
            .find(|candidate| candidate.platform == platform && candidate.capability == capability)
    }

    /// Finds one of the five operations shared by the in-process host API.
    #[must_use]
    pub fn common_adapter(
        &self,
        platform: Platform,
        capability: Capability,
    ) -> Option<&'static Adapter> {
        COMMON_CAPABILITIES
            .contains(&capability)
            .then(|| self.adapter(platform, capability))
            .flatten()
    }
}

const fn adapter(
    id: &'static str,
    platform: Platform,
    capability: Capability,
    backend_id: Option<&'static str>,
    owner: &'static str,
    status: AdapterStatus,
) -> Adapter {
    Adapter { id, platform, capability, backend_id, owner, status }
}

static ADAPTERS: &[Adapter] = &[
    adapter(
        "ds_execute",
        Platform::Ds,
        Capability::Execute,
        Some("dust"),
        "aphrody-dust-core",
        AdapterStatus::Available,
    ),
    adapter(
        "ds_launch",
        Platform::Ds,
        Capability::Launch,
        Some("dust"),
        "iecode-launcher",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "ds_save",
        Platform::Ds,
        Capability::Save,
        None,
        "iecode-save",
        AdapterStatus::Available,
    ),
    adapter(
        "ds_memory",
        Platform::Ds,
        Capability::Memory,
        None,
        "iecode-trace",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "ds_inspect",
        Platform::Ds,
        Capability::Inspect,
        Some("dust"),
        "iecode-formats",
        AdapterStatus::Available,
    ),
    adapter(
        "ds_extract",
        Platform::Ds,
        Capability::Extract,
        None,
        "ninfs",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "ds_mod",
        Platform::Ds,
        Capability::Mod,
        None,
        "iecode-modding",
        AdapterStatus::Available,
    ),
    adapter(
        "ds_homebrew",
        Platform::Ds,
        Capability::Homebrew,
        Some("dust"),
        "aphrody-dust-core",
        AdapterStatus::Available,
    ),
    adapter(
        "3ds_execute",
        Platform::ThreeDs,
        Capability::Execute,
        Some("azahar"),
        "azahar",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "3ds_launch",
        Platform::ThreeDs,
        Capability::Launch,
        Some("azahar"),
        "iecode-launcher",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "3ds_save",
        Platform::ThreeDs,
        Capability::Save,
        None,
        "iecode-save",
        AdapterStatus::Available,
    ),
    adapter(
        "3ds_memory",
        Platform::ThreeDs,
        Capability::Memory,
        None,
        "iecode-trace",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "3ds_inspect",
        Platform::ThreeDs,
        Capability::Inspect,
        Some("azahar"),
        "iecode-formats",
        AdapterStatus::Available,
    ),
    adapter(
        "3ds_extract",
        Platform::ThreeDs,
        Capability::Extract,
        None,
        "ninfs",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "3ds_mod",
        Platform::ThreeDs,
        Capability::Mod,
        None,
        "iecode-modding",
        AdapterStatus::Available,
    ),
    adapter(
        "3ds_homebrew",
        Platform::ThreeDs,
        Capability::Homebrew,
        Some("azahar"),
        "azahar",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_execute",
        Platform::Wii,
        Capability::Execute,
        Some("dolphin"),
        "dolphin",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_launch",
        Platform::Wii,
        Capability::Launch,
        Some("dolphin"),
        "iecode-launcher",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_save",
        Platform::Wii,
        Capability::Save,
        None,
        "iecode-save",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_memory",
        Platform::Wii,
        Capability::Memory,
        Some("gecko-wii"),
        "gecko-wii",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_inspect",
        Platform::Wii,
        Capability::Inspect,
        Some("dolphin"),
        "iecode-formats",
        AdapterStatus::Available,
    ),
    adapter(
        "wii_extract",
        Platform::Wii,
        Capability::Extract,
        None,
        "wiimms-iso-tools",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "wii_mod",
        Platform::Wii,
        Capability::Mod,
        None,
        "iecode-modding",
        AdapterStatus::Available,
    ),
    adapter(
        "wii_homebrew",
        Platform::Wii,
        Capability::Homebrew,
        Some("gecko-wii"),
        "gecko-wii",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "switch_execute",
        Platform::Switch,
        Capability::Execute,
        Some("nxemu"),
        "nxemu",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "switch_inspect",
        Platform::Switch,
        Capability::Inspect,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter(
        "switch_save",
        Platform::Switch,
        Capability::Save,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter(
        "switch_memory",
        Platform::Switch,
        Capability::Memory,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter("switch_mod", Platform::Switch, Capability::Mod, None, "", AdapterStatus::Unavailable),
    adapter(
        "steam_execute",
        Platform::Steam,
        Capability::Execute,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter(
        "steam_inspect",
        Platform::Steam,
        Capability::Inspect,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter("steam_save", Platform::Steam, Capability::Save, None, "", AdapterStatus::Unavailable),
    adapter(
        "steam_memory",
        Platform::Steam,
        Capability::Memory,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter("steam_mod", Platform::Steam, Capability::Mod, None, "", AdapterStatus::Unavailable),
    adapter(
        "android_execute",
        Platform::Android,
        Capability::Execute,
        Some("azahar"),
        "azahar",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "android_launch",
        Platform::Android,
        Capability::Launch,
        Some("azahar"),
        "azahar",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "android_save",
        Platform::Android,
        Capability::Save,
        None,
        "iecode-save",
        AdapterStatus::ReferenceOnly,
    ),
    adapter(
        "android_memory",
        Platform::Android,
        Capability::Memory,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter(
        "android_inspect",
        Platform::Android,
        Capability::Inspect,
        Some("android-inspection"),
        "apktool",
        AdapterStatus::Available,
    ),
    adapter(
        "android_extract",
        Platform::Android,
        Capability::Extract,
        Some("android-inspection"),
        "apktool",
        AdapterStatus::Available,
    ),
    adapter(
        "android_mod",
        Platform::Android,
        Capability::Mod,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
    adapter(
        "android_homebrew",
        Platform::Android,
        Capability::Homebrew,
        None,
        "",
        AdapterStatus::Unavailable,
    ),
];

/// The canonical IECODE registry. It contains metadata only and performs no machine access.
pub const REGISTRY: BackendRegistry = BackendRegistry::new(BACKENDS).with_adapters(ADAPTERS);

/// Returns the one canonical backend descriptor set for all supported platforms.
///
/// This compatibility façade is equivalent to [`BackendRegistry::all`] on [`REGISTRY`].
#[must_use]
pub fn backends() -> &'static [Backend] {
    REGISTRY.all()
}

/// Finds a backend by stable identifier.
#[must_use]
pub fn backend(id: &str) -> Option<&'static Backend> {
    REGISTRY.find(id)
}

/// Finds the first backend for a platform that provides the requested capability.
#[must_use]
pub fn backend_for(platform: Platform, capability: Capability) -> Option<&'static Backend> {
    REGISTRY.select(platform, capability)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_platform_has_one_explicit_owner() {
        for platform in [
            Platform::Ds,
            Platform::ThreeDs,
            Platform::Wii,
            Platform::Switch,
            Platform::Steam,
            Platform::Android,
        ] {
            assert!(backends().iter().any(|backend| backend.platform == platform));
        }
    }

    #[test]
    fn wii_prefers_the_rust_debug_backend() {
        assert_eq!(REGISTRY.select(Platform::Wii, Capability::Debug).unwrap().id, "gecko-wii");
    }

    #[test]
    fn registry_has_unique_ids_and_no_unmeasured_runtime() {
        let entries = REGISTRY.all();
        for (index, entry) in entries.iter().enumerate() {
            assert!(!entry.id.is_empty());
            assert!(!entry.source.is_empty());
            assert!(
                entries[index + 1..].iter().all(|other| other.id != entry.id),
                "duplicate backend id: {}",
                entry.id
            );
            if entry.kind == BackendKind::ReferenceOnly {
                assert!(!entry.is_runtime());
            } else {
                assert!(entry.is_in_process());
            }
        }
    }

    #[test]
    fn registry_api_matches_compatibility_facades() {
        assert_eq!(REGISTRY.all(), backends());
        assert_eq!(REGISTRY.find("dust"), backend("dust"));
        assert_eq!(
            REGISTRY.select(Platform::Wii, Capability::Debug),
            backend_for(Platform::Wii, Capability::Debug)
        );
        assert!(REGISTRY.find("missing").is_none());
        assert!(REGISTRY.select(Platform::Android, Capability::Execute).is_none());
    }

    #[test]
    fn common_api_covers_all_platforms_without_a_subprocess_kind() {
        let platforms = [
            Platform::Ds,
            Platform::ThreeDs,
            Platform::Wii,
            Platform::Switch,
            Platform::Steam,
            Platform::Android,
        ];
        for platform in platforms {
            for capability in COMMON_CAPABILITIES {
                let adapter = REGISTRY.common_adapter(platform, *capability).unwrap();
                assert_eq!(adapter.platform, platform);
                assert_eq!(adapter.capability, *capability);
            }
        }
        assert!(REGISTRY.common_adapter(Platform::Ds, Capability::Launch).is_none());
        assert!(
            REGISTRY
                .all()
                .iter()
                .all(|backend| backend.kind != BackendKind::ReferenceOnly || !backend.is_runtime())
        );
    }

    #[test]
    fn capability_queries_are_pure_metadata_operations() {
        let dust = REGISTRY.find("dust").unwrap();
        assert!(dust.supports(Capability::Execute));
        assert!(dust.supports(Capability::Homebrew));
        assert!(!dust.supports(Capability::Debug));
        assert!(dust.is_runtime());
        assert!(REGISTRY.adapter(Platform::Ds, Capability::Execute).unwrap().is_available());
        assert!(REGISTRY.adapter(Platform::Ds, Capability::Homebrew).unwrap().is_available());
        assert!(REGISTRY.find("gecko-wii").unwrap().is_in_process());
        assert!(REGISTRY.find("android-inspection").unwrap().supports(Capability::Inspect));
    }

    #[test]
    fn dust_is_a_linked_iecode_crate() {
        let runtime = dust::runtime();
        assert_eq!(runtime.package, "aphrody-dust-core");
        assert!(runtime.builder_type.ends_with("::emu::Builder"));
        assert_eq!(runtime.default_model, "ds-lite");
        assert!(runtime.save_storage);
    }

    #[test]
    fn registry_is_serializable_without_machine_access() {
        let json = serde_json::to_string(backends()).unwrap();
        assert!(json.contains("dust"));
        assert!(json.contains("android-inspection"));
    }
}
