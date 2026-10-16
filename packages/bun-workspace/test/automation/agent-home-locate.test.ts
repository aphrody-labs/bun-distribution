// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locate } from "../../src/automation/agent-home.ts";

test("native lookup preserves PATH, persistent PATH, off-path and absent states", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-home-lookup-"));
  const previous = process.env.PATH;
  const executable = process.platform === "win32" ? "fixture-tool.exe" : "fixture-tool";
  try {
    const dir = join(home, ".bun/bin");
    mkdirSync(dir, { recursive: true });
    const binary = join(dir, executable);
    writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = dir;
    expect(locate("fixture-tool", home, [])).toEqual({
      kind: "path",
      path: binary,
    });
    process.env.PATH = home;
    expect(locate("fixture-tool", home, [dir])).toEqual({
      kind: "path",
      path: binary,
    });
    expect(locate("fixture-tool", home, [])).toEqual({
      kind: "off-path",
      path: binary,
    });
    expect(locate("absent-fixture-tool", home, [])).toEqual({ kind: "absent" });
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
