import { spawnSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "../../support/bunTest.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const script = join(process.cwd(), "scripts", "check-dependency-install.mjs");

const fixture = async (
  installedVersion?: string,
  omitDevDependency = false,
) => {
  const root = await createTestTempDirectory("rea-deps-");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      dependencies: { alpha: "1.0.0" },
      devDependencies: { beta: "2.0.0" },
    }),
  );
  const install = async (name: string, version: string) => {
    await mkdir(join(root, "node_modules", name), { recursive: true });
    await writeFile(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  };
  await install("alpha", installedVersion ?? "1.0.0");
  if (!omitDevDependency) await install("beta", "2.0.0");
  await install("unrelated", "9.0.0");
  return root;
};

describe("dependency install freshness", () => {
  it("accepts matching direct packages and ignores extraneous packages", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture(),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("reports a direct version mismatch with one remediation", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture("0.9.0"),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("alpha: installed 0.9.0, expected 1.0.0");
    expect(result.stderr).toContain("bun install");
  });

  it("reports a missing direct development dependency", async () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: await fixture(undefined, true),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "beta: missing from the installed dependencies",
    );
    expect(result.stderr).toContain("bun install");
  });

  it("runs from a script path containing URL-escaped characters", async () => {
    const root = await fixture("0.9.0");
    const scriptDirectory = join(root, "path with spaces");
    const copiedScript = join(scriptDirectory, "check-dependency-install.mjs");
    await mkdir(scriptDirectory);
    await copyFile(script, copiedScript);

    const result = spawnSync(process.execPath, [copiedScript], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("alpha: installed 0.9.0, expected 1.0.0");
  });
});
