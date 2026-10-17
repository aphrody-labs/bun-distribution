// SPDX-License-Identifier: Apache-2.0
// Mirrors crates/re/src/pipeline/contract.rs and the JSON Schemas in crates/re/schema/.

export type TargetKind = "os" | "bios" | "firmware";
export type Stage =
  | "acquire"
  | "identify"
  | "unpack"
  | "analyze"
  | "lift"
  | "decompile"
  | "rebuild"
  | "verify";
export type StageStatus =
  | "ok"
  | "partial"
  | "unavailable"
  | "skipped"
  | "failed";
export type InputKind =
  | "pe"
  | "elf"
  | "macho"
  | "apk"
  | "zip"
  | "iso"
  | "uefi"
  | "bios"
  | "rom"
  | "fdt"
  | "compressed"
  | "raw";

export const STAGES: readonly Stage[] = [
  "acquire",
  "identify",
  "unpack",
  "analyze",
  "lift",
  "decompile",
  "rebuild",
  "verify",
];

export interface Artifact {
  kind: string;
  path: string;
  bytes: number;
}

export interface StageReport {
  stage: Stage;
  adapter: string;
  status: StageStatus;
  detail: string;
  artifacts: Artifact[];
  metrics: Record<string, number>;
  /** AcquireOutput | IdentifyOutput | UnpackOutput | TriageReport | LiftOutput | VerifyOutput | null */
  output: unknown;
}

export interface AcquireOutput {
  source: string;
  path: string;
  size: number;
  sha256: string;
}

export interface IdentifyOutput {
  kind: InputKind;
  format: string;
  arch: string | null;
  platform: string | null;
  entry: number | null;
  liftable: boolean;
  container: boolean;
  notes: string[];
}

export interface Payload {
  name: string;
  path: string;
  size: number;
  kind: InputKind;
}
export interface UnpackOutput {
  payloads: Payload[];
  primary: string | null;
}

export interface LiftStats {
  functions: number;
  blocks: number;
  instructions: number;
  lifted: number;
  unlifted: number;
}
export interface LiftOutput {
  ir: string;
  stats: LiftStats;
  coverage: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface VerifyOutput {
  checks: Check[];
}

export interface PipelineReport {
  schema_version: 1;
  input: string;
  target: TargetKind;
  outdir: string;
  stages: StageReport[];
  summary: "ok" | "partial" | "failed";
}

export type AdapterKind = "builtin" | "crate" | "vendor" | "command" | "env";
export type AdapterStatus = "ready" | "registered" | "unavailable";

export interface AdapterInfo {
  id: string;
  stage: Stage;
  kind: AdapterKind;
  owner: string;
  handles: string[];
  status: AdapterStatus;
  reason: string | null;
}

export type Operand =
  | { kind: "reg"; name: string; bits: number; high: boolean }
  | { kind: "imm"; value: number }
  | {
      kind: "mem";
      base: string | null;
      index: string | null;
      scale: number;
      disp: number;
      bits: number;
    };

export interface IrInsn {
  addr: number;
  len: number;
  text: string;
  op: string;
  [field: string]: unknown;
}
export interface IrBlock {
  addr: number;
  fallthrough: number | null;
  insns: IrInsn[];
}
export interface IrFunction {
  addr: number;
  name: string | null;
  truncated: boolean;
  blocks: IrBlock[];
}
export interface IrModule {
  schema_version: number;
  format: "pe" | "elf";
  arch: "x86" | "x86_64";
  bits: number;
  image_base: number;
  entry: number;
  image_end: number;
  imports: { name: string; lib: string | null; slot: number }[];
  sections: {
    name: string;
    vaddr: number;
    vsize: number;
    file_offset: number;
    file_size: number;
    exec: boolean;
    write: boolean;
  }[];
  functions: IrFunction[];
}

export interface PipelineOptions {
  target: TargetKind;
  outdir: string;
  external?: boolean | undefined;
  trace?: boolean | undefined;
  maxFunctions?: number | undefined;
  maxInsns?: number | undefined;
  timeoutSecs?: number | undefined;
}
