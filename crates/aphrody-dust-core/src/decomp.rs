//! Nintendo DS decompilation analysis and project configuration.
//!
//! The ROM parser is shared with [`crate::rom`], so analysis tools operate on the
//! same validated cartridge model used by Dust and the ROM CLI.

pub mod analysis;
pub mod config;
pub mod rom;
pub(crate) mod util;
