// SPDX-License-Identifier: Apache-2.0
//! x86 / x86-64 lifter: recursive-descent function discovery with `iced-x86`, lowering to [`IrModule`].

use super::image::Image;
use super::ir::{
    BinKind, Cond, Ext, ImportEntry, IrBlock, IrFunction, IrInsn, IrModule, IrOp, Operand, SectionEntry, Target, UnKind,
};
use iced_x86::{
    ConditionCode, Decoder, DecoderOptions, FlowControl, Formatter, Instruction, IntelFormatter, Mnemonic, OpKind,
    Register,
};
use std::collections::{BTreeMap, BTreeSet};

/// Lifter limits.
#[derive(Debug, Clone, Copy)]
pub struct LiftOptions {
    /// Maximum functions discovered.
    pub max_functions: usize,
    /// Maximum instructions per function.
    pub max_insns: usize,
}

impl Default for LiftOptions {
    fn default() -> Self {
        Self { max_functions: 512, max_insns: 4096 }
    }
}

struct Ctx<'a> {
    img: &'a Image,
    imp_index: BTreeMap<u64, u32>,
    imports: Vec<ImportEntry>,
}

/// Lift every function reachable from the entry point, exports and function symbols.
#[must_use]
pub fn lift_image(img: &Image, opts: LiftOptions) -> (IrModule, Vec<u8>) {
    let imports: Vec<ImportEntry> = img
        .imports
        .iter()
        .map(|(slot, s)| ImportEntry { name: s.name.clone(), lib: s.lib.clone(), slot: *slot })
        .collect();
    let imp_index = imports.iter().enumerate().map(|(i, e)| (e.slot, i as u32)).collect();
    let ctx = Ctx { img, imp_index, imports };

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
        let (func, calls) = lift_function(&ctx, addr, &known, opts.max_insns);
        for c in calls {
            if img.is_code(c) && !ctx.imp_index.contains_key(&c) && known.insert(c) {
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
        arch: if img.bits == 64 { "x86_64".into() } else { "x86".into() },
        bits: img.bits,
        image_base: img.base,
        entry: img.entry,
        image_end: img.end(),
        imports: ctx.imports,
        sections,
        functions,
    };
    (module, blob)
}

fn decode_at(img: &Image, addr: u64) -> Option<Instruction> {
    let seg = img.segment_at(addr)?;
    if !seg.exec {
        return None;
    }
    let off = (addr - seg.vaddr) as usize;
    let mut d = Decoder::with_ip(u32::from(img.bits), &seg.data[off..], addr, DecoderOptions::NONE);
    let ins = d.decode();
    if ins.is_invalid() { None } else { Some(ins) }
}

fn is_terminator(ins: &Instruction) -> bool {
    match ins.flow_control() {
        FlowControl::UnconditionalBranch
        | FlowControl::IndirectBranch
        | FlowControl::Return
        | FlowControl::Exception => true,
        FlowControl::Interrupt => ins.mnemonic() == Mnemonic::Int3,
        _ => false,
    }
}

fn lift_function(ctx: &Ctx, start: u64, known: &BTreeSet<u64>, max_insns: usize) -> (IrFunction, Vec<u64>) {
    let img = ctx.img;
    let mut insns: BTreeMap<u64, Instruction> = BTreeMap::new();
    let mut bad: BTreeSet<u64> = BTreeSet::new();
    let mut leaders: BTreeSet<u64> = BTreeSet::new();
    let mut calls: Vec<u64> = Vec::new();
    let mut work = vec![start];
    leaders.insert(start);
    let mut truncated = false;
    let local = |t: u64| -> bool {
        img.is_code(t) && !ctx.imp_index.contains_key(&t) && (t == start || !known.contains(&t))
    };
    while let Some(a) = work.pop() {
        let mut ip = a;
        loop {
            if insns.contains_key(&ip) || bad.contains(&ip) {
                break;
            }
            if ip != start && known.contains(&ip) {
                break;
            }
            if insns.len() >= max_insns {
                truncated = true;
                break;
            }
            let Some(ins) = decode_at(img, ip) else {
                bad.insert(ip);
                break;
            };
            let next = ins.next_ip();
            insns.insert(ip, ins);
            match ins.flow_control() {
                FlowControl::UnconditionalBranch => {
                    if let OpKind::NearBranch16 | OpKind::NearBranch32 | OpKind::NearBranch64 = ins.op0_kind() {
                        let t = ins.near_branch_target();
                        if local(t) {
                            leaders.insert(t);
                            work.push(t);
                        }
                    }
                    break;
                }
                FlowControl::ConditionalBranch => {
                    let t = ins.near_branch_target();
                    if local(t) {
                        leaders.insert(t);
                        work.push(t);
                    }
                    leaders.insert(next);
                    ip = next;
                }
                FlowControl::Call => {
                    calls.push(ins.near_branch_target());
                    ip = next;
                }
                FlowControl::IndirectBranch | FlowControl::Return | FlowControl::Exception => break,
                FlowControl::Interrupt if ins.mnemonic() == Mnemonic::Int3 => break,
                _ => ip = next,
            }
        }
    }

    let mut fmt = IntelFormatter::new();
    let mut blocks: Vec<IrBlock> = Vec::new();
    let mut prev_end: Option<u64> = None;
    let mut prev_term = true;
    for (&addr, ins) in &insns {
        let new_block = prev_term || leaders.contains(&addr) || prev_end != Some(addr);
        if new_block {
            blocks.push(IrBlock { addr, insns: Vec::new(), fallthrough: None });
        }
        let mut text = String::new();
        fmt.format(ins, &mut text);
        let op = lower(ctx, ins);
        let blk = blocks.last_mut().expect("block pushed");
        blk.insns.push(IrInsn { addr, len: ins.len() as u8, text, op });
        prev_term = is_terminator(ins);
        prev_end = Some(ins.next_ip());
        blk.fallthrough = if prev_term { None } else { Some(ins.next_ip()) };
    }
    let name = ctx.img.symbols.get(&start).cloned();
    (IrFunction { addr: start, name, blocks, truncated }, calls)
}

fn canon(r: Register) -> Option<(String, u8, bool)> {
    if !r.is_gpr() {
        return None;
    }
    let full = r.full_register();
    let name = format!("{full:?}").to_ascii_lowercase();
    let high = matches!(r, Register::AH | Register::CH | Register::DH | Register::BH);
    Some((name, (r.size() * 8) as u8, high))
}

fn reg_op(r: Register) -> Option<Operand> {
    let (name, bits, high) = canon(r)?;
    Some(Operand::Reg { name, bits, high })
}

fn opnd(ctx: &Ctx, ins: &Instruction, i: u32) -> Option<Operand> {
    match ins.op_kind(i) {
        OpKind::Register => reg_op(ins.op_register(i)),
        OpKind::Immediate8
        | OpKind::Immediate16
        | OpKind::Immediate32
        | OpKind::Immediate64
        | OpKind::Immediate8to16
        | OpKind::Immediate8to32
        | OpKind::Immediate8to64
        | OpKind::Immediate32to64 => Some(Operand::Imm { value: ins.immediate(i) as i64 }),
        OpKind::Memory => mem_op(ctx, ins),
        _ => None,
    }
}

fn mem_op(ctx: &Ctx, ins: &Instruction) -> Option<Operand> {
    if matches!(ins.segment_prefix(), Register::FS | Register::GS) {
        return None;
    }
    let want = u32::from(ctx.img.bits / 8) as usize;
    let mut base = None;
    let mut index = None;
    let mut disp = ins.memory_displacement64() as i64;
    if ins.is_ip_rel_memory_operand() {
        disp = ins.ip_rel_memory_address() as i64;
    } else {
        if ins.memory_base() != Register::None {
            if ins.memory_base().size() != want {
                return None;
            }
            base = Some(canon(ins.memory_base())?.0);
        }
        if ins.memory_index() != Register::None {
            if ins.memory_index().size() != want {
                return None;
            }
            index = Some(canon(ins.memory_index())?.0);
        }
    }
    Some(Operand::Mem {
        base,
        index,
        scale: ins.memory_index_scale() as u8,
        disp,
        bits: (ins.memory_size().size() * 8) as u8,
    })
}

fn cond(ins: &Instruction) -> Option<Cond> {
    Some(match ins.condition_code() {
        ConditionCode::o => Cond::O,
        ConditionCode::no => Cond::No,
        ConditionCode::b => Cond::B,
        ConditionCode::ae => Cond::Ae,
        ConditionCode::e => Cond::E,
        ConditionCode::ne => Cond::Ne,
        ConditionCode::be => Cond::Be,
        ConditionCode::a => Cond::A,
        ConditionCode::s => Cond::S,
        ConditionCode::ns => Cond::Ns,
        ConditionCode::l => Cond::L,
        ConditionCode::ge => Cond::Ge,
        ConditionCode::le => Cond::Le,
        ConditionCode::g => Cond::G,
        _ => return None,
    })
}

fn branch_target(ctx: &Ctx, ins: &Instruction) -> Option<Target> {
    match ins.op0_kind() {
        OpKind::NearBranch16 | OpKind::NearBranch32 | OpKind::NearBranch64 => {
            let t = ins.near_branch_target();
            if let Some(&i) = ctx.imp_index.get(&t) {
                return Some(Target::Import { index: i, name: ctx.imports[i as usize].name.clone() });
            }
            Some(Target::Direct { addr: t })
        }
        OpKind::Register | OpKind::Memory => {
            let o = opnd(ctx, ins, 0)?;
            if let Operand::Mem { base: None, index: None, disp, .. } = &o {
                if let Some(&i) = ctx.imp_index.get(&(*disp as u64)) {
                    return Some(Target::Import { index: i, name: ctx.imports[i as usize].name.clone() });
                }
            }
            Some(Target::Indirect { operand: o })
        }
        _ => None,
    }
}

fn unl(reason: &str) -> IrOp {
    IrOp::Unlifted { reason: reason.to_string() }
}

fn lower(ctx: &Ctx, ins: &Instruction) -> IrOp {
    let m = ins.mnemonic();
    let o = |i| opnd(ctx, ins, i);
    let two = || Some((o(0)?, o(1)?));
    let mnem = format!("{m:?}");
    // Width sanity: memory operand of unknown size cannot be emitted.
    for i in 0..ins.op_count() {
        if ins.op_kind(i) == OpKind::Memory && m != Mnemonic::Lea && ins.memory_size().size() == 0 {
            return unl("memory operand of unknown width");
        }
    }
    for i in 0..ins.op_count() {
        if ins.op_kind(i) == OpKind::Memory && m != Mnemonic::Lea && !matches!(ins.memory_size().size(), 1 | 2 | 4 | 8) {
            return unl("memory operand width not modelled");
        }
    }
    let r = match m {
        Mnemonic::Nop | Mnemonic::Endbr64 | Mnemonic::Endbr32 | Mnemonic::Pause => Some(IrOp::Nop),
        Mnemonic::Mov => two().map(|(dst, src)| IrOp::Mov { dst, src, ext: Ext::None }),
        Mnemonic::Movzx => two().map(|(dst, src)| IrOp::Mov { dst, src, ext: Ext::Zero }),
        Mnemonic::Movsx | Mnemonic::Movsxd => two().map(|(dst, src)| IrOp::Mov { dst, src, ext: Ext::Sign }),
        Mnemonic::Lea => two().map(|(dst, src)| IrOp::Lea { dst, src }),
        Mnemonic::Add => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Add, dst, src }),
        Mnemonic::Sub => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Sub, dst, src }),
        Mnemonic::And => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::And, dst, src }),
        Mnemonic::Or => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Or, dst, src }),
        Mnemonic::Xor => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Xor, dst, src }),
        Mnemonic::Shl => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Shl, dst, src }),
        Mnemonic::Shr => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Shr, dst, src }),
        Mnemonic::Sar => two().map(|(dst, src)| IrOp::Bin { kind: BinKind::Sar, dst, src }),
        Mnemonic::Inc => o(0).map(|dst| IrOp::Un { kind: UnKind::Inc, dst }),
        Mnemonic::Dec => o(0).map(|dst| IrOp::Un { kind: UnKind::Dec, dst }),
        Mnemonic::Neg => o(0).map(|dst| IrOp::Un { kind: UnKind::Neg, dst }),
        Mnemonic::Not => o(0).map(|dst| IrOp::Un { kind: UnKind::Not, dst }),
        Mnemonic::Cmp => two().map(|(a, b)| IrOp::Cmp { a, b }),
        Mnemonic::Test => two().map(|(a, b)| IrOp::Test { a, b }),
        Mnemonic::Push => o(0).map(|src| IrOp::Push { src }),
        Mnemonic::Pop => o(0).map(|dst| IrOp::Pop { dst }),
        Mnemonic::Leave => Some(IrOp::Leave),
        Mnemonic::Ret => Some(IrOp::Ret { pop: if ins.op_count() == 1 { ins.immediate(0) as u16 } else { 0 } }),
        Mnemonic::Call => branch_target(ctx, ins).map(|target| IrOp::Call { target }),
        Mnemonic::Jmp => branch_target(ctx, ins).map(|target| IrOp::Jmp { target }),
        _ if ins.flow_control() == FlowControl::ConditionalBranch && mnem.starts_with('J') => {
            cond(ins).map(|c| IrOp::Jcc { cond: c, target: ins.near_branch_target() })
        }
        _ if mnem.starts_with("Set") => match (cond(ins), o(0)) {
            (Some(c), Some(dst)) => Some(IrOp::Setcc { cond: c, dst }),
            _ => None,
        },
        _ if mnem.starts_with("Cmov") => match (cond(ins), two()) {
            (Some(c), Some((dst, src))) => Some(IrOp::Cmovcc { cond: c, dst, src }),
            _ => None,
        },
        _ => return unl("mnemonic not modelled"),
    };
    if matches!(m, Mnemonic::Push | Mnemonic::Pop) {
        if let Some(b) = o(0).and_then(|x| x.bits()) {
            if b != ctx.img.bits {
                return unl("push/pop width differs from address width");
            }
        }
    }
    let Some(op) = r else { return unl("operand form not modelled") };
    // Reject mixed shapes the emitters do not handle.
    match &op {
        IrOp::Mov { dst: Operand::Imm { .. }, .. } | IrOp::Lea { src: Operand::Reg { .. } | Operand::Imm { .. }, .. } => {
            unl("unsupported operand shape")
        }
        IrOp::Lea { dst, .. } if dst.bits().is_none() => unl("unsupported operand shape"),
        _ => op,
    }
}
