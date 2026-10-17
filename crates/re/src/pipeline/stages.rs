// SPDX-License-Identifier: Apache-2.0
//! Built-in stage adapters: acquire, identify, unpack (APK/ZIP), analyze (triage), lift (x86 PE/ELF to
//! IR), decompile (C and Rust emission), rebuild (clang / rustc) and verify.

use super::contract::{
    AcquireOutput, Check, IdentifyOutput, InputKind, LiftOutput, Payload, Stage, StageReport, StageStatus,
    UnpackOutput, VerifyOutput,
};
use super::emit_c::emit_c;
use super::emit_rust::emit_rust;
use super::image::Image;
use super::lift::{LiftOptions, lift_image};
use super::recomp;
use super::registry::{AdapterInfo, AdapterKind, AdapterStatus, Ctx, Options, StageAdapter, handles_input, report};
use super::util::{artifact, run_cmd, sha256_hex, tail, which};
use crate::android::{AndroidContainer, AndroidContainerType};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Function-pointer backed built-in adapter.
pub struct Builtin {
    id: &'static str,
    stage: Stage,
    handles: &'static [&'static str],
    applies: fn(&Ctx) -> bool,
    run: fn(&mut Ctx) -> StageReport,
}

impl StageAdapter for Builtin {
    fn id(&self) -> &str {
        self.id
    }
    fn stage(&self) -> Stage {
        self.stage
    }
    fn info(&self, _opts: &Options) -> AdapterInfo {
        AdapterInfo {
            id: self.id.to_string(),
            stage: self.stage,
            kind: AdapterKind::Builtin,
            owner: "crates/re (bun_re::pipeline)".to_string(),
            handles: self.handles.iter().map(|s| (*s).to_string()).collect(),
            status: AdapterStatus::Ready,
            reason: None,
        }
    }
    fn applies(&self, ctx: &Ctx) -> bool {
        (self.applies)(ctx)
    }
    fn run(&self, ctx: &mut Ctx) -> StageReport {
        (self.run)(ctx)
    }
}

fn always(_: &Ctx) -> bool {
    true
}

fn has_ir(c: &Ctx) -> bool {
    c.ir.as_ref().is_some_and(|m| m.abi.as_ref().is_none_or(|a| a.machine.is_none()))
}

fn is_aarch64(c: &Ctx) -> bool {
    c.payload_ident
        .as_ref()
        .and_then(|i| i.arch.as_deref())
        .is_some_and(|a| a.eq_ignore_ascii_case("aarch64") || a.eq_ignore_ascii_case("arm64"))
}

fn liftable(c: &Ctx) -> bool {
    c.payload.is_some() && c.payload_ident.as_ref().is_some_and(|i| i.liftable) && !is_aarch64(c) && super::recomp::machine_of(c).is_none()
}

fn liftable_aarch64(c: &Ctx) -> bool {
    c.payload.is_some() && c.payload_ident.as_ref().is_some_and(|i| i.liftable) && is_aarch64(c)
}

/// Built-in adapters in execution order.
#[must_use]
pub fn builtins() -> Vec<Box<dyn StageAdapter>> {
    let b = |id, stage, handles, applies, run| -> Box<dyn StageAdapter> {
        Box::new(Builtin { id, stage, handles, applies, run })
    };
    vec![
        b("fs-acquire", Stage::Acquire, &["*"], always, acquire),
        b("sniff-identify", Stage::Identify, &["*"], always, identify_stage),
        b("zip-apk-unpack", Stage::Unpack, &["*"], always, unpack),
        b("triage", Stage::Analyze, &["*"], |c| c.payload.is_some(), analyze),
        b("x86-lift", Stage::Lift, &["pe", "elf"], liftable, lift),
        b("aarch64-lift", Stage::Lift, &["pe", "elf"], liftable_aarch64, lift_aarch64),
        b("armv4t-lift", Stage::Lift, &["gba"], recomp::applies_gba, recomp::lift_gba),
        b("r3000a-lift", Stage::Lift, &["ps1"], recomp::applies_psx, recomp::lift_psx),
        b("6502-lift", Stage::Lift, &["nes"], recomp::applies_nes, recomp::lift_nes),
        b("emit-console-rust", Stage::Decompile, &["gba", "ps1", "nes"], recomp::has_guest_ir, recomp::emit),
        b("emit-c", Stage::Decompile, &["pe", "elf"], has_ir, emit_c_stage),
        b("emit-rust", Stage::Decompile, &["pe"], |c| c.ir.as_ref().is_some_and(|m| m.format == "pe" && m.abi.is_none()), emit_rust_stage),
        b("clang-c", Stage::Rebuild, &["pe", "elf"], |c| c.c_dir.is_some(), rebuild_c),
        b("rustc-lib", Stage::Rebuild, &["pe"], |c| c.rust_file.is_some(), rebuild_rust),
        b("cargo-recompile", Stage::Rebuild, &["gba", "ps1", "nes"], recomp::wants_build, recomp::build),
        b("lift-verify", Stage::Verify, &["pe", "elf"], has_ir, verify),
        b("recompile-verify", Stage::Verify, &["gba", "ps1", "nes"], recomp::built, recomp::verify),
    ]
}

// ---------------------------------------------------------------------------------------------
// acquire
// ---------------------------------------------------------------------------------------------

fn acquire(ctx: &mut Ctx) -> StageReport {
    let input = ctx.opts.input.clone();
    let id = "fs-acquire";
    if input.starts_with("http://") || input.starts_with("https://") {
        return report(
            Stage::Acquire,
            id,
            StageStatus::Unavailable,
            "network acquisition is not performed implicitly: download the file first or use the steamcmd / adb-pull adapters",
        );
    }
    let p = Path::new(&input);
    if p.is_dir() {
        return report(Stage::Acquire, id, StageStatus::Failed, "input is a directory: pass an image file");
    }
    let bytes = match std::fs::read(p) {
        Ok(b) => b,
        Err(e) => return report(Stage::Acquire, id, StageStatus::Failed, format!("{input}: {e}")),
    };
    let out = AcquireOutput {
        source: input.clone(),
        path: std::fs::canonicalize(p).map_or(input, |c| c.display().to_string().trim_start_matches(r"\\?\").to_string()),
        size: bytes.len() as u64,
        sha256: sha256_hex(&bytes),
    };
    let mut r = report(Stage::Acquire, id, StageStatus::Ok, format!("{} bytes", out.size));
    r.metrics.insert("size".into(), out.size);
    r.output = serde_json::to_value(&out).unwrap_or_default();
    ctx.acquire = Some(out);
    r
}

// ---------------------------------------------------------------------------------------------
// identify
// ---------------------------------------------------------------------------------------------

fn find(hay: &[u8], needle: &[u8], limit: usize) -> Option<usize> {
    let h = &hay[..hay.len().min(limit)];
    memchr::memmem::find(h, needle)
}

/// Classify raw bytes (format, architecture, platform) without executing anything.
#[must_use]
pub fn identify(b: &[u8]) -> IdentifyOutput {
    let mut out = IdentifyOutput {
        kind: InputKind::Raw,
        format: "raw".into(),
        arch: None,
        platform: None,
        entry: None,
        liftable: false,
        container: false,
        notes: Vec::new(),
    };
    let set = |o: &mut IdentifyOutput, k: InputKind, f: &str, p: Option<&str>| {
        o.kind = k;
        o.format = f.into();
        o.platform = p.map(str::to_string);
    };
    let u32le = |o: usize| b.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]));
    if b.starts_with(b"MZ") || b.starts_with(b"\x7fELF") {
        let is_pe = b.starts_with(b"MZ");
        set(&mut out, if is_pe { InputKind::Pe } else { InputKind::Elf }, if is_pe { "pe" } else { "elf" }, Some(if is_pe { "windows" } else { "linux" }));
        if let Ok(t) = crate::triage(b) {
            out.entry = t.entry_point;
            out.format = t.format.display_name().to_string();
            out.arch = t.arch.clone();
        }
        match Image::load(b) {
            Ok(_) => out.liftable = true,
            Err(e) => out.notes.push(format!("not liftable by the built-in x86 and AArch64 lifters: {e}")),
        }
    } else if matches!(b.get(0..4), Some([0xfe, 0xed, 0xfa, 0xce | 0xcf] | [0xce | 0xcf, 0xfa, 0xed, 0xfe])) {
        set(&mut out, InputKind::Macho, "mach-o", Some("macos"));
        out.notes.push("Mach-O: identified only; lift via ghidra-headless".into());
    } else if b.starts_with(&[0xca, 0xfe, 0xba, 0xbe]) && u32le(4).is_some_and(|n| n.swap_bytes() < 32) {
        set(&mut out, InputKind::Macho, "mach-o fat", Some("macos"));
    } else if b.starts_with(b"PK\x03\x04") {
        set(&mut out, InputKind::Zip, "zip", None);
        out.container = true;
        if let Ok(c) = AndroidContainer::parse(b) {
            if !c.census.manifest_files.is_empty() || !c.census.dex_files.is_empty() {
                let (k, f) = if c.container_type == AndroidContainerType::Aab { (InputKind::Apk, "aab") } else { (InputKind::Apk, "apk") };
                set(&mut out, k, f, Some("android"));
            }
        }
    } else if b.get(0x8001..0x8006) == Some(b"CD001") {
        set(&mut out, InputKind::Iso, "iso9660", None);
        out.container = true;
    } else if b.get(0x10..0x14) == Some(&[0x5a, 0xa5, 0xf0, 0x0f]) || find(b, b"_FVH", 1 << 26).is_some_and(|i| i >= 0x28) {
        set(&mut out, InputKind::Uefi, "uefi firmware", Some("uefi"));
        out.container = true;
        out.arch = Some("x86_64".into());
    } else if b.starts_with(b"NES\x1a") {
        set(&mut out, InputKind::Rom, "ines", Some("nes"));
        out.arch = Some("6502".into());
    } else if b.get(0x104..0x108) == Some(&[0xce, 0xed, 0x66, 0x66]) {
        set(&mut out, InputKind::Rom, "game boy", Some("gb"));
        out.arch = Some("sm83".into());
    } else if b.get(0xc0..0xc4) == Some(&[0x24, 0xff, 0xae, 0x51]) && b.len() >= 0x200 {
        set(&mut out, InputKind::Rom, "nintendo ds", Some("nds"));
        out.arch = Some("arm".into());
    } else if b.len() >= 0xc0 && b.get(0xb2) == Some(&0x96) && b.get(4..8) == Some(&[0x24, 0xff, 0xae, 0x51]) {
        set(&mut out, InputKind::Rom, "game boy advance", Some("gba"));
        out.arch = Some("arm".into());
    } else if matches!(b.get(0..4), Some([0x80, 0x37, 0x12, 0x40] | [0x37, 0x80, 0x40, 0x12] | [0x40, 0x12, 0x37, 0x80])) {
        set(&mut out, InputKind::Rom, "nintendo 64", Some("n64"));
        out.arch = Some("mips".into());
    } else if b.get(0x100..0x104) == Some(b"SEGA") || b.get(0x100..0x110).is_some_and(|x| x.starts_with(b"SEGA")) {
        set(&mut out, InputKind::Rom, "sega genesis", Some("genesis"));
        out.arch = Some("m68k".into());
    } else if b.starts_with(b"PS-X EXE") {
        set(&mut out, InputKind::Rom, "ps-x exe", Some("ps1"));
        out.arch = Some("mips".into());
    } else if b.get(0x18..0x1c) == Some(&[0x5d, 0x1c, 0x9e, 0xa3]) {
        set(&mut out, InputKind::Rom, "wii disc", Some("wii"));
        out.arch = Some("ppc".into());
    } else if b.get(0x1c..0x20) == Some(&[0xc2, 0x33, 0x9f, 0x3d]) {
        set(&mut out, InputKind::Rom, "gamecube disc", Some("gamecube"));
        out.arch = Some("ppc".into());
    } else if b.get(0x100..0x104) == Some(b"NCSD") || b.get(0x100..0x104) == Some(b"NCCH") {
        set(&mut out, InputKind::Rom, "nintendo 3ds", Some("3ds"));
        out.arch = Some("arm".into());
    } else if b.get(0x10..0x14) == Some(b"NRO0") || b.starts_with(b"NSO0") {
        set(&mut out, InputKind::Rom, "switch nro/nso", Some("switch"));
        out.arch = Some("arm64".into());
    } else if b.starts_with(&[0xd0, 0x0d, 0xfe, 0xed]) {
        set(&mut out, InputKind::Fdt, "device tree / fit", None);
    } else if b.starts_with(&[0x1f, 0x8b]) || b.starts_with(&[0xfd, b'7', b'z', b'X', b'Z', 0]) || b.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) || b.starts_with(b"BZh") {
        set(&mut out, InputKind::Compressed, "compressed stream", None);
        out.container = true;
    } else if b.len().is_power_of_two() && b.len() >= 0x10000 && b.len() <= 0x1000000 && {
        let tail16 = &b[b.len() - 16..];
        matches!(tail16[0], 0xea | 0xe9 | 0xeb) && find(b, b"BIOS", usize::MAX).is_some()
            || ["Award", "AMI", "SeaBIOS", "Phoenix", "coreboot"].iter().any(|s| find(b, s.as_bytes(), usize::MAX).is_some())
    } {
        set(&mut out, InputKind::Bios, "legacy bios image", Some("bios"));
        out.arch = Some("x86".into());
        out.notes.push("reset vector at end of image; 16-bit real-mode code is not covered by the 32/64-bit lifter".into());
    }
    out
}

fn identify_stage(ctx: &mut Ctx) -> StageReport {
    let id = "sniff-identify";
    let Some(path) = ctx.acquire.as_ref().map(|a| a.path.clone()) else {
        return report(Stage::Identify, id, StageStatus::Skipped, "nothing acquired");
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Identify, id, StageStatus::Failed, e.to_string()),
    };
    let out = identify(&bytes);
    let mut detail = format!("{} ({})", out.format, out.arch.as_deref().unwrap_or("arch unknown"));
    let tgt_ok = match ctx.opts.target {
        super::contract::TargetKind::Os => matches!(out.kind, InputKind::Pe | InputKind::Elf | InputKind::Macho | InputKind::Apk | InputKind::Zip | InputKind::Iso),
        super::contract::TargetKind::Bios => matches!(out.kind, InputKind::Bios | InputKind::Uefi | InputKind::Raw),
        super::contract::TargetKind::Firmware => !matches!(out.kind, InputKind::Pe),
    };
    if !tgt_ok {
        detail.push_str("; note: input class does not match the requested target");
    }
    let mut r = report(Stage::Identify, id, StageStatus::Ok, detail);
    r.output = serde_json::to_value(&out).unwrap_or_default();
    ctx.ident = Some(out);
    r
}

// ---------------------------------------------------------------------------------------------
// unpack
// ---------------------------------------------------------------------------------------------

fn safe_name(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect()
}

fn unpack(ctx: &mut Ctx) -> StageReport {
    let id = "zip-apk-unpack";
    let (Some(ident), Some(acq)) = (ctx.ident.clone(), ctx.acquire.clone()) else {
        return report(Stage::Unpack, id, StageStatus::Skipped, "input not identified");
    };
    let bytes = match std::fs::read(&acq.path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Unpack, id, StageStatus::Failed, e.to_string()),
    };
    if !matches!(ident.kind, InputKind::Apk | InputKind::Zip) {
        ctx.payload = Some(PathBuf::from(&acq.path));
        ctx.payload_ident = Some(ident.clone());
        let mut r = if ident.container {
            report(
                Stage::Unpack,
                id,
                StageStatus::Partial,
                format!("no built-in unpacker for {}; external unpackers listed in the adapter registry", ident.format),
            )
        } else {
            report(Stage::Unpack, id, StageStatus::Ok, "not a container; input is the payload")
        };
        r.output = serde_json::to_value(UnpackOutput { payloads: vec![], primary: Some(acq.path) }).unwrap_or_default();
        return r;
    }
    let cont = match AndroidContainer::parse(&bytes) {
        Ok(c) => c,
        Err(e) => return report(Stage::Unpack, id, StageStatus::Failed, e.to_string()),
    };
    let dir = ctx.dir("unpack");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return report(Stage::Unpack, id, StageStatus::Failed, e.to_string());
    }
    let mut payloads = Vec::new();
    let mut r = report(Stage::Unpack, id, StageStatus::Ok, "");
    let mut budget: u64 = 512 << 20;
    let mut libs: Vec<(u8, PathBuf)> = Vec::new();
    for e in &cont.entries {
        let p = e.path.as_str();
        let is_lib = p.starts_with("lib/") && p.ends_with(".so");
        let is_dex = p.ends_with(".dex") && !p.contains('/');
        let is_manifest = p == "AndroidManifest.xml" || p.ends_with("/AndroidManifest.xml");
        if !(is_lib || is_dex || is_manifest) || e.uncompressed_size > budget {
            continue;
        }
        let Ok(data) = cont.read_entry_info(e) else { continue };
        budget = budget.saturating_sub(data.len() as u64);
        let out = dir.join(safe_name(p));
        if std::fs::write(&out, &data).is_err() {
            continue;
        }
        let kind = identify(&data).kind;
        if is_lib {
            let rank = if p.contains("/x86_64/") { 0 } else if p.contains("/x86/") { 1 } else if p.contains("/arm64-v8a/") { 2 } else { 3 };
            libs.push((rank, out.clone()));
        }
        r.artifacts.push(artifact("payload", &out));
        payloads.push(Payload { name: p.to_string(), path: out.display().to_string(), size: data.len() as u64, kind });
    }
    libs.sort_by_key(|l| l.0);
    let primary = libs.first().map(|l| l.1.clone());
    r.metrics.insert("payloads".into(), payloads.len() as u64);
    match &primary {
        Some(p) => {
            ctx.payload = Some(p.clone());
            if let Ok(b) = std::fs::read(p) {
                ctx.payload_ident = Some(identify(&b));
            }
            r.detail = format!("{} entries extracted; primary payload {}", payloads.len(), p.display());
        }
        None => {
            r.status = StageStatus::Partial;
            r.detail = format!("{} entries extracted; no native library, Dalvik code needs the dex toolchain", payloads.len());
        }
    }
    r.output = serde_json::to_value(UnpackOutput { payloads, primary: primary.map(|p| p.display().to_string()) }).unwrap_or_default();
    r
}

// ---------------------------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------------------------

fn analyze(ctx: &mut Ctx) -> StageReport {
    let id = "triage";
    let Some(path) = ctx.payload.clone() else {
        return report(Stage::Analyze, id, StageStatus::Skipped, "no payload");
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Analyze, id, StageStatus::Failed, e.to_string()),
    };
    match crate::triage(&bytes) {
        Err(e) => report(Stage::Analyze, id, StageStatus::Failed, e.to_string()),
        Ok(t) => {
            let structured = !matches!(t.format, crate::Format::Unknown);
            let mut r = report(
                Stage::Analyze,
                id,
                if structured { StageStatus::Ok } else { StageStatus::Partial },
                if structured {
                    format!("{} {}", t.format.display_name(), t.arch.as_deref().unwrap_or(""))
                } else {
                    "no structural parser for this format; strings and hash only".to_string()
                },
            );
            r.metrics.insert("sections".into(), t.sections.len() as u64);
            r.metrics.insert("imports".into(), t.imports.len() as u64);
            r.metrics.insert("exports".into(), t.exports.len() as u64);
            let p = ctx.dir("analyze").join("triage.json");
            if std::fs::create_dir_all(ctx.dir("analyze")).is_ok() {
                if let Ok(j) = serde_json::to_vec_pretty(&t) {
                    if std::fs::write(&p, j).is_ok() {
                        r.artifacts.push(artifact("triage", &p));
                    }
                }
            }
            r.output = serde_json::to_value(&t).unwrap_or_default();
            r
        }
    }
}

// ---------------------------------------------------------------------------------------------
// lift
// ---------------------------------------------------------------------------------------------

fn lift(ctx: &mut Ctx) -> StageReport {
    lift_with(ctx, "x86-lift")
}

fn lift_aarch64(ctx: &mut Ctx) -> StageReport {
    lift_with(ctx, "aarch64-lift")
}

fn lift_with(ctx: &mut Ctx, id: &'static str) -> StageReport {
    let Some(path) = ctx.payload.clone() else {
        return report(Stage::Lift, id, StageStatus::Skipped, "no payload");
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e.to_string()),
    };
    let img = match Image::load(&bytes) {
        Ok(i) => i,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e),
    };
    let (module, blob) = lift_image(&img, LiftOptions { max_functions: ctx.opts.max_functions, max_insns: ctx.opts.max_insns });
    let dir = ctx.dir("lift");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return report(Stage::Lift, id, StageStatus::Failed, e.to_string());
    }
    let ir_path = dir.join("ir.json");
    let bin_path = dir.join("image.bin");
    let write = serde_json::to_vec_pretty(&module).map_err(|e| e.to_string()).and_then(|j| {
        std::fs::write(&ir_path, j).map_err(|e| e.to_string())?;
        std::fs::write(&bin_path, &blob).map_err(|e| e.to_string())
    });
    if let Err(e) = write {
        return report(Stage::Lift, id, StageStatus::Failed, e);
    }
    let stats = module.stats();
    let coverage = if stats.instructions == 0 { 0.0 } else { stats.lifted as f64 / stats.instructions as f64 };
    let status = if stats.functions == 0 {
        StageStatus::Failed
    } else if stats.unlifted > 0 {
        StageStatus::Partial
    } else {
        StageStatus::Ok
    };
    let mut r = report(
        Stage::Lift,
        id,
        status,
        format!(
            "{} functions, {} blocks, {} instructions, {:.1}% modelled; unlifted instructions trap at run time",
            stats.functions,
            stats.blocks,
            stats.instructions,
            coverage * 100.0
        ),
    );
    r.metrics.insert("functions".into(), stats.functions);
    r.metrics.insert("instructions".into(), stats.instructions);
    r.metrics.insert("unlifted".into(), stats.unlifted);
    r.artifacts.push(artifact("ir", &ir_path));
    r.artifacts.push(artifact("image", &bin_path));
    r.output = serde_json::to_value(LiftOutput { ir: ir_path.display().to_string(), stats, coverage }).unwrap_or_default();
    ctx.ir = Some(module);
    ctx.image_bin = Some(bin_path);
    r
}

// ---------------------------------------------------------------------------------------------
// decompile (source emission)
// ---------------------------------------------------------------------------------------------

fn emit_c_stage(ctx: &mut Ctx) -> StageReport {
    let id = "emit-c";
    let (Some(m), Some(bin)) = (ctx.ir.as_ref(), ctx.image_bin.clone()) else {
        return report(Stage::Decompile, id, StageStatus::Skipped, "no IR");
    };
    let dir = ctx.dir("decompile").join("c");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return report(Stage::Decompile, id, StageStatus::Failed, e.to_string());
    }
    let mut r = report(Stage::Decompile, id, StageStatus::Ok, "C project with block-level control flow, import and section tables");
    for (name, content) in emit_c(m) {
        let p = dir.join(&name);
        if let Err(e) = std::fs::write(&p, content) {
            return report(Stage::Decompile, id, StageStatus::Failed, e.to_string());
        }
        r.artifacts.push(artifact("c", &p));
    }
    let _ = std::fs::copy(&bin, dir.join("image.bin"));
    ctx.c_dir = Some(dir);
    r
}

fn emit_rust_stage(ctx: &mut Ctx) -> StageReport {
    let id = "emit-rust";
    let Some(m) = ctx.ir.as_ref() else {
        return report(Stage::Decompile, id, StageStatus::Skipped, "no IR");
    };
    let dir = ctx.dir("decompile").join("rust");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return report(Stage::Decompile, id, StageStatus::Failed, e.to_string());
    }
    let p = dir.join("lifted.rs");
    if let Err(e) = std::fs::write(&p, emit_rust(m)) {
        return report(Stage::Decompile, id, StageStatus::Failed, e.to_string());
    }
    let mut r = report(Stage::Decompile, id, StageStatus::Ok, "Rust module (runtime + one block state machine per function)");
    r.artifacts.push(artifact("rust", &p));
    ctx.rust_file = Some(p);
    r
}

// ---------------------------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------------------------

fn pick_cc() -> Option<(String, PathBuf)> {
    if let Some(cc) = std::env::var_os("CC") {
        let s = cc.to_string_lossy().to_string();
        if let Some(p) = which(&s) {
            return Some((s, p));
        }
    }
    ["clang", "cc", "gcc"].iter().find_map(|n| which(n).map(|p| ((*n).to_string(), p)))
}

fn rebuild_c(ctx: &mut Ctx) -> StageReport {
    let id = "clang-c";
    let Some(dir) = ctx.c_dir.clone() else {
        return report(Stage::Rebuild, id, StageStatus::Skipped, "no C project");
    };
    let Some((name, cc)) = pick_cc() else {
        return report(Stage::Rebuild, id, StageStatus::Unavailable, "no C compiler (CC, clang, cc, gcc) found");
    };
    ctx.build.cc = Some(name.clone());
    let timeout = Duration::from_secs(ctx.opts.timeout_secs);
    let tenv = if name == "clang" { super::util::toolchain_env() } else { Vec::new() };
    let mut objs = Vec::new();
    let mut r = report(Stage::Rebuild, id, StageStatus::Ok, "");
    for src in ["bunre_rt.c", "lifted.c", "image.c", "main.c"] {
        let obj = src.replace(".c", if cfg!(windows) { ".obj" } else { ".o" });
        let args: Vec<String> = ["-std=c11", "-O1", "-w", "-c", src, "-o", &obj].iter().map(|s| (*s).to_string()).collect();
        match run_cmd(&cc, &args, Some(&dir), &tenv, timeout) {
            Ok(x) if x.ok() => objs.push(obj),
            Ok(x) => {
                ctx.build.c_ok = Some(false);
                r.status = StageStatus::Failed;
                r.detail = format!("{name} failed on {src}: {}", tail(&x.stderr, 800));
                return r;
            }
            Err(e) => {
                r.status = StageStatus::Failed;
                r.detail = e;
                return r;
            }
        }
    }
    ctx.build.c_ok = Some(true);
    let exe = dir.join(if cfg!(windows) { "bunre_lifted.exe" } else { "bunre_lifted" });
    let mut args: Vec<String> = objs.clone();
    args.push("-o".into());
    args.push(exe.display().to_string());
    match run_cmd(&cc, &args, Some(&dir), &tenv, timeout) {
        Ok(x) if x.ok() && exe.is_file() => {
            ctx.build.exe = Some(exe.clone());
            r.artifacts.push(artifact("executable", &exe));
            r.detail = format!("{name}: compiled {} objects and linked {}", objs.len(), exe.display());
        }
        Ok(x) => {
            r.status = StageStatus::Partial;
            r.detail = format!("{name}: objects compiled, link failed: {}", tail(&x.stderr, 600));
        }
        Err(e) => {
            r.status = StageStatus::Partial;
            r.detail = format!("objects compiled, link not run: {e}");
        }
    }
    for o in &objs {
        let p = dir.join(o);
        if p.is_file() {
            r.artifacts.push(artifact("object", &p));
        }
    }
    r
}

fn rebuild_rust(ctx: &mut Ctx) -> StageReport {
    let id = "rustc-lib";
    let Some(file) = ctx.rust_file.clone() else {
        return report(Stage::Rebuild, id, StageStatus::Skipped, "no Rust module");
    };
    let rustc_name = std::env::var("BUNRE_RUSTC").unwrap_or_else(|_| "rustc".into());
    let Some(rustc) = which(&rustc_name) else {
        return report(Stage::Rebuild, id, StageStatus::Unavailable, format!("`{rustc_name}` not on PATH"));
    };
    let dir = file.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let args: Vec<String> = [
        "--edition",
        "2021",
        "--crate-type",
        "rlib",
        "--crate-name",
        "bunre_lifted",
        "-C",
        "opt-level=0",
        "--out-dir",
        &dir.display().to_string(),
        &file.display().to_string(),
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    match run_cmd(&rustc, &args, Some(&dir), &[], Duration::from_secs(ctx.opts.timeout_secs)) {
        Ok(x) if x.ok() => {
            ctx.build.rust_ok = Some(true);
            let mut r = report(Stage::Rebuild, id, StageStatus::Ok, "lifted.rs compiled to an rlib");
            let lib = dir.join("libbunre_lifted.rlib");
            if lib.is_file() {
                r.artifacts.push(artifact("object", &lib));
            }
            r
        }
        Ok(x) => {
            ctx.build.rust_ok = Some(false);
            report(Stage::Rebuild, id, StageStatus::Failed, tail(&x.stderr, 1200))
        }
        Err(e) => report(Stage::Rebuild, id, StageStatus::Failed, e),
    }
}

// ---------------------------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------------------------

fn verify(ctx: &mut Ctx) -> StageReport {
    let id = "lift-verify";
    let (Some(m), Some(payload)) = (ctx.ir.as_ref(), ctx.payload.clone()) else {
        return report(Stage::Verify, id, StageStatus::Skipped, "no IR");
    };
    let mut checks = Vec::new();
    let s = m.stats();
    checks.push(Check {
        name: "ir-coverage".into(),
        ok: s.instructions > 0 && s.lifted * 10 >= s.instructions * 9,
        detail: format!("{}/{} instructions modelled", s.lifted, s.instructions),
    });
    // The persisted image must equal a fresh load of the input.
    let round = (|| -> Result<bool, String> {
        let src = std::fs::read(&payload).map_err(|e| e.to_string())?;
        let img = Image::load(&src)?;
        let saved = std::fs::read(ctx.image_bin.as_ref().ok_or("no image.bin")?).map_err(|e| e.to_string())?;
        let fresh: Vec<u8> = img.segments.iter().flat_map(|s| s.data.iter().copied()).collect();
        Ok(sha256_hex(&saved) == sha256_hex(&fresh))
    })();
    checks.push(Check {
        name: "image-roundtrip".into(),
        ok: round.as_ref().is_ok_and(|b| *b),
        detail: round.map_or_else(|e| e, |b| if b { "image.bin matches a fresh load of the input".into() } else { "image.bin differs".into() }),
    });
    for (name, state) in [("c-compiles", ctx.build.c_ok), ("rust-compiles", ctx.build.rust_ok)] {
        if let Some(ok) = state {
            checks.push(Check { name: name.into(), ok, detail: ctx.build.cc.clone().unwrap_or_default() });
        }
    }
    if ctx.build.c_ok == Some(true) {
        checks.push(Check { name: "c-links".into(), ok: ctx.build.exe.is_some(), detail: ctx.build.exe.as_ref().map_or("link failed".into(), |p| p.display().to_string()) });
    }
    if ctx.opts.trace {
        if let Some(exe) = ctx.build.exe.clone() {
            let cwd = exe.parent().map(Path::to_path_buf);
            let r = run_cmd(&exe, &["image.bin".to_string()], cwd.as_deref(), &[], Duration::from_secs(10));
            checks.push(match r {
                Ok(x) => Check {
                    name: "trace-run".into(),
                    ok: x.ok(),
                    detail: format!("exit {:?}{}: {}", x.code, if x.timed_out { " (timeout)" } else { "" }, tail(&format!("{}{}", x.stderr, x.stdout), 400)),
                },
                Err(e) => Check { name: "trace-run".into(), ok: false, detail: e },
            });
        } else {
            checks.push(Check { name: "trace-run".into(), ok: false, detail: "no linked executable".into() });
        }
    }
    let all = checks.iter().all(|c| c.ok);
    let mut r = report(
        Stage::Verify,
        id,
        if all { StageStatus::Ok } else { StageStatus::Partial },
        checks.iter().map(|c| format!("{}={}", c.name, if c.ok { "ok" } else { "FAIL" })).collect::<Vec<_>>().join(", "),
    );
    r.output = serde_json::to_value(VerifyOutput { checks }).unwrap_or_default();
    r
}

/// Re-exported for the driver: candidates listing.
#[must_use]
pub fn applicable_external(handles: &[&str], ctx: &Ctx) -> bool {
    handles_input(handles, ctx.effective_ident(), ctx.opts.target)
}
