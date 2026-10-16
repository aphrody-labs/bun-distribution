// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("an installed host-layout module uses its packaged defaults outside the checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-packaged-layout-"));
  try {
    const policy = Bun.TOML.parse(
      await Bun.file(join(import.meta.dir, "../../../infra/config/host/host-policy.toml")).text(),
    );
    await Bun.write(join(root, "data/host-layout.json"), JSON.stringify({ layout: policy.layout }));
    const module = join(root, "src/host/layout.ts");
    await Bun.write(module, await Bun.file(join(import.meta.dir, "../src/host/layout.ts")).text());
    const installed = await import(pathToFileURL(module).href);
    expect(installed.HOST_LAYOUT.home).toBe(policy.layout.home);
    expect(installed.hostLayout("/home/consumer").apps).toBe("/home/consumer/apps");
    expect(installed.migratePath("/srv/aphrody-build/cache")).toBe(`${policy.layout.home}/build/cache`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
