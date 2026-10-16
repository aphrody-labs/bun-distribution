// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineCatalog } from "../../src/automation/pipeline-catalog.ts";

test("known domains run bottom to top, then new domains in name order", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-pipeline-"));
  try {
    await Bun.write(
      join(root, "package.json"),
      JSON.stringify({
        name: "aphrody-workspace",
        workspaces: ["packages/*/*"],
      }),
    );
    await Promise.all(
      ["os", "shell", "google", "ai", "future", "alpha"].map(async domain => {
        const dir = join(root, "packages", domain, "sample");
        await mkdir(dir, { recursive: true });
        await Bun.write(
          join(dir, "package.json"),
          JSON.stringify({
            name: `@aphrody/${domain}`,
            scripts: { test: "bun test" },
          }),
        );
      }),
    );
    const { config } = await pipelineCatalog(root);
    const stages = config.stages.map(stage => stage.id);
    expect(stages.indexOf("bun-os")).toBeLessThan(stages.indexOf("bun-shell"));
    expect(stages.indexOf("bun-google")).toBeLessThan(stages.indexOf("bun-ai"));
    expect(stages.indexOf("bun-ai")).toBeLessThan(stages.indexOf("bun-alpha"));
    expect(stages.indexOf("bun-alpha")).toBeLessThan(stages.indexOf("bun-future"));
    expect(stages.at(-1)).toBe("bun-future");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
