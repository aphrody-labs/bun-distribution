// SPDX-License-Identifier: Apache-2.0
//! Console emitter: an [`IrModule`] lowered to guest semantics ([`super::sem`]) becomes a Cargo
//! crate that links the matching Bun Engine core (`crates/bun-engine-core`, module `recomp`).
//!
//! Each block is one Rust function over the runtime handle `g` of the machine (registers, flags,
//! bus, pipeline and timing helpers); `lookup` maps a block key (address, ORed with the
//! instruction-set index for ARM/Thumb) to its function. The runtime dispatcher runs a block when
//! one exists for the next instruction and the core interpreter otherwise, and each block yields
//! back between instructions when the core's scheduler or an I/O side effect requires it. The crate
//! builds as a native executable (`src/main.rs`) and as a WebAssembly module (`cdylib` exports in
//! `src/lib.rs`).

use super::ir::{IrFunction, IrModule, IrOp};
use super::sem::{Alu, Guest, Stmt, Val};
use std::fmt::Write;
use std::path::Path;

/// Inputs embedded in the generated crate.
#[derive(Debug, Clone)]
pub struct Embed {
    /// Primary image (cartridge ROM, PS-EXE or BIOS) copied to `image.bin`.
    pub image: Vec<u8>,
    /// Optional firmware copied to `bios.bin`.
    pub bios: Option<Vec<u8>>,
}

fn val(v: &Val) -> String {
    match v {
        Val::Imm { v } => format!("0x{v:x}u32"),
        Val::Reg { r } => format!("g.r({r})"),
        Val::Tmp { t } => format!("t[{t}]"),
        Val::Flag { f } => format!("g.flag({f})"),
    }
}

fn alu(op: Alu, a: &str, b: &str) -> String {
    match op {
        Alu::Add => format!("{a}.wrapping_add({b})"),
        Alu::Sub => format!("{a}.wrapping_sub({b})"),
        Alu::And => format!("{a} & {b}"),
        Alu::Or => format!("{a} | {b}"),
        Alu::Xor => format!("{a} ^ {b}"),
        Alu::Mul => format!("{a}.wrapping_mul({b})"),
        Alu::MulHiU => format!("((u64::from({a}) * u64::from({b})) >> 32) as u32"),
        Alu::MulHiS => format!("((i64::from({a} as i32) * i64::from({b} as i32)) >> 32) as u32"),
        Alu::Shl => format!("{a}.checked_shl({b}).unwrap_or(0)"),
        Alu::Shr => format!("{a}.checked_shr({b}).unwrap_or(0)"),
        Alu::Sar => format!("sar({a}, {b})"),
        Alu::Ror => format!("{a}.rotate_right({b} & 31)"),
        Alu::Eq => format!("u32::from({a} == {b})"),
        Alu::Ne => format!("u32::from({a} != {b})"),
        Alu::Ltu => format!("u32::from({a} < {b})"),
        Alu::Lts => format!("u32::from(({a} as i32) < ({b} as i32))"),
        Alu::Leu => format!("u32::from({a} <= {b})"),
        Alu::Les => format!("u32::from(({a} as i32) <= ({b} as i32))"),
        Alu::DivU => format!("divu({a}, {b})"),
        Alu::RemU => format!("remu({a}, {b})"),
        Alu::DivS => format!("divs({a}, {b})"),
        Alu::RemS => format!("rems({a}, {b})"),
        Alu::Sext8 => format!("{a} as u8 as i8 as i32 as u32"),
        Alu::Sext16 => format!("{a} as u16 as i16 as i32 as u32"),
        Alu::Not => format!("!{a}"),
    }
}

fn stmts(body: &[Stmt], ind: usize, out: &mut String) {
    let pad = "    ".repeat(ind);
    for s in body {
        match s {
            Stmt::Op { t, op, a, b } => {
                let _ = writeln!(out, "{pad}t[{t}] = {};", alu(*op, &val(a), &val(b)));
            }
            Stmt::Sel { t, c, a, b } => {
                let _ = writeln!(
                    out,
                    "{pad}t[{t}] = if {} != 0 {{ {} }} else {{ {} }};",
                    val(c),
                    val(a),
                    val(b)
                );
            }
            Stmt::Set { r, v } => {
                let _ = writeln!(out, "{pad}g.set_r({r}, {});", val(v));
            }
            Stmt::SetFlag { f, v } => {
                let _ = writeln!(out, "{pad}g.set_flag({f}, {});", val(v));
            }
            Stmt::Load {
                t,
                bits,
                addr,
                kind,
            } => {
                let _ = writeln!(out, "{pad}t[{t}] = g.load{bits}({}, {kind});", val(addr));
            }
            Stmt::Store {
                bits,
                addr,
                v,
                kind,
            } => {
                let _ = writeln!(
                    out,
                    "{pad}g.store{bits}({}, {}, {kind});",
                    val(addr),
                    val(v)
                );
            }
            Stmt::Call { f, args, t } => {
                let a = args.iter().map(val).collect::<Vec<_>>().join(", ");
                match t {
                    Some(t) => {
                        let _ = writeln!(out, "{pad}t[{t}] = g.{f}({a});");
                    }
                    None => {
                        let _ = writeln!(out, "{pad}g.{f}({a});");
                    }
                }
            }
            Stmt::If { c, then, els } => {
                let _ = writeln!(out, "{pad}if {} != 0 {{", val(c));
                stmts(then, ind + 1, out);
                if els.is_empty() {
                    let _ = writeln!(out, "{pad}}}");
                } else {
                    let _ = writeln!(out, "{pad}}} else {{");
                    stmts(els, ind + 1, out);
                    let _ = writeln!(out, "{pad}}}");
                }
            }
            Stmt::Exit => {
                let _ = writeln!(out, "{pad}return;");
            }
            Stmt::Fallback { why } => {
                let _ = writeln!(
                    out,
                    "{pad}g.fallback(); // {}",
                    why.replace(['\n', '\r'], " ")
                );
                let _ = writeln!(out, "{pad}return;");
            }
        }
    }
}

/// Key of a block in the dispatch table.
#[must_use]
pub fn block_key(f: &IrFunction) -> u32 {
    (f.addr as u32) | u32::from(f.isa)
}

fn block_name(f: &IrFunction) -> String {
    format!("b{}_{:08x}", f.isa, f.addr)
}

/// Emit `lifted.rs` for a guest module.
///
/// # Errors
/// Returns an error when the module carries no guest machine.
pub fn emit_lifted(m: &IrModule) -> Result<String, String> {
    let machine = m
        .abi
        .as_ref()
        .and_then(|a| a.machine.clone())
        .ok_or("module has no guest machine (abi.machine)")?;
    let mut s = String::new();
    let _ = writeln!(
        s,
        "// Generated by `bunre recompile` (bun-re pipeline: lift -> IR -> emit). Do not edit.\n\
         #![allow(unused, unreachable_code, unused_mut, unused_assignments, unused_comparisons, clippy::all, non_snake_case)]\n\
         use bun_engine::recomp::{machine}::Rt as G;\n\n\
         #[inline(always)]\nfn sar(a: u32, b: u32) -> u32 {{ (a as i32).checked_shr(b).unwrap_or((a as i32) >> 31) as u32 }}\n\
         #[inline(always)]\nfn divu(a: u32, b: u32) -> u32 {{ a.checked_div(b).unwrap_or(u32::MAX) }}\n\
         #[inline(always)]\nfn remu(a: u32, b: u32) -> u32 {{ a.checked_rem(b).unwrap_or(a) }}\n\
         #[inline(always)]\nfn divs(a: u32, b: u32) -> u32 {{ if b == 0 {{ if (a as i32) < 0 {{ 1 }} else {{ u32::MAX }} }} else {{ (a as i32).wrapping_div(b as i32) as u32 }} }}\n\
         #[inline(always)]\nfn rems(a: u32, b: u32) -> u32 {{ if b == 0 {{ a }} else {{ (a as i32).wrapping_rem(b as i32) as u32 }} }}\n"
    );
    let mut blocks = 0usize;
    let mut insns = 0usize;
    for f in &m.functions {
        let temps = f
            .blocks
            .iter()
            .flat_map(|b| b.insns.iter())
            .filter_map(|i| {
                if let IrOp::Guest(g) = &i.op {
                    Some(g.temps())
                } else {
                    None
                }
            })
            .max()
            .unwrap_or(0)
            .max(1);
        let _ = writeln!(
            s,
            "#[inline(never)]\npub fn {}(g: &mut G<'_>) {{\n    let mut t = [0u32; {temps}];",
            block_name(f)
        );
        let mut first = true;
        for b in &f.blocks {
            for i in &b.insns {
                let IrOp::Guest(Guest { body, .. }) = &i.op else {
                    continue;
                };
                insns += 1;
                if !first {
                    let _ = writeln!(s, "    if g.yield_now() {{ return; }}");
                }
                first = false;
                let _ = writeln!(
                    s,
                    "    // {:08x}: {}",
                    i.addr,
                    i.text.replace(['\n', '\r'], " ")
                );
                stmts(body, 1, &mut s);
            }
        }
        let _ = writeln!(s, "}}\n");
        blocks += 1;
    }
    let _ = writeln!(
        s,
        "/// Translated block for a dispatch key.\npub fn lookup(key: u32) -> Option<for<'a> fn(&mut G<'a>)> {{\n    match key {{"
    );
    for f in &m.functions {
        let _ = writeln!(
            s,
            "        0x{:x} => Some({}),",
            block_key(f),
            block_name(f)
        );
    }
    let _ = writeln!(s, "        _ => None,\n    }}\n}}\n");
    let _ = writeln!(
        s,
        "/// Translated blocks.\npub const BLOCKS: usize = {blocks};\n/// Translated instructions.\npub const INSNS: usize = {insns};"
    );
    Ok(s)
}

fn lib_rs(machine: &str, has_bios: bool) -> String {
    let bios = if has_bios { "Some(BIOS)" } else { "None" };
    let bios_static = if has_bios {
        "/// Firmware embedded at build time.\npub static BIOS: &[u8] = include_bytes!(\"../bios.bin\");\n"
    } else {
        ""
    };
    let factory = match machine {
        "gba" => format!(
            "/// Recompiled GBA machine (`interp` keeps the interpreter only, for comparisons).\n\
             pub fn machine(interp: bool) -> Result<Box<dyn Machine>, String> {{\n\
             \x20   let mut m = bun_engine::machine::gba::Gba::from_rom(IMAGE, {bios})?;\n\
             \x20   if !interp {{\n        m.set_cpu_runner(Some(runner));\n    }}\n    Ok(Box::new(m))\n}}\n\n\
             fn runner(cpu: &mut bun_engine::recomp::gba::Cpu, deadline: usize) -> bool {{\n\
             \x20   bun_engine::recomp::gba::run(cpu, deadline, lifted::lookup)\n}}\n"
        ),
        "psx" => format!(
            "/// Recompiled PlayStation machine (`interp` keeps the interpreter only, for comparisons).\n\
             pub fn machine(interp: bool) -> Result<Box<dyn Machine>, String> {{\n\
             \x20   let bios: Option<&[u8]> = {bios};\n\
             \x20   let bios = bios.ok_or(\"a PlayStation BIOS is required\")?;\n\
             \x20   // IMAGE is the PS-EXE, or empty when the BIOS itself was recompiled (shell boot).\n\
             \x20   let runner: Option<bun_engine::recomp::psx::Runner> = if interp {{ None }} else {{ Some(runner) }};\n\
             \x20   Ok(Box::new(bun_engine::machine::psx::Psx::with_runner(bios, IMAGE, runner)?))\n}}\n\n\
             fn runner(sys: &mut bun_engine::recomp::psx::System, budget: u32) -> u32 {{\n\
             \x20   bun_engine::recomp::psx::run(sys, budget, lifted::lookup)\n}}\n"
        ),
        _ => "/// Recompiled NES machine (`interp` keeps the interpreter only, for comparisons).\n\
             pub fn machine(interp: bool) -> Result<Box<dyn Machine>, String> {\n\
             \x20   let mut m = bun_engine::machine::nes::Nes::from_rom(\"image.nes\", IMAGE)?;\n\
             \x20   if !interp {\n        m.set_cpu_runner(Some(runner));\n    }\n    Ok(Box::new(m))\n}\n\n\
             fn runner(bus: &mut bun_engine::recomp::nes::Bus) -> bool {\n\
             \x20   bun_engine::recomp::nes::run(bus, lifted::lookup)\n}\n"
            .to_string(),
    };
    format!(
        "// Generated by `bunre recompile`. Do not edit.\n\
         #![allow(clippy::all)]\n\
         use bun_engine::machine::Machine;\n\n\
         pub mod lifted;\n\n\
         /// Image embedded at build time.\n\
         pub static IMAGE: &[u8] = include_bytes!(\"../image.bin\");\n\
         {bios_static}\n\
         {factory}\n\
         /// Statistics of the translated code.\npub fn coverage() -> (usize, usize) {{\n    (lifted::BLOCKS, lifted::INSNS)\n}}\n\n\
         // WebAssembly entry points (wasm32-unknown-unknown cdylib).\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_init(interp: u32) -> u32 {{\n    bun_engine::recomp::wasm::init(machine, interp != 0)\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_frames(n: u32) -> u32 {{\n    bun_engine::recomp::wasm::frames(n)\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_screen(index: u32) -> u32 {{\n    bun_engine::recomp::wasm::screen(index)\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_screen_ptr() -> *const u8 {{\n    bun_engine::recomp::wasm::screen_ptr()\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_screen_width() -> u32 {{\n    bun_engine::recomp::wasm::screen_width()\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_screen_height() -> u32 {{\n    bun_engine::recomp::wasm::screen_height()\n}}\n\
         #[unsafe(no_mangle)]\npub extern \"C\" fn recomp_stat(which: u32) -> f64 {{\n    bun_engine::recomp::wasm::stat(which)\n}}\n"
    )
}

fn main_rs(crate_name: &str) -> String {
    let lib = crate_name.replace('-', "_");
    format!(
        "// Generated by `bunre recompile`. Do not edit.\n\
         fn main() -> std::process::ExitCode {{\n\
         \x20   let (blocks, insns) = {lib}::coverage();\n\
         \x20   bun_engine::recomp::cli({lib}::machine, blocks, insns)\n}}\n"
    )
}

fn cargo_toml(crate_name: &str, machine: &str, engine: &Path) -> String {
    let engine = engine.display().to_string().replace('\\', "/");
    format!(
        "# Generated by `bunre recompile`. Do not edit.\n\
         [package]\nname = \"{crate_name}\"\nversion = \"0.1.0\"\nedition = \"2024\"\npublish = false\n\n\
         [lib]\npath = \"src/lib.rs\"\ncrate-type = [\"rlib\", \"cdylib\"]\n\n\
         [[bin]]\nname = \"{crate_name}\"\npath = \"src/main.rs\"\n\n\
         [dependencies]\nbun-engine = {{ path = \"{engine}\", default-features = false, features = [\"{machine}\"] }}\n\n\
         [profile.release]\nopt-level = 2\ndebug = false\ncodegen-units = 16\npanic = \"abort\"\n\n\
         # Standalone: not a member of the Bun OS workspace.\n[workspace]\n"
    )
}

/// Write the generated crate to `dir`. Returns the written paths.
///
/// # Errors
/// Returns an error when the module has no guest machine or a file cannot be written.
pub fn write_crate(
    m: &IrModule,
    dir: &Path,
    crate_name: &str,
    engine: &Path,
    embed: &Embed,
) -> Result<Vec<std::path::PathBuf>, String> {
    let machine = m
        .abi
        .as_ref()
        .and_then(|a| a.machine.clone())
        .ok_or("module has no guest machine (abi.machine)")?;
    let src = dir.join("src");
    std::fs::create_dir_all(&src).map_err(|e| format!("{}: {e}", src.display()))?;
    let mut files = Vec::new();
    let mut put = |p: std::path::PathBuf, data: &[u8]| -> Result<(), String> {
        std::fs::write(&p, data).map_err(|e| format!("{}: {e}", p.display()))?;
        files.push(p);
        Ok(())
    };
    put(
        dir.join("Cargo.toml"),
        cargo_toml(crate_name, &machine, engine).as_bytes(),
    )?;
    put(src.join("lifted.rs"), emit_lifted(m)?.as_bytes())?;
    put(
        src.join("lib.rs"),
        lib_rs(&machine, embed.bios.is_some()).as_bytes(),
    )?;
    put(src.join("main.rs"), main_rs(crate_name).as_bytes())?;
    put(dir.join("image.bin"), &embed.image)?;
    if let Some(b) = &embed.bios {
        put(dir.join("bios.bin"), b)?;
    }
    Ok(files)
}
