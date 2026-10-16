//! Compatibility facade for the canonical PE inspector in [`aphrody_re`].
//!
//! New consumers should depend on `aphrody-re` directly. This re-export keeps the private
//! `ievr_tools` library target source-compatible while its remaining CRI and manifest probes are audited
//! against `aphrody-nie-formats`.

pub use aphrody_re::{
    PeAnalysis, PeAnalysisImport, PeAnalysisSection, PeAnalysisSymbol, PeHeader, PeSection,
    analyze_pe_file, parse_pe_header_file,
};
