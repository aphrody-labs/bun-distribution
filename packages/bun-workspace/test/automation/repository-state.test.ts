import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRepository } from "../../src/automation/repository-state.ts";

test("state reports byte duplicates, missing Cargo dependencies and malformed links without crashing", async () => {
  const root = await mkdtemp(join(tmpdir(), "repository-state-"));
  try {
    await mkdir(join(root, "packages", "one"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    await writeFile(
      join(root, "packages/one/package.json"),
      JSON.stringify({ name: "@fixture/one", scripts: { test: "bun test" } }),
    );
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname="fixture"\nversion="0.1.0"\n[dependencies]\nmissing={path="absent"}\n',
    );
    await writeFile(join(root, "a.txt"), "same bytes");
    await writeFile(join(root, "b.txt"), "same bytes");
    await writeFile(join(root, "README.md"), "[broken](bad%ZZ.md)\n```md\n[example](example.md)\n```\n");
    for (const args of [
      ["init", "-q"],
      ["add", "."],
      ["-c", "user.name=aphrody-code", "-c", "user.email=contact@aphrody.com", "commit", "-qm", "fixture"],
    ]) {
      expect(Bun.spawnSync(["git", "-C", root, ...args], { windowsHide: true }).exitCode).toBe(0);
    }
    const state = await scanRepository(root);
    expect(state.bun.packages).toHaveLength(1);
    expect(state.exactDuplicates.some(group => group.paths.includes("a.txt") && group.paths.includes("b.txt"))).toBe(
      true,
    );
    expect(state.cargo.missingPaths).toEqual([{ path: "Cargo.toml", target: "absent", kind: "cargo-path" }]);
    expect(state.documentation.missingLinks).toEqual([
      { path: "README.md", target: "bad%ZZ.md", kind: "invalid-url-encoding" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
