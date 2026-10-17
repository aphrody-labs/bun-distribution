// SPDX-License-Identifier: Apache-2.0
//! Stage adapter trait and registry. Built-in adapters live in [`super::stages`]; existing Bun OS
//! crates, vendor owners and host tools plug in as typed [`ExternalAdapter`] entries that reference
//! their owner by path, command or environment variable and report honest availability.

use super::contract::{
    AcquireOutput, Artifact, IdentifyOutput, InputKind, Stage, StageReport, StageStatus, TargetKind, UnpackOutput,
};
use super::ir::IrModule;
use super::util::{artifact, find_root, run_cmd, tail, which};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Run options.
#[derive(Debug, Clone)]
pub struct Options {
    /// Input file path (or URL, reported unavailable).
    pub input: String,
    /// Target family.
    pub target: TargetKind,
    /// Output directory.
    pub outdir: PathBuf,
    /// Bun OS checkout root, used to probe in-tree owners.
    pub root: Option<PathBuf>,
    /// Lifter function budget.
    pub max_functions: usize,
    /// Lifter per-function instruction budget.
    pub max_insns: usize,
    /// Enable heavy external adapters (Ghidra headless).
    pub external: bool,
    /// Execute the rebuilt binary for a bounded trace during verify.
    pub trace: bool,
    /// Timeout for external commands in seconds.
    pub timeout_secs: u64,
    /// Static recompilation request (`bunre recompile`).
    pub recompile: Option<super::recomp::Recompile>,
}

impl Options {
    /// Defaults for an input and output directory.
    #[must_use]
    pub fn new(input: impl Into<String>, target: TargetKind, outdir: impl Into<PathBuf>) -> Self {
        Self {
            input: input.into(),
            target,
            outdir: outdir.into(),
            root: find_root(),
            max_functions: 512,
            max_insns: 4096,
            external: false,
            trace: false,
            timeout_secs: 600,
            recompile: None,
        }
    }
}

/// Build products tracked between rebuild and verify.
#[derive(Debug, Clone, Default)]
pub struct BuildState {
    /// C project compiled to objects.
    pub c_ok: Option<bool>,
    /// Rust module compiled.
    pub rust_ok: Option<bool>,
    /// Linked executable.
    pub exe: Option<PathBuf>,
    /// Compiler used.
    pub cc: Option<String>,
}

/// Mutable pipeline state shared by adapters.
#[derive(Debug)]
pub struct Ctx {
    /// Options.
    pub opts: Options,
    /// Acquire output.
    pub acquire: Option<AcquireOutput>,
    /// Identification of the raw input.
    pub ident: Option<IdentifyOutput>,
    /// Unpack output.
    pub unpack: Option<UnpackOutput>,
    /// Payload analysed by later stages (the input itself when not a container).
    pub payload: Option<PathBuf>,
    /// Identification of the payload.
    pub payload_ident: Option<IdentifyOutput>,
    /// Lifted module.
    pub ir: Option<IrModule>,
    /// Directory of the emitted C project.
    pub c_dir: Option<PathBuf>,
    /// Emitted Rust file.
    pub rust_file: Option<PathBuf>,
    /// `image.bin` blob next to the IR.
    pub image_bin: Option<PathBuf>,
    /// Build state.
    pub build: BuildState,
    /// Ghidra export directory.
    pub ghidra_out: Option<PathBuf>,
    /// Console recompilation products.
    pub guest: Option<super::recomp::GuestBuild>,
    /// Images embedded in the recompiled crate.
    pub guest_embed: Option<super::emit_guest::Embed>,
}

impl Ctx {
    /// New context.
    #[must_use]
    pub fn new(opts: Options) -> Self {
        Self {
            opts,
            acquire: None,
            ident: None,
            unpack: None,
            payload: None,
            payload_ident: None,
            ir: None,
            c_dir: None,
            rust_file: None,
            image_bin: None,
            build: BuildState::default(),
            ghidra_out: None,
            guest: None,
            guest_embed: None,
        }
    }

    /// Identification relevant to analysis (payload preferred).
    #[must_use]
    pub fn effective_ident(&self) -> Option<&IdentifyOutput> {
        self.payload_ident.as_ref().or(self.ident.as_ref())
    }

    /// Path of the file analysed by later stages.
    #[must_use]
    pub fn effective_path(&self) -> Option<PathBuf> {
        self.payload.clone().or_else(|| self.acquire.as_ref().map(|a| PathBuf::from(&a.path)))
    }

    /// Stage working directory.
    #[must_use]
    pub fn dir(&self, name: &str) -> PathBuf {
        self.opts.outdir.join(name)
    }
}

/// Adapter origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    /// Implemented in this crate.
    Builtin,
    /// Workspace crate under `crates/`.
    Crate,
    /// Vendored or submodule source owner.
    Vendor,
    /// Host command.
    Command,
    /// Tool located through an environment variable.
    Env,
}

/// Adapter availability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterStatus {
    /// Runnable now.
    Ready,
    /// Owner present but invoked out of process by its own CLI; the pipeline does not drive it.
    Registered,
    /// Owner or tool missing; see `reason`.
    Unavailable,
}

/// Public adapter descriptor (see `schema/adapter.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterInfo {
    /// Stable id.
    pub id: String,
    /// Stage served.
    pub stage: Stage,
    /// Origin.
    pub kind: AdapterKind,
    /// Crate path, vendor path, command or environment variable.
    pub owner: String,
    /// Input classes handled (`*`, kind names, platforms).
    pub handles: Vec<String>,
    /// Availability.
    pub status: AdapterStatus,
    /// Why not ready.
    pub reason: Option<String>,
}

/// Pipeline stage implementation.
pub trait StageAdapter: Send + Sync {
    /// Adapter id.
    fn id(&self) -> &str;
    /// Stage served.
    fn stage(&self) -> Stage;
    /// Descriptor with live availability.
    fn info(&self, opts: &Options) -> AdapterInfo;
    /// Whether the adapter handles the current input.
    fn applies(&self, ctx: &Ctx) -> bool;
    /// Execute.
    fn run(&self, ctx: &mut Ctx) -> StageReport;
}

/// Build a report.
#[must_use]
pub fn report(stage: Stage, adapter: &str, status: StageStatus, detail: impl Into<String>) -> StageReport {
    StageReport {
        stage,
        adapter: adapter.to_string(),
        status,
        detail: detail.into(),
        artifacts: Vec::new(),
        metrics: BTreeMap::new(),
        output: serde_json::Value::Null,
    }
}

/// How an external owner is detected.
#[derive(Debug, Clone, Copy)]
pub enum Probe {
    /// Path relative to the checkout root.
    Path(&'static str),
    /// Command on `PATH`.
    Command(&'static str),
    /// Environment variable naming an install directory.
    Env(&'static str),
}

/// Command line the pipeline can drive (`{input}` and `{out}` are substituted).
#[derive(Debug, Clone, Copy)]
pub struct Cmd {
    /// Program (resolved on `PATH`).
    pub program: &'static str,
    /// Argument templates.
    pub args: &'static [&'static str],
}

/// Typed adapter referencing an existing owner.
#[derive(Debug, Clone, Copy)]
pub struct ExternalAdapter {
    /// Stable id.
    pub id: &'static str,
    /// Stage.
    pub stage: Stage,
    /// Origin.
    pub kind: AdapterKind,
    /// Human-readable owner reference (path, command line or variable).
    pub owner: &'static str,
    /// Handled input classes.
    pub handles: &'static [&'static str],
    /// Detection.
    pub probe: Probe,
    /// Driveable command, when the pipeline can run it directly.
    pub cmd: Option<Cmd>,
}

/// Does `handles` match the identified input?
#[must_use]
pub fn handles_input(handles: &[&str], ident: Option<&IdentifyOutput>, target: TargetKind) -> bool {
    if handles.contains(&"*") {
        return true;
    }
    let tname = match target {
        TargetKind::Os => "target:os",
        TargetKind::Bios => "target:bios",
        TargetKind::Firmware => "target:firmware",
    };
    if handles.contains(&tname) {
        return true;
    }
    let Some(id) = ident else { return false };
    let kind = serde_json::to_value(id.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    handles.iter().any(|h| {
        *h == kind || id.platform.as_deref() == Some(h) || id.arch.as_deref() == Some(h)
    })
}

fn gitmodule_declared(root: &Path, rel: &str) -> bool {
    std::fs::read_to_string(root.join(".gitmodules"))
        .map(|t| t.lines().any(|l| l.trim().strip_prefix("path").is_some_and(|r| r.trim_start_matches([' ', '=']).trim() == rel)))
        .unwrap_or(false)
}

impl ExternalAdapter {
    fn probe_status(&self, opts: &Options) -> (AdapterStatus, Option<String>) {
        let found = match self.probe {
            Probe::Path(rel) => match &opts.root {
                Some(r) if r.join(rel).exists() => Ok(()),
                Some(r) if gitmodule_declared(r, rel) => Err(format!("declared submodule `{rel}` is not checked out")),
                Some(_) => Err(format!("owner path `{rel}` absent from this checkout")),
                None => Err("Bun OS checkout root not found (set BUN_OS_ROOT)".to_string()),
            },
            Probe::Command(c) => which(c).map(|_| ()).ok_or_else(|| format!("command `{c}` not on PATH")),
            Probe::Env(v) => match std::env::var_os(v) {
                None => Err(format!("{v} is not set")),
                Some(d) if Path::new(&d).is_dir() => Ok(()),
                Some(d) => Err(format!("{v} points to missing directory {}", Path::new(&d).display())),
            },
        };
        match found {
            Err(r) => (AdapterStatus::Unavailable, Some(r)),
            Ok(()) if self.cmd.is_some() => (AdapterStatus::Ready, None),
            Ok(()) => (
                AdapterStatus::Registered,
                Some("owner present; driven by its own CLI, not by the pipeline".to_string()),
            ),
        }
    }
}

impl StageAdapter for ExternalAdapter {
    fn id(&self) -> &str {
        self.id
    }
    fn stage(&self) -> Stage {
        self.stage
    }
    fn info(&self, opts: &Options) -> AdapterInfo {
        let (status, reason) = self.probe_status(opts);
        AdapterInfo {
            id: self.id.to_string(),
            stage: self.stage,
            kind: self.kind,
            owner: self.owner.to_string(),
            handles: self.handles.iter().map(|s| (*s).to_string()).collect(),
            status,
            reason,
        }
    }
    fn applies(&self, ctx: &Ctx) -> bool {
        // Carving unpackers have nothing to extract from an identified, non-container console
        // cartridge or executable; the console lifters take it as is.
        if self.stage == Stage::Unpack
            && self.kind == AdapterKind::Command
            && ctx.effective_ident().is_some_and(|i| i.kind == InputKind::Rom && !i.container)
        {
            return false;
        }
        handles_input(self.handles, ctx.effective_ident(), ctx.opts.target)
    }
    fn run(&self, ctx: &mut Ctx) -> StageReport {
        let Some(cmd) = self.cmd else {
            return report(self.stage, self.id, StageStatus::Unavailable, "no command bound");
        };
        let Some(prog) = which(cmd.program) else {
            return report(self.stage, self.id, StageStatus::Unavailable, format!("command `{}` not on PATH", cmd.program));
        };
        let Some(input) = ctx.effective_path() else {
            return report(self.stage, self.id, StageStatus::Skipped, "no input available");
        };
        let out = ctx.dir(self.stage_dir()).join(self.id);
        if let Err(e) = std::fs::create_dir_all(&out) {
            return report(self.stage, self.id, StageStatus::Failed, e.to_string());
        }
        let args: Vec<String> = cmd
            .args
            .iter()
            .map(|a| a.replace("{input}", &input.display().to_string()).replace("{out}", &out.display().to_string()))
            .collect();
        match run_cmd(&prog, &args, Some(&out), &[], Duration::from_secs(ctx.opts.timeout_secs)) {
            Err(e) => report(self.stage, self.id, StageStatus::Failed, e),
            Ok(r) => {
                let status = if r.ok() { StageStatus::Ok } else { StageStatus::Failed };
                let mut rep = report(
                    self.stage,
                    self.id,
                    status,
                    if r.timed_out { "timed out".to_string() } else { format!("exit {:?}: {}", r.code, tail(&r.stderr, 400)) },
                );
                rep.artifacts = list_files(&out, "output");
                rep
            }
        }
    }
}

impl ExternalAdapter {
    fn stage_dir(&self) -> &'static str {
        match self.stage {
            Stage::Acquire => "acquire",
            Stage::Identify => "identify",
            Stage::Unpack => "unpack",
            Stage::Analyze => "analyze",
            Stage::Lift => "lift",
            Stage::Decompile => "decompile",
            Stage::Rebuild => "rebuild",
            Stage::Verify => "verify",
        }
    }
}

/// Up to 64 files under `dir` as artifacts.
#[must_use]
pub fn list_files(dir: &Path, kind: &str) -> Vec<Artifact> {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .take(64)
        .map(|e| artifact(kind, e.path()))
        .collect()
}

macro_rules! ext {
    ($id:expr, $stage:ident, $kind:ident, $owner:expr, [$($h:expr),*], $probe:expr, $cmd:expr) => {
        ExternalAdapter {
            id: $id,
            stage: Stage::$stage,
            kind: AdapterKind::$kind,
            owner: $owner,
            handles: &[$($h),*],
            probe: $probe,
            cmd: $cmd,
        }
    };
}

/// Typed external adapters bound to real Bun OS owners and host tools.
pub const EXTERNALS: &[ExternalAdapter] = &[
    // acquire
    ext!("steamcmd", Acquire, Vendor, "vendor/steamcmd", ["steam"], Probe::Path("vendor/steamcmd"), None),
    ext!("re-steam", Acquire, Crate, "crates/re/src/steam", ["steam"], Probe::Path("crates/re/src/steam"), None),
    ext!("adb-pull", Acquire, Command, "adb pull", ["apk", "android"], Probe::Command("adb"), None),
    // unpack
    ext!(
        "7z-extract",
        Unpack,
        Command,
        "7z x {input} -o{out}",
        ["iso", "compressed", "zip"],
        Probe::Command("7z"),
        Some(Cmd { program: "7z", args: &["x", "-y", "{input}", "-o{out}"] })
    ),
    ext!(
        "uefiextract",
        Unpack,
        Command,
        "UEFIExtract {input} all",
        ["uefi", "bios"],
        Probe::Command("UEFIExtract"),
        Some(Cmd { program: "UEFIExtract", args: &["{input}", "all"] })
    ),
    ext!(
        "binwalk-extract",
        Unpack,
        Command,
        "binwalk -e {input}",
        ["target:firmware", "raw", "fdt"],
        Probe::Command("binwalk"),
        Some(Cmd { program: "binwalk", args: &["-e", "-C", "{out}", "{input}"] })
    ),
    ext!(
        "unblob-extract",
        Unpack,
        Command,
        "unblob -e {out} {input}",
        ["target:firmware", "raw"],
        Probe::Command("unblob"),
        Some(Cmd { program: "unblob", args: &["-e", "{out}", "{input}"] })
    ),
    ext!("nie-formats", Unpack, Crate, "crates/aphrody-nie-formats", ["rom", "raw"], Probe::Path("crates/aphrody-nie-formats"), None),
    // analyze
    ext!("rea", Analyze, Command, "rea", ["*"], Probe::Command("rea"), None),
    ext!("re-nie", Analyze, Crate, "crates/re/src/nie", ["*"], Probe::Path("crates/re/src/nie"), None),
    ext!("re-dbxv2", Analyze, Crate, "crates/re/src/game", ["cpk", "dbxv2"], Probe::Path("crates/re/src/game"), None),
    ext!("ntr-ghidra", Analyze, Vendor, "vendor/ntr-ghidra", ["nds", "3ds"], Probe::Path("vendor/ntr-ghidra"), None),
    ext!("wii-disasm", Analyze, Crate, "crates/aphrody-wii-disasm", ["wii", "gamecube"], Probe::Path("crates/aphrody-wii-disasm"), None),
        ext!("aarch64-lift", Lift, Crate, "crates/rdynarmic", ["arm64", "aarch64"], Probe::Path("crates/rdynarmic"), None),
    ext!("ghidra-decompiler", Decompile, Crate, "crates/ghidra-decompiler", ["*"], Probe::Path("crates/ghidra-decompiler"), None),
    // rebuild
    ext!("factory-linux", Rebuild, Vendor, "bun src/cli.ts factory (factory/native-targets.json)", ["elf", "linux"], Probe::Path("factory/native-targets.json"), None),
    ext!("factory-arch", Rebuild, Vendor, "bun src/cli.ts factory --composition server|desktop|gaming", ["elf", "linux"], Probe::Path("factory/arch"), None),
    ext!("msvc-windows", Rebuild, Command, "clang-cl / cl via vcvars64.bat", ["pe", "windows"], Probe::Command("clang-cl"), None),
    ext!("android-native", Rebuild, Crate, "crates/android-native", ["apk", "android"], Probe::Path("crates/android-native"), None),
    ext!("libnds-toolchain", Rebuild, Vendor, "vendor/libnds", ["nds"], Probe::Path("vendor/libnds"), None),
    ext!("libogc-toolchain", Rebuild, Vendor, "vendor/libogc", ["wii", "gamecube"], Probe::Path("vendor/libogc"), None),
    ext!("uefi-repack", Rebuild, Command, "UEFIReplace / UEFIPatch", ["uefi", "bios", "target:bios"], Probe::Command("UEFIReplace"), None),
    ext!("firmware-repack", Rebuild, Command, "mkimage / dtc / mksquashfs", ["target:firmware", "fdt"], Probe::Command("mkimage"), None),
    // verify (emulators)
    ext!("bun-engine", Verify, Crate, "crates/bun-engine-core", ["*"], Probe::Path("crates/bun-engine-core"), None),
    ext!("emu-wii-runtime", Verify, Crate, "crates/aphrody-wii-runtime", ["wii", "gamecube"], Probe::Path("crates/aphrody-wii-runtime"), None),
    ext!("emu-dolphin", Verify, Vendor, "vendor/dolphin", ["wii", "gamecube"], Probe::Path("vendor/dolphin"), None),
    ext!("emu-ares", Verify, Vendor, "vendor/ares", ["rom", "nes", "gb", "gba", "n64"], Probe::Path("vendor/ares"), None),
    ext!("emu-mame", Verify, Vendor, "vendor/mame", ["rom", "bios"], Probe::Path("vendor/mame"), None),
    ext!("emu-retroarch", Verify, Vendor, "vendor/retroarch", ["rom"], Probe::Path("vendor/retroarch"), None),
    ext!("emu-qemu", Verify, Vendor, "vendor/qemu", ["bios", "uefi", "elf", "target:bios", "target:firmware"], Probe::Path("vendor/qemu"), None),
    ext!("emu-tetanes", Verify, Vendor, "vendor/tetanes", ["nes"], Probe::Path("vendor/tetanes"), None),
    ext!("emu-gopher64", Verify, Vendor, "vendor/gopher64", ["n64"], Probe::Path("vendor/gopher64"), None),
    ext!("emu-rustboyadvance", Verify, Vendor, "vendor/rustboyadvance-ng", ["gba"], Probe::Path("vendor/rustboyadvance-ng"), None),
    ext!("emu-jgenesis", Verify, Vendor, "vendor/jgenesis", ["genesis", "snes"], Probe::Path("vendor/jgenesis"), None),
    ext!("emu-starpsx", Verify, Vendor, "vendor/starpsx", ["ps1"], Probe::Path("vendor/starpsx"), None),
    ext!("emu-azahar", Verify, Vendor, "vendor/azahar", ["3ds"], Probe::Path("vendor/azahar"), None),
];

/// Registry of adapters in execution order.
pub struct Registry {
    adapters: Vec<Box<dyn StageAdapter>>,
}

impl Registry {
    /// Registry with built-in and external adapters.
    #[must_use]
    pub fn standard() -> Self {
        let mut adapters: Vec<Box<dyn StageAdapter>> = super::stages::builtins();
        adapters.push(Box::new(super::ghidra::Ghidra { stage: Stage::Analyze }));
        adapters.push(Box::new(super::ghidra::Ghidra { stage: Stage::Decompile }));
        for e in EXTERNALS {
            adapters.push(Box::new(*e));
        }
        Self { adapters }
    }

    /// Register an additional adapter (plug-in point for other crates).
    pub fn register(&mut self, a: Box<dyn StageAdapter>) {
        self.adapters.push(a);
    }

    /// Adapters serving `stage`.
    pub fn for_stage(&self, stage: Stage) -> impl Iterator<Item = &dyn StageAdapter> {
        self.adapters.iter().map(AsRef::as_ref).filter(move |a| a.stage() == stage)
    }

    /// Descriptors of every adapter.
    #[must_use]
    pub fn list(&self, opts: &Options) -> Vec<AdapterInfo> {
        self.adapters.iter().map(|a| a.info(opts)).collect()
    }
}

/// Input kind helper for adapters.
#[must_use]
pub fn is_x86_pe_elf(id: &IdentifyOutput) -> bool {
    id.liftable && matches!(id.kind, InputKind::Pe | InputKind::Elf)
}
