// SPDX-License-Identifier: Apache-2.0
//! MOS 6502 lifter (NES PRG-ROM) to guest semantics for the TetaNES runtime.

use super::ir::IrModule;

/// Lift limits.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Maximum number of decoded instructions.
    pub max_insns: usize,
}

/// Lift an iNES cartridge.
///
/// # Errors
/// Returns why the image cannot be lifted.
pub fn lift_ines(_rom: &[u8], _limits: Limits) -> Result<IrModule, String> {
    Err("6502 lifter pending".into())
}
