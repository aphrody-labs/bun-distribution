// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  excluded,
  linksTo,
  storedPath,
  totals,
  treeBytes,
} from "./portable.ts";

describe("portable", () => {
  test("stored paths separate home and system trees", () => {
    expect(
      storedPath(
        "/r/.portable",
        { path: ".config/gh", mode: "copy", category: "essential" },
        "home",
      ),
    ).toBe("/r/.portable/home/.config/gh");
    expect(
      storedPath(
        "/r/.portable",
        { path: "/var/lib/redis", mode: "copy", category: "data" },
        "system",
      ),
    ).toBe("/r/.portable/system/var/lib/redis");
  });

  test("exclusions match whole path segments", () => {
    expect(excluded("tmp", ["tmp"])).toBe(true);
    expect(excluded("tmp/x", ["tmp"])).toBe(true);
    expect(excluded("tmpfile", ["tmp"])).toBe(false);
    expect(excluded("", ["tmp"])).toBe(false);
    expect(excluded("a", undefined)).toBe(false);
  });

  test("tree size skips excluded parts and does not follow symlinks; links are recognised", () => {
    const dir = mkdtempSync(join(tmpdir(), "portable-"));
    try {
      mkdirSync(join(dir, "t/keep"), { recursive: true });
      mkdirSync(join(dir, "t/tmp"), { recursive: true });
      writeFileSync(join(dir, "t/keep/a"), "12345");
      writeFileSync(join(dir, "t/tmp/b"), "1234567890");
      symlinkSync(join(dir, "t/tmp"), join(dir, "t/link"));
      const linkBytes = treeBytes(join(dir, "t/link"));
      expect(treeBytes(join(dir, "t"), ["tmp"])).toBe(5 + linkBytes);
      expect(linksTo(join(dir, "t/link"), join(dir, "t/tmp"))).toBe(true);
      expect(linksTo(join(dir, "t/keep"), join(dir, "t/tmp"))).toBe(false);
      expect(linksTo(join(dir, "missing"), join(dir, "t/tmp"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("heavy subtrees are reported apart from their category", () => {
    expect(
      totals([
        {
          category: "data",
          bytes: 100,
          heavy: { models: 60, "private/backups": 10 },
        },
        { category: "essential", bytes: 5 },
      ]),
    ).toEqual({ essential: 5, data: 30, heavy: 70 });
  });
});
