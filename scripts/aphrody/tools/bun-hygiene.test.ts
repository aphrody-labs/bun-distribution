// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cachePrunable, eligibleTag, expectedSum, isNewer, swapExecutable, sweepOld, tagOf } from "./bun-hygiene.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "bun-hygiene-"));
  dirs.push(dir);
  return dir;
};

const now = Date.parse("2026-10-09T12:00:00Z");
const release = (tag_name: string, days: number, extra: Partial<{ prerelease: boolean; draft: boolean }> = {}) => ({
  tag_name,
  prerelease: false,
  draft: false,
  published_at: new Date(now - days * 86_400_000).toISOString(),
  ...extra,
});

test("the newest runtime release older than the minimum age is selected", () => {
  const releases = [
    release("n2b-v0.7.1", 10),
    release("aphrody-v1.4.3-aphrody.3", 1),
    release("aphrody-tools-1", 9),
    release("aphrody-v1.4.3-aphrody.2", 4, { prerelease: true }),
    release("aphrody-v1.4.3-aphrody.1", 5),
    release("aphrody-v1.4.2-aphrody.9", 20),
  ];
  expect(eligibleTag(releases, now, 3)).toBe("aphrody-v1.4.3-aphrody.1");
  expect(eligibleTag(releases, now, 0)).toBe("aphrody-v1.4.3-aphrody.3");
  expect(eligibleTag(releases, now, 30)).toBeUndefined();
  expect(tagOf("1.4.3-aphrody.3\n")).toBe("aphrody-v1.4.3-aphrody.3");
  expect(isNewer("aphrody-v1.4.3-aphrody.10", "aphrody-v1.4.3-aphrody.9")).toBe(true);
  expect(isNewer("aphrody-v1.4.4-aphrody.1", "aphrody-v1.4.3-aphrody.9")).toBe(true);
  expect(isNewer("aphrody-v1.4.3-aphrody.1", "aphrody-v1.4.3-aphrody.3")).toBe(false);
  expect(isNewer("aphrody-v1.4.3-aphrody.3", "aphrody-v1.4.3-aphrody.3")).toBe(false);
  expect(isNewer("aphrody-v1.4.3-aphrody.1", "aphrody-v1.4.3")).toBe(true);
  expect(isNewer("aphrody-v1.4.3-aphrody.4", "aphrody-v1.4.4")).toBe(false);
  expect(isNewer("aphrody-v1.4.4-aphrody.1", "aphrody-v1.4.4")).toBe(true);
});

test("checksums are matched on the exact asset name", () => {
  const a = "a".repeat(64);
  const b = "B".repeat(64);
  const sums = `${a}  bun-windows-x64-profile.zip\n${b} *dist/bun-windows-x64.zip\n`;
  expect(expectedSum(sums, "bun-windows-x64.zip")).toBe("b".repeat(64));
  expect(expectedSum(sums, "bun-windows-aarch64.zip")).toBeUndefined();
});

test("the executable is swapped aside and aliases are relinked to it", () => {
  const bin = temp();
  writeFileSync(join(bin, "bun.exe"), "old");
  writeFileSync(join(bin, "node.exe"), "old");
  writeFileSync(join(bin, "bun.exe.new"), "new");
  expect(swapExecutable(bin, join(bin, "bun.exe.new"), 7)).toEqual(["bunx.exe", "node.exe"]);
  for (const name of ["bun.exe", "bunx.exe", "node.exe"]) expect(readFileSync(join(bin, name), "utf8")).toBe("new");
  expect(existsSync(join(bin, "npm.exe"))).toBe(false);
  expect(statSync(join(bin, "bun.exe")).nlink).toBe(3);
  expect(readFileSync(join(bin, "bun.exe.old-7"), "utf8")).toBe("old");
  expect(sweepOld(bin).toSorted()).toEqual(["bun.exe.old-7", "node.exe.old-7"]);
  expect(readdirSync(bin).toSorted()).toEqual(["bun.exe", "bunx.exe", "node.exe"]);
});

test("cache entries are pruned only above the size threshold", () => {
  const cache = temp();
  for (const name of ["a@1", "b@1"]) {
    const dir = join(cache, name);
    mkdirSync(dir);
    writeFileSync(join(dir, "f"), "x");
  }
  expect(cachePrunable(cache, now + 60 * 86_400_000, 1)).toEqual([]);
  expect(cachePrunable(cache, Date.now() + 60 * 86_400_000, 6 * 1024 ** 3).length).toBe(2);
  expect(cachePrunable(cache, Date.now(), 6 * 1024 ** 3)).toEqual([]);
});
