// SPDX-License-Identifier: Apache-2.0
//! Deterministic command and filesystem sandboxing for aphrody.
//!
//! Provides the core [`SandboxPolicy`] used to confine agent actions,
//! capability detection via [`probe`], structured failure analysis via
//! [`classify_denial`], and the [`CommandRunner`] injection trait.

pub mod capability;
pub mod denial;
pub mod patch_guard;
pub mod policy;
pub mod runner;

#[cfg(windows)]
pub mod windows;

#[cfg(all(unix, not(target_arch = "wasm32")))]
pub mod unix;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use capability::{CapabilityReport, SandboxCapability, probe};
pub use denial::{SandboxDenial, SandboxDenialKind, classify_denial};
pub use patch_guard::verify_patch_paths;
pub use policy::{NetworkPolicy, SandboxMode, SandboxPolicy};
pub use runner::{
    CommandRunResult, CommandRunner, MockCommandRunner, RunnerError, SandboxedCommandRunner,
};

/// Check if the current process is the sandbox helper dispatch and run it if requested.
///
/// Should be invoked at the entry of `main()` before the async runtime starts.
#[must_use]
pub fn run_helper_if_requested() -> bool {
    #[cfg(all(unix, not(target_arch = "wasm32")))]
    {
        unix::run_helper_if_requested().unwrap_or(false)
    }

    #[cfg(not(all(unix, not(target_arch = "wasm32"))))]
    {
        false
    }
}
