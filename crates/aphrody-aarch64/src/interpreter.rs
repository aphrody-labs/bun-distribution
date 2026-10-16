//! Integer execution extracted from rdynarmic's A64 translator semantics.
//! Unsupported instructions stop at their original PC; no host-native code is emitted.
use crate::{A64InstructionName as Name, decode};

/// Guest memory operations must be little-endian and all-or-nothing on error.
/// Fetch can have permissions distinct from data loads.
pub trait Memory {
    type Error;
    fn fetch_u32(&mut self, address: u64) -> Result<u32, Self::Error>;
    fn read(&mut self, address: u64, bytes: u8) -> Result<u64, Self::Error>;
    fn write(&mut self, address: u64, bytes: u8, value: u64) -> Result<(), Self::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    Fetch,
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trap<E> {
    MisalignedPc(u64),
    Memory {
        address: u64,
        access: Access,
        error: E,
    },
    Undefined(u32),
    Unsupported {
        raw: u32,
        name: Name,
    },
    SupervisorCall(u16),
    Breakpoint(u16),
}

/// EL0 integer registers. SP is distinct from architectural register 31 (XZR).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Cpu {
    pub registers: [u64; 31],
    pub sp: u64,
    pub pc: u64,
    /// NZCV in bits 31..28. Other bits are ignored.
    pub nzcv: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult<E> {
    /// Successfully retired instructions, excluding a trapping instruction.
    pub retired: u64,
    /// None means the caller's instruction budget was exhausted.
    pub trap: Option<Trap<E>>,
}

impl Cpu {
    fn register(&self, index: u32, width: usize, use_sp: bool) -> u64 {
        let value = if index == 31 {
            if use_sp { self.sp } else { 0 }
        } else {
            self.registers[index as usize]
        };
        if width == 32 {
            value & u64::from(u32::MAX)
        } else {
            value
        }
    }

    fn set_register(&mut self, index: u32, width: usize, use_sp: bool, value: u64) {
        let value = if width == 32 {
            value & u64::from(u32::MAX)
        } else {
            value
        };
        if index == 31 {
            if use_sp {
                self.sp = value;
            }
        } else {
            self.registers[index as usize] = value;
        }
    }

    fn flags(&mut self, lhs: u64, rhs: u64, result: u64, width: usize, subtract: bool) {
        let sign = 1_u64 << (width - 1);
        let mask = if width == 32 {
            u64::from(u32::MAX)
        } else {
            u64::MAX
        };
        let result = result & mask;
        let carry = if subtract {
            lhs >= rhs
        } else {
            u128::from(lhs) + u128::from(rhs) > u128::from(mask)
        };
        let overflow = if subtract {
            ((lhs ^ rhs) & (lhs ^ result) & sign) != 0
        } else {
            (!(lhs ^ rhs) & (lhs ^ result) & sign) != 0
        };
        self.nzcv = (u32::from(result & sign != 0) << 31)
            | (u32::from(result == 0) << 30)
            | (u32::from(carry) << 29)
            | (u32::from(overflow) << 28);
    }

    fn condition(&self, cond: u32) -> bool {
        let n = self.nzcv & (1 << 31) != 0;
        let z = self.nzcv & (1 << 30) != 0;
        let c = self.nzcv & (1 << 29) != 0;
        let v = self.nzcv & (1 << 28) != 0;
        let matched = match cond >> 1 {
            0 => z,
            1 => c,
            2 => n,
            3 => v,
            4 => c && !z,
            5 => n == v,
            6 => n == v && !z,
            _ => true,
        };
        if cond & 1 != 0 && cond != 15 {
            !matched
        } else {
            matched
        }
    }

    /// Execute at most the requested number of instructions, including loops.
    pub fn run<M: Memory>(&mut self, memory: &mut M, budget: u64) -> RunResult<M::Error> {
        for retired in 0..budget {
            if let Err(trap) = self.step(memory) {
                return RunResult {
                    retired,
                    trap: Some(trap),
                };
            }
        }
        RunResult {
            retired: budget,
            trap: None,
        }
    }

    /// Execute one integer instruction. Data and instruction faults leave PC unchanged.
    pub fn step<M: Memory>(&mut self, memory: &mut M) -> Result<(), Trap<M::Error>> {
        if self.pc & 3 != 0 {
            return Err(Trap::MisalignedPc(self.pc));
        }
        let raw = memory.fetch_u32(self.pc).map_err(|error| Trap::Memory {
            address: self.pc,
            access: Access::Fetch,
            error,
        })?;
        let inst = decode(raw).ok_or(Trap::Undefined(raw))?;
        let mut next_pc = self.pc.wrapping_add(4);
        let width = inst.datasize();
        match inst.name {
            Name::NOP => {}
            Name::MOVZ | Name::MOVN | Name::MOVK => {
                let shift = inst.hw() * 16;
                if width == 32 && shift >= 32 {
                    return Err(Trap::Undefined(raw));
                }
                let immediate = u64::from(inst.imm16()) << shift;
                let value = match inst.name {
                    Name::MOVN => !immediate,
                    Name::MOVK => {
                        (self.register(inst.rd(), width, false) & !(0xffff_u64 << shift))
                            | immediate
                    }
                    _ => immediate,
                };
                self.set_register(inst.rd(), width, false, value);
            }
            Name::ADD_imm | Name::ADDS_imm | Name::SUB_imm | Name::SUBS_imm => {
                let shift = inst.bits(23, 22);
                if shift > 1 {
                    return Err(Trap::Undefined(raw));
                }
                let lhs = self.register(inst.rn(), width, true);
                let rhs = u64::from(inst.imm12()) << (shift * 12);
                let subtract = inst.bit(30);
                let result = if subtract {
                    lhs.wrapping_sub(rhs)
                } else {
                    lhs.wrapping_add(rhs)
                };
                let set_flags = inst.bit(29);
                if set_flags {
                    self.flags(lhs, rhs, result, width, subtract);
                }
                self.set_register(inst.rd(), width, !set_flags, result);
            }
            Name::B_uncond | Name::BL => {
                if inst.name == Name::BL {
                    self.registers[30] = next_pc;
                }
                next_pc = self.pc.wrapping_add_signed(inst.imm26_sext() * 4);
            }
            Name::BR | Name::BLR | Name::RET => {
                let target = self.register(inst.rn(), 64, false);
                if inst.name == Name::BLR {
                    self.registers[30] = next_pc;
                }
                next_pc = target;
            }
            Name::B_cond => {
                if self.condition(inst.bits(3, 0)) {
                    next_pc = self.pc.wrapping_add_signed(inst.imm19_sext() * 4);
                }
            }
            Name::CBZ | Name::CBNZ => {
                if (self.register(inst.rd(), width, false) == 0) == (inst.name == Name::CBZ) {
                    next_pc = self.pc.wrapping_add_signed(inst.imm19_sext() * 4);
                }
            }
            Name::TBZ | Name::TBNZ => {
                let bit = (u32::from(inst.bit(31)) << 5) | inst.bits(23, 19);
                let is_zero = self.register(inst.rd(), 64, false) & (1_u64 << bit) == 0;
                if is_zero == (inst.name == Name::TBZ) {
                    let offset = ((inst.bits(18, 5) as i32) << 18 >> 18) as i64 * 4;
                    next_pc = self.pc.wrapping_add_signed(offset);
                }
            }
            Name::ADR | Name::ADRP => {
                let encoded = (inst.bits(23, 5) << 2) | inst.bits(30, 29);
                let offset = ((encoded as i32) << 11 >> 11) as i64;
                let address = if inst.name == Name::ADRP {
                    (self.pc & !0xfff).wrapping_add_signed(offset * 4096)
                } else {
                    self.pc.wrapping_add_signed(offset)
                };
                self.set_register(inst.rd(), 64, false, address);
            }
            Name::STRx_LDRx_imm_2 => {
                let size = inst.size();
                let opc = inst.bits(23, 22);
                // PRFM has no architectural data result. Other size/opc combinations
                // have validity constraints beyond the broad table pattern.
                if size == 3 && opc == 2 {
                    self.pc = next_pc;
                    return Ok(());
                }
                if (size >= 2 && opc == 3) || (size == 3 && opc != 0 && opc != 1) {
                    return Err(Trap::Undefined(raw));
                }
                let bytes = 1_u8 << size;
                let address = self
                    .register(inst.rn(), 64, true)
                    .wrapping_add(u64::from(inst.imm12()) << size);
                if opc == 0 {
                    let value = self.register(inst.rd(), 64, false);
                    memory
                        .write(address, bytes, value)
                        .map_err(|error| Trap::Memory {
                            address,
                            access: Access::Write,
                            error,
                        })?;
                } else {
                    let value = memory.read(address, bytes).map_err(|error| Trap::Memory {
                        address,
                        access: Access::Read,
                        error,
                    })?;
                    let signed = opc & 2 != 0;
                    let bits = u32::from(bytes) * 8;
                    let value = if signed {
                        ((value << (64 - bits)) as i64 >> (64 - bits)) as u64
                    } else {
                        value
                    };
                    let reg_width = if size == 3 || opc == 2 { 64 } else { 32 };
                    self.set_register(inst.rd(), reg_width, false, value);
                }
            }
            Name::SVC => return Err(Trap::SupervisorCall(inst.imm16() as u16)),
            Name::BRK => return Err(Trap::Breakpoint(inst.imm16() as u16)),
            name => return Err(Trap::Unsupported { raw, name }),
        }
        self.pc = next_pc;
        Ok(())
    }
}

/// Simple bounded guest RAM useful for legal homebrew, native and WASM harnesses.
pub struct SliceMemory<'a> {
    pub base: u64,
    pub bytes: &'a mut [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryError {
    InvalidWidth(u8),
    OutOfBounds,
}

impl SliceMemory<'_> {
    fn range(&self, address: u64, bytes: u8) -> Result<core::ops::Range<usize>, MemoryError> {
        if !matches!(bytes, 1 | 2 | 4 | 8) {
            return Err(MemoryError::InvalidWidth(bytes));
        }
        let start = address
            .checked_sub(self.base)
            .and_then(|offset| usize::try_from(offset).ok())
            .ok_or(MemoryError::OutOfBounds)?;
        let end = start
            .checked_add(usize::from(bytes))
            .filter(|&end| end <= self.bytes.len())
            .ok_or(MemoryError::OutOfBounds)?;
        Ok(start..end)
    }
}

impl Memory for SliceMemory<'_> {
    type Error = MemoryError;
    fn fetch_u32(&mut self, address: u64) -> Result<u32, Self::Error> {
        self.read(address, 4).map(|word| word as u32)
    }
    fn read(&mut self, address: u64, bytes: u8) -> Result<u64, Self::Error> {
        let range = self.range(address, bytes)?;
        let mut value = [0_u8; 8];
        value[..usize::from(bytes)].copy_from_slice(&self.bytes[range]);
        Ok(u64::from_le_bytes(value))
    }
    fn write(&mut self, address: u64, bytes: u8, value: u64) -> Result<(), Self::Error> {
        let range = self.range(address, bytes)?;
        self.bytes[range].copy_from_slice(&value.to_le_bytes()[..usize::from(bytes)]);
        Ok(())
    }
}
