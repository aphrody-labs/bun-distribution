// SPDX-License-Identifier: Apache-2.0
//! # Aphrody Web — Canonical Pure Web & Browser Surface
//!
//! Unifies the Obscura headless browser, DOM extraction,
//! and CDP session automation into a cohesive, pure library layer.

pub use aphrody_web_bridge as bridge;
pub use aphrody_web_extract as extract;
pub use aphrody_web_index as index;
pub use aphrody_web_service as service;
pub use obscura;

mod subsystem;
pub use subsystem::WebSubsystem;
