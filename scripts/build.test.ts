// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  clean,
  closureHashes,
  globalSalt,
  hashPackage,
  pipeline,
  pool,
  sourceFiles,
} from "./build.ts";
import { levels, workspaceDeps, workspacePackages } from "./lib/workspace.ts";

const PRESET = join(import.meta.dir, "../packages/m3-config/bun-build.ts");
let root = "";

const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const pkg = (name: string, deps: Record<string, string> = {}) => ({
  name,
  version: "0.0.0",
  private: true,
  dependencies: deps,
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "m3-build-test-"));
  write(
    "package.json",
    JSON.stringify({
      name: "ws",
      private: true,
      workspaces: { packages: ["packages/*", "apps/*"] },
    }),
  );
  write("packages/m3-a/package.json", JSON.stringify(pkg("@aphrody/m3-a")));
  write("packages/m3-a/src/index.ts", 'export const a = "A";\n');
  write(
    "packages/m3-a/build.config.ts",
    `import { m3Package } from ${JSON.stringify(PRESET)};\nexport default m3Package({ useClient: false });\n`,
  );
  write(
    "packages/m3-b/package.json",
    JSON.stringify(pkg("@aphrody/m3-b", { "@aphrody/m3-a": "workspace:*" })),
  );
  write(
    "packages/m3-b/src/index.ts",
    'import { a } from "@aphrody/m3-a";\nexport const b = a + "B";\n',
  );
  write("packages/m3-b/src/react.tsx", "export const R = 1;\n");
  write(
    "packages/m3-b/build.config.ts",
    `import { m3Package } from ${JSON.stringify(PRESET)};\nexport default m3Package({ entry: ["src/index.ts", "src/react.tsx"], useClient: ["react.js"] });\n`,
  );
  write("packages/m3-b/test/skipped.test.ts", "// not an input\n");
  write("packages/other/package.json", JSON.stringify(pkg("@foreign/other")));
  write(
    "packages/other/build.config.ts",
    `import { m3Package } from ${JSON.stringify(PRESET)};\nexport default m3Package();\n`,
  );
  write("packages/other/src/index.ts", "export {};\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("workspace", () => {
  test("members, dependency edges and levels", () => {
    const all = workspacePackages(root);
    expect(all.map((p) => p.name)).toEqual(["@aphrody/m3-a", "@aphrody/m3-b", "@foreign/other"]);
    const known = new Set(all.map((p) => p.name));
    expect(workspaceDeps(all[1]!, known)).toEqual(["@aphrody/m3-a"]);
    expect(levels(all).map((l) => l.map((p) => p.name))).toEqual([
      ["@aphrody/m3-a", "@foreign/other"],
      ["@aphrody/m3-b"],
    ]);
  });
  test("the real repository resolves and has no dependency cycle", () => {
    const all = workspacePackages();
    expect(all.length).toBeGreaterThan(10);
    expect(levels(all).flat().length).toBe(all.length);
  });
});

describe("hashing", () => {
  test("inputs exclude dist, node_modules and tests; the hash follows content", () => {
    const dir = join(root, "packages/m3-b");
    expect(sourceFiles(dir)).toEqual([
      "build.config.ts",
      "package.json",
      "src/index.ts",
      "src/react.tsx",
    ]);
    const before = hashPackage(dir);
    expect(hashPackage(dir)).toBe(before);
    write("packages/m3-b/test/skipped.test.ts", "// still not an input\n");
    expect(hashPackage(dir)).toBe(before);
  });
  test("a dependency edit changes the dependent's closure hash, not the reverse", () => {
    const all = workspacePackages(root);
    const salt = globalSalt(root);
    const before = closureHashes(all, salt);
    write("packages/m3-a/src/index.ts", 'export const a = "A2";\n');
    const after = closureHashes(all, salt);
    expect(after.get("@aphrody/m3-a")).not.toBe(before.get("@aphrody/m3-a"));
    expect(after.get("@aphrody/m3-b")).not.toBe(before.get("@aphrody/m3-b"));
    expect(after.get("@foreign/other")).toBe(before.get("@foreign/other"));
  });
});

describe("pipeline", () => {
  test("pool never runs more than the limit at once and keeps result order", async () => {
    let live = 0;
    let max = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      live++;
      max = Math.max(max, live);
      await Bun.sleep(5);
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(max).toBe(2);
  });

  test("builds the in-scope packages in order, then serves the second run from the cache", async () => {
    const first = await pipeline({ root });
    expect(first.map((o) => [o.name, o.status])).toEqual([
      ["@aphrody/m3-a", "built"],
      ["@aphrody/m3-b", "built"],
    ]);
    expect(existsSync(join(root, "packages/m3-a/dist/index.js"))).toBe(true);
    expect(readFileSync(join(root, "packages/m3-b/dist/react.js"), "utf8")).toStartWith(
      "'use client';\n",
    );
    expect(readFileSync(join(root, "packages/m3-b/dist/index.js"), "utf8")).not.toStartWith(
      "'use client';",
    );
    // The workspace scope is external, so the dependent keeps its import of `@aphrody/m3-a`.
    expect(readFileSync(join(root, "packages/m3-b/dist/index.js"), "utf8")).toContain(
      'from "@aphrody/m3-a"',
    );
    const second = await pipeline({ root });
    expect(second.map((o) => o.status)).toEqual(["cached", "cached"]);
  });

  test("an edit rebuilds the package and its dependents only", async () => {
    write("packages/m3-b/src/react.tsx", "export const R = 2;\n");
    const third = await pipeline({ root });
    expect(third.map((o) => [o.name, o.status])).toEqual([
      ["@aphrody/m3-a", "cached"],
      ["@aphrody/m3-b", "built"],
    ]);
    write("packages/m3-a/src/index.ts", 'export const a = "A3";\n');
    const fourth = await pipeline({ root });
    expect(fourth.map((o) => o.status)).toEqual(["built", "built"]);
  });

  test("--no-cache rebuilds, --only selects by short name, foreign members need --only", async () => {
    const forced = await pipeline({ root, cache: false });
    expect(forced.map((o) => o.status)).toEqual(["built", "built"]);
    const only = await pipeline({ root, only: ["other"] });
    expect(only.map((o) => [o.name, o.status])).toEqual([["@foreign/other", "built"]]);
  });

  test("a failing build is reported and stops later levels", async () => {
    write("packages/m3-a/src/index.ts", 'import "./missing-module";\n');
    const result = await pipeline({ root });
    expect(result.map((o) => o.status)).toEqual(["failed"]);
    expect(result[0]!.detail).toContain("missing-module");
  });

  test("typechecking a changed test cannot reuse a stale success", async () => {
    write(
      "packages/m3-a/package.json",
      JSON.stringify({ ...pkg("@aphrody/m3-a"), scripts: { typecheck: "tsc --noEmit" } }),
    );
    write(
      "packages/m3-a/tsconfig.json",
      JSON.stringify({
        compilerOptions: { strict: true, types: [], skipLibCheck: true },
        include: ["test/**/*.ts"],
      }),
    );
    write("packages/m3-a/test/typed.ts", "const n: number = 1; export {};\n");
    const options = { root, task: "typecheck" as const, only: ["m3-a"] };
    expect((await pipeline(options))[0]!.status).toBe("built");
    expect((await pipeline(options))[0]!.status).toBe("cached");
    write("packages/m3-a/test/typed.ts", 'const n: number = "invalid"; export {};\n');
    const failed = (await pipeline(options))[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.detail).toContain("TS2322");
  });

  test("an invalid pool limit fails instead of dropping jobs", async () => {
    await expect(pool([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });

  test("clean removes dist and the cache", () => {
    expect(clean(root)).toBeGreaterThan(0);
    expect(existsSync(join(root, "packages/m3-b/dist"))).toBe(false);
    expect(existsSync(join(root, "node_modules/.cache/m3-build"))).toBe(false);
  });
});
