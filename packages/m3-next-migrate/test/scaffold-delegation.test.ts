// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_OWNER_ROOT, TAURI_3 as scaffoldPins } from "@aphrody/scaffold";
import { scaffoldTargetProject, TAURI_3 } from "../src/index";

// The scaffold itself (pins, Tauri shell, templates) is tested once, in @aphrody/scaffold.
describe("scaffoldTargetProject", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("re-exports the pins of the single scaffolder", () => {
    expect(TAURI_3).toBe(scaffoldPins);
  });

  it("writes a native Bun app in the private owner and preserves an existing consumer", async () => {
    const outDir = join(
      PRIVATE_OWNER_ROOT,
      "apps",
      "m3-migrate-contract-delegation-" + crypto.randomUUID(),
    );
    dirs.push(outDir);
    await scaffoldTargetProject({
      outDir,
      projectName: "demo",
      target: "vite",
    });
    await expect(
      scaffoldTargetProject({
        outDir,
        projectName: "replacement",
        target: "vite",
      }),
    ).rejects.toThrow();
    expect(
      JSON.parse(await Bun.file(join(outDir, "package.json")).text()).name,
    ).toBe("demo");
    expect(await Bun.file(join(outDir, "m3.config.ts")).exists()).toBe(true);
  });
});
