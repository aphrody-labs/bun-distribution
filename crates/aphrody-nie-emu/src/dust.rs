//! Direct ownership boundary for the linked Dust Nintendo DS core.

use aphrody_dust_core::{Model, SaveContents, emu::Builder};

/// Compile-time and runtime evidence for the Dust core linked into IECODE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DustRuntime {
    /// Cargo package providing the emulation implementation.
    pub package: &'static str,
    /// Concrete builder type used to construct DS machines.
    pub builder_type: &'static str,
    /// Default hardware model selected by the linked core.
    pub default_model: &'static str,
    /// Whether the linked core exposes owned save storage.
    pub save_storage: bool,
}

/// Returns evidence derived from real Dust types, without loading private console inputs.
#[must_use]
pub fn runtime() -> DustRuntime {
    let model = Model::default();
    let save = SaveContents::New(512);
    DustRuntime {
        package: "aphrody-dust-core",
        builder_type: std::any::type_name::<Builder>(),
        default_model: match model {
            Model::Ds => "ds",
            Model::Lite => "ds-lite",
            Model::Ique => "ique",
            Model::IqueLite => "ique-lite",
            Model::Dsi => "dsi",
        },
        save_storage: save.len() == 512,
    }
}
