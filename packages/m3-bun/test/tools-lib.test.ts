// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLibrary } from "../src/tools-lib.ts";
import { loadTool } from "../src/tools-load.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

function library(): string {
  const dir = tmp("m3-bun-lib-");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lib", dependencies: { react: "19.0.0" } }));
  writeFileSync(
    join(dir, "src", "a.ts"),
    'import { useState } from "react";\nimport { twice } from "./util.ts";\nexport const a = () => twice(useState(1)[0]);\n',
  );
  writeFileSync(join(dir, "src", "util.ts"), "export const twice = (n: number) => n * 2;\n");
  writeFileSync(join(dir, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(
    join(dir, "build.config.ts"),
    'export default { entry: ["src/a.ts", "src/b.ts"], useClient: ["a.js"] };\n',
  );
  return dir;
}

describe("buildLibrary", () => {
  test("applies build.config.ts through m3BunBuild: dependencies external, 'use client' where asked", async () => {
    const dir = library();
    const report = await buildLibrary({ dir });
    expect(report).toMatchObject({
      success: true,
      outDir: join(dir, "dist"),
      config: join(dir, "build.config.ts"),
      logs: [],
    });
    expect(report.files.map(file => file.path)).toEqual(["a.js", "a.js.map", "b.js", "b.js.map"]);
    for (const file of report.files) {
      const bytes = new Uint8Array(readFileSync(join(dir, "dist", file.path)));
      expect(file.bytes).toBe(bytes.length);
      expect(file.zstdBytes).toBe(Bun.zstdCompressSync(bytes).length);
    }
    const a = readFileSync(join(dir, "dist", "a.js"), "utf8");
    expect(a).toStartWith("'use client';\n");
    expect(a).toContain('import { useState } from "react";');
    expect(a).toContain("var twice = (n) => n * 2;");
    expect(readFileSync(join(dir, "dist", "b.js"), "utf8")).not.toContain("use client");
  });

  test("options override the config; a failed build reports Bun's logs", async () => {
    const report = await buildLibrary({
      dir: library(),
      entry: "src/missing.ts",
    });
    expect(report.success).toBe(false);
    expect(report.files).toEqual([]);
    expect(report.logs.join("\n")).toMatch(/ModuleNotFound.*missing\.ts/);
  });
});

describe("loadTool", () => {
  test("a missing package becomes an error that says what to install", async () => {
    const error = await loadTool("@aphrody/not-installed", () => import("@aphrody/not-installed" as string)).catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "m3-bun: @aphrody/not-installed is not installed; add it next to @aphrody/m3-bun (bun add @aphrody/not-installed)",
    );
    expect((error as Error).cause).toBeDefined();
  });

  test("other load errors are rethrown as they are", async () => {
    const thrown = new SyntaxError("broken module");
    await expect(
      loadTool("@aphrody/m3", () => {
        throw thrown;
      }),
    ).rejects.toBe(thrown);
  });
});
