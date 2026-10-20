// SPDX-License-Identifier: MIT
import { afterEach, expect, test } from "bun:test";
import { chmod, cp, lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceIntegrity } from "../container/source-integrity.ts";
import {
  productModesSHA256,
  sourceEntries,
  validatePreparedProductPath,
  verifyInstalledAdditions,
  verifyLinks,
  verifySourceEntries,
} from "../container/product-payload.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bun-os-product-payload-"));
  roots.push(root);
  return root;
}

test.skipIf(process.platform !== "linux").each(["file", "directory", "root"])(
  "permission drift in a %s changes the product mode checksum without changing source bytes",
  async kind => {
    const root = await tempDir();
    await mkdir(join(root, "bin"));
    await Bun.write(join(root, "bin/command"), "#!/bin/sh\nexit 0\n");
    const target = kind === "root" ? root : kind === "directory" ? join(root, "bin") : join(root, "bin/command");
    await chmod(target, 0o755);
    const bytesBefore = await sourceIntegrity(root);
    const modesBefore = await productModesSHA256(root);

    await chmod(target, 0o700);

    expect((await sourceIntegrity(root)).treeSHA256).toBe(bytesBefore.treeSHA256);
    expect(await productModesSHA256(root)).not.toBe(modesBefore);
  },
);

test.skipIf(process.platform !== "linux")("original source fixture links remain literal, including dangling external targets", async () => {
  const root = await tempDir();
  const absentTarget = join(await tempDir(), "not-present");
  await symlink(absentTarget, join(root, "tracked-fixture"));
  const original = await sourceEntries(root);
  expect(original).toContainEqual(["tracked-fixture", "symlink", absentTarget]);

  await verifyLinks(root, original);
  await verifySourceEntries(root, original);
  expect((await lstat(join(root, "tracked-fixture"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(root, "tracked-fixture"))).toBe(absentTarget);

  await rm(join(root, "tracked-fixture"));
  await symlink("different-missing-target", join(root, "tracked-fixture"));
  await expect(verifyLinks(root, original)).rejects.toThrow("Frozen source symlink changed");
});

test.skipIf(process.platform !== "linux").each(["escaping", "absolute", "dangling"])(
  "new installed %s dependency links are rejected",
  async kind => {
    const sandbox = await tempDir();
    const root = join(sandbox, "product");
    await mkdir(root);
    const original = await sourceEntries(root);
    await Bun.write(join(sandbox, "outside.js"), "export {};\n");
    await Bun.write(join(root, "inside.js"), "export {};\n");
    await mkdir(join(root, "node_modules"));
    const target = kind === "escaping" ? "../../outside.js"
      : kind === "absolute" ? join(root, "inside.js") : "missing.js";
    await symlink(target, join(root, "node_modules/dependency"));

    await expect(verifyLinks(root, original)).rejects.toThrow();
  },
);

test.skipIf(process.platform !== "linux")("relative installed dependencies remain valid when the product tree is relocated", async () => {
  const sandbox = await tempDir();
  const originalRoot = join(sandbox, "original");
  await mkdir(join(originalRoot, "packages/library"), { recursive: true });
  await Bun.write(join(originalRoot, "packages/library/index.js"), "export const value = 42;\n");
  const original = await sourceEntries(originalRoot);
  await mkdir(join(originalRoot, "node_modules"));
  await symlink("../packages/library", join(originalRoot, "node_modules/library"));
  await verifyLinks(originalRoot, original);
  await verifyInstalledAdditions(originalRoot, original, []);

  const relocated = join(sandbox, "relocated");
  await cp(originalRoot, relocated, { recursive: true, dereference: false, verbatimSymlinks: true });
  await rm(originalRoot, { recursive: true });

  await verifyLinks(relocated, original);
  await verifySourceEntries(relocated, original);
  await verifyInstalledAdditions(relocated, original, []);
  expect(await readlink(join(relocated, "node_modules/library"))).toBe("../packages/library");
  expect(await Bun.file(join(relocated, "node_modules/library/index.js")).text()).toContain("value = 42");
});

test("prepared build inputs require a declared root member and cannot overwrite frozen source", async () => {
  const root = await tempDir();
  await Bun.write(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  for (const name of ["declared", "undeclared"]) {
    await mkdir(join(root, "packages", name, "dist"), { recursive: true });
    await Bun.write(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
  }
  await mkdir(join(root, "packages/cli-wasm/wasm"), { recursive: true });
  await Bun.write(join(root, "packages/cli-wasm/package.json"), JSON.stringify({
    name: "@aphrody/cli-wasm",
    imports: { "#cli-wasm-glue": "./wasm/aphrody_command_wasm.js" },
  }));
  await Bun.write(join(root, "packages/declared/dist/tracked.js"), "export const tracked = true;\n");
  const original = await sourceEntries(root);

  await validatePreparedProductPath(root, "packages/declared/dist/generated.js", original);
  await expect(validatePreparedProductPath(root, "packages/undeclared/dist/generated.js", original))
    .rejects.toThrow("declared root workspace member");
  await expect(validatePreparedProductPath(root, "packages/absent/dist/generated.js", original))
    .rejects.toThrow("no frozen workspace manifest");
  await expect(validatePreparedProductPath(root, "packages/declared/dist/tracked.js", original))
    .rejects.toThrow("replaces frozen source");
  await validatePreparedProductPath(root, "packages/cli-wasm/wasm/aphrody_command_wasm_bg.wasm", original);
  await expect(validatePreparedProductPath(root, "packages/declared/wasm/unowned.wasm", original))
    .rejects.toThrow("generated artifact of the declared CLI-WASM owner");
  await expect(validatePreparedProductPath(root, "packages/cli-wasm/wasm/unlisted.wasm", original))
    .rejects.toThrow("generated artifact of the declared CLI-WASM owner");
  expect(await Bun.file(join(root, "packages/declared/dist/tracked.js")).text()).toBe("export const tracked = true;\n");

  const path = "packages/declared/dist/generated.js";
  await Bun.write(join(root, path), "export const generated = true;\n");
  await verifyInstalledAdditions(root, original, [{ path }]);
  await expect(verifyInstalledAdditions(root, original, [])).rejects.toThrow("non-dependency product path");
});
