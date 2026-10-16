// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { FONTS_PACKAGE, LOCK_FILE, REPO, readLock, sync, UPSTREAM_DIR, validateLock } from "./fonts-sync";
import framework from "../../packages/m3/package.json";
import fonts from "../../packages/m3-fonts/package.json";

test("font synchronization and package scripts resolve the selected root owners", async () => {
  expect(REPO).toBe(resolve(import.meta.dir, "../.."));
  expect(FONTS_PACKAGE).toBe(resolve(REPO, "packages/m3-fonts"));
  expect(LOCK_FILE).toBe(resolve(FONTS_PACKAGE, "fonts.lock.json"));
  expect(UPSTREAM_DIR).toBe(resolve(FONTS_PACKAGE, "fonts/upstream"));
  expect(framework.scripts.build).toBe("bun ../../scripts/m3/build.ts build --only @aphrody/m3");
  expect(framework.scripts.test).toBe("bun ../../scripts/m3/fonts-sync.ts --quiet && bun test");
  expect(fonts.scripts.test).toBe("bun ../../scripts/m3/fonts-sync.ts --quiet && bun test src");
  expect(await Bun.file(resolve(REPO, "scripts/m3/build.ts")).exists()).toBe(true);
  const lock = readLock();
  expect(validateLock(lock)).toEqual([]);
  const results = await sync({ check: true, lock, dir: resolve(import.meta.dir, "fixtures/nonexistent-font-sources") });
  expect(results).toHaveLength(lock.files.length);
  expect(results.every(result => result.status === "missing" && result.action === undefined)).toBe(true);
});
