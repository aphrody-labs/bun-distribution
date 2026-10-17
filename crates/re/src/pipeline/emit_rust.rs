// SPDX-License-Identifier: Apache-2.0
//! Rust emitter: [`IrModule`] to a single compilable `lifted.rs` (runtime + one function per lifted
//! function, each a `loop { match pc { .. } }` block state machine).

use super::ir::{BinKind, Cond, Ext, IrFunction, IrModule, IrOp, Operand, Target, UnKind};
use std::collections::BTreeSet;
use std::fmt::Write;

const RUNTIME: &str = r#"
use std::cell::Cell;

pub const RAX: usize = 0;
pub const RCX: usize = 1;
pub const RDX: usize = 2;
pub const RBX: usize = 3;
pub const RSP: usize = 4;
pub const RBP: usize = 5;
pub const RSI: usize = 6;
pub const RDI: usize = 7;
pub const R8: usize = 8;
pub const R9: usize = 9;
pub const R10: usize = 10;
pub const R11: usize = 11;
pub const R12: usize = 12;
pub const R13: usize = 13;
pub const R14: usize = 14;
pub const R15: usize = 15;

/// Guest machine state: registers, flags and a flat memory arena addressed by guest virtual address.
pub struct Cpu {
    pub r: [u64; 16],
    pub zf: bool,
    pub sf: bool,
    pub cf: bool,
    pub of: bool,
    pub mem: Vec<u8>,
    /// Set when execution reached unmodelled code: (address, reason).
    pub trap: Cell<Option<u64>>,
    pub import_log: Vec<usize>,
}

#[inline]
fn mask(bits: u32) -> u64 {
    if bits >= 64 { u64::MAX } else { (1u64 << bits) - 1 }
}

impl Cpu {
    /// Build a CPU with the image sections copied into the arena (`image` is the `image.bin` blob).
    pub fn new(image: &[u8]) -> Self {
        let mut mem = vec![0u8; (LIMIT - BASE) as usize];
        for &(va, off, len) in SECTIONS {
            let (va, off, len) = ((va - BASE) as usize, off as usize, len as usize);
            if let Some(src) = image.get(off..off + len) {
                mem[va..va + len].copy_from_slice(src);
            }
        }
        let mut c = Cpu { r: [0; 16], zf: false, sf: false, cf: false, of: false, mem, trap: Cell::new(None), import_log: Vec::new() };
        c.r[RSP] = LIMIT - 64;
        c
    }

    pub fn get(&self, r: usize, bits: u32, high: bool) -> u64 {
        if high { (self.r[r] >> 8) & 0xff } else { self.r[r] & mask(bits) }
    }

    pub fn set(&mut self, r: usize, bits: u32, high: bool, v: u64) {
        let v = v & mask(bits);
        self.r[r] = match (bits, high) {
            (64, _) => v,
            (32, _) => v,
            (8, true) => (self.r[r] & !0xff00) | (v << 8),
            _ => (self.r[r] & !mask(bits)) | v,
        };
    }

    fn range(&self, a: u64, n: usize) -> Option<std::ops::Range<usize>> {
        if a < BASE || a + n as u64 > LIMIT {
            self.trap.set(Some(a));
            return None;
        }
        let o = (a - BASE) as usize;
        Some(o..o + n)
    }

    pub fn rd(&self, a: u64, bytes: usize) -> u64 {
        let Some(rg) = self.range(a, bytes) else { return 0 };
        let mut v = 0u64;
        for (i, b) in self.mem[rg].iter().enumerate() {
            v |= u64::from(*b) << (8 * i);
        }
        v
    }

    pub fn wr(&mut self, a: u64, bytes: usize, v: u64) {
        let Some(rg) = self.range(a, bytes) else { return };
        for (i, b) in self.mem[rg].iter_mut().enumerate() {
            *b = (v >> (8 * i)) as u8;
        }
    }

    fn zs(&mut self, r: u64, bits: u32) {
        self.zf = r & mask(bits) == 0;
        self.sf = (r >> (bits - 1)) & 1 == 1;
    }

    pub fn fl_add(&mut self, a: u64, b: u64, r: u64, bits: u32) {
        self.zs(r, bits);
        self.cf = (r & mask(bits)) < (a & mask(bits));
        self.of = ((!(a ^ b) & (a ^ r)) >> (bits - 1)) & 1 == 1;
    }

    pub fn fl_sub(&mut self, a: u64, b: u64, r: u64, bits: u32) {
        self.zs(r, bits);
        self.cf = (a & mask(bits)) < (b & mask(bits));
        self.of = (((a ^ b) & (a ^ r)) >> (bits - 1)) & 1 == 1;
    }

    pub fn fl_logic(&mut self, r: u64, bits: u32) {
        self.zs(r, bits);
        self.cf = false;
        self.of = false;
    }

    pub fn push(&mut self, v: u64, bytes: usize) {
        self.r[RSP] = self.r[RSP].wrapping_sub(bytes as u64);
        let sp = self.r[RSP];
        self.wr(sp, bytes, v);
    }

    pub fn pop(&mut self, bytes: usize) -> u64 {
        let v = self.rd(self.r[RSP], bytes);
        self.r[RSP] = self.r[RSP].wrapping_add(bytes as u64);
        v
    }

    pub fn import(&mut self, idx: usize) {
        self.import_log.push(idx);
        self.r[RAX] = 0;
    }

    pub fn trap_at(&self, a: u64) {
        self.trap.set(Some(a));
    }
}
"#;

fn ridx(name: &str) -> &'static str {
    match name {
        "rax" => "RAX",
        "rcx" => "RCX",
        "rdx" => "RDX",
        "rbx" => "RBX",
        "rsp" => "RSP",
        "rbp" => "RBP",
        "rsi" => "RSI",
        "rdi" => "RDI",
        "r8" => "R8",
        "r9" => "R9",
        "r10" => "R10",
        "r11" => "R11",
        "r12" => "R12",
        "r13" => "R13",
        "r14" => "R14",
        _ => "R15",
    }
}

fn mask_lit(bits: u8) -> String {
    if bits >= 64 {
        "u64::MAX".into()
    } else {
        format!("0x{:x}u64", (1u64 << bits) - 1)
    }
}

struct Em<'a> {
    abits: u8,
    funcs: &'a BTreeSet<u64>,
    local: BTreeSet<u64>,
}

impl Em<'_> {
    fn addr(&self, op: &Operand) -> String {
        let Operand::Mem {
            base,
            index,
            scale,
            disp,
            ..
        } = op
        else {
            return "0u64".into();
        };
        let mut s = format!("0x{:x}u64", *disp as u64);
        if let Some(b) = base {
            let _ = write!(s, ".wrapping_add(c.r[{}])", ridx(b));
        }
        if let Some(i) = index {
            let _ = write!(
                s,
                ".wrapping_add(c.r[{}].wrapping_mul({}))",
                ridx(i),
                scale.max(&1)
            );
        }
        if self.abits == 32 {
            format!("({s} & 0xffff_ffffu64)")
        } else {
            format!("({s})")
        }
    }

    fn rd(&self, op: &Operand, bits: u8) -> String {
        match op {
            Operand::Reg {
                name,
                bits: b,
                high,
            } => format!("c.get({}, {b}, {high})", ridx(name)),
            Operand::Imm { value } => format!("(0x{:x}u64 & {})", *value as u64, mask_lit(bits)),
            Operand::Mem { bits: mb, .. } => format!("c.rd({}, {})", self.addr(op), mb / 8),
        }
    }

    fn wr(&self, op: &Operand, v: &str) -> String {
        match op {
            Operand::Reg { name, bits, high } => {
                format!("c.set({}, {bits}, {high}, {v});", ridx(name))
            }
            Operand::Mem { bits, .. } => format!("c.wr({}, {}, {v});", self.addr(op), bits / 8),
            Operand::Imm { .. } => "/* immediate destination */".into(),
        }
    }

    fn cond(c: Cond) -> &'static str {
        match c {
            Cond::O => "c.of",
            Cond::No => "!c.of",
            Cond::B => "c.cf",
            Cond::Ae => "!c.cf",
            Cond::E => "c.zf",
            Cond::Ne => "!c.zf",
            Cond::Be => "(c.cf || c.zf)",
            Cond::A => "(!c.cf && !c.zf)",
            Cond::S => "c.sf",
            Cond::Ns => "!c.sf",
            Cond::L => "(c.sf != c.of)",
            Cond::Ge => "(c.sf == c.of)",
            Cond::Le => "(c.zf || c.sf != c.of)",
            Cond::G => "(!c.zf && c.sf == c.of)",
        }
    }

    fn jump(&self, t: u64) -> String {
        if self.local.contains(&t) {
            format!("{{ pc = 0x{t:x}; continue; }}")
        } else if self.funcs.contains(&t) {
            format!("{{ sub_{t:x}(c); return; }}")
        } else {
            format!("{{ c.trap_at(0x{t:x}); return; }}")
        }
    }

    fn op(&self, a: u64, next: u64, op: &IrOp, out: &mut String) {
        let w = |o: &Operand| o.bits().unwrap_or(64);
        let word = self.abits / 8;
        let s = match op {
            IrOp::Nop => String::new(),
            IrOp::Mov { dst, src, ext } => {
                let d = w(dst);
                let sb = src.bits().unwrap_or(d);
                match ext {
                    Ext::None => self.wr(dst, &self.rd(src, d)),
                    Ext::Zero => self.wr(dst, &self.rd(src, sb)),
                    Ext::Sign => self.wr(
                        dst,
                        &format!(
                            "((({} << {}) as i64) >> {}) as u64",
                            self.rd(src, sb),
                            64 - sb,
                            64 - sb
                        ),
                    ),
                }
            }
            IrOp::Lea { dst, src } => self.wr(dst, &self.addr(src)),
            IrOp::Bin { kind, dst, src } => {
                let d = w(dst);
                let m = mask_lit(d);
                let av = self.rd(dst, d);
                match kind {
                    BinKind::Add | BinKind::Sub | BinKind::And | BinKind::Or | BinKind::Xor => {
                        let (e, fl) = match kind {
                            BinKind::Add => {
                                ("a.wrapping_add(b)", format!("c.fl_add(a, b, r, {d});"))
                            }
                            BinKind::Sub => {
                                ("a.wrapping_sub(b)", format!("c.fl_sub(a, b, r, {d});"))
                            }
                            BinKind::And => ("a & b", format!("c.fl_logic(r, {d});")),
                            BinKind::Or => ("a | b", format!("c.fl_logic(r, {d});")),
                            _ => ("a ^ b", format!("c.fl_logic(r, {d});")),
                        };
                        format!(
                            "{{ let a = {av}; let b = {}; let r = ({e}) & {m}; {fl} {} }}",
                            self.rd(src, d),
                            self.wr(dst, "r")
                        )
                    }
                    BinKind::Mul => {
                        format!(
                            "{{ let a = {av}; let b = {}; let r = a.wrapping_mul(b) & {m}; {} }}",
                            self.rd(src, d),
                            self.wr(dst, "r")
                        )
                    }
                    _ => {
                        let cnt = if d == 64 { 63 } else { 31 };
                        let (e, cf) = match kind {
                            BinKind::Shl => (
                                format!("(a << n) & {m}"),
                                format!("c.cf = n <= {d} && (a >> ({d} - n)) & 1 == 1;"),
                            ),
                            BinKind::Shr => (
                                "a >> n".to_string(),
                                "c.cf = (a >> (n - 1)) & 1 == 1;".to_string(),
                            ),
                            _ => (
                                format!("((((a << {0}) as i64) >> {0}) >> n) as u64 & {m}", 64 - d),
                                format!(
                                    "c.cf = ((((a << {0}) as i64) >> {0}) >> (n - 1)) & 1 == 1;",
                                    64 - d
                                ),
                            ),
                        };
                        format!(
                            "{{ let a = {av}; let n = ({} & {cnt}) as u32; if n != 0 {{ let r = {e}; c.fl_logic(r, {d}); {cf} {} }} }}",
                            self.rd(src, 8),
                            self.wr(dst, "r")
                        )
                    }
                }
            }
            IrOp::Un { kind, dst } => {
                let d = w(dst);
                let m = mask_lit(d);
                let av = self.rd(dst, d);
                let body = match kind {
                    UnKind::Inc => {
                        format!(
                            "let r = a.wrapping_add(1) & {m}; c.fl_logic(r, {d}); c.of = r == 1u64 << {};",
                            d - 1
                        )
                    }
                    UnKind::Dec => {
                        format!(
                            "let r = a.wrapping_sub(1) & {m}; c.fl_logic(r, {d}); c.of = a == 1u64 << {};",
                            d - 1
                        )
                    }
                    UnKind::Neg => {
                        format!("let r = 0u64.wrapping_sub(a) & {m}; c.fl_sub(0, a, r, {d});")
                    }
                    UnKind::Not => format!("let r = !a & {m};"),
                };
                let cf_keep = if matches!(kind, UnKind::Inc | UnKind::Dec) {
                    "let cf = c.cf; "
                } else {
                    ""
                };
                let cf_restore = if matches!(kind, UnKind::Inc | UnKind::Dec) {
                    " c.cf = cf;"
                } else {
                    ""
                };
                format!(
                    "{{ let a = {av}; {cf_keep}{body}{cf_restore} {} }}",
                    self.wr(dst, "r")
                )
            }
            IrOp::Cmp { a, b } => {
                let d = w(a);
                format!(
                    "{{ let a = {}; let b = {}; let r = a.wrapping_sub(b) & {}; c.fl_sub(a, b, r, {d}); }}",
                    self.rd(a, d),
                    self.rd(b, d),
                    mask_lit(d)
                )
            }
            IrOp::Test { a, b } => {
                let d = w(a);
                format!(
                    "{{ let r = {} & {}; c.fl_logic(r, {d}); }}",
                    self.rd(a, d),
                    self.rd(b, d)
                )
            }
            IrOp::Push { src } => format!(
                "{{ let v = {}; c.push(v, {word}); }}",
                self.rd(src, self.abits)
            ),
            IrOp::Pop { dst } => format!("{{ let v = c.pop({word}); {} }}", self.wr(dst, "v")),
            IrOp::Leave => {
                format!("c.r[RSP] = c.r[RBP]; {{ let v = c.pop({word}); c.r[RBP] = v; }}")
            }
            IrOp::Setcc { cond, dst } => self.wr(dst, &format!("u64::from({})", Self::cond(*cond))),
            IrOp::Cmovcc { cond, dst, src } => {
                let d = w(dst);
                self.wr(
                    dst,
                    &format!(
                        "if {} {{ {} }} else {{ {} }}",
                        Self::cond(*cond),
                        self.rd(src, d),
                        self.rd(dst, d)
                    ),
                )
            }
            IrOp::Call { target } => match target {
                Target::Direct { addr } if self.funcs.contains(addr) => {
                    format!("{{ c.push(0x{next:x}, {word}); sub_{addr:x}(c); }}")
                }
                Target::Direct { addr } => {
                    format!("{{ c.push(0x{next:x}, {word}); dispatch(c, 0x{addr:x}); }}")
                }
                Target::Import { index, name } => {
                    format!("c.import({index}); /* {} */", name.replace("*/", ""))
                }
                Target::Indirect { operand } => format!(
                    "{{ let t = {}; c.push(0x{next:x}, {word}); dispatch(c, t); }}",
                    self.rd(operand, self.abits)
                ),
            },
            IrOp::Jmp { target } => match target {
                Target::Direct { addr } => self.jump(*addr),
                Target::Import { index, name } => {
                    format!(
                        "{{ c.import({index}); /* {} */ c.r[RSP] = c.r[RSP].wrapping_add({word}); return; }}",
                        name.replace("*/", "")
                    )
                }
                Target::Indirect { operand } => {
                    format!(
                        "{{ let t = {}; dispatch(c, t); return; }}",
                        self.rd(operand, self.abits)
                    )
                }
            },
            IrOp::Jcc { cond, target } => {
                format!("if {} {}", Self::cond(*cond), self.jump(*target))
            }
            IrOp::Ret { pop } => {
                format!(
                    "{{ c.r[RSP] = c.r[RSP].wrapping_add({}); return; }}",
                    u32::from(word) + u32::from(*pop)
                )
            }
            IrOp::Unlifted { .. } | IrOp::Guest(_) => format!("{{ c.trap_at(0x{a:x}); return; }}"),
        };
        if !s.is_empty() {
            let _ = writeln!(out, "                {s}");
        }
    }

    fn func(&mut self, f: &IrFunction, out: &mut String) {
        self.local = f.blocks.iter().map(|b| b.addr).collect();
        let nm = f.name.as_deref().unwrap_or("").replace(['\n', '\r'], " ");
        let _ = writeln!(
            out,
            "/// {nm}\npub fn sub_{0:x}(c: &mut Cpu) {{\n    let mut pc: u64 = 0x{0:x};\n    loop {{\n        if c.trap.get().is_some() {{ return; }}\n        match pc {{",
            f.addr
        );
        for b in &f.blocks {
            let _ = writeln!(out, "            0x{:x} => {{", b.addr);
            for ins in &b.insns {
                let _ = writeln!(
                    out,
                    "                // {:x}: {}",
                    ins.addr,
                    ins.text.replace(['\n', '\r'], " ")
                );
                self.op(ins.addr, ins.addr + u64::from(ins.len), &ins.op, out);
            }
            if let Some(ft) = b.fallthrough {
                let _ = writeln!(out, "                {}", self.jump(ft));
            }
            let _ = writeln!(out, "            }}");
        }
        let _ = writeln!(
            out,
            "            _ => {{ c.trap_at(pc); return; }}\n        }}\n    }}\n}}\n"
        );
    }
}

/// Emit `lifted.rs`.
#[must_use]
pub fn emit_rust(m: &IrModule) -> String {
    let funcs: BTreeSet<u64> = m.functions.iter().map(|f| f.addr).collect();
    let limit = ((m.image_end + 0xfff) & !0xfff) + 0x10_0000;
    let mut s = String::new();
    let _ = writeln!(
        s,
        "// Generated by bun-re pipeline (lift). Do not edit.\n#![allow(unused, unreachable_code, clippy::all, non_snake_case)]\n"
    );
    let _ = writeln!(
        s,
        "pub const BITS: u32 = {};\npub const BASE: u64 = 0x{:x};\npub const LIMIT: u64 = 0x{:x};\npub const ENTRY: u64 = 0x{:x};",
        m.bits, m.image_base, limit, m.entry
    );
    let _ = writeln!(
        s,
        "/// (virtual address, offset in image.bin, length)\npub const SECTIONS: &[(u64, u64, u64)] = &["
    );
    for sec in &m.sections {
        let _ = writeln!(
            s,
            "    (0x{:x}, 0x{:x}, 0x{:x}),",
            sec.vaddr, sec.file_offset, sec.file_size
        );
    }
    let _ = writeln!(s, "];\npub const IMPORTS: &[&str] = &[");
    for i in &m.imports {
        let lib = i
            .lib
            .as_deref()
            .map(|l| format!("{l}!"))
            .unwrap_or_default();
        let _ = writeln!(s, "    {:?},", format!("{lib}{}", i.name));
    }
    let _ = writeln!(s, "];");
    s.push_str(RUNTIME);
    let mut em = Em {
        abits: m.bits,
        funcs: &funcs,
        local: BTreeSet::new(),
    };
    for f in &m.functions {
        em.func(f, &mut s);
    }
    let _ = writeln!(
        s,
        "pub fn dispatch(c: &mut Cpu, addr: u64) {{\n    match addr {{"
    );
    for f in &m.functions {
        let _ = writeln!(s, "        0x{0:x} => sub_{0:x}(c),", f.addr);
    }
    let _ = writeln!(s, "        _ => c.trap_at(addr),\n    }}\n}}");
    s
}
