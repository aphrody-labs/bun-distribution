// SPDX-License-Identifier: Apache-2.0
//! C emitter: [`IrModule`] to a compilable C project (`bunre_rt.h`, `bunre_rt.c`, `lifted.c`,
//! `image.c`, `main.c`). Guest memory is a flat arena addressed by guest virtual addresses.

use super::ir::{BinKind, Cond, Ext, IrFunction, IrModule, IrOp, Operand, Target, UnKind};
use std::collections::BTreeSet;
use std::fmt::Write;

/// Generated file set (relative name, content).
pub type Files = Vec<(String, String)>;

const RT_H_BODY: &str = r#"
#include <stdint.h>
#include <stddef.h>

typedef struct BrCpu {
    uint64_t rax, rcx, rdx, rbx, rsp, rbp, rsi, rdi;
    uint64_t r8, r9, r10, r11, r12, r13, r14, r15;
    uint8_t zf, sf, cf, of;
} BrCpu;

typedef struct BrSection { uint64_t vaddr, vsize, file_offset, file_size; } BrSection;

extern uint8_t *br_mem;
extern const BrSection br_sections[];
extern const unsigned br_section_count;
extern const char *const br_import_names[];
extern const unsigned br_import_count;

void br_fault(uint64_t addr);
void br_trap(BrCpu *c, uint64_t addr);
void br_unlifted(BrCpu *c, uint64_t addr, const char *text);
void br_import(BrCpu *c, unsigned index);
void br_dispatch(BrCpu *c, uint64_t addr);
int br_load(const char *image_bin_path);

static inline uint8_t *br_p(uint64_t a, size_t n) {
    if (a < BR_BASE || a + n > BR_LIMIT) br_fault(a);
    return br_mem + (a - BR_BASE);
}
static inline uint8_t br_rd8(uint64_t a) { return *br_p(a, 1); }
static inline uint16_t br_rd16(uint64_t a) { uint16_t v; __builtin_memcpy(&v, br_p(a, 2), 2); return v; }
static inline uint32_t br_rd32(uint64_t a) { uint32_t v; __builtin_memcpy(&v, br_p(a, 4), 4); return v; }
static inline uint64_t br_rd64(uint64_t a) { uint64_t v; __builtin_memcpy(&v, br_p(a, 8), 8); return v; }
static inline void br_wr8(uint64_t a, uint8_t v) { *br_p(a, 1) = v; }
static inline void br_wr16(uint64_t a, uint16_t v) { __builtin_memcpy(br_p(a, 2), &v, 2); }
static inline void br_wr32(uint64_t a, uint32_t v) { __builtin_memcpy(br_p(a, 4), &v, 4); }
static inline void br_wr64(uint64_t a, uint64_t v) { __builtin_memcpy(br_p(a, 8), &v, 8); }

#if BR_BITS == 64
typedef uint64_t br_word_t;
#define br_rdw br_rd64
#define br_wrw br_wr64
#else
typedef uint32_t br_word_t;
#define br_rdw br_rd32
#define br_wrw br_wr32
#endif

#define BR_ZS(T, r) do { c->zf = ((T)(r)) == 0; c->sf = (uint8_t)((((T)(r)) >> (sizeof(T) * 8 - 1)) & 1); } while (0)
#define BR_FL_ADD(T, a, b, r) do { BR_ZS(T, r); c->cf = ((T)(r)) < ((T)(a)); \
    c->of = (uint8_t)((((T)~((a) ^ (b)) & (T)((a) ^ (r))) >> (sizeof(T) * 8 - 1)) & 1); } while (0)
#define BR_FL_SUB(T, a, b, r) do { BR_ZS(T, r); c->cf = ((T)(a)) < ((T)(b)); \
    c->of = (uint8_t)((((T)((a) ^ (b)) & (T)((a) ^ (r))) >> (sizeof(T) * 8 - 1)) & 1); } while (0)
#define BR_FL_LOGIC(T, r) do { BR_ZS(T, r); c->cf = 0; c->of = 0; } while (0)
#define BR_PUSHRET(a) do { c->rsp -= sizeof(br_word_t); br_wrw(c->rsp, (br_word_t)(a)); } while (0)
"#;

const RT_C: &str = r#"#include "bunre_rt.h"
#include <stdio.h>
#include <stdlib.h>

uint8_t *br_mem;

int br_load(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    br_mem = (uint8_t *)calloc(1, (size_t)(BR_LIMIT - BR_BASE));
    if (!br_mem) { fclose(f); return -2; }
    for (unsigned i = 0; i < br_section_count; i++) {
        const BrSection *s = &br_sections[i];
        if (fseek(f, (long)s->file_offset, SEEK_SET) != 0) { fclose(f); return -3; }
        if (s->file_size && fread(br_mem + (s->vaddr - BR_BASE), 1, (size_t)s->file_size, f) != s->file_size) {
            fclose(f);
            return -4;
        }
    }
    fclose(f);
    return 0;
}

void br_fault(uint64_t addr) {
    fprintf(stderr, "bunre: guest memory fault at 0x%llx\n", (unsigned long long)addr);
    exit(71);
}

void br_trap(BrCpu *c, uint64_t addr) {
    (void)c;
    fprintf(stderr, "bunre: trap at 0x%llx (unmodelled control flow)\n", (unsigned long long)addr);
    exit(70);
}

void br_unlifted(BrCpu *c, uint64_t addr, const char *text) {
    (void)c;
    fprintf(stderr, "bunre: unlifted instruction at 0x%llx: %s\n", (unsigned long long)addr, text);
    exit(70);
}

void br_import(BrCpu *c, unsigned index) {
    fprintf(stderr, "bunre: import %s\n", index < br_import_count ? br_import_names[index] : "?");
    c->rax = 0;
}
"#;

const MAIN_C: &str = r#"#include "bunre_rt.h"
#include <stdio.h>

int main(int argc, char **argv) {
    const char *img = argc > 1 ? argv[1] : "image.bin";
    int rc = br_load(img);
    if (rc != 0) { fprintf(stderr, "bunre: cannot load %s (%d)\n", img, rc); return 2; }
    BrCpu cpu;
    __builtin_memset(&cpu, 0, sizeof cpu);
    cpu.rsp = BR_LIMIT - 64;
    BrCpu *c = &cpu;
    BR_PUSHRET(0);
    br_dispatch(&cpu, BR_ENTRY);
    printf("rax=0x%llx\n", (unsigned long long)cpu.rax);
    return 0;
}
"#;

fn rn(name: &str) -> String {
    format!("c->{name}")
}

fn tn(bits: u8) -> &'static str {
    match bits {
        8 => "uint8_t",
        16 => "uint16_t",
        32 => "uint32_t",
        _ => "uint64_t",
    }
}

fn sn(bits: u8) -> &'static str {
    match bits {
        8 => "int8_t",
        16 => "int16_t",
        32 => "int32_t",
        _ => "int64_t",
    }
}

fn addr(base: &Option<String>, index: &Option<String>, scale: u8, disp: i64, abits: u8) -> String {
    let mut parts = Vec::new();
    if let Some(b) = base {
        parts.push(rn(b));
    }
    if let Some(i) = index {
        parts.push(format!("{} * {}ull", rn(i), scale.max(1)));
    }
    parts.push(format!("0x{:x}ull", disp as u64));
    let t = if abits == 32 { "uint32_t" } else { "uint64_t" };
    format!("(uint64_t)({t})({})", parts.join(" + "))
}

struct Em<'a> {
    abits: u8,
    funcs: &'a BTreeSet<u64>,
    local: BTreeSet<u64>,
}

impl Em<'_> {
    fn rd(&self, op: &Operand, bits: u8) -> String {
        match op {
            Operand::Reg { name, bits: b, high } => match (b, high) {
                (64, _) => rn(name),
                (8, true) => format!("((uint8_t)({} >> 8))", rn(name)),
                (b, _) => format!("(({}){})", tn(*b), rn(name)),
            },
            Operand::Imm { value } => format!("(({})0x{:x}ull)", tn(bits), *value as u64),
            Operand::Mem { base, index, scale, disp, bits: mb } => {
                let a = addr(base, index, *scale, *disp, self.abits);
                format!("br_rd{mb}({a})")
            }
        }
    }

    fn wr(&self, op: &Operand, v: &str) -> String {
        match op {
            Operand::Reg { name, bits, high } => {
                let r = rn(name);
                match (bits, high) {
                    (64, _) => format!("{r} = (uint64_t)({v});"),
                    (32, _) => format!("{r} = (uint32_t)({v});"),
                    (16, _) => format!("{r} = ({r} & ~0xffffull) | (uint16_t)({v});"),
                    (8, true) => format!("{r} = ({r} & ~0xff00ull) | ((uint64_t)(uint8_t)({v}) << 8);"),
                    _ => format!("{r} = ({r} & ~0xffull) | (uint8_t)({v});"),
                }
            }
            Operand::Mem { base, index, scale, disp, bits } => {
                let a = addr(base, index, *scale, *disp, self.abits);
                format!("br_wr{bits}({a}, ({})({v}));", tn(*bits))
            }
            Operand::Imm { .. } => "/* immediate destination */".into(),
        }
    }

    fn cond(c: Cond) -> &'static str {
        match c {
            Cond::O => "c->of",
            Cond::No => "!c->of",
            Cond::B => "c->cf",
            Cond::Ae => "!c->cf",
            Cond::E => "c->zf",
            Cond::Ne => "!c->zf",
            Cond::Be => "(c->cf || c->zf)",
            Cond::A => "(!c->cf && !c->zf)",
            Cond::S => "c->sf",
            Cond::Ns => "!c->sf",
            Cond::L => "(c->sf != c->of)",
            Cond::Ge => "(c->sf == c->of)",
            Cond::Le => "(c->zf || c->sf != c->of)",
            Cond::G => "(!c->zf && c->sf == c->of)",
        }
    }

    fn jump(&self, t: u64, fall_tail: bool) -> String {
        if self.local.contains(&t) {
            format!("goto L_{t:x};")
        } else if self.funcs.contains(&t) {
            let _ = fall_tail;
            format!("{{ sub_{t:x}(c); return; }}")
        } else {
            format!("br_trap(c, 0x{t:x}ull);")
        }
    }

    fn op(&self, addr_: u64, next: u64, text: &str, op: &IrOp, out: &mut String) {
        let w = |o: &Operand| o.bits().unwrap_or(64);
        let s = match op {
            IrOp::Nop => String::new(),
            IrOp::Mov { dst, src, ext } => {
                let d = w(dst);
                match ext {
                    Ext::None => self.wr(dst, &self.rd(src, d)),
                    Ext::Zero => {
                        let sb = src.bits().unwrap_or(d);
                        self.wr(dst, &format!("({}){}", tn(d), self.rd(src, sb)))
                    }
                    Ext::Sign => {
                        let sb = src.bits().unwrap_or(d);
                        self.wr(dst, &format!("({})({}){}", tn(d), sn(sb), self.rd(src, sb)))
                    }
                }
            }
            IrOp::Lea { dst, src } => {
                if let Operand::Mem { base, index, scale, disp, .. } = src {
                    self.wr(dst, &addr(base, index, *scale, *disp, self.abits))
                } else {
                    String::new()
                }
            }
            IrOp::Bin { kind, dst, src } => {
                let d = w(dst);
                let t = tn(d);
                let a = self.rd(dst, d);
                match kind {
                    BinKind::Add | BinKind::Sub | BinKind::And | BinKind::Or | BinKind::Xor => {
                        let b = self.rd(src, d);
                        let (expr, fl) = match kind {
                            BinKind::Add => ("a + b", "BR_FL_ADD"),
                            BinKind::Sub => ("a - b", "BR_FL_SUB"),
                            BinKind::And => ("a & b", "BR_FL_LOGIC"),
                            BinKind::Or => ("a | b", "BR_FL_LOGIC"),
                            _ => ("a ^ b", "BR_FL_LOGIC"),
                        };
                        let flags = if fl == "BR_FL_LOGIC" { format!("BR_FL_LOGIC({t}, r);") } else { format!("{fl}({t}, a, b, r);") };
                        format!("{{ {t} a = {a}; {t} b = {b}; {t} r = ({t})({expr}); {flags} {} }}", self.wr(dst, "r"))
                    }
                    _ => {
                        let n = self.rd(src, 8);
                        let mask = if d == 64 { 63 } else { 31 };
                        let (expr, cf) = match kind {
                            BinKind::Shl => (
                                format!("({t})((uint64_t)a << n)"),
                                format!("c->cf = (uint8_t)((n <= {d}u) ? (((uint64_t)a >> ({d}u - n)) & 1) : 0);"),
                            ),
                            BinKind::Shr => (
                                format!("({t})((uint64_t)a >> n)"),
                                "c->cf = (uint8_t)(((uint64_t)a >> (n - 1)) & 1);".to_string(),
                            ),
                            _ => (
                                format!("({t})((int64_t)({}) a >> n)", sn(d)),
                                format!("c->cf = (uint8_t)(((int64_t)({}) a >> (n - 1)) & 1);", sn(d)),
                            ),
                        };
                        format!(
                            "{{ {t} a = {a}; unsigned n = (unsigned)({n}) & {mask}u; if (n) {{ {t} r = {expr}; BR_ZS({t}, r); {cf} {} }} }}",
                            self.wr(dst, "r")
                        )
                    }
                }
            }
            IrOp::Un { kind, dst } => {
                let d = w(dst);
                let t = tn(d);
                let a = self.rd(dst, d);
                let sign = format!("(({t})1 << {})", d - 1);
                let body = match kind {
                    UnKind::Inc => format!("{t} r = ({t})(a + 1); BR_ZS({t}, r); c->of = (r == {sign});"),
                    UnKind::Dec => format!("{t} r = ({t})(a - 1); BR_ZS({t}, r); c->of = (a == {sign});"),
                    UnKind::Neg => format!("{t} r = ({t})(0 - a); BR_FL_SUB({t}, 0, a, r);"),
                    UnKind::Not => format!("{t} r = ({t})~a;"),
                };
                format!("{{ {t} a = {a}; {body} {} }}", self.wr(dst, "r"))
            }
            IrOp::Cmp { a, b } => {
                let d = w(a);
                let t = tn(d);
                format!(
                    "{{ {t} a = {}; {t} b = {}; {t} r = ({t})(a - b); BR_FL_SUB({t}, a, b, r); }}",
                    self.rd(a, d),
                    self.rd(b, d)
                )
            }
            IrOp::Test { a, b } => {
                let d = w(a);
                let t = tn(d);
                format!("{{ {t} r = ({t})({} & {}); BR_FL_LOGIC({t}, r); }}", self.rd(a, d), self.rd(b, d))
            }
            IrOp::Push { src } => {
                let wb = self.abits;
                format!(
                    "{{ br_word_t v = (br_word_t){}; c->rsp -= {}; br_wrw(c->rsp, v); }}",
                    self.rd(src, wb),
                    wb / 8
                )
            }
            IrOp::Pop { dst } => {
                let wb = self.abits;
                format!("{{ br_word_t v = br_rdw(c->rsp); c->rsp += {}; {} }}", wb / 8, self.wr(dst, "v"))
            }
            IrOp::Leave => format!(
                "c->rsp = c->rbp; {{ br_word_t v = br_rdw(c->rsp); c->rsp += {}; c->rbp = v; }}",
                self.abits / 8
            ),
            IrOp::Setcc { cond, dst } => self.wr(dst, &format!("{} ? 1 : 0", Self::cond(*cond))),
            IrOp::Cmovcc { cond, dst, src } => {
                let d = w(dst);
                self.wr(dst, &format!("{} ? {} : {}", Self::cond(*cond), self.rd(src, d), self.rd(dst, d)))
            }
            IrOp::Call { target } => match target {
                Target::Direct { addr } if self.funcs.contains(addr) => {
                    format!("{{ BR_PUSHRET(0x{next:x}ull); sub_{addr:x}(c); }}")
                }
                Target::Direct { addr } => format!("{{ BR_PUSHRET(0x{next:x}ull); br_dispatch(c, 0x{addr:x}ull); }}"),
                Target::Import { index, name } => format!("br_import(c, {index}u); /* {} */", cmt(name)),
                Target::Indirect { operand } => format!(
                    "{{ uint64_t t = (uint64_t){}; BR_PUSHRET(0x{next:x}ull); br_dispatch(c, t); }}",
                    self.rd(operand, self.abits)
                ),
            },
            IrOp::Jmp { target } => match target {
                Target::Direct { addr } => self.jump(*addr, true),
                Target::Import { index, name } => format!(
                    "{{ br_import(c, {index}u); /* {} */ c->rsp += {}; return; }}",
                    cmt(name),
                    self.abits / 8
                ),
                Target::Indirect { operand } => {
                    format!("{{ br_dispatch(c, (uint64_t){}); return; }}", self.rd(operand, self.abits))
                }
            },
            IrOp::Jcc { cond, target } => format!("if ({}) {}", Self::cond(*cond), self.jump(*target, false)),
            IrOp::Ret { pop } => format!("c->rsp += {}; return;", u32::from(self.abits / 8) + u32::from(*pop)),
            IrOp::Unlifted { reason } => {
                format!("br_unlifted(c, 0x{addr_:x}ull, \"{}\"); /* {} */", cstr(text), cmt(reason))
            }
        };
        let _ = writeln!(out, "    /* {addr_:x}: {} */", cmt(text));
        if !s.is_empty() {
            let _ = writeln!(out, "    {s}");
        }
    }

    fn func(&mut self, f: &IrFunction, out: &mut String) {
        self.local = f.blocks.iter().map(|b| b.addr).collect();
        let nm = f.name.as_deref().map(cmt).unwrap_or_default();
        let _ = writeln!(out, "/* {} */\nvoid sub_{:x}(BrCpu *c) {{", nm, f.addr);
        for (i, b) in f.blocks.iter().enumerate() {
            let _ = writeln!(out, "L_{:x}:;", b.addr);
            for ins in &b.insns {
                let next = ins.addr + u64::from(ins.len);
                self.op(ins.addr, next, &ins.text, &ins.op, out);
            }
            if let Some(ft) = b.fallthrough {
                let natural = f.blocks.get(i + 1).is_some_and(|n| n.addr == ft);
                if !natural {
                    let _ = writeln!(out, "    {}", self.jump(ft, true));
                }
            }
        }
        if f.truncated {
            let _ = writeln!(out, "    /* function truncated by instruction budget */");
        }
        let _ = writeln!(out, "}}\n");
    }
}

fn cmt(s: &str) -> String {
    s.replace("*/", "* /").replace('\n', " ")
}

fn cstr(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Emit the C project for `m`.
#[must_use]
pub fn emit_c(m: &IrModule) -> Files {
    let funcs: BTreeSet<u64> = m.functions.iter().map(|f| f.addr).collect();
    let limit = (m.image_end + 0xfff) & !0xfff;
    let limit = limit + 0x10_0000;
    let mut h = String::new();
    let _ = writeln!(h, "/* Generated by bun-re pipeline (lift). Do not edit. */\n#ifndef BUNRE_RT_H\n#define BUNRE_RT_H");
    let _ = writeln!(h, "#define BR_BITS {}\n#define BR_BASE 0x{:x}ull\n#define BR_LIMIT 0x{:x}ull\n#define BR_ENTRY 0x{:x}ull", m.bits, m.image_base, limit, m.entry);
    h.push_str(RT_H_BODY);
    h.push_str("#endif\n");

    let mut em = Em { abits: m.bits, funcs: &funcs, local: BTreeSet::new() };
    let mut l = String::from("/* Generated by bun-re pipeline (lift). Do not edit. */\n#include \"bunre_rt.h\"\n\n");
    for f in &m.functions {
        let _ = writeln!(l, "void sub_{:x}(BrCpu *c);", f.addr);
    }
    l.push('\n');
    for f in &m.functions {
        em.func(f, &mut l);
    }
    let _ = writeln!(l, "void br_dispatch(BrCpu *c, uint64_t addr) {{\n    switch (addr) {{");
    for f in &m.functions {
        let _ = writeln!(l, "    case 0x{0:x}ull: sub_{0:x}(c); return;", f.addr);
    }
    let _ = writeln!(l, "    default: br_trap(c, addr);\n    }}\n}}");

    let mut im = String::from("#include \"bunre_rt.h\"\n\nconst BrSection br_sections[] = {\n");
    for s in &m.sections {
        let _ = writeln!(im, "    {{0x{:x}ull, 0x{:x}ull, 0x{:x}ull, 0x{:x}ull}}, /* {} */", s.vaddr, s.vsize, s.file_offset, s.file_size, cmt(&s.name));
    }
    let _ = writeln!(im, "    {{0, 0, 0, 0}}\n}};\nconst unsigned br_section_count = {};\n", m.sections.len());
    let _ = writeln!(im, "const char *const br_import_names[] = {{");
    for i in &m.imports {
        let lib = i.lib.as_deref().map(|l| format!("{l}!")).unwrap_or_default();
        let _ = writeln!(im, "    \"{}\",", cstr(&format!("{lib}{}", i.name)));
    }
    let _ = writeln!(im, "    0\n}};\nconst unsigned br_import_count = {};", m.imports.len());

    vec![
        ("bunre_rt.h".into(), h),
        ("bunre_rt.c".into(), RT_C.into()),
        ("lifted.c".into(), l),
        ("image.c".into(), im),
        ("main.c".into(), MAIN_C.into()),
    ]
}
