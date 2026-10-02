// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineCatalog } from "../src/pipeline-catalog.ts";

test("new domains run before the final Shenron product gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-pipeline-"));
  try {
    await Bun.write(
      join(root, "package.json"),
      JSON.stringify({ name: "aphrody-workspace", workspaces: ["packages/*/*"] }),
    );
    for (const domain of ["os", "shell", "google", "ai", "future", "shenron"]) {
      const dir = join(root, "packages", domain, "sample");
      await mkdir(dir, { recursive: true });
      await Bun.write(
        join(dir, "package.json"),
        JSON.stringify({ name: `@aphrody/${domain}`, scripts: { test: "bun test" } }),
      );
    }
    const { config } = await pipelineCatalog(root);
    const stages = config.stages.map((stage) => stage.id);
    expect(stages.indexOf("bun-os")).toBeLessThan(stages.indexOf("bun-shell"));
    expect(stages.indexOf("bun-google")).toBeLessThan(stages.indexOf("bun-ai"));
    expect(stages.indexOf("bun-future")).toBeLessThan(stages.indexOf("product-shenron-final"));
    expect(stages.at(-1)).toBe("product-shenron-final");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
