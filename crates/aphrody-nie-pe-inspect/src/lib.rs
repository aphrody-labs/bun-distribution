// SPDX-License-Identifier: Apache-2.0
//! # aphrody-nie-pe-inspect — reverse engineering primitives
//!
//! Binary triage, string extraction, header probing and x86-64 disassembly come from
//! [`bun_re`] and are re-exported here under their historical paths; this crate adds the
//! bounded PE/COFF inspector of [`pe`].
//!
//! ```
//! use aphrody_nie_pe_inspect::{Format, disasm, triage};
//!
//! let report = triage(b"not a binary").expect("triage never panics on garbage");
//! assert_eq!(report.format, Format::Unknown);
//! // `mov rbp, rsp` encoded as x86-64.
//! assert_eq!(disasm(&[0x48, 0x89, 0xE5], 0x1000, 8)[0].mnemonic, "mov");
//! ```

#![forbid(unsafe_code)]

pub use bun_re::{
    DISASM_LIMIT, DisasmInsn, Format, ReError, STRINGS_MIN_LEN, STRINGS_SAMPLE_LIMIT, Section,
    TriageReport, disasm, extract_strings, headers, shannon_entropy, triage, triage_bounded,
};

pub mod pe;
