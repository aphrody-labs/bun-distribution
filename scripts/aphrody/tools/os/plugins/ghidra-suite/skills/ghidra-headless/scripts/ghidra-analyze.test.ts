// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAnalyzeHeadless, LAUNCHER } from "./find-ghidra.ts";
import { analyze, cmdQuote, defaultProjectName, launcherArgs, parseArgs } from "./ghidra-analyze.ts";

const WINDOWS = process.platform === "win32";
const sandbox = mkdtempSync(join(tmpdir(), "ghidra-analyze-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** A fake Ghidra install whose launcher echoes its arguments and MAXMEM. */
function fakeGhidra(): string {
  const root = join(sandbox, "ghidra_12.0_PUBLIC");
  mkdirSync(join(root, "support"), { recursive: true });
  const launcher = join(root, "support", LAUNCHER);
  if (WINDOWS) {
    writeFileSync(launcher, "@echo off\r\necho ARGS %*\r\necho MAXMEM=%MAXMEM%\r\nexit /b 0\r\n");
  } else {
    writeFileSync(launcher, '#!/bin/sh\necho "ARGS $*"\necho "MAXMEM=$MAXMEM"\n');
    chmodSync(launcher, 0o755);
  }
  return root;
}

describe("ghidra-analyze", () => {
  test("parses options, script arguments and passthrough arguments", () => {
    const options = parseArgs(
      ["-o", "out", "-s", "ExportAll.java", "-a", "x  y", "--timeout", "60", "a.exe", "--", "-readOnly"],
      "C:/cwd",
    );
    expect(options.binary).toBe("a.exe");
    expect(options.output).toBe("out");
    expect(options.scripts).toEqual([{ name: "ExportAll.java", args: ["x", "y"] }]);
    expect(options.timeout).toBe(60);
    expect(options.extra).toEqual(["-readOnly"]);
    expect(() => parseArgs(["-a", "x"])).toThrow("must follow --script");
    expect(() => parseArgs(["--timeout", "0", "a"])).toThrow("positive integer");
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown option");
  });

  test("builds the analyzeHeadless argument vector", () => {
    const options = parseArgs([
      "--project-dir",
      "P",
      "--project-name",
      "N",
      "-s",
      "S.java",
      "-p",
      "x86:LE:64:default",
      "--no-analysis",
      "--library-search-path",
      "L1",
      "--library-search-path",
      "L2",
      "--max-cpu",
      "4",
      "bin",
    ]);
    expect(launcherArgs(options, "B", "log")).toEqual([
      "P",
      "N",
      "-import",
      "bin",
      "-scriptPath",
      "B",
      "-postScript",
      "S.java",
      "-processor",
      "x86:LE:64:default",
      "-noanalysis",
      "-deleteProject",
      "-librarySearchPaths",
      "L1;L2",
      "-max-cpu",
      "4",
      "-log",
      "log",
    ]);
    const kept = parseArgs(["--keep-project", "--script-path", "X", "bin"]);
    expect(launcherArgs(kept, "B", "log")).not.toContain("-deleteProject");
    expect(launcherArgs(kept, "B", "log")).toContain("B;X");
  });

  test("names the default project after the binary", () => {
    expect(defaultProjectName("C:/x/my-app.v2.exe", 42)).toBe("ghidra_my_app_v2_42");
  });

  test("quotes cmd arguments only when needed", () => {
    expect(cmdQuote("plain")).toBe("plain");
    expect(cmdQuote("C:\\Program Files\\x")).toBe('"C:\\Program Files\\x"');
    expect(cmdQuote("a;b")).toBe('"a;b"');
    expect(cmdQuote("")).toBe('""');
  });

  test("finds the launcher from GHIDRA_INSTALL_DIR", () => {
    const root = fakeGhidra();
    expect(findAnalyzeHeadless({ GHIDRA_INSTALL_DIR: root, PATH: "" })).toBe(join(root, "support", LAUNCHER));
  });

  test("runs the launcher hidden and tees its output", async () => {
    const root = fakeGhidra();
    const binary = join(sandbox, "sample bin.exe");
    writeFileSync(binary, "MZ");
    const output = join(sandbox, "out");
    const previous = process.env.GHIDRA_INSTALL_DIR;
    process.env.GHIDRA_INSTALL_DIR = root;
    try {
      const options = parseArgs(["-o", output, "--max-memory", "2G", "-s", "S.java", binary]);
      expect(await analyze(options)).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.GHIDRA_INSTALL_DIR;
      else process.env.GHIDRA_INSTALL_DIR = previous;
    }
    const log = readFileSync(join(output, "ghidra_output.log"), "utf8");
    expect(log).toContain("-postScript S.java");
    expect(log).toContain("sample bin.exe");
    expect(log).toContain("-deleteProject");
    expect(log).toContain("MAXMEM=2G");
  });
});
