// SPDX-License-Identifier: MIT
import { type Abi } from "./types.ts";

/** Inspect actual executable headers, including PE import DLLs; extensions are not ABI evidence. */
export function abi(data: Uint8Array): Abi {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 20 && data[0] === 0x7f && data[1] === 69 && data[2] === 76 && data[3] === 70) {
    if (![1, 2].includes(data[4]!) || ![1, 2].includes(data[5]!)) throw new Error("Invalid ELF class or endianness");
    if (data.length < (data[4] === 1 ? 52 : 64) || data[6] !== 1)
      throw new Error("Truncated ELF header or unsupported version");
    const machine = view.getUint16(18, data[5] === 1);
    return {
      format: "elf",
      bits: data[4] === 1 ? 32 : 64,
      runtime: data[7] === 3 ? "linux" : undefined,
      elfOsAbi: data[7],
      architecture:
        (
          {
            3: "x86",
            62: "x64",
            40: "arm",
            183: "arm64",
            243: "riscv",
          } as Record<number, string>
        )[machine] ?? `elf-${machine}`,
    };
  }
  if (data.length >= 64 && data[0] === 77 && data[1] === 90) {
    const pe = view.getUint32(60, true);
    if (pe > data.length - 24 || view.getUint32(pe, true) !== 0x4550) throw new Error("Invalid PE signature");
    const machine = view.getUint16(pe + 4, true);
    const count = view.getUint16(pe + 6, true);
    const characteristics = view.getUint16(pe + 22, true);
    const optionalSize = view.getUint16(pe + 20, true);
    const optional = pe + 24;
    if (optionalSize < 96 || optionalSize > data.length - optional || count > 4096)
      throw new Error("Truncated PE optional header");
    const magic = view.getUint16(optional, true);
    if (![0x10b, 0x20b].includes(magic)) throw new Error("Unsupported PE optional header");
    if (
      ([0x14c, 0x1c4].includes(machine) && magic !== 0x10b) ||
      ([0x8664, 0xaa64].includes(machine) && magic !== 0x20b)
    )
      throw new Error("PE machine and optional-header class disagree");
    if (magic === 0x20b && optionalSize < 112) throw new Error("Truncated PE32+ optional header");
    const directories = optional + (magic === 0x20b ? 112 : 96);
    const directoryCountOffset = optional + (magic === 0x20b ? 108 : 92);
    const sections = optional + optionalSize;
    if (sections + count * 40 > data.length) throw new Error("Truncated PE section table");
    const rvaOffset = (rva: number): number => {
      for (let i = 0; i < count; i++) {
        const section = sections + i * 40;
        const address = view.getUint32(section + 12, true);
        const rawSize = view.getUint32(section + 16, true);
        const raw = view.getUint32(section + 20, true);
        if (rva >= address && rva - address < rawSize) {
          const offset = raw + rva - address;
          if (offset < data.length) return offset;
        }
      }
      throw new Error("PE RVA does not map to file bytes");
    };
    const imports: string[] = [];
    const importName = (rva: number): string => {
      const offset = rvaOffset(rva);
      let end = offset;
      while (end < data.length && end - offset < 1024 && data[end] !== 0) end++;
      if (end >= data.length || end - offset >= 1024) throw new Error("Unterminated PE import name");
      const name = new TextDecoder("ascii", { fatal: true }).decode(data.subarray(offset, end)).toLowerCase();
      if (!/^[a-z0-9_.+-]+$/.test(name)) throw new Error("Invalid PE import name");
      return name;
    };
    if (view.getUint32(directoryCountOffset, true) > 1) {
      if (directories + 16 > sections) throw new Error("Truncated PE import directory");
      const importRva = view.getUint32(directories + 8, true);
      const importSize = view.getUint32(directories + 12, true);
      if (importRva) {
        const start = rvaOffset(importRva);
        let ended = false;
        for (let i = 0; i < 4096; i++) {
          const entry = start + i * 20;
          if (entry + 20 > data.length || (importSize && i * 20 >= importSize))
            throw new Error("Truncated PE import descriptors");
          if (data.subarray(entry, entry + 20).every(byte => !byte)) {
            ended = true;
            break;
          }
          imports.push(importName(view.getUint32(entry + 12, true)));
        }
        if (!ended) throw new Error("PE import descriptor count exceeds limit");
      }
    }
    if (view.getUint32(directoryCountOffset, true) > 13) {
      if (directories + 112 > sections) throw new Error("Truncated PE delay import directory");
      const delayRva = view.getUint32(directories + 104, true);
      const delaySize = view.getUint32(directories + 108, true);
      if (delayRva) {
        const start = rvaOffset(delayRva);
        let ended = false;
        for (let i = 0; i < 4096; i++) {
          const entry = start + i * 32;
          if (entry + 32 > data.length || (delaySize && i * 32 >= delaySize))
            throw new Error("Truncated PE delay import descriptors");
          if (data.subarray(entry, entry + 32).every(byte => !byte)) {
            ended = true;
            break;
          }
          const flags = view.getUint32(entry, true);
          if (flags !== 1) throw new Error("PE delay imports need RVA-based descriptors");
          imports.push(importName(view.getUint32(entry + 4, true)));
        }
        if (!ended) throw new Error("PE delay import count exceeds limit");
      }
    }
    return {
      format: "pe",
      bits: magic === 0x20b ? 64 : 32,
      architecture:
        (
          {
            0x14c: "x86",
            0x8664: "x64",
            0x1c4: "arm",
            0xaa64: "arm64",
          } as Record<number, string>
        )[machine] ?? `pe-${machine}`,
      runtime: imports.includes("cygwin1.dll") ? "cygwin" : imports.includes("msys-2.0.dll") ? "msys2" : "windows",
      executable: !!(characteristics & 0x2) && !(characteristics & 0x2000),
      library: !!(characteristics & 0x2) && !!(characteristics & 0x2000),
      subsystem: view.getUint16(optional + 68, true),
      imports: [...new Set(imports)],
    };
  }
  if (data[0] === 35 && data[1] === 33) return { format: "script" };
  return { format: "data" };
}
