import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dependency bootstrap leaves sibling databases and optional game inputs isolated", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "iecode-setup-"));
  try {
    const root = join(temporary, "iecode");
    mkdirSync(join(root, "scripts/tools"), { recursive: true });
    mkdirSync(join(root, "scripts/validation"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    copyFileSync(
      join(import.meta.dir, "../validation/bun-runtime.ts"),
      join(root, "scripts/iecode/validation/bun-runtime.ts"),
    );
    copyFileSync(
      join(import.meta.dir, "../../../config/bun-runtime.json"),
      join(root, "config/bun-runtime.json"),
    );
    const qualified = await Bun.file(join(root, "config/bun-runtime.json")).json();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ packageManager: `bun@${qualified.version}` }),
    );
    mkdirSync(join(temporary, "aphrody/var"), { recursive: true });
    writeFileSync(join(temporary, "aphrody/var/mirror.sqlite"), "isolated-fixture");
    writeFileSync(join(root, ".env.local"), "");
    writeFileSync(join(root, ".env"), "");
    copyFileSync(import.meta.dir + "/setup-fresh.ts", join(root, "scripts/iecode/tools/setup-fresh.ts"));
    writeFileSync(
      join(root, "config/bun-runtime.json"),
      JSON.stringify({ ...qualified, revision: "0".repeat(40) }),
    );
    const rejected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/iecode/tools/setup-fresh.ts",
        "--skip-install",
        "--skip-cargo",
        "--skip-docs",
        "--skip-doctor",
      ],
      { cwd: root },
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr.toString()).toContain(`actual CLI ${qualified.version}`);
    expect(existsSync(join(root, "var"))).toBe(false);
    writeFileSync(join(root, "config/bun-runtime.json"), JSON.stringify(qualified));
    const result = Bun.spawnSync(
      [
        process.execPath,
        "scripts/iecode/tools/setup-fresh.ts",
        "--skip-install",
        "--skip-cargo",
        "--skip-docs",
        "--skip-doctor",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "var/mirror.sqlite"))).toBe(false);
    expect(result.stdout.toString()).toContain("Game data is optional");
    expect(result.stderr.toString()).toBe("");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
