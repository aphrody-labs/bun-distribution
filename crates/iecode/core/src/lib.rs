//! The single Rust ownership boundary for IECODE capabilities.
//!
//! The implementation crates remain independently testable while this facade is
//! the API consumed by the CLI, FFI and future hosts. New public capabilities
//! belong here first; callers must not grow direct dependencies on leaf crates.

pub mod emu {
    pub use iecode_emu::*;
}

pub mod geom {
    pub use iecode_geom::*;
}

pub mod re {
    pub use iecode_re::*;
}

pub mod pipeline {
    pub use iecode_pipeline::*;
}

pub mod sql {
    pub use iecode_sql::*;
}

pub mod tasks {
    pub use iecode_tasks::*;
}

pub mod video {
    pub use iecode_video::*;
}

pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
