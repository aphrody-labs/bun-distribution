// SPDX-License-Identifier: Apache-2.0
// The static export's configuration and files, without starting Next: `scripts/yolo-example.ts export` builds it.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const m3Next = join(root, "../..");

beforeAll(() => {
  if (!existsSync(join(m3Next, "dist/index.js"))) {
    const build = Bun.spawnSync(
      ["bun", join(m3Next, "../../scripts/build.ts"), "build", "--only", "@aphrody/m3-next"],
      { windowsHide: true, cwd: m3Next },
    );
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  }
});

describe("examples/tauri", () => {
  test("next.config.ts is a static export for a webview", async () => {
    const config = (await import("../next.config")).default;
    expect(config.output).toBe("export");
    expect(config.trailingSlash).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    expect(config.cacheComponents).toBe(false);
    expect(config.env).toEqual({ NEXT_PUBLIC_M3_STATIC: "1" });
  });

  test("there is no proxy.ts and no route handler: an export has no server", () => {
    expect(existsSync(join(root, "proxy.ts"))).toBe(false);
    expect(existsSync(join(root, "app/api"))).toBe(false);
  });

  test("the page imports the sheets of the components it uses, not the whole library", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    expect(css).toContain("@aphrody/m3-baseui/css/core.css");
    expect(css).toContain("@aphrody/m3-baseui/css/button.css");
    expect(css).not.toContain("m3-baseui.css");
  });
});
