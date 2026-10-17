// SPDX-License-Identifier: Apache-2.0
//! MIPS R3000A lifter (PlayStation BIOS and PS-EXE) to guest semantics for the PlayStation
//! runtime of Bun Engine (StarPSX device models).
//!
//! Instructions are lowered with the StarPSX interpreter's model: reads come from the committed
//! register file, writes go to the delayed copy that is committed after each instruction, loads go
//! through the load delay slot, branches set the delayed branch consumed by the next instruction.
//! Exceptions are never raised by translated code: a precondition (misaligned access, signed
//! overflow) hands the instruction to the interpreter before any side effect, and `syscall`,
//! `break`, COP0, GTE and illegal encodings always run in the interpreter.
//!
//! Runtime contract (`machine = "psx"`): registers 0..=31 are the GPRs (reads: committed file,
//! writes: delayed file), 32 is `hi` and 33 is `lo`; helpers are `begin(addr)`, `end()`, `pc()`,
//! `branch(target)`, `lb|lbu|lh|lhu|lw|lwl|lwr(rt, addr)`, `sb|sh|sw|swl|swr(addr, value)` and
//! `code_hash(addr, words)` (FNV-1a of the instruction words, block entry guard for RAM code).

use super::ir::{Abi, IrBlock, IrFunction, IrInsn, IrModule, IrOp, SectionEntry};
use super::sem::{Alu, Builder, Guest, Stmt, Val, imm, reg};
use std::collections::{BTreeMap, BTreeSet};

const HI: u8 = 32;
const LO: u8 = 33;

/// Lift limits.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Maximum number of decoded instructions.
    pub max_insns: usize,
}

/// Register file of the PlayStation runtime.
#[must_use]
pub fn abi() -> Abi {
    let mut regs: Vec<String> = (0..32).map(|i| format!("r{i}")).collect();
    regs.push("hi".into());
    regs.push("lo".into());
    Abi {
        regs,
        link: "r31".into(),
        sp: "r29".into(),
        ret: "r2".into(),
        machine: Some("psx".into()),
        flags: Vec::new(),
        isas: vec!["mips".into()],
    }
}

/// FNV-1a over little-endian instruction words (shared with the runtime's `code_hash`).
#[must_use]
pub fn code_hash(words: &[u32]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for w in words {
        for b in w.to_le_bytes() {
            h ^= u32::from(b);
            h = h.wrapping_mul(0x0100_0193);
        }
    }
    h
}

struct Region {
    name: &'static str,
    base: u32,
    data: Vec<u8>,
    /// Writable at run time (RAM): blocks get an entry guard.
    ram: bool,
}

struct Mem {
    regions: Vec<Region>,
}

impl Mem {
    fn word(&self, addr: u32) -> Option<u32> {
        if addr & 3 != 0 {
            return None;
        }
        self.regions.iter().find_map(|r| {
            let off = addr.checked_sub(r.base)? as usize;
            r.data
                .get(off..off + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        })
    }
    fn ram(&self, addr: u32) -> bool {
        self.regions
            .iter()
            .any(|r| r.ram && addr >= r.base && ((addr - r.base) as usize) < r.data.len())
    }
}

const NAMES: [&str; 32] = [
    "zero", "at", "v0", "v1", "a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3", "t4", "t5", "t6",
    "t7", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "t8", "t9", "k0", "k1", "gp", "sp", "fp",
    "ra",
];

/// Control flow of an instruction.
#[derive(Debug, Clone, Default)]
struct Flow {
    /// Static successors (block leaders).
    targets: Vec<u32>,
    /// Sets the delayed branch (next instruction is a delay slot).
    branch: bool,
    /// Unconditional transfer: execution does not continue after the delay slot.
    always: bool,
    /// Handed to the interpreter: leaves the block.
    fallback: bool,
}

struct Lowered {
    g: Guest,
    text: String,
    flow: Flow,
}

fn fb(w: u32, why: &str, text: String) -> Lowered {
    Lowered {
        g: Guest {
            raw: w,
            body: vec![Stmt::Fallback { why: why.into() }],
        },
        text,
        flow: Flow {
            fallback: true,
            ..Flow::default()
        },
    }
}

fn simm(w: u32) -> u32 {
    w as u16 as i16 as i32 as u32
}

/// Lower one instruction. `delay` marks a branch delay slot.
#[allow(clippy::too_many_lines)]
fn lower(pc: u32, w: u32, delay: bool) -> Lowered {
    let op = w >> 26;
    let rs = ((w >> 21) & 31) as u8;
    let rt = ((w >> 16) & 31) as u8;
    let rd = ((w >> 11) & 31) as u8;
    let sa = (w >> 6) & 31;
    let funct = w & 63;
    let im = simm(w);
    let uim = w & 0xffff;
    let (ns, nt, nd) = (NAMES[rs as usize], NAMES[rt as usize], NAMES[rd as usize]);
    let mut pre = Builder::new();
    let mut b = Builder::new();
    let mut flow = Flow::default();
    let r = |n: u8| reg(n);
    let text;
    // Precondition guard: hand the instruction to the interpreter before any side effect.
    let guard = |pre: &mut Builder, c: Val, why: &str| {
        pre.if_else(
            c,
            |p| p.out.push(Stmt::Fallback { why: why.into() }),
            |_| {},
        );
    };
    let branch_target = pc.wrapping_add(im << 2).wrapping_add(4);
    match op {
        0x00 => match funct {
            0x00 | 0x02 | 0x03 => {
                let (alu, mn) = match funct {
                    0x00 => (Alu::Shl, "sll"),
                    0x02 => (Alu::Shr, "srl"),
                    _ => (Alu::Sar, "sra"),
                };
                let v = b.op(alu, r(rt), imm(sa));
                b.set(rd, v);
                text = if w == 0 {
                    "nop".into()
                } else {
                    format!("{mn} {nd}, {nt}, {sa}")
                };
            }
            0x04 | 0x06 | 0x07 => {
                let (alu, mn) = match funct {
                    0x04 => (Alu::Shl, "sllv"),
                    0x06 => (Alu::Shr, "srlv"),
                    _ => (Alu::Sar, "srav"),
                };
                let n = b.op(Alu::And, r(rs), imm(31));
                let v = b.op(alu, r(rt), n);
                b.set(rd, v);
                text = format!("{mn} {nd}, {nt}, {ns}");
            }
            0x08 => {
                b.call("branch", &[r(rs)]);
                flow = Flow {
                    branch: true,
                    always: true,
                    ..Flow::default()
                };
                text = format!("jr {ns}");
            }
            0x09 => {
                b.set(rd, imm(pc.wrapping_add(8)));
                b.call("branch", &[r(rs)]);
                flow = Flow {
                    branch: true,
                    always: true,
                    targets: vec![pc.wrapping_add(8)],
                    ..Flow::default()
                };
                text = format!("jalr {nd}, {ns}");
            }
            0x0c => return fb(w, "syscall", "syscall".into()),
            0x0d => return fb(w, "break", "break".into()),
            0x10 => {
                b.set(rd, reg(HI));
                text = format!("mfhi {nd}");
            }
            0x11 => {
                b.set(HI, r(rs));
                text = format!("mthi {ns}");
            }
            0x12 => {
                b.set(rd, reg(LO));
                text = format!("mflo {nd}");
            }
            0x13 => {
                b.set(LO, r(rs));
                text = format!("mtlo {ns}");
            }
            0x18 | 0x19 => {
                let signed = funct == 0x18;
                let lo = b.op(Alu::Mul, r(rs), r(rt));
                let hi = b.op(if signed { Alu::MulHiS } else { Alu::MulHiU }, r(rs), r(rt));
                b.set(HI, hi);
                b.set(LO, lo);
                text = format!("{} {ns}, {nt}", if signed { "mult" } else { "multu" });
            }
            0x1a | 0x1b => {
                let signed = funct == 0x1a;
                let q = b.op(if signed { Alu::DivS } else { Alu::DivU }, r(rs), r(rt));
                let m = b.op(if signed { Alu::RemS } else { Alu::RemU }, r(rs), r(rt));
                b.set(HI, m);
                b.set(LO, q);
                text = format!("{} {ns}, {nt}", if signed { "div" } else { "divu" });
            }
            0x20 | 0x22 => {
                let sub = funct == 0x22;
                let res = pre.op(if sub { Alu::Sub } else { Alu::Add }, r(rs), r(rt));
                let x = pre.op(Alu::Xor, r(rs), res);
                let y = if sub {
                    pre.op(Alu::Xor, r(rs), r(rt))
                } else {
                    let t = pre.op(Alu::Xor, r(rt), res);
                    t
                };
                let o = pre.op(Alu::And, x, y);
                let ov = pre.op(Alu::Shr, o, imm(31));
                guard(&mut pre, ov, "signed overflow exception");
                let v = b.op(if sub { Alu::Sub } else { Alu::Add }, r(rs), r(rt));
                b.set(rd, v);
                text = format!("{} {nd}, {ns}, {nt}", if sub { "sub" } else { "add" });
            }
            0x21 | 0x23 | 0x24 | 0x25 | 0x26 | 0x27 | 0x2a | 0x2b => {
                let (alu, mn) = match funct {
                    0x21 => (Alu::Add, "addu"),
                    0x23 => (Alu::Sub, "subu"),
                    0x24 => (Alu::And, "and"),
                    0x25 => (Alu::Or, "or"),
                    0x26 => (Alu::Xor, "xor"),
                    0x27 => (Alu::Or, "nor"),
                    0x2a => (Alu::Lts, "slt"),
                    _ => (Alu::Ltu, "sltu"),
                };
                let mut v = b.op(alu, r(rs), r(rt));
                if funct == 0x27 {
                    v = b.op(Alu::Not, v, imm(0));
                }
                b.set(rd, v);
                text = format!("{mn} {nd}, {ns}, {nt}");
            }
            _ => return fb(w, "illegal instruction", format!(".word 0x{w:08x}")),
        },
        0x01 => {
            let ge = (w >> 16) & 1 == 1;
            let al = (w >> 17) & 0xf == 0x8;
            let neg = b.op(Alu::Lts, r(rs), imm(0));
            let cond = if ge { b.op(Alu::Xor, neg, imm(1)) } else { neg };
            if al {
                b.set(31, imm(pc.wrapping_add(8)));
            }
            b.if_else(cond, |b| b.call("branch", &[imm(branch_target)]), |_| {});
            let mut targets = vec![branch_target];
            if al {
                targets.push(pc.wrapping_add(8));
            }
            flow = Flow {
                branch: true,
                targets,
                ..Flow::default()
            };
            text = format!(
                "b{}z{} {ns}, 0x{branch_target:08x}",
                if ge { "ge" } else { "lt" },
                if al { "al" } else { "" }
            );
        }
        0x02 | 0x03 => {
            let target = (pc & 0xf000_0000).wrapping_add((w & 0x03ff_ffff) << 2);
            let mut targets = vec![target];
            if op == 3 {
                b.set(31, imm(pc.wrapping_add(8)));
                targets.push(pc.wrapping_add(8));
            }
            b.call("branch", &[imm(target)]);
            flow = Flow {
                branch: true,
                always: true,
                targets,
                ..Flow::default()
            };
            text = format!("{} 0x{target:08x}", if op == 3 { "jal" } else { "j" });
        }
        0x04..=0x07 => {
            let cond = match op {
                0x04 => b.op(Alu::Eq, r(rs), r(rt)),
                0x05 => b.op(Alu::Ne, r(rs), r(rt)),
                0x06 => b.op(Alu::Les, r(rs), imm(0)),
                _ => b.op(Alu::Lts, imm(0), r(rs)),
            };
            b.if_else(cond, |b| b.call("branch", &[imm(branch_target)]), |_| {});
            let always = op == 0x04 && rs == rt;
            flow = Flow {
                branch: true,
                always,
                targets: vec![branch_target],
                ..Flow::default()
            };
            text = match op {
                0x04 => format!("beq {ns}, {nt}, 0x{branch_target:08x}"),
                0x05 => format!("bne {ns}, {nt}, 0x{branch_target:08x}"),
                0x06 => format!("blez {ns}, 0x{branch_target:08x}"),
                _ => format!("bgtz {ns}, 0x{branch_target:08x}"),
            };
        }
        0x08 => {
            let res = pre.op(Alu::Add, r(rs), imm(im));
            let x = pre.op(Alu::Xor, r(rs), res);
            let y = pre.op(Alu::Xor, imm(im), res);
            let o = pre.op(Alu::And, x, y);
            let ov = pre.op(Alu::Shr, o, imm(31));
            guard(&mut pre, ov, "signed overflow exception");
            let v = b.op(Alu::Add, r(rs), imm(im));
            b.set(rt, v);
            text = format!("addi {nt}, {ns}, {}", im as i32);
        }
        0x09..=0x0e => {
            let (alu, k, mn) = match op {
                0x09 => (Alu::Add, im, "addiu"),
                0x0a => (Alu::Lts, im, "slti"),
                0x0b => (Alu::Ltu, im, "sltiu"),
                0x0c => (Alu::And, uim, "andi"),
                0x0d => (Alu::Or, uim, "ori"),
                _ => (Alu::Xor, uim, "xori"),
            };
            let v = b.op(alu, r(rs), imm(k));
            b.set(rt, v);
            text = format!("{mn} {nt}, {ns}, 0x{k:x}");
        }
        0x0f => {
            b.set(rt, imm(uim << 16));
            text = format!("lui {nt}, 0x{uim:x}");
        }
        0x10 => return fb(w, "cop0", format!("cop0 0x{w:08x}")),
        0x12 | 0x32 | 0x3a => return fb(w, "gte (cop2)", format!("cop2 0x{w:08x}")),
        0x20..=0x26 | 0x28..=0x2b | 0x2e => {
            let (name, width, store) = match op {
                0x20 => ("lb", 1, false),
                0x21 => ("lh", 2, false),
                0x22 => ("lwl", 4, false),
                0x23 => ("lw", 4, false),
                0x24 => ("lbu", 1, false),
                0x25 => ("lhu", 2, false),
                0x26 => ("lwr", 4, false),
                0x28 => ("sb", 1, true),
                0x29 => ("sh", 2, true),
                0x2a => ("swl", 4, true),
                0x2b => ("sw", 4, true),
                _ => ("swr", 4, true),
            };
            let unaligned = matches!(name, "lwl" | "lwr" | "swl" | "swr");
            if width > 1 && !unaligned {
                let a = pre.op(Alu::Add, r(rs), imm(im));
                let m = pre.op(Alu::And, a, imm(width - 1));
                guard(&mut pre, m, "address error exception");
            }
            if matches!(name, "lwl" | "lwr") {
                // These read the delayed register file (load forwarding).
                let base = b.call_v("rd", &[imm(u32::from(rs))]);
                let a = b.op(Alu::Add, base, imm(im));
                b.call(name, &[imm(u32::from(rt)), a]);
            } else if store {
                let a = b.op(Alu::Add, r(rs), imm(im));
                b.call(name, &[a, r(rt)]);
            } else {
                let a = b.op(Alu::Add, r(rs), imm(im));
                b.call(name, &[imm(u32::from(rt)), a]);
            }
            text = format!("{name} {nt}, {}({ns})", im as i32);
        }
        _ => {
            return fb(
                w,
                "coprocessor or illegal instruction",
                format!(".word 0x{w:08x}"),
            );
        }
    }
    // Assemble: [guard] begin, semantics, end, [delay slot exit].
    let mut out = Builder::new();
    let pre_temps = Guest {
        raw: 0,
        body: pre.out.clone(),
    }
    .temps();
    let body_temps = Guest {
        raw: 0,
        body: b.out.clone(),
    }
    .temps();
    let mut body = pre.out;
    // Re-number the semantic temporaries after the guard's.
    let shift = |s: &mut Vec<Stmt>| renumber(s, pre_temps);
    let mut sem = b.out;
    shift(&mut sem);
    let _ = body_temps;
    body.push(Stmt::Call {
        f: "begin".into(),
        args: vec![imm(pc)],
        t: None,
    });
    body.extend(sem);
    body.push(Stmt::Call {
        f: "end".into(),
        args: vec![],
        t: None,
    });
    if delay {
        // After a delay slot the committed pc tells whether the branch was taken.
        let t = pre_temps + body_temps;
        body.push(Stmt::Call {
            f: "pc".into(),
            args: vec![],
            t: Some(t),
        });
        body.push(Stmt::Op {
            t: t + 1,
            op: Alu::Ne,
            a: Val::Tmp { t },
            b: imm(pc.wrapping_add(4)),
        });
        body.push(Stmt::If {
            c: Val::Tmp { t: t + 1 },
            then: vec![Stmt::Exit],
            els: Vec::new(),
        });
    }
    out.out = body;
    Lowered {
        g: out.finish(w),
        text,
        flow,
    }
}

fn renumber(s: &mut [Stmt], by: u16) {
    fn v(x: &mut Val, by: u16) {
        if let Val::Tmp { t } = x {
            *t += by;
        }
    }
    for st in s {
        match st {
            Stmt::Op { t, a, b, .. } => {
                *t += by;
                v(a, by);
                v(b, by);
            }
            Stmt::Sel { t, c, a, b } => {
                *t += by;
                v(c, by);
                v(a, by);
                v(b, by);
            }
            Stmt::Set { v: x, .. } | Stmt::SetFlag { v: x, .. } => v(x, by),
            Stmt::Load { t, addr, .. } => {
                *t += by;
                v(addr, by);
            }
            Stmt::Store { addr, v: x, .. } => {
                v(addr, by);
                v(x, by);
            }
            Stmt::Call { args, t, .. } => {
                if let Some(t) = t {
                    *t += by;
                }
                for a in args {
                    v(a, by);
                }
            }
            Stmt::If { c, then, els } => {
                v(c, by);
                renumber(then, by);
                renumber(els, by);
            }
            Stmt::Exit | Stmt::Fallback { .. } => {}
        }
    }
}

/// Lift a PlayStation BIOS (512 KiB at `0xBFC00000`) and an optional PS-EXE.
///
/// # Errors
/// Returns why the image cannot be lifted.
pub fn lift_psx(bios: &[u8], exe: Option<&[u8]>, limits: Limits) -> Result<IrModule, String> {
    let mut regions = vec![Region {
        name: "bios",
        base: 0xbfc0_0000,
        data: bios.to_vec(),
        ram: false,
    }];
    let mut entries = vec![0xbfc0_0000, 0xbfc0_0180];
    let mut entry = 0xbfc0_0000;
    if let Some(e) = exe {
        let rd = |o: usize| {
            e.get(o..o + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or("truncated PS-EXE header")
        };
        let pc0 = rd(0x10)?;
        let taddr = rd(0x18)?;
        let tsize = rd(0x1c)? as usize;
        let text = e.get(0x800..0x800 + tsize).ok_or("PS-EXE text truncated")?;
        regions.push(Region {
            name: "exe",
            base: taddr,
            data: text.to_vec(),
            ram: true,
        });
        entries.push(pc0);
        entry = pc0;
    }
    let mem = Mem { regions };
    let mut leaders: BTreeSet<u32> = BTreeSet::new();
    let mut seen: BTreeMap<u32, bool> = BTreeMap::new();
    let mut work: Vec<u32> = Vec::new();
    for e in entries {
        if mem.word(e).is_some() && leaders.insert(e) {
            work.push(e);
        }
    }
    let mut budget = limits.max_insns;
    while let Some(start) = work.pop() {
        let mut pc = start;
        let mut delay = false;
        loop {
            if budget == 0 {
                break;
            }
            if seen.contains_key(&pc) && pc != start {
                break;
            }
            let Some(w) = mem.word(pc) else { break };
            seen.insert(pc, delay);
            budget -= 1;
            let low = lower(pc, w, delay);
            for &t in &low.flow.targets {
                if mem.word(t).is_some() && leaders.insert(t) {
                    work.push(t);
                }
            }
            if low.flow.fallback {
                let n = pc.wrapping_add(4);
                if mem.word(n).is_some() && leaders.insert(n) {
                    work.push(n);
                }
                break;
            }
            // An unconditional transfer ends after its delay slot.
            if delay && ends_after(&mem, pc) {
                break;
            }
            delay = low.flow.branch;
            pc = pc.wrapping_add(4);
        }
    }
    let mut functions = Vec::new();
    for &start in &leaders {
        let mut insns = Vec::new();
        let mut pc = start;
        let mut delay = false;
        let guard_ram = mem.ram(start);
        let mut fallthrough = None;
        loop {
            let Some(w) = mem.word(pc) else { break };
            let low = lower(pc, w, delay);
            insns.push(IrInsn {
                addr: u64::from(pc),
                len: 4,
                text: low.text,
                op: IrOp::Guest(low.g),
            });
            if low.flow.fallback {
                break;
            }
            if delay && ends_after(&mem, pc) {
                break;
            }
            delay = low.flow.branch;
            let n = pc.wrapping_add(4);
            if !seen.contains_key(&n) || mem.word(n).is_none() {
                break;
            }
            // Split at leaders, but never between a branch and its delay slot, and never past
            // the BIOS call vectors (the core checks TTY output there).
            if !delay && (leaders.contains(&n) || matches!(n & 0x1fff_ffff, 0xa0 | 0xb0)) {
                fallthrough = Some(u64::from(n));
                break;
            }
            pc = n;
        }
        if insns.is_empty() {
            continue;
        }
        if guard_ram {
            // Entry guard: the code in RAM must still be what was lifted.
            let words: Vec<u32> = insns
                .iter()
                .filter_map(|i| mem.word(i.addr as u32))
                .collect();
            let h = code_hash(&words);
            if let Some(IrInsn {
                op: IrOp::Guest(g), ..
            }) = insns.first_mut()
            {
                let t = g.temps();
                let mut guarded = vec![
                    Stmt::Call {
                        f: "code_hash".into(),
                        args: vec![imm(start), imm(words.len() as u32)],
                        t: Some(t),
                    },
                    Stmt::Op {
                        t: t + 1,
                        op: Alu::Ne,
                        a: Val::Tmp { t },
                        b: imm(h),
                    },
                    Stmt::If {
                        c: Val::Tmp { t: t + 1 },
                        then: vec![Stmt::Fallback {
                            why: "code in RAM changed since lifting".into(),
                        }],
                        els: Vec::new(),
                    },
                ];
                guarded.append(&mut g.body);
                g.body = guarded;
            }
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
            isa: 0,
        });
    }
    let mut off = 0u64;
    let sections = mem
        .regions
        .iter()
        .map(|r| {
            let s = SectionEntry {
                name: r.name.into(),
                vaddr: u64::from(r.base),
                vsize: r.data.len() as u64,
                file_offset: off,
                file_size: r.data.len() as u64,
                exec: true,
                write: r.ram,
            };
            off += r.data.len() as u64;
            s
        })
        .collect();
    Ok(IrModule {
        schema_version: super::contract::SCHEMA_VERSION,
        format: "psx".into(),
        arch: "r3000a".into(),
        abi: Some(abi()),
        bits: 32,
        image_base: mem
            .regions
            .iter()
            .map(|r| u64::from(r.base))
            .min()
            .unwrap_or(0),
        entry: u64::from(entry),
        image_end: mem
            .regions
            .iter()
            .map(|r| u64::from(r.base) + r.data.len() as u64)
            .max()
            .unwrap_or(0),
        imports: Vec::new(),
        sections,
        functions,
    })
}

/// True when the instruction at `slot` is the delay slot of an unconditional transfer.
fn ends_after(mem: &Mem, slot: u32) -> bool {
    let Some(w) = mem.word(slot.wrapping_sub(4)) else {
        return false;
    };
    let low = lower(slot.wrapping_sub(4), w, false);
    low.flow.branch && low.flow.always
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jal_marks_return_and_target() {
        // jal 0x80010100 at 0x80010000
        let l = lower(0x8001_0000, 0x0C00_4040, false);
        assert!(l.flow.branch && l.flow.always);
        assert!(l.flow.targets.contains(&0x8001_0100));
        assert!(l.flow.targets.contains(&0x8001_0008));
    }

    #[test]
    fn exceptions_fall_back() {
        assert!(lower(0, 0x0000_000C, false).g.is_fallback()); // syscall
        assert!(lower(0, 0x4080_6000, false).g.is_fallback()); // mtc0
        assert!(!lower(0, 0x2402_0001, false).g.is_fallback()); // addiu v0, zero, 1
    }
}
