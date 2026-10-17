// SPDX-License-Identifier: MIT
// ELF dynamic-section analysis for Linux payloads: needed sonames, search paths and
// symbol-version requirements. Reference: System V ABI and the GNU symbol-versioning
// extension (DT_VERNEED/DT_VERDEF).

export interface ElfVersionNeed {
  file: string;
  versions: string[];
}

export interface ElfDynamic {
  bits: 32 | 64;
  machine: number;
  type: number;
  interpreter?: string;
  soname?: string;
  needed: string[];
  rpath: string[];
  runpath: string[];
  versionNeeds: ElfVersionNeed[];
  versionDefinitions: string[];
}

const DT = {
  NULL: 0,
  NEEDED: 1,
  STRTAB: 5,
  STRSZ: 10,
  SONAME: 14,
  RPATH: 15,
  RUNPATH: 29,
  VERDEF: 0x6ffffffc,
  VERDEFNUM: 0x6ffffffd,
  VERNEED: 0x6ffffffe,
  VERNEEDNUM: 0x6fffffff,
} as const;

export const isElf = (data: Uint8Array): boolean =>
  data.length >= 52 && data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46;

/** Parse the dynamic segment through program headers; stripped binaries keep it. */
export function elfDynamic(data: Uint8Array): ElfDynamic | undefined {
  if (!isElf(data)) return undefined;
  const bits = data[4] === 2 ? 64 : data[4] === 1 ? 32 : 0;
  const little = data[5] === 1;
  if (!bits || (data[5] !== 1 && data[5] !== 2)) throw new Error("Invalid ELF class or byte order");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const word = (offset: number): number => {
    if (bits === 32) return u32(offset);
    const value = view.getBigUint64(offset, little);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ELF value exceeds safe integer");
    return Number(value);
  };
  const check = (offset: number, size: number) => {
    if (offset < 0 || size < 0 || offset + size > data.length) throw new Error("Truncated ELF structure");
  };
  const type = u16(16);
  const machine = u16(18);
  const phoff = bits === 64 ? word(32) : u32(28);
  const phentsize = u16(bits === 64 ? 54 : 42);
  const phnum = u16(bits === 64 ? 56 : 44);
  if (phnum > 4096 || (phnum && phentsize < (bits === 64 ? 56 : 32)))
    throw new Error("Invalid ELF program header table");
  check(phoff, phnum * phentsize);
  const loads: Array<{ vaddr: number; offset: number; size: number }> = [];
  let dynamic: { offset: number; size: number } | undefined;
  let interpreter: string | undefined;
  for (let index = 0; index < phnum; index++) {
    const base = phoff + index * phentsize;
    const kind = u32(base);
    const offset = bits === 64 ? word(base + 8) : u32(base + 4);
    const vaddr = bits === 64 ? word(base + 16) : u32(base + 8);
    const filesz = bits === 64 ? word(base + 32) : u32(base + 16);
    if (kind === 1) loads.push({ vaddr, offset, size: filesz });
    else if (kind === 2) dynamic = { offset, size: filesz };
    else if (kind === 3) {
      check(offset, filesz);
      const bytes = data.subarray(offset, offset + filesz);
      const end = bytes.indexOf(0);
      interpreter = new TextDecoder().decode(bytes.subarray(0, end < 0 ? bytes.length : end));
    }
  }
  const result: ElfDynamic = {
    bits,
    machine,
    type,
    interpreter,
    needed: [],
    rpath: [],
    runpath: [],
    versionNeeds: [],
    versionDefinitions: [],
  };
  if (!dynamic) return result;
  check(dynamic.offset, dynamic.size);
  const entrySize = bits === 64 ? 16 : 8;
  const entries: Array<[number, number]> = [];
  for (let offset = dynamic.offset; offset + entrySize <= dynamic.offset + dynamic.size; offset += entrySize) {
    const tag = bits === 64 ? Number(view.getBigInt64(offset, little)) : u32(offset);
    if (tag === DT.NULL) break;
    entries.push([tag, word(offset + (bits === 64 ? 8 : 4))]);
    if (entries.length > 65536) throw new Error("ELF dynamic section too large");
  }
  const map = (address: number): number => {
    for (const load of loads)
      if (address >= load.vaddr && address - load.vaddr < load.size) return load.offset + address - load.vaddr;
    throw new Error("ELF address is outside loaded file bytes");
  };
  const value = (tag: number) => entries.find(([key]) => key === tag)?.[1];
  const strtabAddress = value(DT.STRTAB);
  if (strtabAddress === undefined) return result;
  const strtab = map(strtabAddress);
  const strsz = value(DT.STRSZ) ?? data.length - strtab;
  check(strtab, Math.min(strsz, data.length - strtab));
  const text = new TextDecoder();
  const string = (offset: number): string => {
    const start = strtab + offset;
    if (offset >= strsz || start >= data.length) throw new Error("ELF string offset out of range");
    let end = start;
    while (end < data.length && data[end] !== 0 && end - start < 4096) end++;
    return text.decode(data.subarray(start, end));
  };
  for (const [tag, entry] of entries) {
    if (tag === DT.NEEDED) result.needed.push(string(entry));
    else if (tag === DT.SONAME) result.soname = string(entry);
    else if (tag === DT.RPATH) result.rpath.push(...string(entry).split(":"));
    else if (tag === DT.RUNPATH) result.runpath.push(...string(entry).split(":"));
  }
  const verneed = value(DT.VERNEED);
  if (verneed !== undefined) {
    let offset = map(verneed);
    const count = Math.min(value(DT.VERNEEDNUM) ?? 0, 4096);
    for (let index = 0; index < count; index++) {
      check(offset, 16);
      const need: ElfVersionNeed = {
        file: string(u32(offset + 4)),
        versions: [],
      };
      let aux = offset + u32(offset + 8);
      for (let item = 0, items = Math.min(u16(offset + 2), 4096); item < items; item++) {
        check(aux, 16);
        need.versions.push(string(u32(aux + 8)));
        const next = u32(aux + 12);
        if (!next) break;
        aux += next;
      }
      result.versionNeeds.push(need);
      const next = u32(offset + 12);
      if (!next) break;
      offset += next;
    }
  }
  const verdef = value(DT.VERDEF);
  if (verdef !== undefined) {
    let offset = map(verdef);
    const count = Math.min(value(DT.VERDEFNUM) ?? 0, 65536);
    for (let index = 0; index < count; index++) {
      check(offset, 20);
      const aux = offset + u32(offset + 12);
      check(aux, 8);
      // Flag 1 (VER_FLG_BASE) names the file itself, not a symbol version.
      if (!(u16(offset + 2) & 1)) result.versionDefinitions.push(string(u32(aux)));
      const next = u32(offset + 16);
      if (!next) break;
      offset += next;
    }
  }
  return result;
}

/** Compare dotted numeric versions such as 2.38 or 3.4.33. */
export function compareDotted(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** Highest version per prefix (GLIBC, GLIBCXX, CXXABI, GCC) from a version list. */
export function highestVersions(names: Iterable<string>): Record<string, string> {
  const highest: Record<string, string> = Object.create(null);
  for (const name of names) {
    const match = /^(GLIBC|GLIBCXX|CXXABI|GCC)_(\d+(?:\.\d+)*)$/.exec(name);
    if (!match) continue;
    const [, prefix, version] = match;
    if (!highest[prefix!] || compareDotted(version!, highest[prefix!]!) > 0) highest[prefix!] = version!;
  }
  return highest;
}
