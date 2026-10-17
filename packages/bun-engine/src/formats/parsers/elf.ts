// ELF32/ELF64 executables used by homebrew SDKs (devkitARM, devkitPPC, PS2SDK, libnx) and
// by Ghidra/bunre pipelines. Only headers and tables are read.
import { BinaryView, hex32, type Endian } from "../stream.js";
import {
  parsed,
  type Arch,
  type ParseContext,
  type Section,
} from "../types.js";

const machines: Record<number, string> = {
  2: "SPARC",
  3: "x86",
  8: "MIPS",
  20: "PowerPC",
  21: "PowerPC64",
  40: "ARM",
  62: "x86-64",
  183: "AArch64",
  243: "RISC-V",
};

function elfArch(
  machine: number,
  endian: Endian,
  entry: number,
): Arch | undefined {
  if (machine === 40) return entry & 1 ? "thumb" : "arm";
  if (machine === 8) return endian === "le" ? "mips-le" : "mips-be";
  if (machine === 20) return "ppc";
  if (machine === 183) return "aarch64";
  return undefined;
}

function platformHint(
  machine: number,
  endian: Endian,
  entry: number,
): string | undefined {
  if (machine === 40 && entry >= 0x08000000 && entry < 0x0a000000)
    return "Game Boy Advance";
  if (machine === 40 && entry >= 0x02000000 && entry < 0x02400000)
    return "Nintendo DS / GBA multiboot";
  if (machine === 40 && entry >= 0x00100000 && entry < 0x00400000)
    return "Nintendo 3DS";
  if (machine === 20 && entry >= 0x80000000 && entry < 0x81800000)
    return "GameCube / Wii";
  if (
    machine === 8 &&
    endian === "le" &&
    entry >= 0x00100000 &&
    entry < 0x02000000
  )
    return "PlayStation 2";
  if (
    machine === 8 &&
    endian === "le" &&
    entry >= 0x80010000 &&
    entry < 0x80200000
  )
    return "PlayStation";
  if (
    machine === 8 &&
    endian === "be" &&
    entry >= 0x80000000 &&
    entry < 0x80800000
  )
    return "Nintendo 64";
  if (machine === 183) return "Nintendo Switch / AArch64";
  return undefined;
}

export async function parseElf({ source, head }: ParseContext) {
  const is64 = head[4] === 2;
  const endian: Endian = head[5] === 2 ? "be" : "le";
  const view = new BinaryView(head, endian);
  const word = (at: number) => (is64 ? view.u64(at) : view.u32(at));
  const machine = view.u16(0x12);
  const entry = word(0x18);
  const phoff = word(is64 ? 0x20 : 0x1c);
  const shoff = word(is64 ? 0x28 : 0x20);
  const [phentsize, phnum, shentsize, shnum, shstrndx] = is64
    ? [
        view.u16(0x36),
        view.u16(0x38),
        view.u16(0x3a),
        view.u16(0x3c),
        view.u16(0x3e),
      ]
    : [
        view.u16(0x2a),
        view.u16(0x2c),
        view.u16(0x2e),
        view.u16(0x30),
        view.u16(0x32),
      ];
  const arch = elfArch(machine, endian, entry);
  const sections: Section[] = [
    { name: "elf-header", offset: 0, size: is64 ? 0x40 : 0x34, kind: "header" },
  ];

  if (phnum && phoff) {
    const table = await source.view(phoff, phnum * phentsize, endian);
    for (let index = 0; index < phnum; index++) {
      const at = index * phentsize;
      if (!table.has(at, phentsize) || table.u32(at) !== 1) continue;
      const flags = is64 ? table.u32(at + 4) : table.u32(at + 24);
      const offset = is64 ? table.u64(at + 8) : table.u32(at + 4);
      const address = is64 ? table.u64(at + 16) : table.u32(at + 8);
      const size = is64 ? table.u64(at + 32) : table.u32(at + 16);
      sections.push({
        name: `segment[${index}]`,
        offset,
        size,
        address,
        arch: flags & 1 ? arch : undefined,
        kind: flags & 1 ? "code" : "data",
      });
    }
  }
  if (shnum && shoff) {
    const table = await source.view(shoff, shnum * shentsize, endian);
    const field = (at: number, narrow: number, wide: number) =>
      is64 ? table.u64(at + wide) : table.u32(at + narrow);
    const strings =
      shstrndx < shnum
        ? await source.view(
            field(shstrndx * shentsize, 16, 24),
            field(shstrndx * shentsize, 20, 32),
            endian,
          )
        : undefined;
    for (let index = 1; index < shnum; index++) {
      const at = index * shentsize;
      if (!table.has(at, shentsize)) break;
      const type = table.u32(at + 4);
      const flags = field(at, 8, 8);
      const size = field(at, 20, 32);
      if (type === 0 || size === 0) continue;
      const exec = (flags & 4) !== 0;
      sections.push({
        name: strings
          ? strings.ascii(table.u32(at), 128) || `section[${index}]`
          : `section[${index}]`,
        offset: field(at, 16, 24),
        size: type === 8 ? 0 : size,
        address: flags & 2 ? field(at, 12, 16) : undefined,
        arch: exec ? arch : undefined,
        kind: exec ? "code" : type === 8 ? "padding" : "data",
      });
    }
  }
  return parsed({
    header: {
      class: is64 ? "ELF64" : "ELF32",
      endian,
      type:
        ["none", "relocatable", "executable", "shared", "core"][
          view.u16(0x10)
        ] ?? view.u16(0x10),
      machine: machines[machine] ?? machine,
      entry: hex32(entry),
      flags: hex32(view.u32(is64 ? 0x30 : 0x24)),
      platformHint: platformHint(machine, endian, entry),
      programHeaders: phnum,
      sectionHeaders: shnum,
    },
    sections,
    arch,
    entry: arch === "thumb" ? entry & ~1 : entry,
  });
}
