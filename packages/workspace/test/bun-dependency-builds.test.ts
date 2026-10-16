// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDependencies,
  dependencyBuildPlan,
} from "../src/bun-dependency-builds.ts";

async function fixture(run: (root: string) => Promise<void>, failure = false) {
  const root = await mkdtemp(join(tmpdir(), "aphrody-dependency-builds-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*", "!packages/excluded"] }),
    );
    const packages = Object.entries({
      app: {
        name: "fixture-app",
        dependencies: { bridge: "workspace:*", archived: "file:producer.tgz" },
      },
      bridge: {
        name: "bridge",
        exports: "./src/index.ts",
        dependencies: { middle: "workspace:*" },
      },
      middle: {
        name: "middle",
        exports: { ".": { import: "./dist/index.js" } },
        dependencies: { base: "workspace:*" },
        scripts: { build: "bun build.ts" },
      },
      base: {
        name: "base",
        types: "./dist/index.d.ts",
        scripts: { build: "bun build.ts" },
      },
      archive: {
        name: "archived",
        main: "./dist/index.js",
        scripts: { build: "bun build.ts" },
      },
      excluded: {
        name: "excluded",
        main: "./dist/index.js",
        scripts: { build: "bun build.ts" },
      },
    });
    await Promise.all(
      packages.map(async ([name, manifest]) => {
        const directory = join(root, "packages", name);
        await mkdir(directory, { recursive: true });
        await Promise.all([
          writeFile(join(directory, "package.json"), JSON.stringify(manifest)),
          writeFile(
            join(directory, "build.ts"),
            `
        import { appendFileSync } from "node:fs";
        appendFileSync(${JSON.stringify(join(root, "builds.log"))}, ${JSON.stringify(`${name}\n`)});
        if (${JSON.stringify(failure && name === "base")}) process.exit(17);
      `,
          ),
        ]);
      }),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("source dependencies lead to compiled owners in dependency order, with archive ownership kept separate", async () => {
  await fixture(async (root) => {
    expect(
      (await dependencyBuildPlan(root, ["fixture-app", "bridge"])).map(
        (item) => item.name,
      ),
    ).toEqual(["base", "middle"]);
    expect(await buildDependencies(root, ["fixture-app", "bridge"])).toBe(0);
    expect(await readFile(join(root, "builds.log"), "utf8")).toBe(
      "base\nmiddle\n",
    );
  });
});

test("a failed artifact build prevents dependent build execution", async () => {
  await fixture(async (root) => {
    expect(await buildDependencies(root, ["fixture-app"])).toBe(17);
    expect(await readFile(join(root, "builds.log"), "utf8")).toBe("base\n");
  }, true);
});

test("an artifact dependency cycle is rejected before executing build commands", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "packages/base/package.json"),
      JSON.stringify({
        name: "base",
        main: "./dist/index.js",
        dependencies: { middle: "workspace:*" },
        scripts: { build: "bun build.ts" },
      }),
    );
    await expect(dependencyBuildPlan(root, ["fixture-app"])).rejects.toThrow(
      "Workspace artifact build cycle",
    );
    expect(await Bun.file(join(root, "builds.log")).exists()).toBe(false);
  });
});

test("source-only cycles require no compiled artifact and are not scheduled", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "packages/middle/package.json"),
      JSON.stringify({
        name: "middle",
        exports: "./src/index.ts",
        dependencies: { bridge: "workspace:*" },
      }),
    );
    expect(await dependencyBuildPlan(root, ["fixture-app"])).toEqual([]);
  });
});

test("a built public entry must have a build script in its active owning workspace", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "packages/base/package.json"),
      JSON.stringify({ name: "base", types: "./dist/index.d.ts" }),
    );
    await expect(dependencyBuildPlan(root, ["fixture-app"])).rejects.toThrow(
      "Workspace artifact owner has no build script: base",
    );
  });
});

test("a missing workspace owner fails before any build", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "packages/base/package.json"),
      JSON.stringify({
        name: "base",
        dependencies: { missing: "workspace:*" },
      }),
    );
    await expect(dependencyBuildPlan(root, ["fixture-app"])).rejects.toThrow(
      "Workspace dependency has no active owner: missing",
    );
    expect(await Bun.file(join(root, "builds.log")).exists()).toBe(false);
  });
});

test("duplicate workspace owners fail before any build", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "packages/archive/package.json"),
      JSON.stringify({ name: "base" }),
    );
    await expect(dependencyBuildPlan(root, ["fixture-app"])).rejects.toThrow(
      "Duplicate workspace artifact owner: base",
    );
  });
});
