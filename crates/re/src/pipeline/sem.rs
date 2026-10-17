// SPDX-License-Identifier: Apache-2.0
//! Guest-semantics extension of the IR for console instruction sets (ARMv4T ARM and Thumb, MIPS
//! R3000A, MOS 6502).
//!
//! A console instruction lifts to an [`IrOp::Guest`](super::ir::IrOp::Guest) holding a small
//! statement tree over 32-bit values: guest registers and flags named by the module
//! [`Abi`](super::ir::Abi), per-instruction temporaries, loads and stores through the machine bus
//! with a machine-defined access kind, and calls into the machine runtime ("helpers") for the
//! pipeline, timing and system operations the device model owns. The emitter turns the tree into
//! straight Rust against the runtime of the matching Bun Engine core; it knows nothing about any
//! instruction set.
//!
//! Hybrid recompilation: [`Stmt::Fallback`] hands the instruction to the core's interpreter and
//! leaves the block, and the runtime dispatcher interprets every address that has no translated
//! block (indirect targets, code copied to RAM), so the output always runs.

use serde::{Deserialize, Serialize};

/// Operand of a statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum Val {
    /// 32-bit constant.
    Imm {
        /// Value.
        v: u32,
    },
    /// Guest register (index into `Abi::regs`).
    Reg {
        /// Register index.
        r: u8,
    },
    /// Instruction-local temporary.
    Tmp {
        /// Temporary index.
        t: u16,
    },
    /// Guest flag (index into `Abi::flags`), read as 0 or 1.
    Flag {
        /// Flag index.
        f: u8,
    },
}

/// Constant operand.
#[must_use]
pub const fn imm(v: u32) -> Val {
    Val::Imm { v }
}

/// Register operand.
#[must_use]
pub const fn reg(r: u8) -> Val {
    Val::Reg { r }
}

/// Temporary operand.
#[must_use]
pub const fn tmp(t: u16) -> Val {
    Val::Tmp { t }
}

/// Flag operand.
#[must_use]
pub const fn flag(f: u8) -> Val {
    Val::Flag { f }
}

/// Two-operand 32-bit operation. Shifts and rotates take the full second operand: logical shifts by
/// 32 or more give 0, arithmetic shifts by 32 or more give the sign fill, rotates use the amount
/// modulo 32. Comparisons give 0 or 1. Unary operations ignore `b`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Alu {
    /// Wrapping addition.
    Add,
    /// Wrapping subtraction.
    Sub,
    /// Bitwise and.
    And,
    /// Bitwise or.
    Or,
    /// Bitwise xor.
    Xor,
    /// Low 32 bits of the product.
    Mul,
    /// High 32 bits of the unsigned 64-bit product.
    MulHiU,
    /// High 32 bits of the signed 64-bit product.
    MulHiS,
    /// Logical shift left.
    Shl,
    /// Logical shift right.
    Shr,
    /// Arithmetic shift right.
    Sar,
    /// Rotate right.
    Ror,
    /// Equal.
    Eq,
    /// Not equal.
    Ne,
    /// Unsigned less than.
    Ltu,
    /// Signed less than.
    Lts,
    /// Unsigned less or equal.
    Leu,
    /// Signed less or equal.
    Les,
    /// Unsigned quotient; divisor 0 gives `0xffff_ffff` (MIPS).
    DivU,
    /// Unsigned remainder; divisor 0 gives the dividend (MIPS).
    RemU,
    /// Signed quotient; divisor 0 gives 1 or -1 by sign, `MIN / -1` gives `MIN` (MIPS).
    DivS,
    /// Signed remainder; divisor 0 gives the dividend, `MIN % -1` gives 0 (MIPS).
    RemS,
    /// Sign-extend the low byte of `a`.
    Sext8,
    /// Sign-extend the low half-word of `a`.
    Sext16,
    /// Bitwise not of `a`.
    Not,
}

/// Statement of a lifted guest instruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "s", rename_all = "snake_case")]
pub enum Stmt {
    /// `t = op(a, b)`.
    Op {
        /// Destination temporary.
        t: u16,
        /// Operation.
        op: Alu,
        /// First operand.
        a: Val,
        /// Second operand.
        b: Val,
    },
    /// `t = c != 0 ? a : b`.
    Sel {
        /// Destination temporary.
        t: u16,
        /// Condition.
        c: Val,
        /// Value when the condition holds.
        a: Val,
        /// Value otherwise.
        b: Val,
    },
    /// Write a guest register.
    Set {
        /// Register index.
        r: u8,
        /// Value.
        v: Val,
    },
    /// Write a guest flag (bit 0 of `v`).
    SetFlag {
        /// Flag index.
        f: u8,
        /// Value.
        v: Val,
    },
    /// Zero-extending bus load.
    Load {
        /// Destination temporary.
        t: u16,
        /// Access width (8, 16 or 32).
        bits: u8,
        /// Address.
        addr: Val,
        /// Machine-defined access kind (ARM: 0 non-sequential, 1 sequential).
        kind: u8,
    },
    /// Bus store.
    Store {
        /// Access width (8, 16 or 32).
        bits: u8,
        /// Address.
        addr: Val,
        /// Stored value (low `bits` bits).
        v: Val,
        /// Machine-defined access kind.
        kind: u8,
    },
    /// Machine runtime helper `g.<f>(args)`, optionally returning a value.
    Call {
        /// Helper name.
        f: String,
        /// Arguments.
        args: Vec<Val>,
        /// Destination temporary.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        t: Option<u16>,
    },
    /// Conditional statements.
    If {
        /// Condition (non-zero holds).
        c: Val,
        /// Taken statements.
        then: Vec<Stmt>,
        /// Statements otherwise.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        els: Vec<Stmt>,
    },
    /// Leave the block; the runtime state already holds the next instruction.
    Exit,
    /// Execute this instruction in the core interpreter, then leave the block.
    Fallback {
        /// Why the instruction is not translated.
        why: String,
    },
}

/// Lifted guest instruction body.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Guest {
    /// Raw encoding (instruction word, half-word or opcode bytes, little-endian).
    pub raw: u32,
    /// Statements.
    pub body: Vec<Stmt>,
}

impl Guest {
    /// True when the instruction is handed to the interpreter.
    #[must_use]
    pub fn is_fallback(&self) -> bool {
        self.body.iter().any(|s| matches!(s, Stmt::Fallback { .. }))
    }

    /// Number of temporaries used (highest index + 1).
    #[must_use]
    pub fn temps(&self) -> u16 {
        fn val(v: &Val, n: &mut u16) {
            if let Val::Tmp { t } = v {
                *n = (*n).max(t + 1);
            }
        }
        fn walk(s: &[Stmt], n: &mut u16) {
            for st in s {
                match st {
                    Stmt::Op { t, a, b, .. } => {
                        *n = (*n).max(t + 1);
                        val(a, n);
                        val(b, n);
                    }
                    Stmt::Sel { t, c, a, b } => {
                        *n = (*n).max(t + 1);
                        val(c, n);
                        val(a, n);
                        val(b, n);
                    }
                    Stmt::Set { v, .. } | Stmt::SetFlag { v, .. } => val(v, n),
                    Stmt::Load { t, addr, .. } => {
                        *n = (*n).max(t + 1);
                        val(addr, n);
                    }
                    Stmt::Store { addr, v, .. } => {
                        val(addr, n);
                        val(v, n);
                    }
                    Stmt::Call { args, t, .. } => {
                        if let Some(t) = t {
                            *n = (*n).max(t + 1);
                        }
                        for a in args {
                            val(a, n);
                        }
                    }
                    Stmt::If { c, then, els } => {
                        val(c, n);
                        walk(then, n);
                        walk(els, n);
                    }
                    Stmt::Exit | Stmt::Fallback { .. } => {}
                }
            }
        }
        let mut n = 0;
        walk(&self.body, &mut n);
        n
    }
}

/// Statement builder with temporary allocation, used by the console lifters.
#[derive(Debug, Default)]
pub struct Builder {
    /// Emitted statements.
    pub out: Vec<Stmt>,
    next: u16,
}

impl Builder {
    /// Empty builder.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Fresh temporary.
    pub fn fresh(&mut self) -> u16 {
        let t = self.next;
        self.next += 1;
        t
    }

    /// `op(a, b)` into a fresh temporary (folded when both operands are constants).
    pub fn op(&mut self, op: Alu, a: Val, b: Val) -> Val {
        if let (Val::Imm { v: x }, Val::Imm { v: y }) = (a, b) {
            return imm(fold(op, x, y));
        }
        // Comparisons decided by a constant bound.
        match (op, a, b) {
            (Alu::Leu, Val::Imm { v: 0 }, _) => return imm(1),
            (Alu::Ltu, _, Val::Imm { v: 0 }) => return imm(0),
            _ => {}
        }
        let t = self.fresh();
        self.out.push(Stmt::Op { t, op, a, b });
        tmp(t)
    }

    /// `c ? a : b` into a fresh temporary (folded when the condition is a constant).
    pub fn sel(&mut self, c: Val, a: Val, b: Val) -> Val {
        if let Val::Imm { v } = c {
            return if v != 0 { a } else { b };
        }
        let t = self.fresh();
        self.out.push(Stmt::Sel { t, c, a, b });
        tmp(t)
    }

    /// Register write.
    pub fn set(&mut self, r: u8, v: Val) {
        self.out.push(Stmt::Set { r, v });
    }

    /// Flag write.
    pub fn set_flag(&mut self, f: u8, v: Val) {
        self.out.push(Stmt::SetFlag { f, v });
    }

    /// Bus load into a fresh temporary.
    pub fn load(&mut self, bits: u8, addr: Val, kind: u8) -> Val {
        let t = self.fresh();
        self.out.push(Stmt::Load {
            t,
            bits,
            addr,
            kind,
        });
        tmp(t)
    }

    /// Bus store.
    pub fn store(&mut self, bits: u8, addr: Val, v: Val, kind: u8) {
        self.out.push(Stmt::Store {
            bits,
            addr,
            v,
            kind,
        });
    }

    /// Helper call without a result.
    pub fn call(&mut self, f: &str, args: &[Val]) {
        self.out.push(Stmt::Call {
            f: f.into(),
            args: args.to_vec(),
            t: None,
        });
    }

    /// Helper call returning a value.
    pub fn call_v(&mut self, f: &str, args: &[Val]) -> Val {
        let t = self.fresh();
        self.out.push(Stmt::Call {
            f: f.into(),
            args: args.to_vec(),
            t: Some(t),
        });
        tmp(t)
    }

    /// Conditional block built by two closures sharing the temporary counter.
    pub fn if_else(&mut self, c: Val, then: impl FnOnce(&mut Self), els: impl FnOnce(&mut Self)) {
        let saved = std::mem::take(&mut self.out);
        then(self);
        let t = std::mem::take(&mut self.out);
        els(self);
        let e = std::mem::replace(&mut self.out, saved);
        self.out.push(Stmt::If { c, then: t, els: e });
    }

    /// Leave the block.
    pub fn exit(&mut self) {
        self.out.push(Stmt::Exit);
    }

    /// Finish into a [`Guest`] body.
    #[must_use]
    pub fn finish(self, raw: u32) -> Guest {
        Guest {
            raw,
            body: self.out,
        }
    }
}

/// Fold an operation on two constants.
#[must_use]
pub fn fold(op: Alu, a: u32, b: u32) -> u32 {
    let s = |x: u32| x as i32;
    match op {
        Alu::Add => a.wrapping_add(b),
        Alu::Sub => a.wrapping_sub(b),
        Alu::And => a & b,
        Alu::Or => a | b,
        Alu::Xor => a ^ b,
        Alu::Mul => a.wrapping_mul(b),
        Alu::MulHiU => ((u64::from(a) * u64::from(b)) >> 32) as u32,
        Alu::MulHiS => ((i64::from(s(a)) * i64::from(s(b))) >> 32) as u32,
        Alu::Shl => a.checked_shl(b).unwrap_or(0),
        Alu::Shr => a.checked_shr(b).unwrap_or(0),
        Alu::Sar => s(a).checked_shr(b).unwrap_or(s(a) >> 31) as u32,
        Alu::Ror => a.rotate_right(b & 31),
        Alu::Eq => u32::from(a == b),
        Alu::Ne => u32::from(a != b),
        Alu::Ltu => u32::from(a < b),
        Alu::Lts => u32::from(s(a) < s(b)),
        Alu::Leu => u32::from(a <= b),
        Alu::Les => u32::from(s(a) <= s(b)),
        Alu::DivU => a.checked_div(b).unwrap_or(u32::MAX),
        Alu::RemU => a.checked_rem(b).unwrap_or(a),
        Alu::DivS => {
            if b == 0 {
                if s(a) < 0 { 1 } else { u32::MAX }
            } else {
                s(a).wrapping_div(s(b)) as u32
            }
        }
        Alu::RemS => {
            if b == 0 {
                a
            } else {
                s(a).wrapping_rem(s(b)) as u32
            }
        }
        Alu::Sext8 => a as u8 as i8 as i32 as u32,
        Alu::Sext16 => a as u16 as i16 as i32 as u32,
        Alu::Not => !a,
    }
}
