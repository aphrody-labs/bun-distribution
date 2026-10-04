// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { m3BunBuild, prependUseClient, M3_EXTERNAL } from "../bun-build.ts";

const DIRECTIVE = "'use client';\n";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m3-bun-build-"));
  await mkdir(join(dir, "src"), { recursive: true });
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("m3BunBuild native preset", () => {
  test("prepends 'use client' using native Bun I/O", async () => {
    const dist = join(dir, "dist");
    await mkdir(join(dist, "sub"), { recursive: true });
    await Bun.write(join(dist, "index.js"), "export const a = 1;\n");
    await Bun.write(join(dist, "sub", "btn.js"), "export const b = 2;\n");

    const modified = await prependUseClient(dist);
    expect(modified).toBe(2);

    const content1 = await Bun.file(join(dist, "index.js")).text();
    const content2 = await Bun.file(join(dist, "sub", "btn.js")).text();
    expect(content1).toBe(`${DIRECTIVE}export const a = 1;\n`);
    expect(content2).toBe(`${DIRECTIVE}export const b = 2;\n`);

    // Second run should be idempotent
    const modifiedSecond = await prependUseClient(dist);
    expect(modifiedSecond).toBe(0);
  });

  test("bundles TypeScript code into dist using Bun.build", async () => {
    await Bun.write(
      join(dir, "src", "index.ts"),
      `export const greet = (name: string): string => 'Hello ' + name;`,
    );

    const result = await m3BunBuild({
      entry: "src/index.ts",
      cwd: dir,
      target: "browser",
      useClient: true,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);

    const outFile = join(dir, "dist", "index.js");
    expect(await Bun.file(outFile).exists()).toBe(true);

    const text = await Bun.file(outFile).text();
    expect(text).toContain(DIRECTIVE);
    expect(text).toContain("greet");
  });

  test("preserves M3_EXTERNAL dependencies", () => {
    expect(M3_EXTERNAL).toContain("react");
    expect(M3_EXTERNAL).toContain("lit");
    expect(M3_EXTERNAL).toContain("@aphrody/*");
  });
});
