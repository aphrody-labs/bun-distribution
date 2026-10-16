import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentationSourceFiles } from "./docs-files";

test("documentation inventory excludes ignored notes, retains ignored tracked files and archive projections", () => {
  const root = mkdtempSync(join(tmpdir(), "iecode-docs-source-"));
  try {
    mkdirSync(join(root, "docs/private"), { recursive: true });
    mkdirSync(join(root, "docs/history"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "docs/private/\ndocs/history/\n");
    for (const path of [
      "docs/private/local.md",
      "docs/private/tracked.md",
      "docs/current.md",
      "docs/history/expanded.md",
    ]) {
      writeFileSync(join(root, path), "fixture");
    }
    const git = (args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root });
      expect(result.exitCode).toBe(0);
    };
    git(["init", "--quiet"]);
    git(["add", "-f", "docs/private/tracked.md"]);
    const files = documentationSourceFiles(root, [
      "docs/history/expanded.md",
      "docs/history/packed.md",
    ]);
    expect(files).not.toContain("docs/private/local.md");
    expect(files).toContain("docs/private/tracked.md");
    expect(files).toContain("docs/current.md");
    expect(files).toContain("docs/history/expanded.md");
    expect(files).toContain("docs/history/packed.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
