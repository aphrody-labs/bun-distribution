// SPDX-License-Identifier: Apache-2.0
//! glibc ceiling for the Bun fork binary. The build host runs a newer glibc (the factory: 2.43) than the hosts that
//! install the binary (Ubuntu 24.04 user machines: 2.39; vps and dbfr run 26.04). Linking there records `acosf@GLIBC_2.43`, `asinf@GLIBC_2.43` and
//! `atan2f@GLIBC_2.43` (libm functions re-versioned by glibc 2.43; the previous versions are still exported), which
//! makes the dynamic loader refuse the binary on older hosts. `lowerGlibcCeiling` rewrites the version requirement
//! (`.gnu.version_r` entry: hash and name) of those re-versioned symbols to the lowest GLIBC version the same library
//! is already required at, so the binary binds the older, still exported implementation. Anything above the ceiling
//! that is not a known re-versioned libm symbol is refused, never patched.

const SHT_DYNSYM = 11;
const SHT_GNU_VERNEED = 0x6ffffffe;
const SHT_GNU_VERSYM = 0x6fffffff;

/** libm symbols re-versioned by glibc 2.43 whose earlier version remains exported by older glibc. */
export const REVERSIONED_LIBM = new Set(["acosf", "asinf", "atan2f"]);

export interface GlibcAudit {
  maxGlibc: string | null;
  /** Imports above the ceiling: `name@version`. */
  above: string[];
}

export interface GlibcPatch extends GlibcAudit {
  /** Symbols moved to the older version, `name: from -> to`. */
  patched: string[];
}

interface Aux {
  at: number;
  file: string;
  version: string;
  index: number;
  nameOffset: number;
}

interface Layout {
  view: DataView;
  auxes: Aux[];
  dynsym: { offset: number; size: number; entsize: number };
  dynstr: number;
  versym: number;
}

const decoder = new TextDecoder();

function cString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(offset, end));
}

/** SysV ELF hash, the `vna_hash` of a version name. */
export function elfHash(name: string): number {
  let h = 0;
  for (const c of new TextEncoder().encode(name)) {
    h = ((h << 4) + c) >>> 0;
    const g = h & 0xf0000000;
    if (g !== 0) h = (h ^ (g >>> 24)) >>> 0;
    h = (h & ~g) >>> 0;
  }
  return h >>> 0;
}

export function parseVersion(name: string): number[] | null {
  const m = /^GLIBC_(\d+(?:\.\d+)*)$/.exec(name);
  return m ? m[1]!.split(".").map(Number) : null;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function layout(bytes: Uint8Array): Layout | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || view.getUint32(0, false) !== 0x7f454c46)
    throw new Error("not an ELF file");
  if (bytes[4] !== 2 || bytes[5] !== 1) throw new Error("only little-endian ELF64 is supported");
  const shoff = Number(view.getBigUint64(0x28, true));
  const shentsize = view.getUint16(0x3a, true);
  const shnum = view.getUint16(0x3c, true);
  const sections = Array.from({ length: shnum }, (_, i) => {
    const at = shoff + i * shentsize;
    return {
      type: view.getUint32(at + 4, true),
      offset: Number(view.getBigUint64(at + 0x18, true)),
      size: Number(view.getBigUint64(at + 0x20, true)),
      link: view.getUint32(at + 0x28, true),
      info: view.getUint32(at + 0x2c, true),
      entsize: Number(view.getBigUint64(at + 0x38, true)),
    };
  });
  const dynsym = sections.find((s) => s.type === SHT_DYNSYM);
  const verneed = sections.find((s) => s.type === SHT_GNU_VERNEED);
  const versym = sections.find((s) => s.type === SHT_GNU_VERSYM);
  if (!dynsym || !verneed || !versym) return null;
  const dynstr = sections[dynsym.link]!.offset;
  const strings = sections[verneed.link]!.offset;
  const auxes: Aux[] = [];
  let at = verneed.offset;
  for (let n = 0; n < verneed.info; n++) {
    const count = view.getUint16(at + 2, true);
    const file = cString(bytes, strings + view.getUint32(at + 4, true));
    let aux = at + view.getUint32(at + 8, true);
    for (let k = 0; k < count; k++) {
      const nameOffset = view.getUint32(aux + 8, true);
      auxes.push({
        at: aux,
        file,
        version: cString(bytes, strings + nameOffset),
        index: view.getUint16(aux + 6, true) & 0x7fff,
        nameOffset,
      });
      aux += view.getUint32(aux + 12, true);
    }
    at += view.getUint32(at + 12, true);
  }
  return {
    view,
    auxes,
    dynsym: { offset: dynsym.offset, size: dynsym.size, entsize: dynsym.entsize },
    dynstr,
    versym: versym.offset,
  };
}

/** Undefined dynamic symbols with the version index they are bound to. */
function imports(bytes: Uint8Array, l: Layout): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  const count = Math.floor(l.dynsym.size / (l.dynsym.entsize || 24));
  for (let i = 1; i < count; i++) {
    const at = l.dynsym.offset + i * 24;
    if (l.view.getUint16(at + 6, true) !== 0) continue;
    const name = cString(bytes, l.dynstr + l.view.getUint32(at, true));
    if (name) out.push({ name, index: l.view.getUint16(l.versym + i * 2, true) & 0x7fff });
  }
  return out;
}

function audit(bytes: Uint8Array, l: Layout | null, ceiling: string): GlibcAudit {
  if (!l) return { maxGlibc: null, above: [] };
  const limit = ceiling.split(".").map(Number);
  const byIndex = new Map(l.auxes.map((a) => [a.index, a.version]));
  let best: number[] | null = null;
  let maxGlibc: string | null = null;
  const above: string[] = [];
  for (const { name, index } of imports(bytes, l)) {
    const version = byIndex.get(index);
    const parsed = version ? parseVersion(version) : null;
    if (!version || !parsed) continue;
    if (!best || compare(parsed, best) > 0) {
      best = parsed;
      maxGlibc = version;
    }
    if (compare(parsed, limit) > 0) above.push(`${name}@${version}`);
  }
  return { maxGlibc, above };
}

export function auditGlibc(bytes: Uint8Array, ceiling: string): GlibcAudit {
  return audit(bytes, layout(bytes), ceiling);
}

/**
 * Rewrites, in place, the version requirement of the re-versioned libm symbols above `ceiling`. Returns what was
 * patched and the audit afterwards; throws when another import stays above the ceiling.
 */
export function lowerGlibcCeiling(bytes: Uint8Array, ceiling: string): GlibcPatch {
  const l = layout(bytes);
  const before = audit(bytes, l, ceiling);
  if (!l || before.above.length === 0) return { ...before, patched: [] };
  const limit = ceiling.split(".").map(Number);
  const strange = before.above.filter((s) => !REVERSIONED_LIBM.has(s.split("@")[0]!));
  if (strange.length > 0)
    throw new Error(
      `imports above glibc ${ceiling} that are not known re-versioned libm symbols: ${strange.join(", ")}`,
    );

  // Target: the lowest GLIBC version libm.so.6 is already required at (GLIBC_2.2.5 on x86_64, 2.17 on arm64).
  const libm = l.auxes
    .filter((a) => a.file.startsWith("libm.so") && parseVersion(a.version))
    .toSorted((a, b) => compare(parseVersion(a.version)!, parseVersion(b.version)!));
  const target = libm[0];
  if (!target || compare(parseVersion(target.version)!, limit) > 0)
    throw new Error("no libm requirement at or below the ceiling to rebind to");

  const byIndex = new Map(l.auxes.map((a) => [a.index, a]));
  const moved = new Set<number>();
  const patched: string[] = [];
  for (const { name, index } of imports(bytes, l)) {
    const aux = byIndex.get(index);
    if (!aux || !aux.file.startsWith("libm.so") || !REVERSIONED_LIBM.has(name)) continue;
    const parsed = parseVersion(aux.version);
    if (!parsed || compare(parsed, limit) <= 0) continue;
    patched.push(`${name}: ${aux.version} -> ${target.version}`);
    moved.add(aux.index);
  }
  // Every symbol bound to a moved requirement is a re-versioned one (checked above): the entry can be renamed.
  for (const index of moved) {
    const aux = byIndex.get(index)!;
    l.view.setUint32(aux.at, elfHash(target.version), true);
    l.view.setUint32(aux.at + 8, target.nameOffset, true);
  }
  const after = auditGlibc(bytes, ceiling);
  if (after.above.length > 0)
    throw new Error(`still above glibc ${ceiling}: ${after.above.join(", ")}`);
  return { ...after, patched };
}
