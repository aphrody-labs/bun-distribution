// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  build,
  developerEnvironment,
  msbuildArgs,
  parseArgs,
  parseSetOutput,
  SDK,
  TOOLSET,
} from "./terminal-build.ts";

describe("terminal-build", () => {
  test("parses options and rejects unknown values", () => {
    const options = parseArgs([
      "--project",
      "Conhost\\Host_EXE",
      "--platform",
      "ARM64",
    ]);
    expect(options.project).toBe("Conhost\\Host_EXE");
    expect(options.platform).toBe("ARM64");
    expect(options.configuration).toBe("Release");
    expect(() => parseArgs(["--configuration", "Ship"])).toThrow(
      "--configuration",
    );
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--project"])).toThrow("expects a value");
  });

  test("passes the toolset and SDK overrides to MSBuild", () => {
    const args = msbuildArgs({
      terminalRoot: "T",
      configuration: "Debug",
      platform: "x64",
      project: "Conhost\\Host_EXE",
    });
    expect(args[0]).toBe(join("T", "OpenConsole.slnx"));
    expect(args).toContain(`/p:PlatformToolset=${TOOLSET}`);
    expect(args).toContain(`/p:WindowsTargetPlatformVersion=${SDK}`);
    expect(args).toContain(`/p:TargetPlatformVersion=${SDK}`);
    expect(args.at(-1)).toBe("/t:Conhost\\Host_EXE");
  });

  test("parses captured set output", () => {
    expect(
      parseSetOutput("A=1\r\nPath=C:\\x;C:\\y\r\n=C:=C:\\\r\nnoise\r\n"),
    ).toEqual({
      A: "1",
      Path: "C:\\x;C:\\y",
      "=C:": "C:\\",
    });
  });

  test("refuses a missing checkout before touching the toolchain", async () => {
    const root = mkdtempSync(join(tmpdir(), "terminal-build-"));
    try {
      const options = parseArgs(["--terminal-root", root]);
      if (process.platform === "win32")
        expect(build(options)).rejects.toThrow("checkout not found");
      else expect(build(options)).rejects.toThrow("Windows only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  test.skipIf(process.platform !== "win32" || !existsSync(vswhere))(
    "captures the Visual Studio developer environment without a console",
    () => {
      const env = developerEnvironment(process.env);
      expect(env.VSINSTALLDIR).toBeTruthy();
      expect(
        existsSync(
          join(env.VSINSTALLDIR as string, "MSBuild", "Current", "Bin"),
        ),
      ).toBe(true);
    },
    60_000,
  );
});
