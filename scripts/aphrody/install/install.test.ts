// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const sh = readFileSync(join(dir, "install.sh"), "utf8");
const ps1 = readFileSync(join(dir, "install.ps1"), "utf8");

describe("one-click installers", () => {
  for (const [name, text] of [
    ["install.sh", sh],
    ["install.ps1", ps1],
  ] as const) {
    test(`${name} verifies the release checksum then delegates to self install`, () => {
      expect(text).toContain("latest.json");
      expect(text).toContain("SHA256SUMS");
      expect(text).toContain("self install");
      expect(text).toContain("checksum mismatch");
      expect(text).toContain("install-full");
    });
  }

  test("install.sh is valid POSIX shell", () => {
    const sha = Bun.which("sh");
    if (!sha) return;
    const run = Bun.spawnSync([sha, "-n", join(dir, "install.sh")]);
    expect(run.exitCode).toBe(0);
  });

  test("install.ps1 parses", () => {
    const pwsh = Bun.which("pwsh");
    if (!pwsh) return;
    const script = `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${join(dir, "install.ps1").replaceAll("'", "''")}',[ref]$null,[ref]$e);exit ($e.Count)`;
    expect(
      Bun.spawnSync([pwsh, "-NoProfile", "-Command", script]).exitCode,
    ).toBe(0);
  });
});
