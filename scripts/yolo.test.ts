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
