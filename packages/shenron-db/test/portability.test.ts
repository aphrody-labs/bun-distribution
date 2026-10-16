// Source: packages/shenron/db/test/portability.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listExportEntries, checkNoEscapingImports, checkPackageRuntimes } from "@aphrody/bun-workspace/guards";

const PACKAGE_DIR = join(import.meta.dir, "..");

// Native empty-environment import gate; no provider variables or shared temp files.
async function checkEmptyEnvImports(directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of listExportEntries(directory)) {
    if (entry.declared === "json" || !/\.(?:m|c)?tsx?$/.test(entry.file)) continue;
    const child = Bun.spawn(
      [process.execPath, "-e", `await import(${JSON.stringify(pathToFileURL(entry.file).href)});`],
      {
        cwd: directory,
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.PATH,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
        stdout: "ignore",
        stderr: "pipe",
        timeout: 10000,
      },
    );
    const stderr = new Response(child.stderr).text();
    if ((await child.exited) !== 0) errors.push(`${entry.subpath}: ${(await stderr).slice(0, 200)}`);
    else await stderr;
  }
  return errors;
}

describe("@shenron/db portability", () => {
  test("runtime classes hold for every exported entry", async () => {
    expect(await checkPackageRuntimes(PACKAGE_DIR)).toEqual([]);
  });
  test("no import escapes the package", async () => {
    expect(await checkNoEscapingImports(PACKAGE_DIR)).toEqual([]);
  });
  test("every subpath imports with an empty environment", async () => {
    expect(await checkEmptyEnvImports(PACKAGE_DIR)).toEqual([]);
  }, 120_000);
});
