// SPDX-License-Identifier: Apache-2.0
//! WebAssembly stub implementation of sandbox hooks.

use std::{io, process::Command};

use crate::policy::SandboxPolicy;

/// Stubs helper check on wasm32 targets.
pub fn run_helper_if_requested() -> io::Result<bool> {
    Ok(false)
}

/// Stubs command configuration on wasm32 targets.
pub fn configure_command(_command: &mut Command, _policy: &SandboxPolicy) -> io::Result<()> {
    Ok(())
}
