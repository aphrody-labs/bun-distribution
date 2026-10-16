// SPDX-License-Identifier: Apache-2.0
//! Typed JSON stage contract of the RE pipeline. Mirrored by `packages/re/src/pipeline/contract.ts`
//! and by the JSON Schemas under `crates/re/schema/`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Contract revision.
pub const SCHEMA_VERSION: u32 = 1;

/// Pipeline target family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    /// Operating-system binaries (PE, ELF, Mach-O, APK, ISO).
    Os,
    /// BIOS / UEFI images.
    Bios,
    /// Device firmware and console ROMs.
    Firmware,
}

impl TargetKind {
    /// Parse a CLI value.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "os" => Some(Self::Os),
            "bios" => Some(Self::Bios),
            "firmware" => Some(Self::Firmware),
            _ => None,
        }
    }
}

/// Pipeline stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    /// Fetch the input and fingerprint it.
    Acquire,
    /// Identify format, architecture and platform.
    Identify,
    /// Unpack containers into payloads.
    Unpack,
    /// Static analysis (triage, Ghidra, rea).
    Analyze,
    /// Lift machine code to IR.
    Lift,
    /// Emit readable source (C / Rust) or decompile.
    Decompile,
    /// Rebuild with a toolchain or repack.
    Rebuild,
    /// Verify by compile checks, emulation, diff or trace.
    Verify,
}

impl Stage {
    /// Stages in execution order.
    pub const ALL: [Stage; 8] = [
        Stage::Acquire,
        Stage::Identify,
        Stage::Unpack,
        Stage::Analyze,
        Stage::Lift,
        Stage::Decompile,
        Stage::Rebuild,
        Stage::Verify,
    ];
}

/// Stage outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    /// Completed.
    Ok,
    /// Completed with reported gaps (unlifted instructions, skipped payloads).
    Partial,
    /// No runnable adapter exists for this input; candidates are listed in the detail.
    Unavailable,
    /// Skipped because an earlier stage did not produce its input.
    Skipped,
    /// Adapter ran and failed.
    Failed,
}

/// File produced by a stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    /// Role (`ir`, `c`, `rust`, `object`, `image`, `log`, `payload`).
    pub kind: String,
    /// Path.
    pub path: String,
    /// Size in bytes.
    pub bytes: u64,
}

/// Result of one stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StageReport {
    /// Stage.
    pub stage: Stage,
    /// Adapter id that produced the report.
    pub adapter: String,
    /// Outcome.
    pub status: StageStatus,
    /// Human-readable detail (reason when not `ok`).
    pub detail: String,
    /// Produced files.
    pub artifacts: Vec<Artifact>,
    /// Numeric metrics.
    pub metrics: BTreeMap<String, u64>,
    /// Stage-specific typed payload (see the `*Output` contract structs).
    pub output: serde_json::Value,
}

/// Input classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    /// Windows PE.
    Pe,
    /// ELF.
    Elf,
    /// Mach-O or fat Mach-O.
    Macho,
    /// Android APK/AAB.
    Apk,
    /// Generic ZIP.
    Zip,
    /// ISO 9660 image.
    Iso,
    /// UEFI firmware volume / flash image.
    Uefi,
    /// Legacy BIOS image.
    Bios,
    /// Console or cartridge ROM.
    Rom,
    /// Device-tree blob / FIT image.
    Fdt,
    /// Compressed stream (gzip, xz, zstd, bzip2).
    Compressed,
    /// Unknown raw blob.
    Raw,
}

/// Output of the acquire stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcquireOutput {
    /// Requested source.
    pub source: String,
    /// Local path used by later stages.
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// SHA-256 hex.
    pub sha256: String,
}

/// Output of the identify stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentifyOutput {
    /// Classification.
    pub kind: InputKind,
    /// Format label.
    pub format: String,
    /// Architecture (`x86_64`, `x86`, `arm64`, `arm`, `mips`, ...) when known.
    pub arch: Option<String>,
    /// Platform hint (`windows`, `linux`, `android`, `gba`, `uefi`, ...).
    pub platform: Option<String>,
    /// Entry point when the format has one.
    pub entry: Option<u64>,
    /// True when the built-in lifter can process the machine code directly.
    pub liftable: bool,
    /// True when the input is a container needing the unpack stage.
    pub container: bool,
    /// Notes.
    pub notes: Vec<String>,
}

/// Extracted payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payload {
    /// Name inside the container.
    pub name: String,
    /// Extracted path.
    pub path: String,
    /// Size in bytes.
    pub size: u64,
    /// Classification.
    pub kind: InputKind,
}

/// Output of the unpack stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnpackOutput {
    /// Extracted payloads.
    pub payloads: Vec<Payload>,
    /// Payload selected for analysis/lift.
    pub primary: Option<String>,
}

/// Output of the lift stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiftOutput {
    /// IR JSON path.
    pub ir: String,
    /// Counters.
    pub stats: super::ir::LiftStats,
    /// Fraction of instructions modelled (0..1).
    pub coverage: f64,
}

/// One verification check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Check {
    /// Check name.
    pub name: String,
    /// Pass/fail.
    pub ok: bool,
    /// Detail or tool output excerpt.
    pub detail: String,
}

/// Output of the verify stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerifyOutput {
    /// Checks performed.
    pub checks: Vec<Check>,
}

/// Whole-run report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PipelineReport {
    /// Contract revision.
    pub schema_version: u32,
    /// Input as given.
    pub input: String,
    /// Target family.
    pub target: TargetKind,
    /// Output directory.
    pub outdir: String,
    /// One report per stage, in order.
    pub stages: Vec<StageReport>,
    /// `ok` when every stage is ok, `partial` when some stages are partial/unavailable but the run
    /// produced artifacts, `failed` otherwise.
    pub summary: String,
}
