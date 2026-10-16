import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshStandalone, standaloneServer } from "./next-build";

test("standalone paths follow the selected workspace and reject an outside app", () => {
  const root = join(tmpdir(), "rg-next-workspace");
  const app = join(root, "apps", "rg", "website");
  expect(standaloneServer(root, app)).toBe(join(app, ".next", "standalone", "apps", "rg", "website", "server.js"));
  expect(() => standaloneServer(root, join(root, "..", "outside"))).toThrow("inside");
  expect(() => standaloneServer(root, root)).toThrow("inside");
});

test("failed builds cannot be qualified by old standalone artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rg-next-artifacts-"));
  try {
    const app = join(root, "apps", "rg", "website");
    const server = standaloneServer(root, app);
    await mkdir(join(server, ".."), { recursive: true });
    await Bun.write(join(app, ".next", "BUILD_ID"), "fixture-build");
    await Bun.write(server, "export default 'fixture';");
    await assertFreshStandalone(app, server, 0);
    await utimes(server, 1, 1);
    await expect(assertFreshStandalone(app, server, Date.now() - 60_000)).rejects.toThrow("stale");
    await rm(join(app, ".next", "BUILD_ID"));
    await expect(assertFreshStandalone(app, server, 0)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
