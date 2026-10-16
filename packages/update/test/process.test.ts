// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "../src/process.ts";

test("process adapter captures UTF-8 output and exit diagnostics", () => {
  const result = spawnSync(process.execPath, [
    "-e",
    'console.log("été"); console.error("diagnostic"); process.exit(7)',
  ]);
  expect(result.status).toBe(7);
  expect(result.stdout).toBe("été\n");
  expect(result.stderr).toBe("diagnostic\n");
  expect(result.error).toBeUndefined();
});

test("process adapter reports launch failures without throwing", () => {
  const result = spawnSync("aphrody-nonexistent-process-fixture");
  expect(result.status).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
  expect(result.error).toBeInstanceOf(Error);
});

test("execFileSync preserves Buffer and text results and throws on failure", () => {
  const args = ["-e", 'process.stdout.write("été")'];
  expect(execFileSync(process.execPath, args)).toEqual(Buffer.from("été"));
  expect(execFileSync(process.execPath, args, { encoding: "utf8" })).toBe(
    "été",
  );
  expect(() =>
    execFileSync(process.execPath, [
      "-e",
      'process.stderr.write("failed"); process.exit(9)',
    ]),
  ).toThrow("failed");
});
