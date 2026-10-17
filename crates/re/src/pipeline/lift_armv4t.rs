// SPDX-License-Identifier: Apache-2.0
//! ARMv4T lifter (ARM7TDMI, ARM and Thumb states) to guest semantics for the Game Boy Advance
//! runtime of Bun Engine (RustBoyAdvance-NG device models).
//!
//! Every instruction is lowered with the exact observable behaviour of the RustBoyAdvance-NG
//! interpreter it runs next to: the same bus accesses in the same order with the same
//! sequential/non-sequential kinds, the same prefetch pipeline bookkeeping, the same flag rules
//! (including its barrel-shifter carry and misaligned-load quirks). That makes translated code a
//! drop-in replacement for interpreter steps, so the scheduler, DMA and interrupts see identical
//! timing. PSR transfers, `SWP`, `SWI`, user-bank transfers and coprocessor or undefined encodings
//! become [`Stmt::Fallback`] and run in the interpreter.
//!
//! Runtime contract (`machine = "gba"`): registers 0..=14 are `r0`..`r14`; flags are `n z c v`;
//! access kind 0 is non-sequential and 1 sequential; helpers are `arm_begin(addr)`,
//! `arm_next(kind)`, `thumb_begin(addr)`, `thumb_next(kind)`, `idle()`, `mul_idle(rs)`,
//! `ldr_word(addr, kind)`, `ldr_half(addr, kind)`, `ldr_sign_half(addr, kind)`, `reload32(pc)`,
//! `reload16(pc)`, `branch_exchange(target)`.

use super::ir::{Abi, IrBlock, IrFunction, IrInsn, IrModule, IrOp, SectionEntry};
use super::sem::{Alu, Builder, Guest, Stmt, Val, flag, imm, reg};
use std::collections::{BTreeMap, BTreeSet};

const N: u8 = 0;
const Z: u8 = 1;
const C: u8 = 2;
const V: u8 = 3;
const NSEQ: u32 = 0;
const SEQ: u32 = 1;

/// Instruction-set state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Isa {
    /// 32-bit ARM.
    Arm,
    /// 16-bit Thumb.
    Thumb,
}

impl Isa {
    fn size(self) -> u32 {
        match self {
            Self::Arm => 4,
            Self::Thumb => 2,
        }
    }
    fn index(self) -> u8 {
        match self {
            Self::Arm => 0,
            Self::Thumb => 1,
        }
    }
}

/// Mapped read-only code region (BIOS, cartridge ROM).
#[derive(Debug, Clone)]
pub struct Region {
    /// Section name.
    pub name: String,
    /// Guest base address.
    pub base: u32,
    /// Contents.
    pub data: Vec<u8>,
}

/// Lift limits.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Maximum number of decoded instructions.
    pub max_insns: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_insns: 400_000 }
    }
}

/// Register file of the GBA runtime.
#[must_use]
pub fn abi() -> Abi {
    Abi {
        regs: (0..15).map(|i| format!("r{i}")).collect(),
        link: "r14".into(),
        sp: "r13".into(),
        ret: "r0".into(),
        machine: Some("gba".into()),
        flags: ["n", "z", "c", "v"]
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        isas: vec!["arm".into(), "thumb".into()],
    }
}

struct Mem<'a> {
    regions: &'a [Region],
}

impl Mem<'_> {
    fn bytes(&self, addr: u32, n: u32) -> Option<&[u8]> {
        self.regions.iter().find_map(|r| {
            let off = addr.checked_sub(r.base)? as usize;
            r.data.get(off..off + n as usize)
        })
    }
    fn u32(&self, addr: u32) -> Option<u32> {
        self.bytes(addr, 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u16(&self, addr: u32) -> Option<u16> {
        self.bytes(addr, 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
    }
}

/// Control flow of a lowered instruction.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Flow {
    /// Static successors that become block leaders, with their state.
    targets: Vec<(u32, Isa)>,
    /// The instruction always leaves the block (unconditional transfer or interpreter fallback).
    ends: bool,
    /// Execution may continue with the next instruction (also true for conditional transfers).
    falls: bool,
}

struct Lowered {
    g: Guest,
    text: String,
    flow: Flow,
}

fn bits(w: u32, lo: u32, n: u32) -> u32 {
    (w >> lo) & ((1u32 << n) - 1)
}

fn bit(w: u32, b: u32) -> bool {
    (w >> b) & 1 == 1
}

const CONDS: [&str; 16] = [
    "eq", "ne", "cs", "cc", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le", "", "nv",
];
const REGS: [&str; 16] = [
    "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "fp", "ip", "sp", "lr", "pc",
];

/// Condition value (0/1) of an ARM condition code; `None` for AL.
fn cond_val(b: &mut Builder, c: u32) -> Option<Val> {
    let not = |b: &mut Builder, v: Val| b.op(Alu::Xor, v, imm(1));
    Some(match c {
        0 => flag(Z),
        1 => not(b, flag(Z)),
        2 => flag(C),
        3 => not(b, flag(C)),
        4 => flag(N),
        5 => not(b, flag(N)),
        6 => flag(V),
        7 => not(b, flag(V)),
        8 => {
            let nz = not(b, flag(Z));
            b.op(Alu::And, flag(C), nz)
        }
        9 => {
            let nc = not(b, flag(C));
            b.op(Alu::Or, nc, flag(Z))
        }
        10 => b.op(Alu::Eq, flag(N), flag(V)),
        11 => b.op(Alu::Ne, flag(N), flag(V)),
        12 => {
            let nz = not(b, flag(Z));
            let ge = b.op(Alu::Eq, flag(N), flag(V));
            b.op(Alu::And, nz, ge)
        }
        13 => {
            let lt = b.op(Alu::Ne, flag(N), flag(V));
            b.op(Alu::Or, flag(Z), lt)
        }
        14 => return None,
        _ => imm(0),
    })
}

/// N and Z from a result.
fn nz(b: &mut Builder, r: Val) {
    let n = b.op(Alu::Shr, r, imm(31));
    b.set_flag(N, n);
    let z = b.op(Alu::Eq, r, imm(0));
    b.set_flag(Z, z);
}

/// `a + b` with ARM carry and overflow.
fn add_flags(b: &mut Builder, x: Val, y: Val) -> (Val, Val, Val) {
    let r = b.op(Alu::Add, x, y);
    let c = b.op(Alu::Ltu, r, x);
    let xy = b.op(Alu::Xor, x, y);
    let nxy = b.op(Alu::Not, xy, imm(0));
    let xr = b.op(Alu::Xor, x, r);
    let o = b.op(Alu::And, nxy, xr);
    let v = b.op(Alu::Shr, o, imm(31));
    (r, c, v)
}

/// `a - b` with ARM carry (no borrow) and overflow.
fn sub_flags(b: &mut Builder, x: Val, y: Val) -> (Val, Val, Val) {
    let r = b.op(Alu::Sub, x, y);
    let c = b.op(Alu::Leu, y, x);
    let xy = b.op(Alu::Xor, x, y);
    let xr = b.op(Alu::Xor, x, r);
    let o = b.op(Alu::And, xy, xr);
    let v = b.op(Alu::Shr, o, imm(31));
    (r, c, v)
}

/// `a + b + cin` with the interpreter's carry and overflow rules (`alu_adc_flags`).
fn adc_flags(b: &mut Builder, x: Val, y: Val, cin: Val) -> (Val, Val, Val) {
    let s1 = b.op(Alu::Add, x, y);
    let c1 = b.op(Alu::Ltu, s1, x);
    let r = b.op(Alu::Add, s1, cin);
    let c2 = b.op(Alu::Ltu, r, s1);
    let c = b.op(Alu::Or, c1, c2);
    let xy = b.op(Alu::Xor, x, y);
    let nxy = b.op(Alu::Not, xy, imm(0));
    let yr = b.op(Alu::Xor, y, r);
    let o = b.op(Alu::And, nxy, yr);
    let v = b.op(Alu::Shr, o, imm(31));
    (r, c, v)
}

/// Barrel shift by an immediate amount (`immediate = true` rules of the interpreter).
fn shift_imm(b: &mut Builder, op: u32, v: Val, amount: u32, carry: Val) -> (Val, Val) {
    match (op, amount) {
        (0, 0) => (v, carry),
        (0, n) => {
            let c = b.op(Alu::Shr, v, imm(32 - n));
            let c = b.op(Alu::And, c, imm(1));
            (b.op(Alu::Shl, v, imm(n)), c)
        }
        (1, 0) => (imm(0), b.op(Alu::Shr, v, imm(31))),
        (1, n) => {
            let c = b.op(Alu::Shr, v, imm(n - 1));
            let c = b.op(Alu::And, c, imm(1));
            (b.op(Alu::Shr, v, imm(n)), c)
        }
        (2, 0) => (b.op(Alu::Sar, v, imm(31)), b.op(Alu::Shr, v, imm(31))),
        (2, n) => {
            let c = b.op(Alu::Shr, v, imm(n - 1));
            let c = b.op(Alu::And, c, imm(1));
            (b.op(Alu::Sar, v, imm(n)), c)
        }
        (_, 0) => {
            // RRX
            let c = b.op(Alu::And, v, imm(1));
            let lo = b.op(Alu::Shr, v, imm(1));
            let hi = b.op(Alu::Shl, carry, imm(31));
            (b.op(Alu::Or, lo, hi), c)
        }
        (_, n) => {
            let r = b.op(Alu::Ror, v, imm(n));
            (r, b.op(Alu::Shr, r, imm(31)))
        }
    }
}

/// Barrel shift by a register amount (`immediate = false` rules of the interpreter).
fn shift_reg(b: &mut Builder, op: u32, v: Val, amt: Val, carry: Val) -> (Val, Val) {
    let zero = b.op(Alu::Eq, amt, imm(0));
    let (r, c) = match op {
        0 => {
            let r = b.op(Alu::Shl, v, amt);
            let k = b.op(Alu::Sub, imm(32), amt);
            let c = b.op(Alu::Shr, v, k);
            (r, b.op(Alu::And, c, imm(1)))
        }
        1 => {
            let r = b.op(Alu::Shr, v, amt);
            let k = b.op(Alu::Sub, amt, imm(1));
            let c = b.op(Alu::Shr, v, k);
            (r, b.op(Alu::And, c, imm(1)))
        }
        2 => {
            let r = b.op(Alu::Sar, v, amt);
            let k = b.op(Alu::Sub, amt, imm(1));
            let c = b.op(Alu::Sar, v, k);
            (r, b.op(Alu::And, c, imm(1)))
        }
        _ => {
            let r = b.op(Alu::Ror, v, amt);
            (r, b.op(Alu::Shr, r, imm(31)))
        }
    };
    let c = b.sel(zero, carry, c);
    (r, c)
}

fn fallback(raw: u32, text: String, why: &str, next: (u32, Isa)) -> Lowered {
    Lowered {
        g: Guest {
            raw,
            body: vec![Stmt::Fallback { why: why.into() }],
        },
        text,
        flow: Flow {
            targets: vec![next],
            ends: true,
            falls: false,
        },
    }
}

/// Wrap an ARM body: prologue fetch, condition, and the advance of a non-flushing instruction.
fn arm_wrap(pc: u32, w: u32, b: Builder, kind: Option<u32>) -> Guest {
    // `b.out` holds the semantics; `kind` is the advance access (None when the body flushed).
    let mut outer = Builder::new();
    // Reuse the temporaries of the body: shift the outer counter past them.
    let body_temps = Guest {
        raw: 0,
        body: b.out.clone(),
    }
    .temps();
    for _ in 0..body_temps {
        outer.fresh();
    }
    outer.call("arm_begin", &[imm(pc)]);
    let mut body = b.out;
    match kind {
        Some(k) => body.push(Stmt::Call {
            f: "arm_next".into(),
            args: vec![imm(k)],
            t: None,
        }),
        None => body.push(Stmt::Exit),
    }
    let cond = w >> 28;
    match cond_val(&mut outer, cond) {
        None => outer.out.extend(body),
        Some(c) => {
            let els = vec![Stmt::Call {
                f: "arm_next".into(),
                args: vec![imm(NSEQ)],
                t: None,
            }];
            outer.out.push(Stmt::If { c, then: body, els });
        }
    }
    outer.finish(w)
}

fn arm_flow(w: u32, exits: bool, targets: Vec<(u32, Isa)>) -> Flow {
    let always = w >> 28 == 14;
    let never = w >> 28 == 15;
    Flow {
        targets: if never { Vec::new() } else { targets },
        ends: exits && always,
        falls: !(exits && always),
    }
}

/// Constant-register knowledge used to resolve `bx`/`mov pc` targets.
#[derive(Default, Clone)]
struct Consts([Option<u32>; 16]);

#[allow(clippy::too_many_lines)]
fn lower_arm(m: &Mem, pc: u32, w: u32, k: &mut Consts) -> Lowered {
    let cond = w >> 28;
    let cs = CONDS[cond as usize];
    let rn = bits(w, 16, 4);
    let rd = bits(w, 12, 4);
    let rs = bits(w, 8, 4);
    let rm = bits(w, 0, 4);
    let next = (pc.wrapping_add(4), Isa::Arm);
    let r = |n: u32| -> Val {
        if n == 15 {
            imm(pc.wrapping_add(8))
        } else {
            reg(n as u8)
        }
    };
    let fb = |why: &str| fallback(w, format!(".word 0x{w:08x} ; {why}"), why, next);
    let always = cond == 14;
    let mut known = std::mem::take(k);
    // Clear knowledge by default; recognised constant producers restore it below.
    let mut set_known: Option<(u32, Option<u32>)> = None;

    let res = match bits(w, 26, 2) {
        0b00 => {
            let hi = bits(w, 23, 3);
            let mid = bits(w, 4, 4);
            if hi == 0 && mid == 0b1001 && !bit(w, 22) {
                // MUL / MLA
                let acc = bit(w, 21);
                let s = bit(w, 20);
                let (rd, rn) = (rn, rd);
                if [rd, rn, rs, rm].contains(&15) {
                    return fb("mul with r15");
                }
                let mut b = Builder::new();
                let op2 = r(rs);
                let mut res = b.op(Alu::Mul, r(rm), op2);
                if acc {
                    res = b.op(Alu::Add, res, r(rn));
                    b.call("idle", &[]);
                }
                b.set(rd as u8, res);
                b.call("mul_idle", &[op2]);
                if s {
                    nz(&mut b, res);
                    b.set_flag(C, imm(0));
                    b.set_flag(V, imm(0));
                }
                set_known = Some((rd, None));
                let text = if acc {
                    format!(
                        "mla{}{cs} {}, {}, {}, {}",
                        if s { "s" } else { "" },
                        REGS[rd as usize],
                        REGS[rm as usize],
                        REGS[rs as usize],
                        REGS[rn as usize]
                    )
                } else {
                    format!(
                        "mul{}{cs} {}, {}, {}",
                        if s { "s" } else { "" },
                        REGS[rd as usize],
                        REGS[rm as usize],
                        REGS[rs as usize]
                    )
                };
                Lowered {
                    g: arm_wrap(pc, w, b, Some(SEQ)),
                    text,
                    flow: arm_flow(w, false, Vec::new()),
                }
            } else if hi == 1 && mid == 0b1001 {
                // UMULL / SMULL / UMLAL / SMLAL
                let signed = bit(w, 22);
                let acc = bit(w, 21);
                let s = bit(w, 20);
                let (rdhi, rdlo) = (rn, rd);
                if [rdhi, rdlo, rs, rm].contains(&15) {
                    return fb("long multiply with r15");
                }
                let mut b = Builder::new();
                let (x, y) = (r(rm), r(rs));
                let mut lo = b.op(Alu::Mul, x, y);
                let mut hi = b.op(if signed { Alu::MulHiS } else { Alu::MulHiU }, x, y);
                if acc {
                    let lo2 = b.op(Alu::Add, lo, r(rdlo));
                    let carry = b.op(Alu::Ltu, lo2, lo);
                    let hi2 = b.op(Alu::Add, hi, r(rdhi));
                    hi = b.op(Alu::Add, hi2, carry);
                    lo = lo2;
                    b.call("idle", &[]);
                }
                b.set(rdhi as u8, hi);
                b.set(rdlo as u8, lo);
                b.call("idle", &[]);
                b.call("mul_idle", &[r(rs)]);
                if s {
                    let n = b.op(Alu::Shr, hi, imm(31));
                    b.set_flag(N, n);
                    let or = b.op(Alu::Or, hi, lo);
                    let z = b.op(Alu::Eq, or, imm(0));
                    b.set_flag(Z, z);
                    b.set_flag(C, imm(0));
                    b.set_flag(V, imm(0));
                }
                set_known = Some((rdhi, None));
                known.0[rdlo as usize] = None;
                let name = format!(
                    "{}{}l{}",
                    if signed { "s" } else { "u" },
                    if acc { "mla" } else { "mul" },
                    if s { "s" } else { "" }
                );
                let text = format!(
                    "{name}{cs} {}, {}, {}, {}",
                    REGS[rdlo as usize], REGS[rdhi as usize], REGS[rm as usize], REGS[rs as usize]
                );
                Lowered {
                    g: arm_wrap(pc, w, b, Some(SEQ)),
                    text,
                    flow: arm_flow(w, false, Vec::new()),
                }
            } else if hi == 2 && mid == 0b1001 && bits(w, 20, 2) == 0 {
                return fb("swp");
            } else if hi == 2 && mid == 0b0001 && bits(w, 20, 3) == 0b010 {
                // BX
                let mut b = Builder::new();
                let target = known.0[rm as usize].or(if rm == 15 {
                    Some(pc.wrapping_add(8))
                } else {
                    None
                });
                b.call("branch_exchange", &[r(rm)]);
                let targets = target
                    .map(|t| vec![(t & !1, if t & 1 == 1 { Isa::Thumb } else { Isa::Arm })])
                    .unwrap_or_default();
                let text = format!("bx{cs} {}", REGS[rm as usize]);
                Lowered {
                    g: arm_wrap(pc, w, b, None),
                    text,
                    flow: arm_flow(w, true, targets),
                }
            } else if !bit(w, 25) && bit(w, 7) && bit(w, 4) {
                // Halfword / signed transfers
                let hs = bits(w, 5, 2);
                let load = bit(w, 20);
                let wb = bit(w, 21);
                let add = bit(w, 23);
                let pre = bit(w, 24);
                if hs == 0 {
                    return fb("halfword transfer with sh=0");
                }
                if !pre && wb {
                    return fb("post-indexed transfer with writeback (user bank)");
                }
                if rn == 15 && (wb || !pre) {
                    return fb("pc-relative transfer with writeback");
                }
                if load && rd == 15 && rn == 15 {
                    return fb("pc load with pc base");
                }
                let mut b = Builder::new();
                let off = if bit(w, 22) {
                    imm((bits(w, 8, 4) << 4) + bits(w, 0, 4))
                } else {
                    r(rm)
                };
                let off = if add {
                    off
                } else {
                    b.op(Alu::Sub, imm(0), off)
                };
                let base = r(rn);
                let eff = b.op(Alu::Add, base, off);
                let addr = if pre { eff } else { base };
                let mut flushed = false;
                if load {
                    let data = match hs {
                        1 => b.call_v("ldr_half", &[addr, imm(NSEQ)]),
                        2 => {
                            let v = b.load(8, addr, NSEQ as u8);
                            b.op(Alu::Sext8, v, imm(0))
                        }
                        _ => b.call_v("ldr_sign_half", &[addr, imm(NSEQ)]),
                    };
                    if rd == 15 {
                        let t = b.op(Alu::And, data, imm(!3));
                        b.call("idle", &[]);
                        b.call("reload32", &[t]);
                        flushed = true;
                    } else {
                        b.set(rd as u8, data);
                        b.call("idle", &[]);
                    }
                } else {
                    let value = if rd == 15 {
                        imm(pc.wrapping_add(12))
                    } else {
                        r(rd)
                    };
                    match hs {
                        2 => b.store(8, addr, value, NSEQ as u8),
                        _ => b.store(16, addr, value, NSEQ as u8),
                    }
                }
                if (!load || rn != rd) && (!pre || wb) {
                    b.set(rn as u8, eff);
                    known.0[rn as usize] = None;
                }
                if load {
                    set_known = Some((rd, None));
                }
                let mn = match (load, hs) {
                    (true, 1) => "ldrh",
                    (true, 2) => "ldrsb",
                    (true, _) => "ldrsh",
                    (false, 2) => "strsb",
                    (false, _) => "strh",
                };
                let text = format!(
                    "{mn}{cs} {}, [{}{}]",
                    REGS[rd as usize],
                    REGS[rn as usize],
                    if pre { "" } else { "], ..." }
                );
                let exits = flushed;
                Lowered {
                    g: arm_wrap(pc, w, b, if flushed { None } else { Some(NSEQ) }),
                    text,
                    flow: arm_flow(w, exits, Vec::new()),
                }
            } else {
                let s = bit(w, 20);
                let opc = bits(w, 21, 4);
                if !s && opc & 0b1100 == 0b1000 {
                    return fb(if bit(w, 21) { "msr" } else { "mrs" });
                }
                // Data processing
                let imm_op = bit(w, 25);
                let by_reg = !imm_op && bit(w, 4);
                if rd == 15 && s {
                    return fb("data processing to pc with spsr restore");
                }
                let mut b = Builder::new();
                let mut op1 = if rn == 15 {
                    imm(pc.wrapping_add(8))
                } else {
                    reg(rn as u8)
                };
                let carry_in = flag(C);
                let (op2, shc) = if imm_op {
                    let v = bits(w, 0, 8);
                    let rot = 2 * bits(w, 8, 4);
                    if rot == 0 {
                        (imm(v), carry_in)
                    } else {
                        (imm(v.rotate_right(rot)), imm(v.rotate_right(rot) >> 31))
                    }
                } else if by_reg {
                    if rn == 15 {
                        op1 = imm(pc.wrapping_add(12));
                    }
                    b.call("idle", &[]);
                    let v = if rm == 15 {
                        imm(pc.wrapping_add(12))
                    } else {
                        reg(rm as u8)
                    };
                    let amt = b.op(Alu::And, r(rs), imm(0xff));
                    shift_reg(&mut b, bits(w, 5, 2), v, amt, carry_in)
                } else {
                    shift_imm(&mut b, bits(w, 5, 2), r(rm), bits(w, 7, 5), carry_in)
                };
                let logical = matches!(opc, 0 | 1 | 8 | 9 | 12 | 13 | 14 | 15);
                let result = if s {
                    let (res, c, v) = match opc {
                        0 | 8 => (b.op(Alu::And, op1, op2), shc, None),
                        1 | 9 => (b.op(Alu::Xor, op1, op2), shc, None),
                        2 | 10 => {
                            let (x, c, v) = sub_flags(&mut b, op1, op2);
                            (x, c, Some(v))
                        }
                        3 => {
                            let (x, c, v) = sub_flags(&mut b, op2, op1);
                            (x, c, Some(v))
                        }
                        4 | 11 => {
                            let (x, c, v) = add_flags(&mut b, op1, op2);
                            (x, c, Some(v))
                        }
                        5 => {
                            let (x, c, v) = adc_flags(&mut b, op1, op2, flag(C));
                            (x, c, Some(v))
                        }
                        6 => {
                            let n2 = b.op(Alu::Not, op2, imm(0));
                            let (x, c, v) = adc_flags(&mut b, op1, n2, flag(C));
                            (x, c, Some(v))
                        }
                        7 => {
                            let n1 = b.op(Alu::Not, op1, imm(0));
                            let (x, c, v) = adc_flags(&mut b, op2, n1, flag(C));
                            (x, c, Some(v))
                        }
                        12 => (b.op(Alu::Or, op1, op2), shc, None),
                        13 => (op2, shc, None),
                        14 => {
                            let n2 = b.op(Alu::Not, op2, imm(0));
                            (b.op(Alu::And, op1, n2), shc, None)
                        }
                        _ => (b.op(Alu::Not, op2, imm(0)), shc, None),
                    };
                    // Materialise the flag inputs before any flag is written.
                    let c = if matches!(c, Val::Flag { .. }) { c } else { c };
                    nz(&mut b, res);
                    if c != flag(C) {
                        b.set_flag(C, c);
                    }
                    if let Some(v) = v {
                        b.set_flag(V, v);
                    }
                    let _ = logical;
                    if matches!(opc, 8..=11) {
                        None
                    } else {
                        Some(res)
                    }
                } else {
                    // Non-flag-setting forms use the shifter carry as the carry input, as the
                    // interpreter does.
                    let c = shc;
                    Some(match opc {
                        0 => b.op(Alu::And, op1, op2),
                        1 => b.op(Alu::Xor, op1, op2),
                        2 => b.op(Alu::Sub, op1, op2),
                        3 => b.op(Alu::Sub, op2, op1),
                        4 => b.op(Alu::Add, op1, op2),
                        5 => {
                            let t = b.op(Alu::Add, op1, op2);
                            b.op(Alu::Add, t, c)
                        }
                        6 => {
                            let nc = b.op(Alu::Sub, imm(1), c);
                            let t = b.op(Alu::Add, op2, nc);
                            b.op(Alu::Sub, op1, t)
                        }
                        7 => {
                            let nc = b.op(Alu::Sub, imm(1), c);
                            let t = b.op(Alu::Add, op1, nc);
                            b.op(Alu::Sub, op2, t)
                        }
                        12 => b.op(Alu::Or, op1, op2),
                        13 => op2,
                        14 => {
                            let n2 = b.op(Alu::Not, op2, imm(0));
                            b.op(Alu::And, op1, n2)
                        }
                        _ => b.op(Alu::Not, op2, imm(0)),
                    })
                };
                let mut flushed = false;
                let mut targets = Vec::new();
                if let Some(res) = result {
                    if rd == 15 {
                        let t = b.op(Alu::And, res, imm(!3));
                        b.call("reload32", &[t]);
                        flushed = true;
                        if let Val::Imm { v } = t {
                            targets.push((v, Isa::Arm));
                        }
                    } else {
                        b.set(rd as u8, res);
                        // Constant tracking: mov/add/sub with constant operands.
                        let kv = |v: Val, kn: &Consts| match v {
                            Val::Imm { v } => Some(v),
                            Val::Reg { r } => kn.0[r as usize],
                            _ => None,
                        };
                        let value = match (opc, imm_op) {
                            (13, true) => kv(op2, &known),
                            (15, true) => kv(op2, &known).map(|v| !v),
                            (4, true) => kv(op1, &known)
                                .zip(kv(op2, &known))
                                .map(|(a, c)| a.wrapping_add(c)),
                            (2, true) => kv(op1, &known)
                                .zip(kv(op2, &known))
                                .map(|(a, c)| a.wrapping_sub(c)),
                            (12, true) => kv(op1, &known).zip(kv(op2, &known)).map(|(a, c)| a | c),
                            _ => None,
                        };
                        set_known = Some((rd, value));
                    }
                }
                const OPS: [&str; 16] = [
                    "and", "eor", "sub", "rsb", "add", "adc", "sbc", "rsc", "tst", "teq", "cmp",
                    "cmn", "orr", "mov", "bic", "mvn",
                ];
                const SHIFTS: [&str; 4] = ["lsl", "lsr", "asr", "ror"];
                let op2_text = if imm_op {
                    format!("#0x{:x}", bits(w, 0, 8).rotate_right(2 * bits(w, 8, 4)))
                } else if by_reg {
                    format!(
                        "{}, {} {}",
                        REGS[rm as usize],
                        SHIFTS[bits(w, 5, 2) as usize],
                        REGS[rs as usize]
                    )
                } else if bits(w, 5, 7) == 0 {
                    REGS[rm as usize].to_string()
                } else if bits(w, 5, 2) == 3 && bits(w, 7, 5) == 0 {
                    format!("{}, rrx", REGS[rm as usize])
                } else {
                    format!(
                        "{}, {} #{}",
                        REGS[rm as usize],
                        SHIFTS[bits(w, 5, 2) as usize],
                        bits(w, 7, 5)
                    )
                };
                let mn = format!(
                    "{}{cs}{}",
                    OPS[opc as usize],
                    if s && !matches!(opc, 8..=11) { "s" } else { "" }
                );
                let text = match opc {
                    13 | 15 => format!("{mn} {}, {op2_text}", REGS[rd as usize]),
                    8..=11 => format!("{mn} {}, {op2_text}", REGS[rn as usize]),
                    _ => format!(
                        "{mn} {}, {}, {op2_text}",
                        REGS[rd as usize], REGS[rn as usize]
                    ),
                };
                Lowered {
                    g: arm_wrap(pc, w, b, if flushed { None } else { Some(SEQ) }),
                    text,
                    flow: arm_flow(w, flushed, targets),
                }
            }
        }
        0b01 => {
            if bit(w, 25) && bit(w, 4) {
                return fb("undefined");
            }
            let load = bit(w, 20);
            let wb = bit(w, 21);
            let byte = bit(w, 22);
            let add = bit(w, 23);
            let pre = bit(w, 24);
            if !pre && wb {
                return fb("ldrt/strt (user bank)");
            }
            if rn == 15 && (wb || !pre) {
                return fb("pc-relative transfer with writeback");
            }
            if load && rd == 15 && rn == 15 {
                return fb("pc load with pc base");
            }
            let mut b = Builder::new();
            let base = if rn == 15 {
                imm(pc.wrapping_add(8))
            } else {
                reg(rn as u8)
            };
            let off = if bit(w, 25) {
                let (v, _) = shift_imm(&mut b, bits(w, 5, 2), r(rm), bits(w, 7, 5), flag(C));
                v
            } else {
                imm(bits(w, 0, 12))
            };
            let off = if add {
                off
            } else {
                b.op(Alu::Sub, imm(0), off)
            };
            let eff = b.op(Alu::Add, base, off);
            let addr = if pre { eff } else { base };
            let mut flushed = false;
            let mut targets = Vec::new();
            if load {
                let data = if byte {
                    b.load(8, addr, NSEQ as u8)
                } else {
                    b.call_v("ldr_word", &[addr, imm(NSEQ)])
                };
                // Literal pool loads feed the constant tracker.
                let lit = match addr {
                    Val::Imm { v } if !byte && v & 3 == 0 => m.u32(v),
                    _ => None,
                };
                if rd == 15 {
                    let t = b.op(Alu::And, data, imm(!3));
                    b.call("idle", &[]);
                    b.call("reload32", &[t]);
                    flushed = true;
                    if let Some(l) = lit {
                        targets.push((l & !3, Isa::Arm));
                    }
                } else {
                    b.set(rd as u8, data);
                    b.call("idle", &[]);
                    set_known = Some((rd, lit));
                }
            } else {
                let value = if rd == 15 {
                    imm(pc.wrapping_add(12))
                } else {
                    reg(rd as u8)
                };
                if byte {
                    b.store(8, addr, value, NSEQ as u8);
                } else {
                    let a = b.op(Alu::And, addr, imm(!3));
                    b.store(32, a, value, NSEQ as u8);
                }
            }
            if (!load || rn != rd) && (!pre || wb) {
                b.set(rn as u8, eff);
                known.0[rn as usize] = None;
            }
            let text = format!(
                "{}{}{cs} {}, [{}, ...]",
                if load { "ldr" } else { "str" },
                if byte { "b" } else { "" },
                REGS[rd as usize],
                REGS[rn as usize]
            );
            Lowered {
                g: arm_wrap(pc, w, b, if flushed { None } else { Some(NSEQ) }),
                text,
                flow: arm_flow(w, flushed, targets),
            }
        }
        0b10 => {
            if bit(w, 25) {
                // B / BL
                let off = ((w << 8) as i32 >> 6) as u32;
                let target = pc.wrapping_add(8).wrapping_add(off) & !1;
                let link = bit(w, 24);
                let mut b = Builder::new();
                if link {
                    b.set(14, imm(pc.wrapping_add(4)));
                }
                b.call("reload32", &[imm(target)]);
                let mut targets = vec![(target, Isa::Arm)];
                if link {
                    targets.push((pc.wrapping_add(4), Isa::Arm));
                    set_known = Some((14, Some(pc.wrapping_add(4))));
                }
                let text = format!("b{}{cs} 0x{target:08x}", if link { "l" } else { "" });
                Lowered {
                    g: arm_wrap(pc, w, b, None),
                    text,
                    flow: arm_flow(w, true, targets),
                }
            } else {
                lower_block_transfer(pc, w, &mut known, &mut set_known)
                    .unwrap_or_else(|why| fb(why))
            }
        }
        _ => {
            if bit(w, 25) && bit(w, 24) {
                return fb("swi");
            }
            return fb("coprocessor");
        }
    };
    if !always {
        // A conditional instruction may or may not have executed: forget what it wrote.
        if let Some((r, _)) = set_known {
            known.0[r as usize] = None;
        }
    } else if let Some((r, v)) = set_known {
        known.0[r as usize] = v;
    }
    if res.flow.ends {
        known = Consts::default();
    }
    *k = known;
    res
}

/// LDM / STM without the S bit.
fn lower_block_transfer(
    pc: u32,
    w: u32,
    known: &mut Consts,
    _set: &mut Option<(u32, Option<u32>)>,
) -> Result<Lowered, &'static str> {
    let load = bit(w, 20);
    let wbit = bit(w, 21);
    let sbit = bit(w, 22);
    let ascending = bit(w, 23);
    let pre = bit(w, 24);
    let rn = bits(w, 16, 4);
    let rlist = w & 0xffff;
    if sbit {
        return Err("ldm/stm with user bank or spsr transfer");
    }
    if rn == 15 {
        return Err("ldm/stm with pc base");
    }
    let cs = CONDS[(w >> 28) as usize];
    let mut b = Builder::new();
    let count = rlist.count_ones();
    let mut full = pre;
    let mut writeback = wbit;
    // The interpreter captures the base before any writeback.
    let old_base = b.op(Alu::Or, reg(rn as u8), imm(0));
    let mut base_addr = old_base;
    if rlist != 0 && !ascending {
        base_addr = b.op(Alu::Sub, old_base, imm(count * 4));
        if writeback {
            b.set(rn as u8, base_addr);
            writeback = false;
        }
        full = !full;
    }
    let mut addr = base_addr;
    let mut flushed = false;
    if rlist != 0 {
        if load {
            let mut access = NSEQ;
            for r in 0..16 {
                if rlist & (1 << r) == 0 {
                    continue;
                }
                if r == rn {
                    writeback = false;
                }
                if full {
                    addr = b.op(Alu::Add, addr, imm(4));
                }
                let val = b.load(32, addr, access as u8);
                access = SEQ;
                if r == 15 {
                    let t = b.op(Alu::And, val, imm(!3));
                    b.call("reload32", &[t]);
                    flushed = true;
                } else {
                    b.set(r as u8, val);
                    known.0[r as usize] = None;
                }
                if !full {
                    addr = b.op(Alu::Add, addr, imm(4));
                }
            }
            b.call("idle", &[]);
        } else {
            let mut first = true;
            let mut access = NSEQ;
            for r in 0..16 {
                if rlist & (1 << r) == 0 {
                    continue;
                }
                let val = if r != rn {
                    if r == 15 {
                        imm(pc.wrapping_add(12))
                    } else {
                        reg(r as u8)
                    }
                } else if first {
                    old_base
                } else if ascending {
                    b.op(Alu::Add, old_base, imm(count * 4))
                } else {
                    b.op(Alu::Sub, old_base, imm(count * 4))
                };
                if full {
                    addr = b.op(Alu::Add, addr, imm(4));
                }
                first = false;
                let a = b.op(Alu::And, addr, imm(!3));
                b.store(32, a, val, access as u8);
                access = SEQ;
                if !full {
                    addr = b.op(Alu::Add, addr, imm(4));
                }
            }
        }
    } else {
        if load {
            let val = b.call_v("ldr_word", &[addr, imm(NSEQ)]);
            let t = b.op(Alu::And, val, imm(!3));
            b.call("reload32", &[t]);
            flushed = true;
        } else {
            let a = match (ascending, full) {
                (false, false) => b.op(Alu::Sub, addr, imm(0x3c)),
                (false, true) => b.op(Alu::Sub, addr, imm(0x40)),
                (true, false) => addr,
                (true, true) => b.op(Alu::Add, addr, imm(4)),
            };
            let a = b.op(Alu::And, a, imm(!3));
            b.store(32, a, imm(pc.wrapping_add(12)), NSEQ as u8);
        }
        addr = if ascending {
            b.op(Alu::Add, addr, imm(0x40))
        } else {
            b.op(Alu::Sub, addr, imm(0x40))
        };
    }
    if writeback {
        b.set(rn as u8, addr);
    }
    known.0[rn as usize] = None;
    let text = format!(
        "{}{}{}{cs} {}{}, {{0x{rlist:04x}}}",
        if load { "ldm" } else { "stm" },
        if ascending { "i" } else { "d" },
        if pre { "b" } else { "a" },
        REGS[rn as usize],
        if wbit { "!" } else { "" }
    );
    Ok(Lowered {
        g: arm_wrap(pc, w, b, if flushed { None } else { Some(NSEQ) }),
        text,
        flow: arm_flow(w, flushed, Vec::new()),
    })
}

/// Wrap a Thumb body with its prologue fetch and advance.
fn thumb_wrap(pc: u32, h: u16, b: Builder, kind: Option<u32>) -> Guest {
    let mut out = vec![Stmt::Call {
        f: "thumb_begin".into(),
        args: vec![imm(pc)],
        t: None,
    }];
    out.extend(b.out);
    match kind {
        Some(k) => out.push(Stmt::Call {
            f: "thumb_next".into(),
            args: vec![imm(k)],
            t: None,
        }),
        None => out.push(Stmt::Exit),
    }
    Guest {
        raw: u32::from(h),
        body: out,
    }
}

fn tflow(exits: bool, conditional: bool, targets: Vec<(u32, Isa)>) -> Flow {
    Flow {
        targets,
        ends: exits && !conditional,
        falls: !exits || conditional,
    }
}

#[allow(clippy::too_many_lines)]
fn lower_thumb(m: &Mem, pc: u32, h: u16, prev: Option<u16>, k: &mut Consts) -> Lowered {
    let i = u32::from(h);
    let rd = i & 7;
    let rs = (i >> 3) & 7;
    let next = (pc.wrapping_add(2), Isa::Thumb);
    let fb = |why: &str| fallback(i, format!(".hword 0x{h:04x} ; {why}"), why, next);
    let pcv = pc.wrapping_add(4);
    let mut b = Builder::new();
    let mut kind = Some(SEQ);
    let mut flow = tflow(false, false, Vec::new());
    let mut known = std::mem::take(k);
    let mut kset: Option<(u32, Option<u32>)> = None;
    let r = |n: u32| -> Val { if n == 15 { imm(pcv) } else { reg(n as u8) } };
    let text;
    if i & 0xf800 == 0x1800 {
        // Format 2: add/sub
        let sub = bit(i, 9);
        let immf = bit(i, 10);
        let rn = (i >> 6) & 7;
        let op2 = if immf { imm(rn) } else { reg(rn as u8) };
        let (res, c, v) = if sub {
            sub_flags(&mut b, reg(rs as u8), op2)
        } else {
            add_flags(&mut b, reg(rs as u8), op2)
        };
        nz(&mut b, res);
        b.set_flag(C, c);
        b.set_flag(V, v);
        b.set(rd as u8, res);
        kset = Some((rd, None));
        text = format!(
            "{} {}, {}, {}{}",
            if sub { "subs" } else { "adds" },
            REGS[rd as usize],
            REGS[rs as usize],
            if immf { "#" } else { "r" },
            rn
        );
    } else if i & 0xe000 == 0x0000 {
        // Format 1: move shifted register
        let op = (i >> 11) & 3;
        let amount = (i >> 6) & 31;
        let (res, c) = shift_imm(&mut b, op, reg(rs as u8), amount, flag(C));
        b.set(rd as u8, res);
        nz(&mut b, res);
        if c != flag(C) {
            b.set_flag(C, c);
        }
        kset = Some((rd, None));
        text = format!(
            "{} {}, {}, #{amount}",
            ["lsls", "lsrs", "asrs", "rors"][op as usize],
            REGS[rd as usize],
            REGS[rs as usize]
        );
    } else if i & 0xe000 == 0x2000 {
        // Format 3: mov/cmp/add/sub immediate
        let op = (i >> 11) & 3;
        let rd = (i >> 8) & 7;
        let v8 = i & 0xff;
        match op {
            0 => {
                b.set(rd as u8, imm(v8));
                b.set_flag(N, imm(0));
                b.set_flag(Z, imm(u32::from(v8 == 0)));
                kset = Some((rd, Some(v8)));
            }
            1 => {
                let (res, c, v) = sub_flags(&mut b, reg(rd as u8), imm(v8));
                nz(&mut b, res);
                b.set_flag(C, c);
                b.set_flag(V, v);
            }
            2 | 3 => {
                let (res, c, v) = if op == 2 {
                    add_flags(&mut b, reg(rd as u8), imm(v8))
                } else {
                    sub_flags(&mut b, reg(rd as u8), imm(v8))
                };
                nz(&mut b, res);
                b.set_flag(C, c);
                b.set_flag(V, v);
                b.set(rd as u8, res);
                let kv = known.0[rd as usize].map(|x| {
                    if op == 2 {
                        x.wrapping_add(v8)
                    } else {
                        x.wrapping_sub(v8)
                    }
                });
                kset = Some((rd, kv));
            }
            _ => unreachable!(),
        }
        text = format!(
            "{} {}, #{v8}",
            ["movs", "cmp", "adds", "subs"][op as usize],
            REGS[rd as usize]
        );
    } else if i & 0xfc00 == 0x4000 {
        // Format 4: ALU operations
        let op = (i >> 6) & 15;
        let dst = reg(rd as u8);
        let src = reg(rs as u8);
        let mut v_out: Option<Val> = None;
        let mut c_out: Option<Val> = None;
        let res = match op {
            0 | 8 => b.op(Alu::And, dst, src),
            1 => b.op(Alu::Xor, dst, src),
            2..=4 | 7 => {
                let amt = b.op(Alu::And, src, imm(0xff));
                let (res, c) = shift_reg(
                    &mut b,
                    match op {
                        2 => 0,
                        3 => 1,
                        4 => 2,
                        _ => 3,
                    },
                    dst,
                    amt,
                    flag(C),
                );
                b.call("idle", &[]);
                c_out = Some(c);
                res
            }
            5 => {
                let (res, c, v) = adc_flags(&mut b, dst, src, flag(C));
                c_out = Some(c);
                v_out = Some(v);
                res
            }
            6 => {
                let ns = b.op(Alu::Not, src, imm(0));
                let (res, c, v) = adc_flags(&mut b, dst, ns, flag(C));
                c_out = Some(c);
                v_out = Some(v);
                res
            }
            9 | 10 | 11 => {
                let (res, c, v) = match op {
                    9 => sub_flags(&mut b, imm(0), src),
                    10 => sub_flags(&mut b, dst, src),
                    _ => add_flags(&mut b, dst, src),
                };
                c_out = Some(c);
                v_out = Some(v);
                res
            }
            12 => b.op(Alu::Or, dst, src),
            13 => {
                b.call("mul_idle", &[src]);
                c_out = Some(imm(0));
                v_out = Some(imm(0));
                b.op(Alu::Mul, dst, src)
            }
            14 => {
                let ns = b.op(Alu::Not, src, imm(0));
                b.op(Alu::And, dst, ns)
            }
            _ => b.op(Alu::Not, src, imm(0)),
        };
        nz(&mut b, res);
        if let Some(c) = c_out {
            b.set_flag(C, c);
        }
        if let Some(v) = v_out {
            b.set_flag(V, v);
        }
        if !matches!(op, 8 | 10 | 11) {
            b.set(rd as u8, res);
            kset = Some((rd, None));
        }
        const OPS: [&str; 16] = [
            "ands", "eors", "lsls", "lsrs", "asrs", "adcs", "sbcs", "rors", "tst", "negs", "cmp",
            "cmn", "orrs", "muls", "bics", "mvns",
        ];
        text = format!(
            "{} {}, {}",
            OPS[op as usize], REGS[rd as usize], REGS[rs as usize]
        );
    } else if i & 0xfc00 == 0x4400 {
        // Format 5: hi-register operations / bx
        let op = (i >> 8) & 3;
        let dreg = if bit(i, 7) { rd + 8 } else { rd };
        let sreg = if bit(i, 6) { rs + 8 } else { rs };
        let op1 = r(dreg);
        let op2 = r(sreg);
        match op {
            3 => {
                b.call("branch_exchange", &[op2]);
                kind = None;
                let t = if sreg == 15 {
                    Some(pcv)
                } else {
                    known.0[sreg as usize]
                };
                flow = tflow(
                    true,
                    false,
                    t.map(|t| vec![(t & !1, if t & 1 == 1 { Isa::Thumb } else { Isa::Arm })])
                        .unwrap_or_default(),
                );
                text = format!("bx {}", REGS[sreg as usize]);
            }
            0 | 2 => {
                let res = if op == 0 {
                    b.op(Alu::Add, op1, op2)
                } else {
                    op2
                };
                if dreg == 15 {
                    let t = b.op(Alu::And, res, imm(!1));
                    b.call("reload16", &[t]);
                    kind = None;
                    let targets = if let Val::Imm { v } = t {
                        vec![(v, Isa::Thumb)]
                    } else {
                        Vec::new()
                    };
                    flow = tflow(true, false, targets);
                } else {
                    b.set(dreg as u8, res);
                    let kv = if op == 2 {
                        if sreg == 15 {
                            Some(pcv)
                        } else {
                            known.0[sreg as usize]
                        }
                    } else {
                        None
                    };
                    kset = Some((dreg, kv));
                }
                text = format!(
                    "{} {}, {}",
                    if op == 0 { "add" } else { "mov" },
                    REGS[dreg as usize],
                    REGS[sreg as usize]
                );
            }
            _ => {
                let (res, c, v) = sub_flags(&mut b, op1, op2);
                nz(&mut b, res);
                b.set_flag(C, c);
                b.set_flag(V, v);
                text = format!("cmp {}, {}", REGS[dreg as usize], REGS[sreg as usize]);
            }
        }
    } else if i & 0xf800 == 0x4800 {
        // Format 6: pc-relative load
        let rd = (i >> 8) & 7;
        let addr = (pcv & !3).wrapping_add((i & 0xff) << 2);
        let v = b.load(32, imm(addr), NSEQ as u8);
        b.set(rd as u8, v);
        b.call("idle", &[]);
        kind = Some(NSEQ);
        kset = Some((rd, m.u32(addr)));
        text = format!(
            "ldr {}, [pc, #0x{:x}] ; 0x{addr:08x}",
            REGS[rd as usize],
            (i & 0xff) << 2
        );
    } else if i & 0xf000 == 0x5000 {
        let ro = (i >> 6) & 7;
        let addr = b.op(Alu::Add, reg(rs as u8), reg(ro as u8));
        if i & 0x0200 == 0 {
            // Format 7: load/store with register offset
            let load = bit(i, 11);
            let byte = bit(i, 10);
            thumb_ldr_str(&mut b, load, byte, rd, addr, &mut kind, &mut kset);
            text = format!(
                "{}{} {}, [{}, {}]",
                if load { "ldr" } else { "str" },
                if byte { "b" } else { "" },
                REGS[rd as usize],
                REGS[rs as usize],
                REGS[ro as usize]
            );
        } else {
            // Format 8: sign-extended byte/halfword
            let sign = bit(i, 10);
            let half = bit(i, 11);
            match (sign, half) {
                (false, false) => b.store(16, addr, reg(rd as u8), NSEQ as u8),
                (false, true) => {
                    let v = b.call_v("ldr_half", &[addr, imm(NSEQ)]);
                    b.set(rd as u8, v);
                    b.call("idle", &[]);
                    kset = Some((rd, None));
                }
                (true, false) => {
                    let v = b.load(8, addr, NSEQ as u8);
                    let v = b.op(Alu::Sext8, v, imm(0));
                    b.set(rd as u8, v);
                    b.call("idle", &[]);
                    kset = Some((rd, None));
                }
                (true, true) => {
                    let v = b.call_v("ldr_sign_half", &[addr, imm(NSEQ)]);
                    b.set(rd as u8, v);
                    b.call("idle", &[]);
                    kset = Some((rd, None));
                }
            }
            kind = Some(NSEQ);
            text = format!(
                "{} {}, [{}, {}]",
                ["strh", "ldrh", "ldrsb", "ldrsh"][usize::from(sign) * 2 + usize::from(half)],
                REGS[rd as usize],
                REGS[rs as usize],
                REGS[ro as usize]
            );
        }
    } else if i & 0xe000 == 0x6000 {
        // Format 9: load/store with immediate offset
        let load = bit(i, 11);
        let byte = bit(i, 12);
        let off5 = (i >> 6) & 31;
        let off = if byte { off5 } else { off5 << 2 };
        let addr = b.op(Alu::Add, reg(rs as u8), imm(off));
        thumb_ldr_str(&mut b, load, byte, rd, addr, &mut kind, &mut kset);
        text = format!(
            "{}{} {}, [{}, #0x{off:x}]",
            if load { "ldr" } else { "str" },
            if byte { "b" } else { "" },
            REGS[rd as usize],
            REGS[rs as usize]
        );
    } else if i & 0xf000 == 0x8000 {
        // Format 10: halfword with immediate offset
        let load = bit(i, 11);
        let off = ((i >> 6) & 31) << 1;
        let addr = b.op(Alu::Add, reg(rs as u8), imm(off));
        if load {
            let v = b.call_v("ldr_half", &[addr, imm(NSEQ)]);
            b.call("idle", &[]);
            b.set(rd as u8, v);
            kset = Some((rd, None));
        } else {
            b.store(16, addr, reg(rd as u8), NSEQ as u8);
            kind = Some(NSEQ);
        }
        text = format!(
            "{} {}, [{}, #0x{off:x}]",
            if load { "ldrh" } else { "strh" },
            REGS[rd as usize],
            REGS[rs as usize]
        );
    } else if i & 0xf000 == 0x9000 {
        // Format 11: sp-relative load/store
        let load = bit(i, 11);
        let rd = (i >> 8) & 7;
        let addr = b.op(Alu::Add, reg(13), imm((i & 0xff) << 2));
        if load {
            let v = b.call_v("ldr_word", &[addr, imm(NSEQ)]);
            b.call("idle", &[]);
            b.set(rd as u8, v);
            kset = Some((rd, None));
        } else {
            let a = b.op(Alu::And, addr, imm(!3));
            b.store(32, a, reg(rd as u8), NSEQ as u8);
            kind = Some(NSEQ);
        }
        text = format!(
            "{} {}, [sp, #0x{:x}]",
            if load { "ldr" } else { "str" },
            REGS[rd as usize],
            (i & 0xff) << 2
        );
    } else if i & 0xf000 == 0xa000 {
        // Format 12: load address
        let sp = bit(i, 11);
        let rd = (i >> 8) & 7;
        let off = (i & 0xff) << 2;
        if sp {
            let v = b.op(Alu::Add, reg(13), imm(off));
            b.set(rd as u8, v);
            kset = Some((rd, None));
        } else {
            let v = (pc & !2).wrapping_add(4).wrapping_add(off);
            b.set(rd as u8, imm(v));
            kset = Some((rd, Some(v)));
        }
        text = format!(
            "add {}, {}, #0x{off:x}",
            REGS[rd as usize],
            if sp { "sp" } else { "pc" }
        );
    } else if i & 0xff00 == 0xb000 {
        // Format 13: add offset to sp
        let off = (i & 0x7f) << 2;
        let v = if bit(i, 7) {
            b.op(Alu::Sub, reg(13), imm(off))
        } else {
            b.op(Alu::Add, reg(13), imm(off))
        };
        b.set(13, v);
        text = format!("add sp, #{}0x{off:x}", if bit(i, 7) { "-" } else { "" });
    } else if i & 0xf600 == 0xb400 {
        // Format 14: push/pop
        let pop = bit(i, 11);
        let rbit = bit(i, 8);
        let rlist = i & 0xff;
        let mut access = NSEQ;
        kind = Some(NSEQ);
        if pop {
            for r in 0..8 {
                if rlist & (1 << r) != 0 {
                    let a = b.op(Alu::And, reg(13), imm(!3));
                    let v = b.load(32, a, access as u8);
                    access = SEQ;
                    b.set(r as u8, v);
                    known.0[r as usize] = None;
                    let sp = b.op(Alu::Add, reg(13), imm(4));
                    b.set(13, sp);
                }
            }
            if rbit {
                let a = b.op(Alu::And, reg(13), imm(!3));
                let v = b.load(32, a, SEQ as u8);
                let sp = b.op(Alu::Add, reg(13), imm(4));
                b.set(13, sp);
                let t = b.op(Alu::And, v, imm(!1));
                b.call("reload16", &[t]);
                kind = None;
                flow = tflow(true, false, Vec::new());
            }
            b.call("idle", &[]);
        } else {
            let push = |b: &mut Builder, r: u8, access: &mut u32| {
                let sp = b.op(Alu::Sub, reg(13), imm(4));
                b.set(13, sp);
                let a = b.op(Alu::And, sp, imm(!3));
                b.store(32, a, reg(r), *access as u8);
                *access = SEQ;
            };
            if rbit {
                push(&mut b, 14, &mut access);
            }
            for r in (0..8).rev() {
                if rlist & (1 << r) != 0 {
                    push(&mut b, r, &mut access);
                }
            }
        }
        text = format!(
            "{} {{0x{rlist:02x}{}}}",
            if pop { "pop" } else { "push" },
            if rbit {
                if pop { ",pc" } else { ",lr" }
            } else {
                ""
            }
        );
    } else if i & 0xf000 == 0xc000 {
        // Format 15: ldmia/stmia
        let load = bit(i, 11);
        let rb = (i >> 8) & 7;
        let rlist = i & 0xff;
        let align = b.op(Alu::And, reg(rb as u8), imm(3));
        let mut addr = b.op(Alu::And, reg(rb as u8), imm(!3));
        kind = Some(NSEQ);
        if rlist != 0 {
            if load {
                let mut access = NSEQ;
                for r in 0..8 {
                    if rlist & (1 << r) != 0 {
                        let v = b.load(32, addr, access as u8);
                        access = SEQ;
                        addr = b.op(Alu::Add, addr, imm(4));
                        b.set(r as u8, v);
                        known.0[r as usize] = None;
                    }
                }
                b.call("idle", &[]);
                if rlist & (1 << rb) == 0 {
                    let v = b.op(Alu::Add, addr, align);
                    b.set(rb as u8, v);
                }
            } else {
                let mut first = true;
                let mut access = NSEQ;
                let count = rlist.count_ones();
                for r in 0..8 {
                    if rlist & (1 << r) != 0 {
                        let v = if r != rb {
                            reg(r as u8)
                        } else if first {
                            addr
                        } else {
                            b.op(Alu::Add, addr, imm((count - 1) * 4))
                        };
                        b.store(32, addr, v, access as u8);
                        access = SEQ;
                        addr = b.op(Alu::Add, addr, imm(4));
                        first = false;
                    }
                    // The interpreter rewrites the base after every slot, set or not.
                    let nb = b.op(Alu::Add, addr, align);
                    b.set(rb as u8, nb);
                }
            }
        } else {
            if load {
                let v = b.load(32, addr, NSEQ as u8);
                let t = b.op(Alu::And, v, imm(!1));
                // The base is updated after the pipeline reload, as in the interpreter.
                let na = b.op(Alu::Add, addr, imm(0x40));
                let nb = b.op(Alu::Add, na, align);
                b.call("reload16", &[t]);
                b.set(rb as u8, nb);
                kind = None;
                flow = tflow(true, false, Vec::new());
            } else {
                b.store(32, addr, imm(pcv.wrapping_add(2)), NSEQ as u8);
                let na = b.op(Alu::Add, addr, imm(0x40));
                let nb = b.op(Alu::Add, na, align);
                b.set(rb as u8, nb);
            }
        }
        known.0[rb as usize] = None;
        text = format!(
            "{} {}!, {{0x{rlist:02x}}}",
            if load { "ldmia" } else { "stmia" },
            REGS[rb as usize]
        );
    } else if i & 0xff00 == 0xdf00 {
        *k = Consts::default();
        return fb("swi");
    } else if i & 0xf000 == 0xd000 {
        // Format 16: conditional branch
        let cond = (i >> 8) & 15;
        let off = ((i & 0xff) as u8 as i8 as i32 as u32) << 1;
        let target = pcv.wrapping_add(off);
        match cond_val(&mut b, cond) {
            Some(c) => {
                if cond == 14 {
                    *k = Consts::default();
                    return fb("undefined thumb branch condition");
                }
                b.if_else(
                    c,
                    |b| {
                        b.call("reload16", &[imm(target)]);
                        b.exit();
                    },
                    |_| {},
                );
                flow = tflow(true, true, vec![(target, Isa::Thumb)]);
            }
            None => {
                *k = Consts::default();
                return fb("undefined thumb branch condition");
            }
        }
        text = format!("b{} 0x{target:08x}", CONDS[cond as usize]);
    } else if i & 0xf800 == 0xe000 {
        // Format 18: unconditional branch
        let off = ((i & 0x7ff) << 21) as i32 >> 20;
        let target = pcv.wrapping_add(off as u32);
        b.call("reload16", &[imm(target)]);
        kind = None;
        flow = tflow(true, false, vec![(target, Isa::Thumb)]);
        text = format!("b 0x{target:08x}");
    } else if i & 0xf000 == 0xf000 {
        // Format 19: long branch with link
        let off = i & 0x7ff;
        if bit(i, 11) {
            let lr = b.op(Alu::And, reg(14), imm(!1));
            let t = b.op(Alu::Add, lr, imm(off << 1));
            b.set(14, imm(pc.wrapping_add(2) | 1));
            b.call("reload16", &[t]);
            kind = None;
            let mut targets = vec![(pc.wrapping_add(2), Isa::Thumb)];
            // Resolve the target from the preceding first half when it is adjacent.
            if let Some(p) = prev.filter(|p| p & 0xf800 == 0xf000) {
                let hi = ((u32::from(p) & 0x7ff) << 21) as i32 >> 9;
                let target = pc
                    .wrapping_add(2)
                    .wrapping_add(hi as u32)
                    .wrapping_add(off << 1);
                targets.push((target & !1, Isa::Thumb));
            } else if let Some(l) = known.0[14] {
                targets.push(((l & !1).wrapping_add(off << 1), Isa::Thumb));
            }
            flow = tflow(true, false, targets);
            text = format!("bl.lo #0x{:x}", off << 1);
        } else {
            let hi = ((off << 21) as i32 >> 9) as u32;
            let v = pcv.wrapping_add(hi);
            b.set(14, imm(v));
            kset = Some((14, Some(v)));
            text = format!("bl.hi #0x{hi:x}");
        }
    } else {
        *k = Consts::default();
        return fb("undefined thumb");
    }
    if let Some((r, v)) = kset {
        known.0[r as usize] = v;
    }
    if flow.ends {
        known = Consts::default();
    }
    *k = known;
    Lowered {
        g: thumb_wrap(pc, h, b, kind),
        text,
        flow,
    }
}

fn thumb_ldr_str(
    b: &mut Builder,
    load: bool,
    byte: bool,
    rd: u32,
    addr: Val,
    kind: &mut Option<u32>,
    kset: &mut Option<(u32, Option<u32>)>,
) {
    if load {
        let v = if byte {
            b.load(8, addr, NSEQ as u8)
        } else {
            b.call_v("ldr_word", &[addr, imm(NSEQ)])
        };
        b.set(rd as u8, v);
        b.call("idle", &[]);
        *kind = Some(SEQ);
        *kset = Some((rd, None));
    } else {
        if byte {
            b.store(8, addr, reg(rd as u8), NSEQ as u8);
        } else {
            let a = b.op(Alu::And, addr, imm(!3));
            b.store(32, a, reg(rd as u8), NSEQ as u8);
        }
        *kind = Some(NSEQ);
    }
}

/// Lift the reachable code of `regions` from `entries` into a GBA guest module.
#[must_use]
pub fn lift(regions: &[Region], entries: &[(u32, Isa)], entry: u32, limits: Limits) -> IrModule {
    let mem = Mem { regions };
    // Phase 1: explore every reachable instruction and collect block leaders.
    let mut leaders: BTreeSet<(u32, Isa)> = BTreeSet::new();
    let mut seen: BTreeMap<(u32, Isa), ()> = BTreeMap::new();
    let mut work: Vec<(u32, Isa)> = Vec::new();
    for &e in entries {
        if valid(&mem, e) {
            leaders.insert(e);
            work.push(e);
        }
    }
    let mut budget = limits.max_insns;
    while let Some(start) = work.pop() {
        let (mut pc, isa) = start;
        let mut k = Consts::default();
        let mut prev: Option<u16> = None;
        loop {
            if budget == 0 {
                break;
            }
            if seen.contains_key(&(pc, isa)) && (pc, isa) != start {
                break;
            }
            seen.insert((pc, isa), ());
            budget -= 1;
            let Some(low) = decode(&mem, pc, isa, prev, &mut k) else {
                break;
            };
            for &t in &low.flow.targets {
                if valid(&mem, t) && leaders.insert(t) {
                    work.push(t);
                }
            }
            prev = if isa == Isa::Thumb { mem.u16(pc) } else { None };
            if !low.flow.falls {
                break;
            }
            pc = pc.wrapping_add(isa.size());
            if !valid(&mem, (pc, isa)) {
                break;
            }
            if leaders.contains(&(pc, isa)) {
                break;
            }
        }
    }
    // Phase 2: one block per leader, running to a terminator or the next leader.
    let mut functions = Vec::new();
    for &(start, isa) in &leaders {
        let mut insns = Vec::new();
        let mut pc = start;
        let mut k = Consts::default();
        let mut prev: Option<u16> = None;
        let mut fallthrough = None;
        loop {
            let Some(low) = decode(&mem, pc, isa, prev, &mut k) else {
                break;
            };
            insns.push(IrInsn {
                addr: u64::from(pc),
                len: isa.size() as u8,
                text: low.text,
                op: IrOp::Guest(low.g),
            });
            prev = if isa == Isa::Thumb { mem.u16(pc) } else { None };
            if !low.flow.falls {
                break;
            }
            let n = pc.wrapping_add(isa.size());
            if !valid(&mem, (n, isa)) || !seen.contains_key(&(n, isa)) {
                break;
            }
            if leaders.contains(&(n, isa)) {
                fallthrough = Some(u64::from(n));
                break;
            }
            pc = n;
        }
        if insns.is_empty() {
            continue;
        }
        functions.push(IrFunction {
            addr: u64::from(start),
            name: None,
            blocks: vec![IrBlock {
                addr: u64::from(start),
                insns,
                fallthrough,
            }],
            truncated: budget == 0,
            isa: isa.index(),
        });
    }
    let sections = regions
        .iter()
        .scan(0u64, |off, r| {
            let s = SectionEntry {
                name: r.name.clone(),
                vaddr: u64::from(r.base),
                vsize: r.data.len() as u64,
                file_offset: *off,
                file_size: r.data.len() as u64,
                exec: true,
                write: false,
            };
            *off += r.data.len() as u64;
            Some(s)
        })
        .collect();
    let image_end = regions
        .iter()
        .map(|r| u64::from(r.base) + r.data.len() as u64)
        .max()
        .unwrap_or(0);
    IrModule {
        schema_version: super::contract::SCHEMA_VERSION,
        format: "gba".into(),
        arch: "armv4t".into(),
        abi: Some(abi()),
        bits: 32,
        image_base: regions.iter().map(|r| u64::from(r.base)).min().unwrap_or(0),
        entry: u64::from(entry),
        image_end,
        imports: Vec::new(),
        sections,
        functions,
    }
}

fn valid(mem: &Mem, (pc, isa): (u32, Isa)) -> bool {
    pc % isa.size() == 0 && mem.bytes(pc, isa.size()).is_some()
}

fn decode(mem: &Mem, pc: u32, isa: Isa, prev: Option<u16>, k: &mut Consts) -> Option<Lowered> {
    match isa {
        Isa::Arm => mem.u32(pc).map(|w| lower_arm(mem, pc, w, k)),
        Isa::Thumb => mem.u16(pc).map(|h| lower_thumb(mem, pc, h, prev, k)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(w: u32) -> Lowered {
        let regions = [Region {
            name: "rom".into(),
            base: 0x0800_0000,
            data: w.to_le_bytes().to_vec(),
        }];
        let mem = Mem { regions: &regions };
        lower_arm(&mem, 0x0800_0000, w, &mut Consts::default())
    }

    #[test]
    fn branch_targets_resolve() {
        // b 0x080000c0 (GBA header branch)
        let l = one(0xEA00_002E);
        assert_eq!(l.flow.targets, vec![(0x0800_00c0, Isa::Arm)]);
        assert!(l.flow.ends);
    }

    #[test]
    fn psr_transfers_fall_back() {
        // mrs r0, cpsr
        assert!(one(0xE10F_0000).g.is_fallback());
        // msr cpsr_fc, r0
        assert!(one(0xE129_F000).g.is_fallback());
        // swi 0x050000
        assert!(one(0xEF05_0000).g.is_fallback());
    }

    #[test]
    fn data_processing_is_translated() {
        // adds r0, r1, r2
        let l = one(0xE091_0002);
        assert!(!l.g.is_fallback());
        assert!(l.flow.falls);
    }
}
