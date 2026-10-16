// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  aboveCeiling,
  compareVersions,
  glibcVersion,
  readElfVersions,
} from "./elf-glibc-imports.ts";

/** A minimal ELF64 with one undefined `acosf@GLIBC_2.43` import and one defined `entry@GLIBC_2.2.5`. */
function fixture(): Uint8Array {
  const text = new TextEncoder();
  const table = "\0acosf\0libm.so.6\0GLIBC_2.43\0entry\0GLIBC_2.2.5\0";
  const strings = text.encode(table);
  const position = (name: string) => table.indexOf(`\0${name}\0`) + 1;
  const offset = {
    acosf: position("acosf"),
    libm: position("libm.so.6"),
    v243: position("GLIBC_2.43"),
    entry: position("entry"),
    v225: position("GLIBC_2.2.5"),
  };
  const dynsym = new Uint8Array(24 * 3);
  const sym = new DataView(dynsym.buffer);
  // [1] acosf: undefined (shndx 0).
  sym.setUint32(24, offset.acosf, true);
  sym.setUint8(24 + 4, 0x12);
  // [2] entry: defined in section 1.
  sym.setUint32(48, offset.entry, true);
  sym.setUint8(48 + 4, 0x12);
  sym.setUint16(48 + 6, 1, true);

  const versym = new Uint8Array(2 * 3);
  const vs = new DataView(versym.buffer);
  vs.setUint16(2, 2, true); // acosf -> needed version index 2
  vs.setUint16(4, 3, true); // entry -> defined version index 3

  const verneed = new Uint8Array(32);
  const vn = new DataView(verneed.buffer);
  vn.setUint16(0, 1, true); // vn_version
  vn.setUint16(2, 1, true); // vn_cnt
  vn.setUint32(4, offset.libm, true); // vn_file
  vn.setUint32(8, 16, true); // vn_aux
  vn.setUint32(12, 0, true); // vn_next
  vn.setUint16(16 + 4, 0, true);
  vn.setUint16(16 + 6, 2, true); // vna_other
  vn.setUint32(16 + 8, offset.v243, true); // vna_name
  vn.setUint32(16 + 12, 0, true); // vna_next

  const verdef = new Uint8Array(28);
  const vd = new DataView(verdef.buffer);
  vd.setUint16(0, 1, true); // vd_version
  vd.setUint16(4, 3, true); // vd_ndx
  vd.setUint16(6, 1, true); // vd_cnt
  vd.setUint32(12, 20, true); // vd_aux
  vd.setUint32(16, 0, true); // vd_next
  vd.setUint32(20, offset.v225, true); // vda_name

  const bodies = [strings, dynsym, versym, verneed, verdef];
  const headerSize = 64;
  let cursor = headerSize;
  const offsets = bodies.map((body) => {
    const at = cursor;
    cursor += body.length;
    return at;
  });
  const shoff = cursor;
  const sections = [
    // type, offset, size, link, info, entsize
    [0, 0, 0, 0, 0, 0],
    [3, offsets[0]!, strings.length, 0, 0, 0], // .dynstr
    [11, offsets[1]!, dynsym.length, 1, 0, 24], // .dynsym
    [0x6fffffff, offsets[2]!, versym.length, 2, 0, 2], // .gnu.version
    [0x6ffffffe, offsets[3]!, verneed.length, 1, 1, 0], // .gnu.version_r
    [0x6ffffffd, offsets[4]!, verdef.length, 1, 1, 0], // .gnu.version_d
  ] as const;
  const file = new Uint8Array(shoff + sections.length * 64);
  const view = new DataView(file.buffer);
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  view.setBigUint64(0x28, BigInt(shoff), true);
  view.setUint16(0x3a, 64, true);
  view.setUint16(0x3c, sections.length, true);
  bodies.forEach((body, index) => file.set(body, offsets[index]!));
  sections.forEach(([type, off, size, link, info, entsize], index) => {
    const at = shoff + index * 64;
    view.setUint32(at + 4, type, true);
    view.setBigUint64(at + 0x18, BigInt(off), true);
    view.setBigUint64(at + 0x20, BigInt(size), true);
    view.setUint32(at + 0x28, link, true);
    view.setUint32(at + 0x2c, info, true);
    view.setBigUint64(at + 0x38, BigInt(entsize), true);
  });
  return file;
}

describe("elf-glibc-imports", () => {
  test("reads the versioned imports and definitions of an ELF64 object", () => {
    const report = readElfVersions(fixture());
    expect(report.imports).toEqual([
      { symbol: "acosf", version: "GLIBC_2.43", file: "libm.so.6" },
    ]);
    expect(report.defined).toEqual([
      { symbol: "entry", version: "GLIBC_2.2.5", file: null },
    ]);
    expect(report.maxGlibc).toBe("GLIBC_2.43");
  });

  test("the ceiling selects exactly the imports above it", () => {
    const { imports } = readElfVersions(fixture());
    expect(aboveCeiling(imports, "2.39").map((entry) => entry.symbol)).toEqual([
      "acosf",
    ]);
    expect(aboveCeiling(imports, "2.43")).toEqual([]);
    expect(aboveCeiling(imports, "2.9")).toHaveLength(1);
  });

  test("version names compare numerically, not lexically", () => {
    expect(glibcVersion("GLIBC_2.39")).toEqual([2, 39]);
    expect(glibcVersion("GLIBC_2.2.5")).toEqual([2, 2, 5]);
    expect(glibcVersion("GCC_3.0")).toBeNull();
    expect(glibcVersion(null)).toBeNull();
    expect(compareVersions([2, 9], [2, 39])).toBeLessThan(0);
    expect(compareVersions([2, 2, 5], [2, 2])).toBeGreaterThan(0);
    expect(compareVersions([2, 39], [2, 39, 0])).toBe(0);
  });

  test("rejects files that are not little-endian ELF64", () => {
    expect(() => readElfVersions(new Uint8Array(80))).toThrow(
      "not an ELF file",
    );
    const elf32 = fixture();
    elf32[4] = 1;
    expect(() => readElfVersions(elf32)).toThrow("only little-endian ELF64");
  });

  test.skipIf(process.platform !== "linux")(
    "parses the running Bun executable",
    () => {
      const report = readElfVersions(readFileSync(process.execPath));
      expect(report.imports.length).toBeGreaterThan(50);
      expect(report.maxGlibc).toMatch(/^GLIBC_2\.\d+/);
    },
  );
});
