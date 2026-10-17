// SPDX-License-Identifier: Apache-2.0
//! AArch64 lifter: recursive-descent function discovery over fixed 32-bit instructions, lowering a
//! documented core subset to the shared [`IrModule`]. Everything outside the subset becomes
//! [`IrOp::Unlifted`] (reported, never dropped).
//!
//! Model: registers are `x0..x30` and `sp` (the 32-bit forms read and write the low half and zero
//! the upper half, as on hardware); calls write `x30`; flags use the x86 convention of the shared
//! emitters (carry = borrow after a subtraction), with the AArch64 condition codes mapped so that
//! every condition keeps its meaning. Non-flag-setting `add`/`sub` lower to `lea` so they do not
//! clobber the flags a later conditional branch reads; logical operations and `movk` still do.

use super::image::Image;
use super::ir::{
    Abi, BinKind, Cond, Ext, IrBlock, IrFunction, IrInsn, IrModule, IrOp, Operand, SectionEntry, Target, UnKind,
};
use super::lift::LiftOptions;
use std::collections::{BTreeMap, BTreeSet};

/// Register file of the AArch64 CPU emitted by the C backend.
#[must_use]
pub fn abi() -> Abi {
    let mut regs: Vec<String> = (0..=30).map(|i| format!("x{i}")).collect();
    regs.push("sp".into());
    Abi { regs, link: "x30".into(), sp: "sp".into(), ret: "x0".into() }
}

/// Control-flow class of a decoded instruction.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Flow {
    Seq,
    Cond(u64),
    Jump(Option<u64>),
    Call(Option<u64>),
    End,
}

struct Lowered {
    ops: Vec<IrOp>,
    text: String,
    flow: Flow,
}

fn reg(n: u32, sf: bool, sp_ctx: bool) -> Option<Operand> {
    if n == 31 && !sp_ctx {
        return None;
    }
    let name = if n == 31 { "sp".to_string() } else { format!("x{n}") };
    Some(Operand::Reg { name, bits: if sf { 64 } else { 32 }, high: false })
}

/// Source operand: the zero register reads as an immediate zero.
fn src(n: u32, sf: bool, sp_ctx: bool) -> Operand {
    reg(n, sf, sp_ctx).unwrap_or(Operand::Imm { value: 0 })
}

fn rname(n: u32, sf: bool, sp_ctx: bool) -> String {
    match (n, sp_ctx, sf) {
        (31, true, _) => "sp".into(),
        (31, false, true) => "xzr".into(),
        (31, false, false) => "wzr".into(),
        (_, _, true) => format!("x{n}"),
        _ => format!("w{n}"),
    }
}

fn mem(base: u32, disp: i64, bits: u8) -> Operand {
    Operand::Mem { base: Some(if base == 31 { "sp".into() } else { format!("x{base}") }), index: None, scale: 1, disp, bits }
}

fn imm(value: i64) -> Operand {
    Operand::Imm { value }
}

fn sext(v: u32, bits: u32) -> i64 {
    let s = 64 - bits;
    (i64::from(v) << s) >> s
}

fn cond_of(c: u32) -> Option<Cond> {
    Some(match c {
        0 => Cond::E,
        1 => Cond::Ne,
        2 => Cond::Ae,
        3 => Cond::B,
        4 => Cond::S,
        5 => Cond::Ns,
        6 => Cond::O,
        7 => Cond::No,
        8 => Cond::A,
        9 => Cond::Be,
        10 => Cond::Ge,
        11 => Cond::L,
        12 => Cond::G,
        13 => Cond::Le,
        _ => return None,
    })
}

const COND_NAMES: [&str; 14] = ["eq", "ne", "cs", "cc", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le"];

/// Decode the `DecodeBitMasks` immediate of a logical-immediate instruction.
fn bitmask(n: u32, imms: u32, immr: u32, sf: bool) -> Option<u64> {
    let combined = (n << 6) | (!imms & 0x3f);
    if combined == 0 {
        return None;
    }
    let len = 31 - combined.leading_zeros();
    if len < 1 {
        return None;
    }
    let esize = 1u32 << len;
    if !sf && esize == 64 {
        return None;
    }
    let levels = esize - 1;
    let s = imms & levels;
    let r = immr & levels;
    if s == levels {
        return None;
    }
    let welem: u64 = if s + 1 >= 64 { u64::MAX } else { (1u64 << (s + 1)) - 1 };
    let emask: u64 = if esize == 64 { u64::MAX } else { (1u64 << esize) - 1 };
    let rot = if r == 0 { welem } else { ((welem >> r) | (welem << (esize - r))) & emask };
    let mut out = 0u64;
    let mut at = 0;
    while at < 64 {
        out |= rot << at;
        at += esize;
    }
    Some(if sf { out } else { out & 0xffff_ffff })
}

fn unlifted(w: u32, why: &str) -> Lowered {
    Lowered { ops: vec![IrOp::Unlifted { reason: why.into() }], text: format!(".inst 0x{w:08x}"), flow: Flow::Seq }
}

fn seq(ops: Vec<IrOp>, text: String) -> Lowered {
    Lowered { ops, text, flow: Flow::Seq }
}

/// Lower one instruction located at `pc`.
#[allow(clippy::too_many_lines, clippy::cognitive_complexity)]
fn lower(pc: u64, w: u32) -> Lowered {
    let rd = w & 31;
    let rn = (w >> 5) & 31;
    let rm = (w >> 16) & 31;
    let sf = w >> 31 == 1;

    if w & 0xffff_f01f == 0xd503_201f {
        return seq(vec![IrOp::Nop], "nop".into());
    }
    // Unconditional branch (immediate): b / bl.
    if w & 0x7c00_0000 == 0x1400_0000 {
        let target = pc.wrapping_add((sext(w & 0x03ff_ffff, 26) * 4) as u64);
        return if w >> 31 == 1 {
            Lowered { ops: vec![IrOp::Call { target: Target::Direct { addr: target } }], text: format!("bl 0x{target:x}"), flow: Flow::Call(Some(target)) }
        } else {
            Lowered { ops: vec![IrOp::Jmp { target: Target::Direct { addr: target } }], text: format!("b 0x{target:x}"), flow: Flow::Jump(Some(target)) }
        };
    }
    // b.cond
    if w & 0xff00_0010 == 0x5400_0000 {
        let target = pc.wrapping_add((sext((w >> 5) & 0x7ffff, 19) * 4) as u64);
        let c = w & 15;
        return match cond_of(c) {
            Some(cond) => Lowered { ops: vec![IrOp::Jcc { cond, target }], text: format!("b.{} 0x{target:x}", COND_NAMES[c as usize]), flow: Flow::Cond(target) },
            None => Lowered { ops: vec![IrOp::Jmp { target: Target::Direct { addr: target } }], text: format!("b.al 0x{target:x}"), flow: Flow::Jump(Some(target)) },
        };
    }
    // cbz / cbnz
    if w & 0x7e00_0000 == 0x3400_0000 {
        let target = pc.wrapping_add((sext((w >> 5) & 0x7ffff, 19) * 4) as u64);
        let nz = (w >> 24) & 1 == 1;
        let ops = vec![
            IrOp::Cmp { a: src(rd, sf, false), b: imm(0) },
            IrOp::Jcc { cond: if nz { Cond::Ne } else { Cond::E }, target },
        ];
        return Lowered { ops, text: format!("{} {}, 0x{target:x}", if nz { "cbnz" } else { "cbz" }, rname(rd, sf, false)), flow: Flow::Cond(target) };
    }
    // tbz / tbnz
    if w & 0x7e00_0000 == 0x3600_0000 {
        let target = pc.wrapping_add((sext((w >> 5) & 0x3fff, 14) * 4) as u64);
        let nz = (w >> 24) & 1 == 1;
        let bit = ((w >> 31) << 5) | ((w >> 19) & 31);
        let ops = vec![
            IrOp::Test { a: src(rd, true, false), b: imm((1u64 << bit) as i64) },
            IrOp::Jcc { cond: if nz { Cond::Ne } else { Cond::E }, target },
        ];
        return Lowered { ops, text: format!("{} {}, #{bit}, 0x{target:x}", if nz { "tbnz" } else { "tbz" }, rname(rd, true, false)), flow: Flow::Cond(target) };
    }
    // br / blr / ret
    if w & 0xffff_fc1f == 0xd61f_0000 {
        let t = Target::Indirect { operand: src(rn, true, false) };
        return Lowered { ops: vec![IrOp::Jmp { target: t }], text: format!("br {}", rname(rn, true, false)), flow: Flow::Jump(None) };
    }
    if w & 0xffff_fc1f == 0xd63f_0000 {
        let t = Target::Indirect { operand: src(rn, true, false) };
        return Lowered { ops: vec![IrOp::Call { target: t }], text: format!("blr {}", rname(rn, true, false)), flow: Flow::Call(None) };
    }
    if w & 0xffff_fc1f == 0xd65f_0000 {
        return if rn == 30 {
            Lowered { ops: vec![IrOp::Ret { pop: 0 }], text: "ret".into(), flow: Flow::End }
        } else {
            let t = Target::Indirect { operand: src(rn, true, false) };
            Lowered { ops: vec![IrOp::Jmp { target: t }], text: format!("ret {}", rname(rn, true, false)), flow: Flow::Jump(None) }
        };
    }
    // adr / adrp
    if w & 0x1f00_0000 == 0x1000_0000 {
        let immv = sext(((w >> 5) & 0x7ffff) << 2 | ((w >> 29) & 3), 21);
        let page = w >> 31 == 1;
        let value = if page { (pc & !0xfff).wrapping_add((immv << 12) as u64) } else { pc.wrapping_add(immv as u64) };
        let Some(d) = reg(rd, true, false) else { return seq(vec![IrOp::Nop], "adr xzr".into()) };
        return seq(vec![IrOp::Mov { dst: d, src: imm(value as i64), ext: Ext::None }], format!("{} {}, 0x{value:x}", if page { "adrp" } else { "adr" }, rname(rd, true, false)));
    }
    // add / sub (immediate)
    if w & 0x1f00_0000 == 0x1100_0000 {
        let sub = (w >> 30) & 1 == 1;
        let s = (w >> 29) & 1 == 1;
        let sh = (w >> 22) & 1;
        if (w >> 23) & 1 == 1 {
            return unlifted(w, "reserved add/sub immediate");
        }
        let v = i64::from((w >> 10) & 0xfff) << (12 * sh);
        let text = format!("{}{} {}, {}, #{v}", if sub { "sub" } else { "add" }, if s { "s" } else { "" }, rname(rd, sf, !s), rname(rn, sf, true));
        if s {
            if rd == 31 {
                return if sub {
                    seq(vec![IrOp::Cmp { a: src(rn, sf, true), b: imm(v) }], format!("cmp {}, #{v}", rname(rn, sf, true)))
                } else {
                    unlifted(w, "cmn is not modelled")
                };
            }
            let d = reg(rd, sf, false).expect("non-zero destination");
            return seq(
                vec![
                    IrOp::Mov { dst: d.clone(), src: src(rn, sf, true), ext: Ext::None },
                    IrOp::Bin { kind: if sub { BinKind::Sub } else { BinKind::Add }, dst: d, src: imm(v) },
                ],
                text,
            );
        }
        let d = reg(rd, sf, true).expect("sp-capable destination");
        let disp = if sub { -v } else { v };
        return seq(vec![IrOp::Lea { dst: d, src: mem(rn, disp, 0) }], text);
    }
    // add / sub (shifted register)
    if w & 0x1f20_0000 == 0x0b00_0000 {
        let sub = (w >> 30) & 1 == 1;
        let s = (w >> 29) & 1 == 1;
        let shift = (w >> 22) & 3;
        let amt = (w >> 10) & 63;
        if shift == 3 || (!sf && amt > 31) {
            return unlifted(w, "reserved shifted-register encoding");
        }
        let text = format!("{}{} {}, {}, {}", if sub { "sub" } else { "add" }, if s { "s" } else { "" }, rname(rd, sf, false), rname(rn, sf, false), rname(rm, sf, false));
        if s && rd == 31 {
            return if sub && shift == 0 && amt == 0 {
                seq(vec![IrOp::Cmp { a: src(rn, sf, false), b: src(rm, sf, false) }], format!("cmp {}, {}", rname(rn, sf, false), rname(rm, sf, false)))
            } else {
                unlifted(w, "cmp/cmn with a shifted operand or cmn is not modelled")
            };
        }
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], text) };
        if !s && !sub && shift == 0 && amt <= 3 && rn != 31 && rm != 31 {
            let base = format!("x{rn}");
            let index = format!("x{rm}");
            let scale = 1u8 << amt;
            let m = Operand::Mem { base: Some(base), index: Some(index), scale, disp: 0, bits: 0 };
            return seq(vec![IrOp::Lea { dst: d, src: m }], text);
        }
        if shift != 0 || amt != 0 {
            return unlifted(w, "shifted operand is not modelled");
        }
        return seq(
            vec![
                IrOp::Mov { dst: d.clone(), src: src(rn, sf, false), ext: Ext::None },
                IrOp::Bin { kind: if sub { BinKind::Sub } else { BinKind::Add }, dst: d, src: src(rm, sf, false) },
            ],
            text,
        );
    }
    // logical (shifted register)
    if w & 0x1f00_0000 == 0x0a00_0000 {
        let opc = (w >> 29) & 3;
        let n = (w >> 21) & 1;
        let shift = (w >> 22) & 3;
        let amt = (w >> 10) & 63;
        let text = format!("{} {}, {}, {}", ["and", "orr", "eor", "ands"][opc as usize], rname(rd, sf, false), rname(rn, sf, false), rname(rm, sf, false));
        if shift != 0 || amt != 0 {
            return unlifted(w, "shifted logical operand is not modelled");
        }
        if n == 1 {
            if opc == 1 && rn == 31 {
                let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], text) };
                return seq(vec![IrOp::Mov { dst: d.clone(), src: src(rm, sf, false), ext: Ext::None }, IrOp::Un { kind: UnKind::Not, dst: d }], format!("mvn {}, {}", rname(rd, sf, false), rname(rm, sf, false)));
            }
            return unlifted(w, "bic/orn/eon are not modelled");
        }
        if opc == 3 && rd == 31 {
            return seq(vec![IrOp::Test { a: src(rn, sf, false), b: src(rm, sf, false) }], format!("tst {}, {}", rname(rn, sf, false), rname(rm, sf, false)));
        }
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], text) };
        if opc == 1 && rn == 31 {
            return seq(vec![IrOp::Mov { dst: d, src: src(rm, sf, false), ext: Ext::None }], format!("mov {}, {}", rname(rd, sf, false), rname(rm, sf, false)));
        }
        let kind = [BinKind::And, BinKind::Or, BinKind::Xor, BinKind::And][opc as usize];
        return seq(vec![IrOp::Mov { dst: d.clone(), src: src(rn, sf, false), ext: Ext::None }, IrOp::Bin { kind, dst: d, src: src(rm, sf, false) }], text);
    }
    // logical (immediate)
    if w & 0x1f80_0000 == 0x1200_0000 {
        let opc = (w >> 29) & 3;
        let Some(mask) = bitmask((w >> 22) & 1, (w >> 10) & 0x3f, (w >> 16) & 0x3f, sf) else {
            return unlifted(w, "reserved logical immediate");
        };
        let text = format!("{} {}, {}, #0x{mask:x}", ["and", "orr", "eor", "ands"][opc as usize], rname(rd, sf, opc != 3), rname(rn, sf, false));
        if opc == 3 && rd == 31 {
            return seq(vec![IrOp::Test { a: src(rn, sf, false), b: imm(mask as i64) }], format!("tst {}, #0x{mask:x}", rname(rn, sf, false)));
        }
        let Some(d) = reg(rd, sf, opc != 3) else { return seq(vec![IrOp::Nop], text) };
        if opc == 1 && rn == 31 {
            return seq(vec![IrOp::Mov { dst: d, src: imm(mask as i64), ext: Ext::None }], format!("mov {}, #0x{mask:x}", rname(rd, sf, true)));
        }
        let kind = [BinKind::And, BinKind::Or, BinKind::Xor, BinKind::And][opc as usize];
        return seq(vec![IrOp::Mov { dst: d.clone(), src: src(rn, sf, false), ext: Ext::None }, IrOp::Bin { kind, dst: d, src: imm(mask as i64) }], text);
    }
    // move wide
    if w & 0x1f80_0000 == 0x1280_0000 {
        let opc = (w >> 29) & 3;
        let hw = (w >> 21) & 3;
        if !sf && hw > 1 || opc == 1 {
            return unlifted(w, "reserved move-wide encoding");
        }
        let part = u64::from((w >> 5) & 0xffff) << (16 * hw);
        let width_mask = if sf { u64::MAX } else { 0xffff_ffff };
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], "mov xzr".into()) };
        return match opc {
            0 => {
                let v = !part & width_mask;
                seq(vec![IrOp::Mov { dst: d, src: imm(v as i64), ext: Ext::None }], format!("movn {}, #0x{:x}", rname(rd, sf, false), part >> (16 * hw)))
            }
            2 => seq(vec![IrOp::Mov { dst: d, src: imm(part as i64), ext: Ext::None }], format!("movz {}, #0x{:x}", rname(rd, sf, false), part >> (16 * hw))),
            _ => seq(
                vec![
                    IrOp::Bin { kind: BinKind::And, dst: d.clone(), src: imm((!(0xffffu64 << (16 * hw)) & width_mask) as i64) },
                    IrOp::Bin { kind: BinKind::Or, dst: d, src: imm(part as i64) },
                ],
                format!("movk {}, #0x{:x}, lsl #{}", rname(rd, sf, false), part >> (16 * hw), 16 * hw),
            ),
        };
    }
    // bitfield: lsl / lsr / asr / sxt* / uxt*
    if w & 0x1f80_0000 == 0x1300_0000 {
        let opc = (w >> 29) & 3;
        let immr = (w >> 16) & 0x3f;
        let imms = (w >> 10) & 0x3f;
        let width = if sf { 63 } else { 31 };
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], "bfm xzr".into()) };
        let s = src(rn, sf, false);
        let text = format!("{} {}, {}, #{immr}, #{imms}", ["sbfm", "bfm", "ubfm"][opc.min(2) as usize], rname(rd, sf, false), rname(rn, sf, false));
        let extend = |bits: u8, ext: Ext| -> Option<IrOp> {
            let Operand::Reg { name, .. } = &s else { return None };
            Some(IrOp::Mov { dst: d.clone(), src: Operand::Reg { name: name.clone(), bits, high: false }, ext })
        };
        if opc == 2 {
            if imms == width {
                return seq(vec![IrOp::Mov { dst: d.clone(), src: s, ext: Ext::None }, IrOp::Bin { kind: BinKind::Shr, dst: d, src: imm(i64::from(immr)) }], text);
            }
            if imms + 1 == immr {
                let sh = i64::from(width - imms);
                return seq(vec![IrOp::Mov { dst: d.clone(), src: s, ext: Ext::None }, IrOp::Bin { kind: BinKind::Shl, dst: d, src: imm(sh) }], text);
            }
            if immr == 0 && (imms == 7 || imms == 15) {
                if let Some(op) = extend(if imms == 7 { 8 } else { 16 }, Ext::Zero) {
                    return seq(vec![op], text);
                }
            }
        } else if opc == 0 {
            if imms == width {
                return seq(vec![IrOp::Mov { dst: d.clone(), src: s, ext: Ext::None }, IrOp::Bin { kind: BinKind::Sar, dst: d, src: imm(i64::from(immr)) }], text);
            }
            if immr == 0 && matches!(imms, 7 | 15 | 31) {
                if let Some(op) = extend(match imms { 7 => 8, 15 => 16, _ => 32 }, Ext::Sign) {
                    return seq(vec![op], text);
                }
            }
        }
        return unlifted(w, "bitfield move form is not modelled");
    }
    // mul (madd with the zero register as accumulator)
    if w & 0x1fe0_8000 == 0x1b00_0000 && (w >> 10) & 31 == 31 {
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], "mul xzr".into()) };
        return seq(
            vec![IrOp::Mov { dst: d.clone(), src: src(rn, sf, false), ext: Ext::None }, IrOp::Bin { kind: BinKind::Mul, dst: d, src: src(rm, sf, false) }],
            format!("mul {}, {}, {}", rname(rd, sf, false), rname(rn, sf, false), rname(rm, sf, false)),
        );
    }
    // conditional select: csel and the cset alias of csinc
    if w & 0x1fe0_0800 == 0x1a80_0000 {
        let c = (w >> 12) & 15;
        let o2 = (w >> 10) & 1;
        let op = (w >> 30) & 1;
        let Some(d) = reg(rd, sf, false) else { return seq(vec![IrOp::Nop], "csel xzr".into()) };
        if op == 0 && o2 == 0 {
            if let Some(cond) = cond_of(c) {
                return seq(
                    vec![
                        IrOp::Mov { dst: d.clone(), src: src(rm, sf, false), ext: Ext::None },
                        IrOp::Cmovcc { cond, dst: d, src: src(rn, sf, false) },
                    ],
                    format!("csel {}, {}, {}, {}", rname(rd, sf, false), rname(rn, sf, false), rname(rm, sf, false), COND_NAMES[c as usize]),
                );
            }
        }
        if op == 0 && o2 == 1 && rn == 31 && rm == 31 && c < 14 {
            if let Some(cond) = cond_of(c ^ 1) {
                let low = Operand::Reg { name: format!("x{rd}"), bits: 8, high: false };
                return seq(
                    vec![IrOp::Mov { dst: d, src: imm(0), ext: Ext::None }, IrOp::Setcc { cond, dst: low }],
                    format!("cset {}, {}", rname(rd, sf, false), COND_NAMES[(c ^ 1) as usize]),
                );
            }
        }
        return unlifted(w, "conditional select form is not modelled");
    }
    // load / store pair
    if w & 0x3a00_0000 == 0x2800_0000 && (w >> 26) & 1 == 0 {
        let opc = (w >> 30) & 3;
        let load = (w >> 22) & 1 == 1;
        let kind = (w >> 23) & 7;
        let rt2 = (w >> 10) & 31;
        if opc == 1 || opc == 3 || !(1..=3).contains(&kind) {
            return unlifted(w, "load/store pair form is not modelled");
        }
        let bits = if opc == 2 { 64 } else { 32 };
        let scale = i64::from(bits / 8);
        let off = sext((w >> 15) & 0x7f, 7) * scale;
        let (disp, pre, post) = match kind {
            1 => (0, false, true),
            3 => (0, true, false),
            _ => (off, false, false),
        };
        let mut ops = Vec::new();
        let base_adjust = || IrOp::Lea { dst: Operand::Reg { name: if rn == 31 { "sp".into() } else { format!("x{rn}") }, bits: 64, high: false }, src: mem(rn, off, 0) };
        if pre {
            ops.push(base_adjust());
        }
        let first = mem(rn, disp, bits);
        let second = mem(rn, disp + scale, bits);
        let sf2 = bits == 64;
        for (slot, r) in [(first, rd), (second, rt2)] {
            let reg_op = reg(r, sf2, false);
            if load {
                if let Some(dst) = reg_op {
                    ops.push(IrOp::Mov { dst, src: slot, ext: Ext::None });
                }
            } else {
                ops.push(IrOp::Mov { dst: slot, src: reg_op.unwrap_or(imm(0)), ext: Ext::None });
            }
        }
        if post {
            ops.push(base_adjust());
        }
        let name = if load { "ldp" } else { "stp" };
        return seq(ops, format!("{name} {}, {}, [{}, #{off}]", rname(rd, sf2, false), rname(rt2, sf2, false), rname(rn, true, true)));
    }
    // load / store register (unsigned offset, unscaled, pre/post-index, register offset)
    if w & 0x3b00_0000 == 0x3900_0000 || w & 0x3b00_0000 == 0x3800_0000 {
        let size = (w >> 30) & 3;
        let opc = (w >> 22) & 3;
        let bits = 8u8 << size;
        let unsigned = (w >> 24) & 1 == 1;
        let (disp, pre, post, index) = if unsigned {
            (i64::from((w >> 10) & 0xfff) << size, false, false, None)
        } else if (w >> 21) & 1 == 1 {
            if (w >> 10) & 3 != 2 || (w >> 13) & 7 != 3 {
                return unlifted(w, "register-offset form is not modelled");
            }
            let scaled = (w >> 12) & 1 == 1;
            (0, false, false, Some((rm, if scaled { 1u8 << size } else { 1 })))
        } else {
            let off = sext((w >> 12) & 0x1ff, 9);
            match (w >> 10) & 3 {
                0 => (off, false, false, None),
                1 => (0, false, true, None),
                3 => (0, true, false, None),
                _ => return unlifted(w, "unprivileged load/store is not modelled"),
            }
        };
        let off9 = sext((w >> 12) & 0x1ff, 9);
        let slot = match index {
            Some((m, sc)) => Operand::Mem {
                base: Some(if rn == 31 { "sp".into() } else { format!("x{rn}") }),
                index: if m == 31 { None } else { Some(format!("x{m}")) },
                scale: sc,
                disp: 0,
                bits,
            },
            None => mem(rn, disp, bits),
        };
        let store = opc == 0;
        let sign = opc >= 2;
        if sign && size == 3 {
            return seq(vec![IrOp::Nop], "prfm".into());
        }
        let dst_sf = match opc {
            2 => true,
            3 => false,
            _ => size == 3,
        };
        let mut ops = Vec::new();
        let adjust = IrOp::Lea { dst: Operand::Reg { name: if rn == 31 { "sp".into() } else { format!("x{rn}") }, bits: 64, high: false }, src: mem(rn, off9, 0) };
        if pre {
            ops.push(adjust.clone());
        }
        if store {
            let value = if size == 3 {
                src(rd, true, false)
            } else {
                match reg(rd, false, false) {
                    Some(Operand::Reg { name, .. }) => Operand::Reg { name, bits, high: false },
                    _ => imm(0),
                }
            };
            ops.push(IrOp::Mov { dst: slot, src: value, ext: Ext::None });
        } else if let Some(dst) = reg(rd, dst_sf, false) {
            let ext = if sign { Ext::Sign } else if size < 2 { Ext::Zero } else { Ext::None };
            ops.push(IrOp::Mov { dst, src: slot, ext });
        }
        if post {
            ops.push(adjust);
        }
        let mnemonic = match (store, sign, size) {
            (true, _, 0) => "strb",
            (true, _, 1) => "strh",
            (true, _, _) => "str",
            (false, true, 0) => "ldrsb",
            (false, true, 1) => "ldrsh",
            (false, true, _) => "ldrsw",
            (false, false, 0) => "ldrb",
            (false, false, 1) => "ldrh",
            (false, false, _) => "ldr",
        };
        return seq(ops, format!("{mnemonic} {}, [{}, #{disp}]", rname(rd, dst_sf, false), rname(rn, true, true)));
    }
    // load register (literal)
    if w & 0x3b00_0000 == 0x1800_0000 {
        let opc = (w >> 30) & 3;
        let address = pc.wrapping_add((sext((w >> 5) & 0x7ffff, 19) * 4) as u64);
        let (bits, sf2, ext) = match opc {
            0 => (32, false, Ext::None),
            1 => (64, true, Ext::None),
            2 => (32, true, Ext::Sign),
            _ => return seq(vec![IrOp::Nop], "prfm literal".into()),
        };
        let Some(dst) = reg(rd, sf2, false) else { return seq(vec![IrOp::Nop], "ldr xzr".into()) };
        let slot = Operand::Mem { base: None, index: None, scale: 1, disp: address as i64, bits };
        return seq(vec![IrOp::Mov { dst, src: slot, ext }], format!("ldr {}, 0x{address:x}", rname(rd, sf2, false)));
    }
    unlifted(w, "instruction is outside the modelled AArch64 subset")
}

fn decode_at(img: &Image, addr: u64) -> Option<u32> {
    let seg = img.segment_at(addr)?;
    if !seg.exec || addr % 4 != 0 {
        return None;
    }
    let off = (addr - seg.vaddr) as usize;
    let b = seg.data.get(off..off + 4)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn lift_function(img: &Image, start: u64, known: &BTreeSet<u64>, max_insns: usize) -> (IrFunction, Vec<u64>) {
    let mut insns: BTreeMap<u64, Lowered> = BTreeMap::new();
    let mut leaders: BTreeSet<u64> = BTreeSet::new();
    let mut calls: Vec<u64> = Vec::new();
    let mut bad: BTreeSet<u64> = BTreeSet::new();
    let mut work = vec![start];
    leaders.insert(start);
    let mut truncated = false;
    let local = |t: u64| img.is_code(t) && (t == start || !known.contains(&t));
    while let Some(a) = work.pop() {
        let mut ip = a;
        loop {
            if insns.contains_key(&ip) || bad.contains(&ip) || (ip != start && known.contains(&ip)) {
                break;
            }
            if insns.len() >= max_insns {
                truncated = true;
                break;
            }
            let Some(word) = decode_at(img, ip) else {
                bad.insert(ip);
                break;
            };
            let low = lower(ip, word);
            let flow = low.flow;
            insns.insert(ip, low);
            let next = ip + 4;
            match flow {
                Flow::Seq => ip = next,
                Flow::Cond(t) => {
                    if local(t) {
                        leaders.insert(t);
                        work.push(t);
                    }
                    leaders.insert(next);
                    ip = next;
                }
                Flow::Jump(t) => {
                    if let Some(t) = t {
                        if local(t) {
                            leaders.insert(t);
                            work.push(t);
                        }
                    }
                    break;
                }
                Flow::Call(t) => {
                    if let Some(t) = t {
                        calls.push(t);
                    }
                    ip = next;
                }
                Flow::End => break,
            }
        }
    }
    let mut blocks: Vec<IrBlock> = Vec::new();
    let mut prev_end: Option<u64> = None;
    let mut prev_term = true;
    for (&addr, low) in &insns {
        if prev_term || leaders.contains(&addr) || prev_end != Some(addr) {
            blocks.push(IrBlock { addr, insns: Vec::new(), fallthrough: None });
        }
        let blk = blocks.last_mut().expect("block pushed");
        let count = low.ops.len();
        for (i, op) in low.ops.iter().enumerate() {
            let last = i + 1 == count;
            blk.insns.push(IrInsn { addr, len: if last { 4 } else { 0 }, text: if i == 0 { low.text.clone() } else { String::new() }, op: op.clone() });
        }
        prev_term = matches!(low.flow, Flow::Jump(_) | Flow::End);
        prev_end = Some(addr + 4);
        blk.fallthrough = if prev_term { None } else { Some(addr + 4) };
    }
    let name = img.symbols.get(&start).cloned();
    (IrFunction { addr: start, name, blocks, truncated }, calls)
}

/// Lift every function reachable from the entry point and function symbols.
#[must_use]
pub fn lift_image(img: &Image, opts: LiftOptions) -> (IrModule, Vec<u8>) {
    let mut known: BTreeSet<u64> = BTreeSet::new();
    let mut queue: Vec<u64> = Vec::new();
    for a in std::iter::once(img.entry).chain(img.symbols.keys().copied()) {
        if img.is_code(a) && known.insert(a) {
            queue.push(a);
        }
    }
    queue.reverse();
    let mut functions: Vec<IrFunction> = Vec::new();
    while let Some(addr) = queue.pop() {
        if functions.len() >= opts.max_functions {
            break;
        }
        let (func, calls) = lift_function(img, addr, &known, opts.max_insns);
        for c in calls {
            if img.is_code(c) && known.insert(c) {
                queue.push(c);
            }
        }
        functions.push(func);
    }
    functions.sort_by_key(|f| f.addr);

    let mut blob = Vec::new();
    let mut sections = Vec::new();
    for s in &img.segments {
        sections.push(SectionEntry {
            name: s.name.clone(),
            vaddr: s.vaddr,
            vsize: s.vsize,
            file_offset: blob.len() as u64,
            file_size: s.data.len() as u64,
            exec: s.exec,
            write: s.write,
        });
        blob.extend_from_slice(&s.data);
    }
    let module = IrModule {
        schema_version: 1,
        format: img.format.to_string(),
        arch: "aarch64".into(),
        abi: Some(abi()),
        bits: 64,
        image_base: img.base,
        entry: img.entry,
        image_end: img.end(),
        imports: Vec::new(),
        sections,
        functions,
    };
    (module, blob)
}
