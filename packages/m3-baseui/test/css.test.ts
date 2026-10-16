// SPDX-License-Identifier: Apache-2.0
// The stylesheets go through a real CSS pipeline: Bun's bundler resolves the @imports and minifies with Lightning CSS.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(import.meta.dir, "..");

async function bundle(entry: string): Promise<string> {
  const result = await Bun.build({ entrypoints: [entry], minify: true });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return result.outputs[0]!.text();
}

/* oxlint-disable eslint/no-await-in-loop -- one bundle at a time keeps the failure message attached to its sheet */
describe("css pipeline", () => {
  test("the aggregate resolves every @import and keeps everything in the components layer", async () => {
    const out = await bundle(join(pkgDir, "m3-baseui.css"));
    expect(out).not.toContain("@import");
    expect(out.startsWith("@layer components{")).toBe(true);
    expect(out).toContain(".m3-bui-button");
    expect(out).toContain(".m3-bui-toast");
    expect(out).toContain("color-mix(");
  });

  test("each sheet is valid CSS on its own", async () => {
    for (const file of readdirSync(join(pkgDir, "css")).filter((f) =>
      f.endsWith(".css"),
    )) {
      const out = await bundle(join(pkgDir, "css", file));
      expect(out.length).toBeGreaterThan(100);
      expect(out).toContain("@layer components");
    }
  });

  test("one component costs a fraction of the whole sheet", async () => {
    const all = (await bundle(join(pkgDir, "m3-baseui.css"))).length;
    const button = (await bundle(join(pkgDir, "css", "button.css"))).length;
    const core = (await bundle(join(pkgDir, "css", "core.css"))).length;
    expect(button + core).toBeLessThan(all / 2);
  });
});
