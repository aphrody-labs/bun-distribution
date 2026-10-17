import { expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshBuild, assertWorkspaceMember } from "./next-build";

test("builds run from an app inside the selected workspace", () => {
  const root = join(tmpdir(), "rg-next-workspace");
  expect(() => assertWorkspaceMember(root, join(root, "apps", "rg-website"))).not.toThrow();
  expect(() => assertWorkspaceMember(root, join(root, "..", "outside"))).toThrow("inside");
  expect(() => assertWorkspaceMember(root, root)).toThrow("inside");
});

test("failed builds cannot be qualified by an old build identifier", async () => {
  const root = await mkdtemp(join(tmpdir(), "rg-next-artifacts-"));
  try {
    const app = join(root, "apps", "rg-website");
    const buildId = join(app, ".next", "BUILD_ID");
    await Bun.write(buildId, "fixture-build");
    await assertFreshBuild(app, 0);
    await utimes(buildId, 1, 1);
    await expect(assertFreshBuild(app, Date.now() - 60_000)).rejects.toThrow("stale");
    await rm(buildId);
    await expect(assertFreshBuild(app, 0)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
