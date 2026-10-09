// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditGlibc, elfHash, lowerGlibcCeiling } from "../../src/cli/forge/glibc.ts";
import { firstPartyTests } from "../../src/cli/forge/run.ts";

/** Minimal ELF64 with .dynstr, .dynsym, .gnu.version, .gnu.version_r: libm needs GLIBC_2.2.5 and GLIBC_2.43. */
function fixture(symbols: { name: string; index: number }[]): Uint8Array {
  const strs: string[] = [
    "",
    "libm.so.6",
    "GLIBC_2.2.5",
    "GLIBC_2.43",
    ...symbols.map((s) => s.name),
  ];
  const offsets = new Map<string, number>();
  let dynstr = new Uint8Array(0);
  for (const s of strs) {
    if (offsets.has(s)) continue;
    offsets.set(s, dynstr.length);
    dynstr = Uint8Array.from([...dynstr, ...new TextEncoder().encode(s), 0]);
  }
  const dynsym = new Uint8Array(24 * (symbols.length + 1));
  const dsv = new DataView(dynsym.buffer);
  symbols.forEach((s, i) => dsv.setUint32(24 * (i + 1), offsets.get(s.name)!, true));
  const versym = new Uint8Array(2 * (symbols.length + 1));
  const vv = new DataView(versym.buffer);
  symbols.forEach((s, i) => vv.setUint16(2 * (i + 1), s.index, true));
  const verneed = new Uint8Array(16 + 32);
  const nv = new DataView(verneed.buffer);
  nv.setUint16(0, 1, true);
  nv.setUint16(2, 2, true);
  nv.setUint32(4, offsets.get("libm.so.6")!, true);
  nv.setUint32(8, 16, true);
  nv.setUint32(12, 0, true);
  const aux = (at: number, name: string, other: number, next: number) => {
    nv.setUint32(at, elfHash(name), true);
    nv.setUint16(at + 6, other, true);
    nv.setUint32(at + 8, offsets.get(name)!, true);
    nv.setUint32(at + 12, next, true);
  };
  aux(16, "GLIBC_2.2.5", 2, 16);
  aux(32, "GLIBC_2.43", 3, 0);

  const bodies = [dynstr, dynsym, versym, verneed];
  const types = [3, 11, 0x6fffffff, 0x6ffffffe];
  let at = 64;
  const placed = bodies.map((b) => {
    const o = at;
    at += Math.ceil(b.length / 8) * 8;
    return o;
  });
  const shoff = at;
  const out = new Uint8Array(shoff + 64 * 5);
  const v = new DataView(out.buffer);
  out.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  v.setBigUint64(0x28, BigInt(shoff), true);
  v.setUint16(0x3a, 64, true);
  v.setUint16(0x3c, 5, true);
  bodies.forEach((b, i) => {
    out.set(b, placed[i]);
    const sh = shoff + 64 * (i + 1);
    v.setUint32(sh + 4, types[i]!, true);
    v.setBigUint64(sh + 0x18, BigInt(placed[i]!), true);
    v.setBigUint64(sh + 0x20, BigInt(b.length), true);
    // dynsym and verneed link to .dynstr (section 1).
    v.setUint32(sh + 0x28, i === 1 || i === 3 ? 1 : 0, true);
    v.setUint32(sh + 0x2c, i === 3 ? 1 : 0, true);
    v.setBigUint64(sh + 0x38, i === 1 ? 24n : i === 2 ? 2n : 0n, true);
  });
  return out;
}

describe("first-party suites", () => {
  test("skips files that need bun:internal-for-testing (debug builds only)", () => {
    const tree = mkdtempSync(join(tmpdir(), "forge-fp-"));
    mkdirSync(join(tree, "test/js/first_party/ws"), { recursive: true });
    writeFileSync(join(tree, "test/js/first_party/ws/a.test.ts"), "export {};\n");
    writeFileSync(
      join(tree, "test/js/first_party/ws/b.test.ts"),
      'import "bun:internal-for-testing";\n',
    );
    expect(firstPartyTests(tree)).toEqual(["test/js/first_party/ws/a.test.ts"]);
  });
});

describe("glibc ceiling", () => {
  test("elfHash matches the SysV value of a glibc version name", () => {
    expect(elfHash("GLIBC_2.2.5")).toBe(0x09691a75);
  });

  test("rebinds re-versioned libm symbols to the oldest libm requirement", () => {
    const bytes = fixture([
      { name: "acosf", index: 3 },
      { name: "atan2f", index: 3 },
      { name: "floor", index: 2 },
    ]);
    expect(auditGlibc(bytes, "2.39").above).toEqual(["acosf@GLIBC_2.43", "atan2f@GLIBC_2.43"]);
    const result = lowerGlibcCeiling(bytes, "2.39");
    expect(result.patched).toEqual([
      "acosf: GLIBC_2.43 -> GLIBC_2.2.5",
      "atan2f: GLIBC_2.43 -> GLIBC_2.2.5",
    ]);
    expect(result.above).toEqual([]);
    expect(result.maxGlibc).toBe("GLIBC_2.2.5");
    expect(auditGlibc(bytes, "2.39").above).toEqual([]);
  });

  test("leaves a binary under the ceiling untouched", () => {
    const bytes = fixture([{ name: "floor", index: 2 }]);
    const copy = bytes.slice();
    expect(lowerGlibcCeiling(bytes, "2.39").patched).toEqual([]);
    expect(bytes).toEqual(copy);
  });

  test("refuses an unknown symbol above the ceiling", () => {
    const bytes = fixture([{ name: "exp10f", index: 3 }]);
    expect(() => lowerGlibcCeiling(bytes, "2.39")).toThrow(/not known re-versioned/);
  });
});
