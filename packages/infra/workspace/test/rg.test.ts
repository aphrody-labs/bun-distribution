import { expect, test } from "bun:test";
import { isRootWorkspaceMember, rgRoots } from "../src/rg.ts";

test("RG paths are anchored to the Aphrody workspace layout", () => {
  expect(rgRoots("/workspace/aphrody")).toEqual([
    "/workspace/aphrody/apps/rg",
    "/workspace/aphrody/packages/rg",
  ]);
});

test("RG command scope follows root workspace patterns", () => {
  const root = "/workspace/aphrody";
  const patterns = ["apps/rg/*", "packages/rg/*", "packages/rg/patreon-bun/examples/*"];

  expect(isRootWorkspaceMember(root, `${root}/packages/rg/search`, patterns)).toBe(true);
  expect(
    isRootWorkspaceMember(root, `${root}/packages/rg/patreon-bun/examples/bun-esm`, patterns),
  ).toBe(true);
  expect(
    isRootWorkspaceMember(
      root,
      `${root}/packages/rg/patreon-bun/examples/bun-esm/fixture`,
      patterns,
    ),
  ).toBe(false);
  expect(isRootWorkspaceMember(root, `${root}/packages/discord/source/repository`, patterns)).toBe(
    false,
  );
});

test("RG command scope honors root workspace exclusions", () => {
  expect(
    isRootWorkspaceMember("/workspace/aphrody", "/workspace/aphrody/apps/rg/demo", [
      "apps/rg/*",
      "!apps/rg/demo",
    ]),
  ).toBe(false);
});

test("RG detailed inventory resolves default and named Bun catalogs by dependency name", async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { exportDetailedInventory } = await import("../src/rg.ts");
  const root = await mkdtemp(join(tmpdir(), "rg-catalog-test-"));
  try {
    await mkdir(join(root, "apps/rg/demo"), { recursive: true });
    await mkdir(join(root, "packages/rg"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        workspaces: {
          packages: ["apps/rg/*"],
          catalog: { zod: "4.6.5" },
          catalogs: { producer: { zod: "3.25.76" } },
        },
      }),
    );
    await writeFile(
      join(root, "apps/rg/demo/package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        dependencies: { zod: "catalog:" },
        devDependencies: { zod: "catalog:producer" },
      }),
    );
    const result = await exportDetailedInventory(root);
    expect(result.packages[0]?.externalDependencies.zod?.resolved).toBe("4.6.5");
    expect(result.packages[0]?.devDependencies.zod?.resolved).toBe("3.25.76");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
