// SPDX-License-Identifier: MIT
/** Read-only PE/COFF metadata: headers, sections, imports, exports, resources, CLR header. */
import { basename, resolve } from "node:path";
import { abi } from "../../package-converter/src/abi.ts";

const MACHINES: Record<number, string> = {
  0x14c: "x86",
  0x8664: "x64",
  0x1c0: "arm",
  0x1c4: "armnt",
  0xaa64: "arm64",
  0xa641: "arm64ec",
  0x5064: "riscv64",
  0x200: "ia64",
};
const SUBSYSTEMS: Record<number, string> = {
  1: "native",
  2: "windows-gui",
  3: "windows-cui",
  9: "windows-ce",
  10: "efi-application",
  11: "efi-boot-driver",
  12: "efi-runtime-driver",
  13: "efi-rom",
  14: "xbox",
  16: "windows-boot-application",
};
const RESOURCE_TYPES: Record<number, string> = {
  1: "CURSOR",
  2: "BITMAP",
  3: "ICON",
  4: "MENU",
  5: "DIALOG",
  6: "STRING",
  7: "FONTDIR",
  8: "FONT",
  9: "ACCELERATOR",
  10: "RCDATA",
  11: "MESSAGETABLE",
  12: "GROUP_CURSOR",
  14: "GROUP_ICON",
  16: "VERSION",
  17: "DLGINCLUDE",
  19: "PLUGPLAY",
  20: "VXD",
  21: "ANICURSOR",
  22: "ANIICON",
  23: "HTML",
  24: "MANIFEST",
};

export interface PeSection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
  characteristics: number;
  flags: string[];
}
export interface PeImport {
  dll: string;
  delayed: boolean;
  functions: (string | number)[];
}
export interface PeResource {
  type: string;
  name: string | number;
  language: number;
  size: number;
  rva: number;
}
export interface PeInfo {
  path: string;
  name: string;
  size: number;
  machine: string;
  bits: 32 | 64;
  timestamp: string;
  characteristics: string[];
  dll: boolean;
  subsystem: string;
  entryPoint: number;
  imageBase: string;
  sizeOfImage: number;
  linkerVersion: string;
  osVersion: string;
  dllCharacteristics: string[];
  dotnet: { runtime: string; flags: number } | null;
  sections: PeSection[];
  imports: PeImport[];
  exports: {
    dll: string | null;
    functions: {
      name: string | null;
      ordinal: number;
      rva: number;
      forwarder?: string;
    }[];
  };
  resources: PeResource[];
  version: Record<string, string>;
  manifest: string | null;
  abi: unknown;
}

const flagNames = (value: number, names: Record<number, string>): string[] =>
  Object.entries(names)
    .filter(([bit]) => value & Number(bit))
    .map(([, name]) => name);

export function parsePe(data: Uint8Array, path = "<memory>"): PeInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 64 || view.getUint16(0, true) !== 0x5a4d) throw new TypeError(`not a PE image (no MZ): ${path}`);
  const pe = view.getUint32(60, true);
  if (pe + 24 > data.length || view.getUint32(pe, true) !== 0x4550)
    throw new TypeError(`invalid PE signature: ${path}`);
  const machine = view.getUint16(pe + 4, true);
  const count = view.getUint16(pe + 6, true);
  const time = view.getUint32(pe + 8, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const chars = view.getUint16(pe + 22, true);
  const opt = pe + 24;
  const magic = view.getUint16(opt, true);
  const wide = magic === 0x20b;
  const dirBase = opt + (wide ? 112 : 96);
  const dirCount = Math.min(16, view.getUint32(opt + (wide ? 108 : 92), true));
  const secBase = opt + optionalSize;
  const ascii = new TextDecoder("latin1");

  const sections: PeSection[] = [];
  for (let i = 0; i < count && secBase + i * 40 + 40 <= data.length; i++) {
    const s = secBase + i * 40;
    const c = view.getUint32(s + 36, true);
    sections.push({
      name: ascii.decode(data.subarray(s, s + 8)).replace(/\0.*$/s, ""),
      virtualSize: view.getUint32(s + 8, true),
      virtualAddress: view.getUint32(s + 12, true),
      rawSize: view.getUint32(s + 16, true),
      rawOffset: view.getUint32(s + 20, true),
      characteristics: c,
      flags: flagNames(c, {
        0x20: "code",
        0x40: "initialized",
        0x80: "uninitialized",
        0x20000000: "execute",
        0x40000000: "read",
        0x80000000: "write",
      }),
    });
  }
  const off = (rva: number): number => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
        const o = s.rawOffset + rva - s.virtualAddress;
        return o < data.length ? o : -1;
      }
    }
    return rva < data.length && rva < (sections[0]?.rawOffset ?? 0x400) ? rva : -1;
  };
  const cstr = (o: number, max = 512): string => {
    if (o < 0) return "";
    let e = o;
    while (e < data.length && e - o < max && data[e] !== 0) e++;
    return ascii.decode(data.subarray(o, e));
  };
  const dir = (i: number): [number, number] =>
    i < dirCount && dirBase + i * 8 + 8 <= secBase
      ? [view.getUint32(dirBase + i * 8, true), view.getUint32(dirBase + i * 8 + 4, true)]
      : [0, 0];
  const u32 = (o: number) => (o >= 0 && o + 4 <= data.length ? view.getUint32(o, true) : 0);
  const u16 = (o: number) => (o >= 0 && o + 2 <= data.length ? view.getUint16(o, true) : 0);

  const thunks = (rva: number): (string | number)[] => {
    const out: (string | number)[] = [];
    let o = off(rva);
    for (let n = 0; o >= 0 && n < 65536; n++, o += wide ? 8 : 4) {
      const lo = u32(o);
      const hi = wide ? u32(o + 4) : 0;
      if (!lo && !hi) break;
      const ordinal = wide ? hi & 0x80000000 : lo & 0x80000000;
      out.push(ordinal ? lo & 0xffff : cstr(off(lo) + 2));
    }
    return out;
  };
  const imports: PeImport[] = [];
  const [impRva] = dir(1);
  for (let o = impRva ? off(impRva) : -1, n = 0; o >= 0 && o + 20 <= data.length && n < 4096; o += 20, n++) {
    const nameRva = u32(o + 12);
    if (!nameRva && !u32(o) && !u32(o + 16)) break;
    imports.push({
      dll: cstr(off(nameRva)),
      delayed: false,
      functions: thunks(u32(o) || u32(o + 16)),
    });
  }
  const [delayRva] = dir(13);
  for (let o = delayRva ? off(delayRva) : -1, n = 0; o >= 0 && o + 32 <= data.length && n < 4096; o += 32, n++) {
    if (!u32(o + 4)) break;
    imports.push({
      dll: cstr(off(u32(o + 4))),
      delayed: true,
      functions: thunks(u32(o + 16)),
    });
  }

  const exports: PeInfo["exports"] = { dll: null, functions: [] };
  const [expRva, expSize] = dir(0);
  const e = expRva ? off(expRva) : -1;
  if (e >= 0) {
    exports.dll = cstr(off(u32(e + 12)));
    const base = u32(e + 16);
    const nFuncs = Math.min(u32(e + 20), 65536);
    const nNames = Math.min(u32(e + 24), 65536);
    const funcs = off(u32(e + 28));
    const names = off(u32(e + 32));
    const ords = off(u32(e + 36));
    const named = new Map<number, string>();
    for (let i = 0; i < nNames; i++) named.set(u16(ords + i * 2), cstr(off(u32(names + i * 4))));
    for (let i = 0; i < nFuncs; i++) {
      const rva = u32(funcs + i * 4);
      if (!rva) continue;
      const entry: PeInfo["exports"]["functions"][number] = {
        name: named.get(i) ?? null,
        ordinal: base + i,
        rva,
      };
      if (rva >= expRva && rva < expRva + expSize) entry.forwarder = cstr(off(rva));
      exports.functions.push(entry);
    }
  }

  const resources: PeResource[] = [];
  const [resRva] = dir(2);
  const root = resRva ? off(resRva) : -1;
  const resName = (v: number): string | number => {
    if (!(v & 0x80000000)) return v & 0xffff;
    const o = root + (v & 0x7fffffff);
    return new TextDecoder("utf-16le").decode(data.subarray(o + 2, o + 2 + u16(o) * 2));
  };
  const walk = (o: number, depth: number, path: (string | number)[]): void => {
    if (o < 0 || depth > 2 || resources.length > 4096) return;
    const n = u16(o + 12) + u16(o + 14);
    for (let i = 0; i < n; i++) {
      const name = resName(u32(o + 16 + i * 8));
      const target = u32(o + 20 + i * 8);
      if (target & 0x80000000) walk(root + (target & 0x7fffffff), depth + 1, [...path, name]);
      else {
        const leaf = root + target;
        const t = path[0]!;
        resources.push({
          type: typeof t === "number" ? (RESOURCE_TYPES[t] ?? String(t)) : t,
          name: path[1] ?? name,
          language: typeof name === "number" ? name : 0,
          rva: u32(leaf),
          size: u32(leaf + 4),
        });
      }
    }
  };
  if (root >= 0) walk(root, 0, []);
  const bytesOf = (r?: PeResource) => (r ? data.subarray(off(r.rva), off(r.rva) + r.size) : undefined);
  const manifestBytes = bytesOf(resources.find(r => r.type === "MANIFEST"));
  const version: Record<string, string> = {};
  const versionBytes = bytesOf(resources.find(r => r.type === "VERSION"));
  if (versionBytes) {
    const text = new TextDecoder("utf-16le").decode(versionBytes);
    for (const key of [
      "CompanyName",
      "FileDescription",
      "FileVersion",
      "InternalName",
      "LegalCopyright",
      "OriginalFilename",
      "ProductName",
      "ProductVersion",
    ]) {
      const at = text.indexOf(`${key}\0`);
      if (at < 0) continue;
      const value = text.slice(at + key.length).replace(/^\0+/, "");
      version[key] = value.slice(0, value.indexOf("\0")).trim();
    }
  }

  const [clrRva] = dir(14);
  const clr = clrRva ? off(clrRva) : -1;
  let summary: unknown;
  try {
    summary = abi(data);
  } catch (error) {
    summary = { error: (error as Error).message };
  }
  return {
    path,
    name: basename(path),
    size: data.length,
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    bits: wide ? 64 : 32,
    timestamp: new Date(time * 1000).toISOString(),
    characteristics: flagNames(chars, {
      0x2: "executable",
      0x20: "large-address-aware",
      0x100: "32bit",
      0x1000: "system",
      0x2000: "dll",
    }),
    dll: (chars & 0x2000) !== 0,
    subsystem: SUBSYSTEMS[u16(opt + 68)] ?? String(u16(opt + 68)),
    entryPoint: u32(opt + 16),
    imageBase: "0x" + (wide ? view.getBigUint64(opt + 24, true) : BigInt(u32(opt + 28))).toString(16),
    sizeOfImage: u32(opt + 56),
    linkerVersion: `${data[opt + 2]}.${data[opt + 3]}`,
    osVersion: `${u16(opt + 40)}.${u16(opt + 42)}`,
    dllCharacteristics: flagNames(u16(opt + 70), {
      0x20: "high-entropy-va",
      0x40: "dynamic-base",
      0x80: "force-integrity",
      0x100: "nx-compat",
      0x200: "no-isolation",
      0x400: "no-seh",
      0x1000: "appcontainer",
      0x4000: "guard-cf",
    }),
    dotnet: clr >= 0 ? { runtime: `${u16(clr + 4)}.${u16(clr + 6)}`, flags: u32(clr + 16) } : null,
    sections,
    imports,
    exports,
    resources,
    version,
    manifest: manifestBytes ? new TextDecoder().decode(manifestBytes).trim() : null,
    abi: summary,
  };
}

export async function inspectPe(input: string): Promise<PeInfo> {
  const path = resolve(input);
  return parsePe(await Bun.file(path).bytes(), path);
}
