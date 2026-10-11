// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCompileCommand } from "./stage-setup.ts";

describe("setup compiler selection", () => {
  test("native Windows x64 embeds the selected running runtime without a target download", () => {
    const executable = join(tmpdir(), "qualified Bun", "bun.exe");
    const outfile = join(tmpdir(), "release pack", "Aphrody-Setup.exe");
    const argv = setupCompileCommand(outfile, { executable, platform: "win32", arch: "x64" });
    expect(argv[0]).toBe(executable);
    expect(argv).not.toContain("bun");
    expect(argv.some((arg) => arg.startsWith("--target"))).toBe(false);
    expect(argv.at(-1)).toBe(outfile);
  });

  test("other build hosts retain the Windows x64 target and qualified artifact path", () => {
    const executable = join(tmpdir(), "build runtime", "bun");
    const targetExecutable = join(tmpdir(), "qualified Windows runtime", "bun.exe");
    const outfile = join(tmpdir(), "release pack", "Aphrody-Setup.exe");
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const argv = setupCompileCommand(outfile, {
        executable,
        platform,
        arch: "arm64",
        targetExecutable,
      });
      expect(argv[0]).toBe(executable);
      expect(argv).toContain("--target=bun-windows-x64");
      expect(argv[argv.indexOf("--compile-executable-path") + 1]).toBe(targetExecutable);
      expect(argv.at(-1)).toBe(outfile);
    }
  });
});
