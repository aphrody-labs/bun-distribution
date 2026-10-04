// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAURI_3 as scaffoldPins } from "@aphrody/scaffold";
import { scaffoldTargetProject, TAURI_3 } from "../src/index";

// The scaffold itself (pins, Tauri shell, templates) is tested once, in @aphrody/scaffold.
describe("scaffoldTargetProject", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("re-exports the pins of the single scaffolder", () => {
    expect(TAURI_3).toBe(scaffoldPins);
  });

  it("writes the app template and refreshes an existing directory in place", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "m3-delegation-"));
    dirs.push(outDir);
    await scaffoldTargetProject({ outDir, projectName: "demo", target: "tauri" });
    await scaffoldTargetProject({ outDir, projectName: "demo", target: "tauri" });
    expect(JSON.parse(await Bun.file(join(outDir, "package.json")).text()).name).toBe("demo");
    expect(await Bun.file(join(outDir, "src-tauri/Cargo.toml")).exists()).toBe(true);
  });
});
