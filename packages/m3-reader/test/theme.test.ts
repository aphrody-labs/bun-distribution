// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("optional Dragon Ball stylesheet resolves and ships the authored host-palette theme", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const path = Bun.resolveSync("@aphrody/m3-reader/dragon-ball.css", import.meta.dir);
  expect(path).toBe(resolve(import.meta.dir, "../dragon-ball.css"));
  expect(manifest.files).toContain("dragon-ball.css");
  expect(manifest.sideEffects).toContain("*.css");
  const css = await Bun.file(path).text();
  expect(css).toContain("SPDX-License-Identifier: Apache-2.0");
  expect(css).toContain("--reader-accent: var(--dbz-orange, #e78220)");
  expect(css).toContain("skewX(-12.3deg)");
  expect(css).toContain(".m3-reader--dragon-ball .m3-reader-scroll");
});
