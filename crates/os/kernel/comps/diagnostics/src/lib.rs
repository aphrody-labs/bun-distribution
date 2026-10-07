// SPDX-License-Identifier: Apache-2.0
//! Diagnostics and status for the Aphrody CLI and desktop app.
//!
//! One implementation behind `aphrody doctor`, `os status`, `infra status|check`,
//! `config show` and `ai env`, callable in-process by any front end.

pub mod ai_env;
pub mod config;
pub mod doctor;
pub mod infra;
pub mod os;

pub use ai_env::ai_env;
pub use config::config_resolved;
pub use doctor::diagnostics;
pub use infra::{infra_check, infra_status};
pub use os::os_status;
