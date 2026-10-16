import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { guarded } from "../../src/creator/cli.ts";
import { crashLogPath, logCrash, splitArgs } from "../../src/shared/crash.ts";

test("splitArgs groups quoted words", () => {
  expect(
    splitArgs('wiki-images "https://x.org/a b" --out "C:\\My Files"'),
  ).toEqual(["wiki-images", "https://x.org/a b", "--out", "C:\\My Files"]);
  expect(splitArgs("   ")).toEqual([]);
});

test("logCrash appends the stack to the crash log", async () => {
  const env = { LOCALAPPDATA: await mkdtemp(join(tmpdir(), "crash-")) };
  const path = logCrash(new Error("boom"), ["img-compress"], env);
  expect(path).toBe(crashLogPath(env));
  expect(await readFile(path, "utf8")).toContain("boom");
});

test("guarded turns an unknown command into exit code 2 and never throws", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    expect(await guarded(["nope"])).toBe(2);
  } finally {
    console.error = original;
  }
});
