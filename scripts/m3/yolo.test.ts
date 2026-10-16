// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "./build.ts";
import { REPO, YOLO_CLI, plan } from "./yolo.ts";

describe("yolo task plan", () => {
  test("build, serve and compile go through the yolo CLI web|tauri commands", () => {
    expect(plan("build")[0]!.cmd).toEqual([YOLO_CLI, "web", "build"]);
    expect(plan("serve")[0]!.cmd.slice(1)).toEqual(["web", "dev"]);
    expect(plan("compile")[0]!.cmd.slice(1)).toEqual(["tauri", "build"]);
    expect(plan("build")[0]!.env).toEqual({ YOLO_HOME: REPO });
  });
  test("build then runs the cached package and app pipeline; typecheck uses the same owner", () => {
    expect(plan("build")[1]!.cmd.slice(1)).toEqual(["scripts/build.ts", "build"]);
    expect(plan("typecheck")[1]!.cmd.slice(1)).toEqual(["scripts/build.ts", "typecheck"]);
  });
  test("the root build includes every app and caches their compiled outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "m3-root-apps-"));
    try {
      await Bun.write(
        join(root, "package.json"),
        JSON.stringify({
          name: "fixture-owner",
          private: true,
          workspaces: { packages: ["apps/*"] },
        }),
      );
      await Promise.all(
        ["web", "showcase"].map(async (name) => {
          const directory = join(root, "apps", name);
          await Bun.write(
            join(directory, "package.json"),
            JSON.stringify({
              name: "@aphrody/m3-" + name,
              private: true,
              scripts: { build: "bun build.ts" },
            }),
          );
          await Bun.write(
            join(directory, "src/index.ts"),
            "export const application = " + JSON.stringify(name) + ";",
          );
          await Bun.write(
            join(directory, "build.ts"),
            'const result = await Bun.build({ entrypoints: ["src/index.ts"], outdir: "dist", target: "browser" }); if (!result.success) throw new Error("Application compilation failed");',
          );
        }),
      );
      const build = plan("build").find((step) => step.cmd[1] === "scripts/build.ts")!;
      const options = { root, apps: !build.cmd.includes("--no-apps") };
      const results = await pipeline(options);
      expect(results.map((result) => result.name).toSorted()).toEqual([
        "@aphrody/m3-showcase",
        "@aphrody/m3-web",
      ]);
      expect(results.every((result) => result.status === "built")).toBe(true);
      expect(await Bun.file(join(root, "apps/m3-showcase/dist/index.js")).text()).toContain(
        '"showcase"',
      );
      expect((await pipeline(options)).every((result) => result.status === "cached")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("test runs the packages concurrently and still fails when one fails", () => {
    const steps = plan("test");
    expect(steps[1]!.cmd).toContain("./scripts/bench/lib.test.ts");
    expect(steps[2]!.cmd.slice(1, 4)).toEqual(["run", "--parallel", "--no-exit-on-error"]);
  });
  test("bench and bench:check run the harness, the latter with --check", () => {
    expect(plan("bench", ["--only", "yolo"])[0]!.cmd.slice(1)).toEqual([
      "scripts/bench/run.ts",
      "--only",
      "yolo",
    ]);
    expect(plan("bench:check")[0]!.cmd.slice(1)).toEqual(["scripts/bench/run.ts", "--check"]);
  });
  test("test runs every workspace package and ends with the repository gates", () => {
    const steps = plan("test");
    expect(steps[1]!.cmd).toContain("./scripts/check-exports.test.ts");
    expect(steps[2]!.cmd).toContain("*");
    expect(steps[2]!.cmd).toContain("!@aphrody/app-ui");
    expect(steps[2]!.cmd).toContain("!@aphrody/nie-ui");
    expect(steps.slice(3).map((s) => s.cmd[1])).toEqual([
      "scripts/check-exports.ts",
      "scripts/check-assets.ts",
      "scripts/check-links.ts",
    ]);
  });
  test("YOLO_CLI resolves under YOLO_ROOT", () => {
    expect(YOLO_CLI.endsWith("bin/yolo")).toBe(true);
  });
  test("install:theme defaults to a dry-run install", () => {
    const cmd = plan("install:theme")[0]!.cmd;
    expect(cmd.join(" ")).toContain("m3-os-themes/src/cli.ts install --target all");
    expect(cmd).not.toContain("--apply");
  });
  test("unknown tasks throw", () => expect(() => plan("nope")).toThrow());
});
