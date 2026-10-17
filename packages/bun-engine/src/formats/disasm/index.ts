// Disassembly front end over existing owners: MAME `unidasm` (bep-installed usr/lib/mame) for
// 6502, ARM/Thumb, LR35902, R3000, MIPS III and PowerPC; LLVM `llvm-objdump` for ARM, Thumb and
// AArch64 (raw bytes wrapped in a minimal ELF); Rizin `rz-asm` (Capstone) for every console
// arch; and the built-in TypeScript 6502 decoder as the dependency-free fallback.
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llvmObjdump, mameTool, rizinAsm, runTool } from "../tools.js";
import type { Arch } from "../types.js";
import { disassemble6502 } from "./m6502.js";

export interface DisasmLine {
  address: number;
  bytes: string;
  text: string;
}

export const backends = ["unidasm", "llvm", "rizin", "ts"] as const;
export type Backend = (typeof backends)[number];

export interface DisasmOptions {
  arch: Arch;
  address: number;
  count: number;
  backend?: Backend | undefined;
}

export interface DisasmResult {
  arch: Arch;
  backend: Backend;
  address: number;
  lines: DisasmLine[];
}

const unidasmArch: Partial<Record<Arch, string>> = {
  "6502": "m6502",
  arm: "arm7",
  thumb: "arm7thumb",
  lr35902: "lr35902",
  r3000: "psxcpu",
  "mips-be": "mips3be",
  "mips-le": "mips3le",
  ppc: "powerpc",
  m68k: "m68000",
};

const llvmTriple: Partial<Record<Arch, string>> = {
  arm: "armv5te-none-eabi",
  thumb: "thumbv5te-none-eabi",
  aarch64: "aarch64-none-elf",
};

const rizinArch: Partial<Record<Arch, string[]>> = {
  "6502": ["-a", "6502", "-b", "8"],
  arm: ["-a", "arm", "-b", "32"],
  thumb: ["-a", "arm", "-b", "16"],
  aarch64: ["-a", "arm", "-b", "64"],
  lr35902: ["-a", "gb", "-b", "16"],
  r3000: ["-a", "mips", "-b", "32"],
  "mips-le": ["-a", "mips", "-b", "32"],
  "mips-be": ["-a", "mips", "-b", "32", "-e"],
  ppc: ["-a", "ppc", "-b", "32", "-e"],
  m68k: ["-a", "m68k", "-b", "32"],
};

/** Upper bound of one instruction, used to size the byte window for `count` instructions. */
export function maxInstructionBytes(arch: Arch): number {
  if (arch === "m68k") return 10;
  return arch === "6502" || arch === "lr35902" ? 3 : 4;
}

function available(backend: Backend, arch: Arch): boolean {
  if (backend === "ts") return arch === "6502";
  if (backend === "unidasm")
    return !!unidasmArch[arch] && !!mameTool("unidasm");
  if (backend === "llvm") return !!llvmTriple[arch] && !!llvmObjdump();
  return !!rizinArch[arch] && !!rizinAsm();
}

export function backendFor(arch: Arch, preferred?: Backend): Backend {
  if (preferred) {
    if (!available(preferred, arch))
      throw new Error(
        `disassembler backend ${preferred} is unavailable for ${arch}`,
      );
    return preferred;
  }
  const order: Backend[] =
    arch === "aarch64" ? ["llvm", "rizin"] : ["unidasm", "llvm", "rizin", "ts"];
  const backend = order.find((candidate) => available(candidate, arch));
  if (!backend)
    throw new Error(
      `no disassembler for ${arch}: install MAME with \`bep install mame\`, LLVM or Rizin`,
    );
  return backend;
}

async function withTemp<T>(
  bytes: Uint8Array,
  suffix: string,
  use: (path: string) => Promise<T>,
): Promise<T> {
  const path = join(tmpdir(), `bun-engine-formats-${randomUUID()}${suffix}`);
  await Bun.write(path, bytes);
  try {
    return await use(path);
  } finally {
    await rm(path, { force: true });
  }
}

function hexAddress(value: number): string {
  return value.toString(16);
}

async function viaUnidasm(
  bytes: Uint8Array,
  options: DisasmOptions,
): Promise<DisasmLine[]> {
  const tool = mameTool("unidasm")!;
  const result = await withTemp(bytes, ".bin", (path) =>
    runTool([
      tool,
      path,
      "-arch",
      unidasmArch[options.arch]!,
      "-basepc",
      hexAddress(options.address),
      "-count",
      String(bytes.byteLength),
    ]),
  );
  if (result.code !== 0)
    throw new Error(`unidasm failed: ${result.stderr || result.stdout}`);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^([0-9a-f]+): (.*)$/i.exec(line);
    if (!match) return [];
    const split = /\s{2,}/.exec(match[2]!);
    const raw = split ? match[2]!.slice(0, split.index) : match[2]!;
    const text = split
      ? match[2]!.slice(split.index).trim().replace(/\s+/g, " ")
      : "";
    return [
      { address: Number.parseInt(match[1]!, 16), bytes: raw.trim(), text },
    ];
  });
}

/** Minimal relocatable-free ELF holding `bytes` as an executable .text at `address`. */
export function wrapElf(
  bytes: Uint8Array,
  address: number,
  arch: Arch,
): Uint8Array {
  const is64 = arch === "aarch64";
  const machine = is64 ? 183 : 40;
  const ehsize = is64 ? 64 : 52;
  const shentsize = is64 ? 64 : 40;
  const names = new TextEncoder().encode("\0.text\0.shstrtab\0");
  const textOffset = ehsize;
  const namesOffset = textOffset + bytes.byteLength;
  const shoff = (namesOffset + names.byteLength + 7) & ~7;
  const out = new Uint8Array(shoff + shentsize * 3);
  const view = new DataView(out.buffer);
  out.set([0x7f, 0x45, 0x4c, 0x46, is64 ? 2 : 1, 1, 1], 0);
  view.setUint16(16, 2, true);
  view.setUint16(18, machine, true);
  view.setUint32(20, 1, true);
  const word = (at: number, value: number) =>
    is64
      ? view.setBigUint64(at, BigInt(value), true)
      : view.setUint32(at, value, true);
  if (is64) {
    word(24, address);
    word(40, shoff);
    view.setUint16(52, ehsize, true);
    view.setUint16(58, shentsize, true);
    view.setUint16(60, 3, true);
    view.setUint16(62, 2, true);
  } else {
    word(24, address);
    word(32, shoff);
    view.setUint32(36, 0x05000000, true);
    view.setUint16(40, ehsize, true);
    view.setUint16(46, shentsize, true);
    view.setUint16(48, 3, true);
    view.setUint16(50, 2, true);
  }
  out.set(bytes, textOffset);
  out.set(names, namesOffset);
  const section = (
    index: number,
    name: number,
    type: number,
    flags: number,
    addr: number,
    offset: number,
    size: number,
  ) => {
    const at = shoff + index * shentsize;
    view.setUint32(at, name, true);
    view.setUint32(at + 4, type, true);
    if (is64) {
      word(at + 8, flags);
      word(at + 16, addr);
      word(at + 24, offset);
      word(at + 32, size);
      word(at + 48, 4);
    } else {
      word(at + 8, flags);
      word(at + 12, addr);
      word(at + 16, offset);
      word(at + 20, size);
      word(at + 32, 4);
    }
  };
  section(1, 1, 1, 6, address, textOffset, bytes.byteLength);
  section(2, 7, 3, 0, 0, namesOffset, names.byteLength);
  return out;
}

async function viaLlvm(
  bytes: Uint8Array,
  options: DisasmOptions,
): Promise<DisasmLine[]> {
  const tool = llvmObjdump()!;
  const result = await withTemp(
    wrapElf(bytes, options.address, options.arch),
    ".o",
    (path) =>
      runTool([
        tool,
        "-d",
        "--print-imm-hex",
        `--triple=${llvmTriple[options.arch]}`,
        path,
      ]),
  );
  if (result.code !== 0)
    throw new Error(`llvm-objdump failed: ${result.stderr}`);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2,8} )+)\s*	(.*)$/i.exec(
      line,
    );
    if (!match) return [];
    const text = match[3]!
      .replace(/\s+<\.text[^>]*>/, "")
      .replace(/\s*@.*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    return [
      {
        address: Number.parseInt(match[1]!, 16),
        bytes: match[2]!.trim(),
        text,
      },
    ];
  });
}

async function viaRizin(
  bytes: Uint8Array,
  options: DisasmOptions,
): Promise<DisasmLine[]> {
  const tool = rizinAsm()!;
  const result = await runTool([
    tool,
    ...rizinArch[options.arch]!,
    "-o",
    `0x${hexAddress(options.address)}`,
    "-D",
    Buffer.from(bytes).toString("hex"),
  ]);
  if (result.code !== 0) throw new Error(`rz-asm failed: ${result.stderr}`);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^0x([0-9a-f]+)\s+\d+\s+([0-9a-f]+)\s+(.*)$/i.exec(
      line.trim(),
    );
    return match
      ? [
          {
            address: Number.parseInt(match[1]!, 16),
            bytes: match[2]!,
            text: match[3]!.trim(),
          },
        ]
      : [];
  });
}

/** Disassembles `bytes` loaded at `address`; returns at most `count` instructions. */
export async function disassembleBytes(
  bytes: Uint8Array,
  options: DisasmOptions,
): Promise<DisasmResult> {
  const backend = backendFor(options.arch, options.backend);
  const run = {
    unidasm: viaUnidasm,
    llvm: viaLlvm,
    rizin: viaRizin,
    ts: async () => disassemble6502(bytes, options.address, options.count),
  }[backend];
  const lines = (await run(bytes, options)).slice(0, options.count);
  return { arch: options.arch, backend, address: options.address, lines };
}
