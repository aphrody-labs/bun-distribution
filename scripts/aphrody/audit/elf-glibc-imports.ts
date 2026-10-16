#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Lists the versioned symbols an ELF64 shared object or executable imports (`.dynsym` undefined
 * entries joined with `.gnu.version_r`) and, with `--max <version>`, fails when a GLIBC version above
 * that ceiling is required. A library built on a newer glibc (the VPS runs 2.43) must not import
 * `acosf@GLIBC_2.43` when it has to load on an older host (WSL runs 2.39).
 *
 *   bun scripts/audit/elf-glibc-imports.ts <elf> [--max 2.39] [--libm]
 *
 * `--libm` also lists the symbols the file *defines* with a version above the ceiling (use it on a libm
 * to learn which functions a newer glibc re-versioned).
 */
import { readFileSync } from "node:fs";

const SHT_DYNSYM = 11;
const SHT_GNU_VERDEF = 0x6ffffffd;
const SHT_GNU_VERNEED = 0x6ffffffe;
const SHT_GNU_VERSYM = 0x6fffffff;

export interface VersionedSymbol {
  symbol: string;
  version: string | null;
  file: string | null;
}

export interface ElfVersionReport {
  imports: VersionedSymbol[];
  defined: VersionedSymbol[];
  /** Highest `GLIBC_x.y` among the imports (null when none). */
  maxGlibc: string | null;
}

interface Section {
  type: number;
  offset: number;
  size: number;
  link: number;
  info: number;
  entsize: number;
}

/** `GLIBC_2.39` -> [2, 39] (null for other version names such as `GCC_3.0`). */
export function glibcVersion(name: string | null): number[] | null {
  const match = /^GLIBC_(\d+(?:\.\d+)*)$/.exec(name ?? "");
  return match ? match[1]!.split(".").map(Number) : null;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function cString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

export function readElfVersions(bytes: Uint8Array): ElfVersionReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || view.getUint32(0, false) !== 0x7f454c46)
    throw new Error("not an ELF file");
  if (bytes[4] !== 2 || bytes[5] !== 1) throw new Error("only little-endian ELF64 is supported");
  const shoff = Number(view.getBigUint64(0x28, true));
  const shentsize = view.getUint16(0x3a, true);
  const shnum = view.getUint16(0x3c, true);
  const sections: Section[] = [];
  for (let i = 0; i < shnum; i++) {
    const at = shoff + i * shentsize;
    sections.push({
      type: view.getUint32(at + 4, true),
      offset: Number(view.getBigUint64(at + 0x18, true)),
      size: Number(view.getBigUint64(at + 0x20, true)),
      link: view.getUint32(at + 0x28, true),
      info: view.getUint32(at + 0x2c, true),
      entsize: Number(view.getBigUint64(at + 0x38, true)),
    });
  }
  const dynsym = sections.find((s) => s.type === SHT_DYNSYM);
  if (!dynsym) return { imports: [], defined: [], maxGlibc: null };
  const dynstr = sections[dynsym.link]!;
  const name = (offset: number) => cString(bytes, dynstr.offset + offset);

  // version index -> { version, file } from both the needed and the defined tables.
  const versions = new Map<number, { version: string; file: string | null }>();
  const verneed = sections.find((s) => s.type === SHT_GNU_VERNEED);
  if (verneed) {
    const strings = sections[verneed.link]!;
    let at = verneed.offset;
    for (let n = 0; n < verneed.info; n++) {
      const count = view.getUint16(at + 2, true);
      const file = cString(bytes, strings.offset + view.getUint32(at + 4, true));
      let aux = at + view.getUint32(at + 8, true);
      for (let k = 0; k < count; k++) {
        const index = view.getUint16(aux + 6, true) & 0x7fff;
        versions.set(index, {
          version: cString(bytes, strings.offset + view.getUint32(aux + 8, true)),
          file,
        });
        aux += view.getUint32(aux + 12, true) || 0;
      }
      at += view.getUint32(at + 12, true);
    }
  }
  const verdef = sections.find((s) => s.type === SHT_GNU_VERDEF);
  if (verdef) {
    const strings = sections[verdef.link]!;
    let at = verdef.offset;
    for (let n = 0; n < verdef.info; n++) {
      const index = view.getUint16(at + 4, true) & 0x7fff;
      const aux = at + view.getUint32(at + 12, true);
      versions.set(index, {
        version: cString(bytes, strings.offset + view.getUint32(aux, true)),
        file: null,
      });
      const next = view.getUint32(at + 16, true);
      if (next === 0) break;
      at += next;
    }
  }
  const versym = sections.find((s) => s.type === SHT_GNU_VERSYM);

  const imports: VersionedSymbol[] = [];
  const defined: VersionedSymbol[] = [];
  const count = Math.floor(dynsym.size / (dynsym.entsize || 24));
  for (let i = 1; i < count; i++) {
    const at = dynsym.offset + i * 24;
    const symbol = name(view.getUint32(at, true));
    if (!symbol) continue;
    const shndx = view.getUint16(at + 6, true);
    const raw = versym ? view.getUint16(versym.offset + i * 2, true) : 0;
    const info = versions.get(raw & 0x7fff);
    const entry = { symbol, version: info?.version ?? null, file: info?.file ?? null };
    (shndx === 0 ? imports : defined).push(entry);
  }
  let maxGlibc: string | null = null;
  let best: number[] | null = null;
  for (const entry of imports) {
    const parsed = glibcVersion(entry.version);
    if (parsed && (!best || compareVersions(parsed, best) > 0)) {
      best = parsed;
      maxGlibc = entry.version;
    }
  }
  return { imports, defined, maxGlibc };
}

/** Imports (or definitions) whose GLIBC version is above `ceiling` (e.g. "2.39"). */
export function aboveCeiling(symbols: VersionedSymbol[], ceiling: string): VersionedSymbol[] {
  const limit = ceiling.split(".").map(Number);
  return symbols.filter((entry) => {
    const parsed = glibcVersion(entry.version);
    return parsed !== null && compareVersions(parsed, limit) > 0;
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--max");
  if (!path) {
    console.error("usage: elf-glibc-imports.ts <elf> [--max 2.39] [--libm]");
    process.exit(64);
  }
  const maxIndex = args.indexOf("--max");
  const max = maxIndex >= 0 ? args[maxIndex + 1] : undefined;
  const report = readElfVersions(readFileSync(path));
  const offending = max ? aboveCeiling(report.imports, max) : [];
  const definedAbove = args.includes("--libm") && max ? aboveCeiling(report.defined, max) : [];
  console.log(
    JSON.stringify(
      {
        path,
        maxGlibc: report.maxGlibc,
        importCount: report.imports.length,
        ceiling: max ?? null,
        offending,
        definedAbove: args.includes("--libm") ? definedAbove : undefined,
      },
      null,
      2,
    ),
  );
  process.exitCode = offending.length > 0 ? 1 : 0;
}
