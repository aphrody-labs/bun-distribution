// SPDX-License-Identifier: Apache-2.0
//! Bun OS platform layer for native hosts (console shell, Bun Engine runtime).
//!
//! The data has one source, shared with the Bun side (`packages/bun-os-platform`):
//! - `locales/<tag>/<domain>.ftl`: Project Fluent catalogs ([`i18n`]);
//! - `themes/*.{json,toml,css}`: M3 theme files resolved by `aphrody-m3-tokens` ([`theme`]);
//! - plugins, the file-type registry and the transfer service run in Bun and are reached over the
//!   typed JSON-lines [`sidecar`].
//!
//! See `docs/bun-os/PLATFORM.md`.

pub mod desktop;
pub mod i18n;
pub mod locale;
pub mod paths;
pub mod sidecar;
pub mod theme;

#[cfg(feature = "bevy")]
pub mod bevy;

pub use i18n::{t, tf};
