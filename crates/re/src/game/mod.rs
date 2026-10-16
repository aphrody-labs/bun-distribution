// SPDX-License-Identifier: Apache-2.0
//! Game-asset RE helpers absorbed from `shenron-re` (Apache-2.0, aphrody-labs/shenron):
//! CRIWARE CPK archives with CRILAYLA decompression, AOB signature scanning and
//! live process-memory inspection. Format parsers specific to one game stay in
//! `shenron-re`, which can depend on this module instead of duplicating it.
pub mod error;
pub mod fs;
pub mod live;

pub use error::{ReError, Result};
