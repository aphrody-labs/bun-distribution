// SPDX-License-Identifier: Apache-2.0
//! Small register-machine IR produced by the lift stage and consumed by the C and Rust emitters.
//!
//! Operands are 64-bit canonical registers (with a width and a high-byte flag), immediates and
//! memory references. Instructions the lifter cannot model become [`IrOp::Unlifted`] and are
//! reported, never silently dropped.

use serde::{Deserialize, Serialize};

/// Operand of an IR instruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Operand {
    /// Register operand.
    Reg {
        /// Canonical 64-bit register name (`rax` .. `r15`).
        name: String,
        /// Accessed width in bits.
        bits: u8,
        /// True for AH/CH/DH/BH.
        high: bool,
    },
    /// Immediate (sign-extended to 64 bits).
    Imm {
        /// Immediate value.
        value: i64,
    },
    /// Memory reference `[base + index*scale + disp]`.
    Mem {
        /// Base register.
        base: Option<String>,
        /// Index register.
        index: Option<String>,
        /// Index scale (1, 2, 4, 8).
        scale: u8,
        /// Displacement or resolved absolute address.
        disp: i64,
        /// Access width in bits (0 for `lea` sources).
        bits: u8,
    },
}

impl Operand {
    /// Access width in bits when intrinsic to the operand.
    #[must_use]
    pub fn bits(&self) -> Option<u8> {
        match self {
            Self::Reg { bits, .. } => Some(*bits),
            Self::Mem { bits, .. } if *bits != 0 => Some(*bits),
            _ => None,
        }
    }
}

/// Extension applied by a move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ext {
    /// Plain move.
    None,
    /// `movzx`.
    Zero,
    /// `movsx` / `movsxd`.
    Sign,
}

/// Two-operand arithmetic/logic kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BinKind {
    /// Addition.
    Add,
    /// Subtraction.
    Sub,
    /// Bitwise and.
    And,
    /// Bitwise or.
    Or,
    /// Bitwise xor.
    Xor,
    /// Shift left.
    Shl,
    /// Logical shift right.
    Shr,
    /// Arithmetic shift right.
    Sar,
}

/// One-operand arithmetic kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnKind {
    /// Increment.
    Inc,
    /// Decrement.
    Dec,
    /// Negation.
    Neg,
    /// Bitwise not.
    Not,
}

/// Condition code (parity conditions are not modelled).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cond {
    /// Overflow.
    O,
    /// No overflow.
    No,
    /// Below.
    B,
    /// Above or equal.
    Ae,
    /// Equal.
    E,
    /// Not equal.
    Ne,
    /// Below or equal.
    Be,
    /// Above.
    A,
    /// Sign.
    S,
    /// No sign.
    Ns,
    /// Less.
    L,
    /// Greater or equal.
    Ge,
    /// Less or equal.
    Le,
    /// Greater.
    G,
}

/// Control-transfer target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Target {
    /// Direct address.
    Direct {
        /// Absolute virtual address.
        addr: u64,
    },
    /// Imported symbol (IAT slot or PLT stub).
    Import {
        /// Index into [`IrModule::imports`].
        index: u32,
        /// Symbol name.
        name: String,
    },
    /// Computed target.
    Indirect {
        /// Operand holding the target address.
        operand: Operand,
    },
}

/// IR operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum IrOp {
    /// No operation.
    Nop,
    /// `dst = ext(src)`.
    Mov {
        /// Destination.
        dst: Operand,
        /// Source.
        src: Operand,
        /// Extension mode.
        ext: Ext,
    },
    /// `dst = address of src`.
    Lea {
        /// Destination register.
        dst: Operand,
        /// Memory operand.
        src: Operand,
    },
    /// `dst = dst <kind> src` with flags.
    Bin {
        /// Operation.
        kind: BinKind,
        /// Destination and first source.
        dst: Operand,
        /// Second source.
        src: Operand,
    },
    /// `dst = <kind> dst` with flags.
    Un {
        /// Operation.
        kind: UnKind,
        /// Destination.
        dst: Operand,
    },
    /// Flags of `a - b`.
    Cmp {
        /// Left operand.
        a: Operand,
        /// Right operand.
        b: Operand,
    },
    /// Flags of `a & b`.
    Test {
        /// Left operand.
        a: Operand,
        /// Right operand.
        b: Operand,
    },
    /// Push.
    Push {
        /// Pushed value.
        src: Operand,
    },
    /// Pop.
    Pop {
        /// Destination.
        dst: Operand,
    },
    /// `mov rsp, rbp; pop rbp`.
    Leave,
    /// `dst = cond ? 1 : 0`.
    Setcc {
        /// Condition.
        cond: Cond,
        /// Byte destination.
        dst: Operand,
    },
    /// `dst = cond ? src : dst`.
    Cmovcc {
        /// Condition.
        cond: Cond,
        /// Destination.
        dst: Operand,
        /// Source.
        src: Operand,
    },
    /// Call.
    Call {
        /// Target.
        target: Target,
    },
    /// Unconditional jump (local goto or tail call).
    Jmp {
        /// Target.
        target: Target,
    },
    /// Conditional jump; falls through otherwise.
    Jcc {
        /// Condition.
        cond: Cond,
        /// Taken target address.
        target: u64,
    },
    /// Return, popping `pop` extra bytes.
    Ret {
        /// Extra bytes popped.
        pop: u16,
    },
    /// Instruction not modelled by the lifter.
    Unlifted {
        /// Why it is not modelled.
        reason: String,
    },
}

/// One lifted instruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrInsn {
    /// Virtual address.
    pub addr: u64,
    /// Encoded length.
    pub len: u8,
    /// Disassembly text.
    pub text: String,
    /// Lifted operation.
    #[serde(flatten)]
    pub op: IrOp,
}

/// Straight-line block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrBlock {
    /// First instruction address.
    pub addr: u64,
    /// Instructions.
    pub insns: Vec<IrInsn>,
    /// Address reached when the block does not end in an unconditional transfer.
    pub fallthrough: Option<u64>,
}

/// Lifted function.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrFunction {
    /// Entry address.
    pub addr: u64,
    /// Symbol/export name when known.
    pub name: Option<String>,
    /// Blocks sorted by address.
    pub blocks: Vec<IrBlock>,
    /// True when the instruction budget cut the function short.
    pub truncated: bool,
}

/// Imported symbol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportEntry {
    /// Symbol name.
    pub name: String,
    /// Library when known.
    pub lib: Option<String>,
    /// IAT slot or PLT stub address.
    pub slot: u64,
}

/// Mapped section stored in `image.bin`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionEntry {
    /// Section name.
    pub name: String,
    /// Virtual address.
    pub vaddr: u64,
    /// Virtual size.
    pub vsize: u64,
    /// Offset of the raw bytes in `image.bin`.
    pub file_offset: u64,
    /// Raw byte count stored in `image.bin`.
    pub file_size: u64,
    /// Executable.
    pub exec: bool,
    /// Writable.
    pub write: bool,
}

/// Lifted module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IrModule {
    /// Schema revision.
    pub schema_version: u32,
    /// Source container (`pe` or `elf`).
    pub format: String,
    /// Instruction set (`x86` or `x86_64`).
    pub arch: String,
    /// Address width in bits.
    pub bits: u8,
    /// Preferred image base.
    pub image_base: u64,
    /// Entry address.
    pub entry: u64,
    /// Highest mapped address (exclusive).
    pub image_end: u64,
    /// Import table.
    pub imports: Vec<ImportEntry>,
    /// Mapped sections.
    pub sections: Vec<SectionEntry>,
    /// Lifted functions.
    pub functions: Vec<IrFunction>,
}

/// Lift coverage counters.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiftStats {
    /// Functions lifted.
    pub functions: u64,
    /// Basic blocks.
    pub blocks: u64,
    /// Instructions decoded.
    pub instructions: u64,
    /// Instructions modelled by the IR.
    pub lifted: u64,
    /// Instructions kept as `Unlifted`.
    pub unlifted: u64,
}

impl IrModule {
    /// Coverage counters.
    #[must_use]
    pub fn stats(&self) -> LiftStats {
        let mut s = LiftStats::default();
        for f in &self.functions {
            s.functions += 1;
            for b in &f.blocks {
                s.blocks += 1;
                for i in &b.insns {
                    s.instructions += 1;
                    if matches!(i.op, IrOp::Unlifted { .. }) {
                        s.unlifted += 1;
                    } else {
                        s.lifted += 1;
                    }
                }
            }
        }
        s
    }
}
