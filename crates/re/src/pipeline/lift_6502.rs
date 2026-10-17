// SPDX-License-Identifier: Apache-2.0
//! MOS 6502 (NES 2A03) lifter to guest semantics for the NES runtime of Bun Engine (TetaNES
//! device models).
//!
//! The NES clocks its PPU, APU and cartridge on every CPU bus cycle, so translated code keeps every
//! access of the TetaNES interpreter: the opcode fetch, the addressing-mode fetches and dummy
//! reads (performed by the core's own addressing functions), the operand read, the read-modify-
//! write dummy write and the final write, then the interrupt poll that ends each instruction. The
//! ALU, loads, stores, transfers and flag operations are lowered to IR; stack, subroutine,
//! branch and interrupt opcodes call the core's implementation; unofficial opcodes run in the
//! interpreter.
//!
//! Runtime contract (`machine = "nes"`): registers 0..=3 are `a x y s`; flags 0..=5 are
//! `n v d i z c`; helpers are `begin(addr)`, `operand(mode)`, `end(next) -> continue`,
//! `set_pc(pc)`, `branch(taken)`, `op(id)` for stack/subroutine opcodes and
//! `code_hash(addr, len)` (block entry guard against bank switching).

use super::ir::{Abi, IrBlock, IrFunction, IrInsn, IrModule, IrOp, SectionEntry};
use super::sem::{Alu, Builder, Guest, Stmt, Val, flag, imm, reg};
use std::collections::{BTreeMap, BTreeSet};

const A: u8 = 0;
const X: u8 = 1;
const Y: u8 = 2;
const S: u8 = 3;
const FN: u8 = 0;
const FV: u8 = 1;
const FD: u8 = 2;
const FI: u8 = 3;
const FZ: u8 = 4;
const FC: u8 = 5;

/// Lift limits.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Maximum number of decoded instructions.
    pub max_insns: usize,
}

/// Register file of the NES runtime.
#[must_use]
pub fn abi() -> Abi {
    Abi {
        regs: ["a", "x", "y", "s"]
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        link: "s".into(),
        sp: "s".into(),
        ret: "a".into(),
        machine: Some("nes".into()),
        flags: ["n", "v", "d", "i", "z", "c"]
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        isas: vec!["6502".into()],
    }
}

/// Addressing modes, in TetaNES `AddrMode` order (the runtime maps the index back).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Mode {
    Acc,
    Imp,
    Imm,
    Rel,
    Zp0,
    Abs,
    Zpx,
    Zpy,
    Ind,
    Idx,
    Idy,
    Idyw,
    Abx,
    Abxw,
    Aby,
    Abyw,
    Oth,
}

impl Mode {
    const fn len(self) -> u16 {
        match self {
            Self::Acc | Self::Imp => 1,
            Self::Imm
            | Self::Rel
            | Self::Zp0
            | Self::Zpx
            | Self::Zpy
            | Self::Idx
            | Self::Idy
            | Self::Idyw => 2,
            _ => 3,
        }
    }
}

use Mode::{
    Abs, Abx, Abxw, Aby, Abyw, Acc, Idx, Idy, Idyw, Imm, Imp, Ind, Oth, Rel, Zp0, Zpx, Zpy,
};

/// TetaNES opcode matrix: (operation, addressing mode).
#[rustfmt::skip]
const OPS: [(&str, Mode); 256] = [
    ("brk",Imm),("ora",Idx),("hlt",Imp),("slo",Idx),("nop",Zp0),("ora",Zp0),("aslm",Zp0),("slo",Zp0),("php",Imp),("ora",Imm),("asla",Acc),("anc",Imm),("nop",Abs),("ora",Abs),("aslm",Abs),("slo",Abs),
    ("bpl",Rel),("ora",Idy),("hlt",Imp),("slo",Idyw),("nop",Zpx),("ora",Zpx),("aslm",Zpx),("slo",Zpx),("clc",Imp),("ora",Aby),("nop",Imp),("slo",Abyw),("nop",Abx),("ora",Abx),("aslm",Abxw),("slo",Abxw),
    ("jsr",Oth),("and",Idx),("hlt",Imp),("rla",Idx),("bit",Zp0),("and",Zp0),("rolm",Zp0),("rla",Zp0),("plp",Imp),("and",Imm),("rola",Acc),("anc",Imm),("bit",Abs),("and",Abs),("rolm",Abs),("rla",Abs),
    ("bmi",Rel),("and",Idy),("hlt",Imp),("rla",Idyw),("nop",Zpx),("and",Zpx),("rolm",Zpx),("rla",Zpx),("sec",Imp),("and",Aby),("nop",Imp),("rla",Abyw),("nop",Abx),("and",Abx),("rolm",Abxw),("rla",Abxw),
    ("rti",Imp),("eor",Idx),("hlt",Imp),("sre",Idx),("nop",Zp0),("eor",Zp0),("lsrm",Zp0),("sre",Zp0),("pha",Imp),("eor",Imm),("lsra",Acc),("alr",Imm),("jmpa",Abs),("eor",Abs),("lsrm",Abs),("sre",Abs),
    ("bvc",Rel),("eor",Idy),("hlt",Imp),("sre",Idyw),("nop",Zpx),("eor",Zpx),("lsrm",Zpx),("sre",Zpx),("cli",Imp),("eor",Aby),("nop",Imp),("sre",Abyw),("nop",Abx),("eor",Abx),("lsrm",Abxw),("sre",Abxw),
    ("rts",Imp),("adc",Idx),("hlt",Imp),("rra",Idx),("nop",Zp0),("adc",Zp0),("rorm",Zp0),("rra",Zp0),("pla",Imp),("adc",Imm),("rora",Acc),("arr",Imm),("jmpi",Ind),("adc",Abs),("rorm",Abs),("rra",Abs),
    ("bvs",Rel),("adc",Idy),("hlt",Imp),("rra",Idyw),("nop",Zpx),("adc",Zpx),("rorm",Zpx),("rra",Zpx),("sei",Imp),("adc",Aby),("nop",Imp),("rra",Abyw),("nop",Abx),("adc",Abx),("rorm",Abxw),("rra",Abxw),
    ("nop",Imm),("sta",Idx),("nop",Imm),("sax",Idx),("sty",Zp0),("sta",Zp0),("stx",Zp0),("sax",Zp0),("dey",Imp),("nop",Imm),("txa",Imp),("xaa",Imm),("sty",Abs),("sta",Abs),("stx",Abs),("sax",Abs),
    ("bcc",Rel),("sta",Idyw),("hlt",Imp),("shaz",Oth),("sty",Zpx),("sta",Zpx),("stx",Zpy),("sax",Zpy),("tya",Imp),("sta",Abyw),("txs",Imp),("tas",Oth),("sya",Oth),("sta",Abxw),("sxa",Oth),("shaa",Oth),
    ("ldy",Imm),("lda",Idx),("ldx",Imm),("lax",Idx),("ldy",Zp0),("lda",Zp0),("ldx",Zp0),("lax",Zp0),("tay",Imp),("lda",Imm),("tax",Imp),("atx",Imm),("ldy",Abs),("lda",Abs),("ldx",Abs),("lax",Abs),
    ("bcs",Rel),("lda",Idy),("hlt",Imp),("lax",Idy),("ldy",Zpx),("lda",Zpx),("ldx",Zpy),("lax",Zpy),("clv",Imp),("lda",Aby),("tsx",Imp),("las",Aby),("ldy",Abx),("lda",Abx),("ldx",Aby),("lax",Aby),
    ("cpy",Imm),("cpa",Idx),("nop",Imm),("dcp",Idx),("cpy",Zp0),("cpa",Zp0),("dec",Zp0),("dcp",Zp0),("iny",Imp),("cpa",Imm),("dex",Imp),("axs",Imm),("cpy",Abs),("cpa",Abs),("dec",Abs),("dcp",Abs),
    ("bne",Rel),("cpa",Idy),("hlt",Imp),("dcp",Idyw),("nop",Zpx),("cpa",Zpx),("dec",Zpx),("dcp",Zpx),("cld",Imp),("cpa",Aby),("nop",Imp),("dcp",Abyw),("nop",Abx),("cpa",Abx),("dec",Abxw),("dcp",Abxw),
    ("cpx",Imm),("sbc",Idx),("nop",Imm),("isb",Idx),("cpx",Zp0),("sbc",Zp0),("inc",Zp0),("isb",Zp0),("inx",Imp),("sbc",Imm),("nop",Imp),("sbc",Imm),("cpx",Abs),("sbc",Abs),("inc",Abs),("isb",Abs),
    ("beq",Rel),("sbc",Idy),("hlt",Imp),("isb",Idyw),("nop",Zpx),("sbc",Zpx),("inc",Zpx),("isb",Zpx),("sed",Imp),("sbc",Aby),("nop",Imp),("isb",Abyw),("nop",Abx),("sbc",Abx),("inc",Abxw),("isb",Abxw),
];

/// Stack, subroutine and system opcodes executed by the core's own implementation (`op(id)`).
const CORE_OPS: [&str; 8] = ["jsr", "rts", "rti", "brk", "php", "plp", "pha", "pla"];

/// FNV-1a over code bytes (shared with the runtime's `code_hash`).
#[must_use]
pub fn code_hash(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in bytes {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

struct Mem {
    /// (cpu base, bytes) windows of fixed PRG banks.
    windows: Vec<(u16, Vec<u8>)>,
}

impl Mem {
    fn byte(&self, addr: u16) -> Option<u8> {
        self.windows.iter().find_map(|(base, d)| {
            addr.checked_sub(*base)
                .and_then(|o| d.get(o as usize).copied())
        })
    }
    fn bytes(&self, addr: u16, n: u16) -> Option<Vec<u8>> {
        (0..n).map(|i| self.byte(addr.wrapping_add(i))).collect()
    }
}

struct Lowered {
    g: Guest,
    text: String,
    /// Static successors.
    targets: Vec<u16>,
    /// Execution may continue at the next instruction.
    falls: bool,
}

fn nz(b: &mut Builder, v: Val) {
    let n = b.op(Alu::Shr, v, imm(7));
    b.set_flag(FN, n);
    let z = b.op(Alu::Eq, v, imm(0));
    b.set_flag(FZ, z);
}

#[allow(clippy::too_many_lines)]
fn lower(pc: u16, bytes: &[u8]) -> Lowered {
    let opcode = bytes[0];
    let (name, mode) = OPS[usize::from(opcode)];
    let len = mode.len();
    let next = pc.wrapping_add(len);
    let operand_text = match mode {
        Acc => "a".to_string(),
        Imp | Oth => String::new(),
        Imm => format!("#${:02x}", bytes.get(1).copied().unwrap_or(0)),
        Rel => format!(
            "${:04x}",
            next.wrapping_add(i16::from(bytes.get(1).copied().unwrap_or(0) as i8) as u16)
        ),
        Zp0 => format!("${:02x}", bytes[1]),
        Zpx => format!("${:02x},x", bytes[1]),
        Zpy => format!("${:02x},y", bytes[1]),
        Idx => format!("(${:02x},x)", bytes[1]),
        Idy | Idyw => format!("(${:02x}),y", bytes[1]),
        Abs => format!("${:04x}", u16::from_le_bytes([bytes[1], bytes[2]])),
        Ind => format!("(${:04x})", u16::from_le_bytes([bytes[1], bytes[2]])),
        Abx | Abxw => format!("${:04x},x", u16::from_le_bytes([bytes[1], bytes[2]])),
        Aby | Abyw => format!("${:04x},y", u16::from_le_bytes([bytes[1], bytes[2]])),
    };
    let text = format!("{name} {operand_text}").trim_end().to_string();
    let raw = bytes
        .iter()
        .take(usize::from(len))
        .enumerate()
        .fold(0u32, |a, (i, b)| a | (u32::from(*b) << (8 * i)));
    let unofficial = !matches!(
        name,
        "brk"
            | "ora"
            | "nop"
            | "aslm"
            | "php"
            | "asla"
            | "bpl"
            | "clc"
            | "jsr"
            | "and"
            | "bit"
            | "rolm"
            | "plp"
            | "rola"
            | "bmi"
            | "sec"
            | "rti"
            | "eor"
            | "lsrm"
            | "pha"
            | "lsra"
            | "jmpa"
            | "bvc"
            | "cli"
            | "rts"
            | "adc"
            | "rorm"
            | "pla"
            | "rora"
            | "jmpi"
            | "bvs"
            | "sei"
            | "sta"
            | "sty"
            | "stx"
            | "dey"
            | "txa"
            | "bcc"
            | "tya"
            | "txs"
            | "ldy"
            | "lda"
            | "ldx"
            | "tay"
            | "tax"
            | "bcs"
            | "clv"
            | "tsx"
            | "cpy"
            | "cpa"
            | "dec"
            | "iny"
            | "dex"
            | "bne"
            | "cld"
            | "cpx"
            | "sbc"
            | "inc"
            | "inx"
            | "beq"
            | "sed"
    );
    if unofficial {
        return Lowered {
            g: Guest {
                raw,
                body: vec![Stmt::Fallback {
                    why: format!("unofficial opcode {name}"),
                }],
            },
            text,
            targets: vec![next],
            falls: false,
        };
    }
    let mut b = Builder::new();
    b.call("begin", &[imm(u32::from(pc))]);
    let operand = b.call_v("operand", &[imm(mode as u32)]);
    // Value read by `read_operand`: the operand itself for immediate/relative/implied modes.
    let value = |b: &mut Builder| {
        if matches!(mode, Acc | Imp | Imm | Rel) {
            operand
        } else {
            b.load(8, operand, 0)
        }
    };
    let mut targets = Vec::new();
    let mut falls = true;
    match name {
        "lda" | "ldx" | "ldy" => {
            let v = value(&mut b);
            b.set(
                match name {
                    "lda" => A,
                    "ldx" => X,
                    _ => Y,
                },
                v,
            );
            nz(&mut b, v);
        }
        "sta" | "stx" | "sty" => b.store(
            8,
            operand,
            reg(match name {
                "sta" => A,
                "stx" => X,
                _ => Y,
            }),
            0,
        ),
        "tax" | "tay" | "tsx" | "txa" | "tya" => {
            let (d, s) = match name {
                "tax" => (X, A),
                "tay" => (Y, A),
                "tsx" => (X, S),
                "txa" => (A, X),
                _ => (A, Y),
            };
            b.set(d, reg(s));
            nz(&mut b, reg(s));
        }
        "txs" => b.set(S, reg(X)),
        "adc" | "sbc" => {
            let v0 = value(&mut b);
            let v = if name == "sbc" {
                b.op(Alu::Xor, v0, imm(0xff))
            } else {
                v0
            };
            let s1 = b.op(Alu::Add, reg(A), v);
            let s = b.op(Alu::Add, s1, flag(FC));
            let r = b.op(Alu::And, s, imm(0xff));
            nz(&mut b, r);
            let av = b.op(Alu::Xor, reg(A), v);
            let nav = b.op(Alu::Not, av, imm(0));
            let ar = b.op(Alu::Xor, reg(A), s);
            let o = b.op(Alu::And, nav, ar);
            let o = b.op(Alu::Shr, o, imm(7));
            let o = b.op(Alu::And, o, imm(1));
            b.set_flag(FV, o);
            let c = b.op(Alu::Shr, s, imm(8));
            b.set_flag(FC, c);
            b.set(A, r);
        }
        "and" | "eor" | "ora" => {
            let v = value(&mut b);
            let r = b.op(
                match name {
                    "and" => Alu::And,
                    "eor" => Alu::Xor,
                    _ => Alu::Or,
                },
                reg(A),
                v,
            );
            b.set(A, r);
            nz(&mut b, r);
        }
        "cpa" | "cpx" | "cpy" => {
            let v = value(&mut b);
            let rr = reg(match name {
                "cpa" => A,
                "cpx" => X,
                _ => Y,
            });
            let d = b.op(Alu::Sub, rr, v);
            let d = b.op(Alu::And, d, imm(0xff));
            let c = b.op(Alu::Leu, v, rr);
            b.set_flag(FC, c);
            nz(&mut b, d);
        }
        "bit" => {
            let v = value(&mut b);
            let av = b.op(Alu::And, reg(A), v);
            let z = b.op(Alu::Eq, av, imm(0));
            b.set_flag(FZ, z);
            let n = b.op(Alu::Shr, v, imm(7));
            b.set_flag(FN, n);
            let o = b.op(Alu::Shr, v, imm(6));
            let o = b.op(Alu::And, o, imm(1));
            b.set_flag(FV, o);
        }
        "inc" | "dec" => {
            let v = b.load(8, operand, 0);
            b.store(8, operand, v, 0);
            let r = b.op(if name == "inc" { Alu::Add } else { Alu::Sub }, v, imm(1));
            let r = b.op(Alu::And, r, imm(0xff));
            b.store(8, operand, r, 0);
            nz(&mut b, r);
        }
        "inx" | "iny" | "dex" | "dey" => {
            let rr = if name.ends_with('x') { X } else { Y };
            let r = b.op(
                if name.starts_with("in") {
                    Alu::Add
                } else {
                    Alu::Sub
                },
                reg(rr),
                imm(1),
            );
            let r = b.op(Alu::And, r, imm(0xff));
            b.set(rr, r);
            nz(&mut b, r);
        }
        "asla" | "aslm" | "lsra" | "lsrm" | "rola" | "rolm" | "rora" | "rorm" => {
            let mem = name.ends_with('m');
            let v = if mem {
                let v = b.load(8, operand, 0);
                b.store(8, operand, v, 0);
                v
            } else {
                reg(A)
            };
            let (r, c) = match &name[..3] {
                "asl" => {
                    let r = b.op(Alu::Shl, v, imm(1));
                    (b.op(Alu::And, r, imm(0xff)), b.op(Alu::Shr, v, imm(7)))
                }
                "lsr" => (b.op(Alu::Shr, v, imm(1)), b.op(Alu::And, v, imm(1))),
                "rol" => {
                    let r = b.op(Alu::Shl, v, imm(1));
                    let r = b.op(Alu::Or, r, flag(FC));
                    (b.op(Alu::And, r, imm(0xff)), b.op(Alu::Shr, v, imm(7)))
                }
                _ => {
                    let r = b.op(Alu::Shr, v, imm(1));
                    let c7 = b.op(Alu::Shl, flag(FC), imm(7));
                    (b.op(Alu::Or, r, c7), b.op(Alu::And, v, imm(1)))
                }
            };
            b.set_flag(FC, c);
            nz(&mut b, r);
            if mem {
                b.store(8, operand, r, 0);
            } else {
                b.set(A, r);
            }
        }
        "clc" | "sec" | "cld" | "sed" | "cli" | "sei" | "clv" => {
            let (f, v) = match name {
                "clc" => (FC, 0),
                "sec" => (FC, 1),
                "cld" => (FD, 0),
                "sed" => (FD, 1),
                "cli" => (FI, 0),
                "sei" => (FI, 1),
                _ => (FV, 0),
            };
            b.set_flag(f, imm(v));
        }
        "nop" => {
            let _ = value(&mut b);
        }
        "bpl" | "bmi" | "bvc" | "bvs" | "bcc" | "bcs" | "bne" | "beq" => {
            let (f, set) = match name {
                "bpl" => (FN, false),
                "bmi" => (FN, true),
                "bvc" => (FV, false),
                "bvs" => (FV, true),
                "bcc" => (FC, false),
                "bcs" => (FC, true),
                "bne" => (FZ, false),
                _ => (FZ, true),
            };
            let c = if set {
                flag(f)
            } else {
                b.op(Alu::Xor, flag(f), imm(1))
            };
            b.call("branch", &[c]);
            targets.push(next.wrapping_add(i16::from(bytes[1] as i8) as u16));
        }
        "jmpa" => {
            b.call("set_pc", &[operand]);
            targets.push(u16::from_le_bytes([bytes[1], bytes[2]]));
            falls = false;
        }
        "jmpi" => {
            b.call("op", &[imm(8)]);
            falls = false;
        }
        n if CORE_OPS.contains(&n) => {
            let id = CORE_OPS.iter().position(|o| *o == n).unwrap_or(0) as u32;
            b.call("op", &[imm(id)]);
            match n {
                "jsr" => {
                    targets.push(u16::from_le_bytes([bytes[1], bytes[2]]));
                    targets.push(pc.wrapping_add(3));
                    falls = false;
                }
                "rts" | "rti" => falls = false,
                "brk" => {
                    targets.push(pc.wrapping_add(2));
                    falls = false;
                }
                _ => {}
            }
        }
        _ => {
            return Lowered {
                g: Guest {
                    raw,
                    body: vec![Stmt::Fallback {
                        why: format!("{name} is not lifted"),
                    }],
                },
                text,
                targets: vec![next],
                falls: false,
            };
        }
    }
    // End of instruction: interrupt poll; leave when control did not reach the next instruction.
    let cont = b.call_v("end", &[imm(u32::from(next))]);
    let stop = b.op(Alu::Eq, cont, imm(0));
    b.if_else(stop, |b| b.exit(), |_| {});
    Lowered {
        g: b.finish(raw),
        text,
        targets,
        falls,
    }
}

/// Lift the fixed PRG banks of an iNES cartridge.
///
/// # Errors
/// Returns why the cartridge cannot be lifted.
pub fn lift_ines(rom: &[u8], limits: Limits) -> Result<IrModule, String> {
    if !rom.starts_with(b"NES\x1a") || rom.len() < 16 {
        return Err("not an iNES image".into());
    }
    let prg_banks = usize::from(rom[4]);
    let mapper = (rom[6] >> 4) | (rom[7] & 0xf0);
    let start = 16 + if rom[6] & 4 != 0 { 512 } else { 0 };
    let prg = rom
        .get(start..start + prg_banks * 0x4000)
        .ok_or("PRG-ROM truncated")?;
    if prg.is_empty() {
        return Err("no PRG-ROM".into());
    }
    let last = &prg[prg.len() - 0x4000..];
    // Windows whose contents are known at power-on; banked windows are guarded at run time.
    let windows: Vec<(u16, Vec<u8>)> = match mapper {
        0 | 3 => {
            if prg_banks == 1 {
                vec![(0x8000, prg.to_vec()), (0xc000, prg.to_vec())]
            } else {
                vec![(0x8000, prg[..0x8000].to_vec())]
            }
        }
        // MMC3: the last 8 KiB are fixed at $E000.
        4 => vec![(0xe000, prg[prg.len() - 0x2000..].to_vec())],
        // 32 KiB switchable boards start on bank 0.
        7 | 34 | 11 | 66 => vec![(0x8000, prg[..prg.len().min(0x8000)].to_vec())],
        // UxROM, MMC1 and most others: the last 16 KiB bank is fixed at $C000.
        _ => vec![(0xc000, last.to_vec())],
    };
    // NROM and CNROM never switch PRG: their blocks need no bank guard.
    let banked = !matches!(mapper, 0 | 3);
    let mem = Mem { windows };
    let vec = |a: u16| {
        mem.byte(a)
            .zip(mem.byte(a + 1))
            .map(|(l, h)| u16::from_le_bytes([l, h]))
    };
    let mut entries = Vec::new();
    for v in [0xfffc, 0xfffa, 0xfffe] {
        if let Some(t) = vec(v) {
            entries.push(t);
        }
    }
    let reset = vec(0xfffc).ok_or("no reset vector in the fixed bank")?;
    let fetch = |pc: u16| {
        mem.byte(pc)
            .and_then(|op| mem.bytes(pc, OPS[usize::from(op)].1.len()))
    };
    let mut leaders: BTreeSet<u16> = BTreeSet::new();
    let mut seen: BTreeMap<u16, u16> = BTreeMap::new();
    let mut work = Vec::new();
    for e in entries {
        if fetch(e).is_some() && leaders.insert(e) {
            work.push(e);
        }
    }
    let mut budget = limits.max_insns;
    while let Some(start) = work.pop() {
        let mut pc = start;
        loop {
            if budget == 0 || (seen.contains_key(&pc) && pc != start) {
                break;
            }
            let Some(bytes) = fetch(pc) else { break };
            budget -= 1;
            let low = lower(pc, &bytes);
            seen.insert(pc, bytes.len() as u16);
            for &t in &low.targets {
                if fetch(t).is_some() && leaders.insert(t) {
                    work.push(t);
                }
            }
            if !low.falls {
                break;
            }
            pc = pc.wrapping_add(bytes.len() as u16);
        }
    }
    let mut functions = Vec::new();
    for &start in &leaders {
        let mut insns = Vec::new();
        let mut code = Vec::new();
        let mut pc = start;
        let mut fallthrough = None;
        loop {
            let Some(bytes) = fetch(pc) else { break };
            let low = lower(pc, &bytes);
            code.extend_from_slice(&bytes);
            insns.push(IrInsn {
                addr: u64::from(pc),
                len: bytes.len() as u8,
                text: low.text,
                op: IrOp::Guest(low.g),
            });
            if !low.falls {
                break;
            }
            let n = pc.wrapping_add(bytes.len() as u16);
            if !seen.contains_key(&n) {
                break;
            }
            if leaders.contains(&n) {
                fallthrough = Some(u64::from(n));
                break;
            }
            pc = n;
        }
        if insns.is_empty() {
            continue;
        }
        // Entry guard: the mapped bank must still hold the lifted code (boards that switch PRG).
        let h = code_hash(&code);
        if let Some(IrInsn {
            op: IrOp::Guest(g), ..
        }) = insns.first_mut().filter(|_| banked)
        {
            let t = g.temps();
            let mut guarded = vec![
                Stmt::Call {
                    f: "code_hash".into(),
                    args: vec![imm(u32::from(start)), imm(code.len() as u32)],
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
                        why: "bank switched since lifting".into(),
                    }],
                    els: Vec::new(),
                },
            ];
            guarded.append(&mut g.body);
            g.body = guarded;
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
        .windows
        .iter()
        .map(|(base, d)| {
            let s = SectionEntry {
                name: format!("prg_{base:04x}"),
                vaddr: u64::from(*base),
                vsize: d.len() as u64,
                file_offset: off,
                file_size: d.len() as u64,
                exec: true,
                write: false,
            };
            off += d.len() as u64;
            s
        })
        .collect();
    Ok(IrModule {
        schema_version: super::contract::SCHEMA_VERSION,
        format: "nes".into(),
        arch: "6502".into(),
        abi: Some(abi()),
        bits: 16,
        image_base: mem
            .windows
            .iter()
            .map(|w| u64::from(w.0))
            .min()
            .unwrap_or(0x8000),
        entry: u64::from(reset),
        image_end: 0x1_0000,
        imports: Vec::new(),
        sections,
        functions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opcode_table_lengths() {
        assert_eq!(OPS[0x20], ("jsr", Oth));
        assert_eq!(OPS[0x20].1.len(), 3);
        assert_eq!(OPS[0xa9], ("lda", Imm));
        assert_eq!(OPS[0x6c], ("jmpi", Ind));
    }

    #[test]
    fn jsr_targets() {
        let l = lower(0x8000, &[0x20, 0x34, 0x12]);
        assert_eq!(l.targets, vec![0x1234, 0x8003]);
        assert!(!l.falls);
    }

    #[test]
    fn unofficial_falls_back() {
        assert!(lower(0x8000, &[0xa7, 0x10]).g.is_fallback());
        assert!(!lower(0x8000, &[0xa9, 0x10]).g.is_fallback());
    }
}
