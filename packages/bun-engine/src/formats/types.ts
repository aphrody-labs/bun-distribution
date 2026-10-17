import type { BinarySource } from "./stream";

export const formatIds = [
  "nes",
  "fds",
  "gb",
  "gbc",
  "gba",
  "nds",
  "n64",
  "dol",
  "elf",
  "gamecube-disc",
  "wii-disc",
  "wbfs",
  "wia",
  "rvz",
  "cue",
  "chd",
  "psx-exe",
  "psx-disc",
  "iso9660",
  "pbp",
  "3ds-ncsd",
  "3ds-ncch",
  "nsp",
  "xci",
  "nro",
  "gba-bios",
  "nds-arm7-bios",
  "nds-arm9-bios",
  "nds-firmware",
  "psx-bios",
  "genesis",
  "unknown",
] as const;

export type FormatId = (typeof formatIds)[number];

/** Instruction sets the disassembler front end understands. */
export const archIds = [
  "6502",
  "arm",
  "thumb",
  "lr35902",
  "r3000",
  "mips-be",
  "mips-le",
  "ppc",
  "aarch64",
  "m68k",
] as const;
export type Arch = (typeof archIds)[number];

export interface Section {
  name: string;
  /** Offset of the section in the source file. */
  offset: number;
  size: number;
  /** Load address in the guest memory map, when the format defines one. */
  address?: number;
  arch?: Arch;
  kind:
    | "header"
    | "code"
    | "data"
    | "filesystem"
    | "partition"
    | "track"
    | "metadata"
    | "padding";
  /** Byte order of the stored data when it differs from the guest order (N64 v64/n64 dumps). */
  swap?: "16" | "32";
}

export interface Detection {
  format: FormatId;
  platform: string;
  /** "magic": signature match, "heuristic": structural validation, "extension": name only,
   * "catalog": plugins/consoles/formats.json signature only, "magika": ML content type. */
  by: "magic" | "heuristic" | "extension" | "catalog" | "magika";
  confidence: number;
  /** Matching entries of plugins/consoles/formats.json (owners, status, specs). */
  catalog?: Array<{
    id: string;
    kind: string;
    consoles: string[];
    status?: string;
    owners: string[];
    spec: string[];
  }>;
  magika?: unknown;
}

export interface ParsedImage<H extends object = Record<string, unknown>> {
  header: H;
  sections: Section[];
  arch?: Arch;
  entry?: number;
  /** Other owners that contributed to the parse (native Rust inspector, MAME tools...). */
  owners?: string[];
}

export interface ParseContext {
  source: BinarySource;
  path: string;
  head: Uint8Array;
}

export type FormatParser = (
  context: ParseContext,
) => Promise<ParsedImage<object>>;

export interface FileEntry {
  path: string;
  offset: number;
  size: number;
}

/** Identity helper that keeps the inferred header type of a parser (used for typed imports). */
export function parsed<H extends object>(
  image: ParsedImage<H>,
): ParsedImage<H> {
  return image;
}
