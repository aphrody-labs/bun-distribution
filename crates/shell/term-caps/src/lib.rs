// SPDX-License-Identifier: Apache-2.0
//! Terminal capabilities for Aphrody: detection and escape-sequence emission.
//!
//! - [`detect`]: identify the host terminal from the environment, then refine
//!   with DA1, XTVERSION and the kitty graphics query ([`probe`]).
//! - [`seq`]: OSC 8 hyperlinks, OSC 133/633 marks, OSC 7 and 9;9 cwd,
//!   OSC 9;4 progress, OSC 52, OSC 9/99/777 notifications, titles, DEC 2026.
//! - [`image`]: Kitty graphics, Sixel and iTerm2 inline image encoders.
//! - [`links`]: turn `path:line:col` mentions into OSC 8 links.
//!
//! The per-terminal profiles and the sources they were verified against are in
//! `docs/architecture/shell/terminal-capabilities.md`.
#![deny(unsafe_code)]
#![deny(missing_docs)]

pub mod detect;
pub mod image;
pub mod links;
#[cfg(feature = "probe")]
#[allow(unsafe_code)]
pub mod probe;
pub mod seq;

pub use detect::{Capabilities, Detection, ImageProtocol, Multiplexer, ProbeReplies, Terminal};

/// Nushell module wiring the integration (`aphrody shell start` loads it):
/// prompt and command marks, cwd, OSC 9;4 during long commands, `img`, `lk`.
pub const NU_MODULE: &str = include_str!("../nu/aphrody-term.nu");
