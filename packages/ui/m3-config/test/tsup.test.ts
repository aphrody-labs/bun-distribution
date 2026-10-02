// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { M3_EXTERNAL, m3Tsup, prependUseClient } from "../tsup.ts";

const DIRECTIVE = "'use client';\n";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m3-tsup-"));
  await mkdir(join(dir, "wrappers"));
  await Promise.all([
    writeFile(join(dir, "index.js"), "export {};\n"),
    writeFile(join(dir, "react.js"), `${DIRECTIVE}export {};\n`),
    writeFile(join(dir, "index.js.map"), "{}"),
    writeFile(join(dir, "wrappers", "button.js"), "export {};\n"),
  ]);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const read = (...parts: string[]) => Bun.file(join(dir, ...parts)).text();

describe("m3 tsup preset", () => {
  test("marks every emitted .js file once, recursively", async () => {
    await prependUseClient(dir);
    await prependUseClient(dir);
    expect(await read("index.js")).toBe(`${DIRECTIVE}export {};\n`);
    expect(await read("react.js")).toBe(`${DIRECTIVE}export {};\n`);
    expect(await read("wrappers", "button.js")).toBe(`${DIRECTIVE}export {};\n`);
    expect(await read("index.js.map")).toBe("{}");
  });

  test("an explicit list marks only those top-level files", async () => {
    await prependUseClient(dir, ["index.js"]);
    expect(await read("index.js")).toStartWith(DIRECTIVE);
    expect(await read("wrappers", "button.js")).toBe("export {};\n");
  });

  test("defaults: ESM browser build, shared externals first, overrides win", () => {
    const options = m3Tsup({ entry: ["src/a.ts"], external: ["three"], platform: "neutral" }) as Record<string, unknown>;
    expect(options.entry).toEqual(["src/a.ts"]);
    expect(options.format).toEqual(["esm"]);
    expect(options.platform).toBe("neutral");
    expect(options.dts).toBe(false);
    expect(options.external).toEqual([...M3_EXTERNAL, "three"]);
    expect(typeof options.onSuccess).toBe("function");
  });
});
