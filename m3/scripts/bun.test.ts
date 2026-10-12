// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "./build.ts";
import { BUN_ROOT, REPO, EXAMPLE, plan } from "./bun.ts";

describe("bun task plan", () => {
  test("build uses the Bun-native pipeline; serve and compile run the example app", () => {
    expect(plan("build")[0]!.cmd).toEqual(["bun", "scripts/build.ts", "build"]);
    expect(plan("build")[0]!.cwd).toBe(REPO);
    expect(plan("serve")).toEqual([{ cmd: ["bun", "run", "dev"], cwd: EXAMPLE }]);
    expect(plan("compile")).toEqual([{ cmd: ["bun", "run", "compile"], cwd: EXAMPLE }]);
  });
  test("build then runs the cached package and app pipeline; typecheck uses the same owner", () => {
    expect(plan("build")[0]!.cmd.slice(1)).toEqual(["scripts/build.ts", "build"]);
    expect(plan("typecheck")[0]!.cmd.slice(1)).toEqual(["scripts/build.ts", "typecheck"]);
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
        ["example", "spa"].map(async (name) => {
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
        "@aphrody/m3-example",
        "@aphrody/m3-spa",
      ]);
      expect(results.every((result) => result.status === "built")).toBe(true);
      expect(await Bun.file(join(root, "apps/spa/dist/index.js")).text()).toContain('"spa"');
      expect((await pipeline(options)).every((result) => result.status === "cached")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("test runs the packages concurrently and still fails when one fails", () => {
    const steps = plan("test");
    expect(steps[0]!.cmd).toContain("./scripts/bench/lib.test.ts");
    expect(steps[1]!.cmd.slice(1, 4)).toEqual(["run", "--parallel", "--no-exit-on-error"]);
  });
  test("bench and bench:check run the harness, the latter with --check", () => {
    expect(plan("bench", ["--only", "bun"])[0]!.cmd.slice(1)).toEqual([
      "scripts/bench/run.ts",
      "--only",
      "bun",
    ]);
    expect(plan("bench:check")[0]!.cmd.slice(1)).toEqual(["scripts/bench/run.ts", "--check"]);
  });
  test("test runs every workspace package and ends with the repository gates", () => {
    const steps = plan("test");
    expect(steps[0]!.cmd).toContain("./scripts/check-exports.test.ts");
    expect(steps[1]!.cmd).toContain("./packages/*");
    expect(steps[1]!.cmd).not.toContain("*");
    expect(steps[1]!.cmd).toContain("!@aphrody/nie-ui");
    expect(steps.slice(2).map((s) => s.cmd[1])).toEqual([
      "scripts/check-exports.ts",
      "scripts/check-assets.ts",
      "scripts/check-links.ts",
    ]);
  });
  test("BUN_ROOT selects the shared native owner", () => {
    expect(BUN_ROOT).toBeString();
  });
  test("install:theme defaults to a dry-run install", () => {
    const cmd = plan("install:theme")[0]!.cmd;
    expect(cmd.join(" ")).toContain("m3-os-themes/src/cli.ts install --target all");
    expect(cmd).not.toContain("--apply");
  });
  test("unknown tasks throw", () => expect(() => plan("nope")).toThrow());
  test("scoped lint forwards fixes and rejects unknown package selection", () => {
    expect(plan("lint", ["--only", "@aphrody/m3", "--fix"])[0]!.cmd).toEqual([
      "oxlint",
      "packages/m3",
      "--fix",
    ]);
    expect(() => plan("lint", ["--only", "@unknown/m3", "--fix"])).toThrow("Unknown M3 workspace");
    expect(plan("typecheck", ["--only", "@aphrody/m3"])[0]!.cmd.slice(-2)).toEqual([
      "--only",
      "@aphrody/m3",
    ]);
  });
  test("updates are scoped to M3 and previewed unless explicitly applied", () => {
    const step = plan("update", ["--only", "@aphrody/m3"])[0]!;
    expect(step.cmd).toContain("--dry-run");
    expect(step.cmd).toContain("--filter");
    expect(step.cmd.join(" ")).toContain("packages/m3");
    expect(plan("update", ["--only", "@aphrody/m3", "--apply"])[0]!.cmd).not.toContain("--dry-run");
    expect(() => plan("update", ["--latest"])).toThrow("separate qualification");
    expect(() => plan("security", ["fix"])).toThrow("no M3 workspace filter");
  });
  test("research delegates to the real native Web owner without a second acquisition implementation", () => {
    const before = process.env.APHRODY_BIN;
    process.env.APHRODY_BIN = process.execPath;
    try {
      expect(plan("research", ["--reuse-corpus"])[0]!.cmd).toEqual([
        process.execPath,
        "web",
        "design-sync",
        "--workspace",
        resolve(REPO, ".."),
        "--reuse-corpus",
      ]);
    } finally {
      if (before === undefined) delete process.env.APHRODY_BIN;
      else process.env.APHRODY_BIN = before;
    }
  });
});
