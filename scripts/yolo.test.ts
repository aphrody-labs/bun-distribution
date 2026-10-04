// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { REPO, YOLO_CLI, plan } from "./yolo.ts";

describe("yolo task plan", () => {
  test("build, serve and compile go through the yolo CLI web|tauri commands", () => {
    expect(plan("build")[0]!.cmd).toEqual(["bun", YOLO_CLI, "web", "build"]);
    expect(plan("serve")[0]!.cmd.slice(2)).toEqual(["web", "dev"]);
    expect(plan("compile")[0]!.cmd.slice(2)).toEqual(["tauri", "build"]);
    expect(plan("build")[0]!.env).toEqual({ YOLO_HOME: REPO });
  });
  test("build then runs the cached package pipeline without rebuilding the app; typecheck is the pipeline", () => {
    expect(plan("build")[1]!.cmd.slice(1)).toEqual(["scripts/build.ts", "build", "--no-apps"]);
    expect(plan("typecheck")[1]!.cmd.slice(1)).toEqual(["scripts/build.ts", "typecheck"]);
  });
  test("test runs the packages concurrently and still fails when one fails", () => {
    const steps = plan("test");
    expect(steps[1]!.cmd).toContain("./scripts/bench/lib.test.ts");
    expect(steps[2]!.cmd.slice(1, 4)).toEqual(["run", "--parallel", "--no-exit-on-error"]);
  });
  test("bench and bench:check run the harness, the latter with --check", () => {
    expect(plan("bench", ["--only", "yolo"])[0]!.cmd.slice(1)).toEqual(["scripts/bench/run.ts", "--only", "yolo"]);
    expect(plan("bench:check")[0]!.cmd.slice(1)).toEqual(["scripts/bench/run.ts", "--check"]);
  });
  test("test runs every workspace package and ends with the repository gates", () => {
    const steps = plan("test");
    expect(steps[1]!.cmd).toContain("./scripts/check-exports.test.ts");
    expect(steps[2]!.cmd).toContain("*");
    expect(steps[2]!.cmd).toContain("!@aphrody/app-ui");
    expect(steps[2]!.cmd).toContain("!@aphrody/nie-ui");
    expect(steps.slice(3).map((s) => s.cmd[1])).toEqual(["scripts/check-exports.ts", "scripts/check-assets.ts", "scripts/check-links.ts"]);
  });
  test("YOLO_CLI resolves under YOLO_ROOT", () => {
    expect(YOLO_CLI.endsWith("apps/cli/src/index.ts")).toBe(true);
  });
  test("install:theme defaults to a dry-run install", () => {
    const cmd = plan("install:theme")[0]!.cmd;
    expect(cmd.join(" ")).toContain("m3-os-themes/src/cli.ts install --target all");
    expect(cmd).not.toContain("--apply");
  });
  test("unknown tasks throw", () => expect(() => plan("nope")).toThrow());
});
