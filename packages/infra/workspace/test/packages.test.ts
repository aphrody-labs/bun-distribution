// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverBunPackageWorkspaces } from "../src/packages.ts";

test("Bun bridge discovers only the supplied monorepo root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bun-roots-"));
  try {
    const root = join(parent, "relocated");
    await Promise.all(
      [root, join(parent, "aphrody-ui"), join(parent, "aphrody-ai")].map(async (dir) => {
        await mkdir(dir);
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({ name: dir, engines: { bun: ">=1.4.2" }, workspaces: ["packages/*"] }),
        );
        await writeFile(join(dir, "bun.lock"), "{}");
      }),
    );
    const found = await discoverBunPackageWorkspaces(root);
    expect(found.map((workspace) => workspace.root)).toEqual([root]);
    expect(found[0]?.workspaces).toEqual(["packages/*"]);
    expect(await discoverBunPackageWorkspaces(join(parent, "missing"))).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
