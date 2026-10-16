// SPDX-License-Identifier: Apache-2.0
// The example's configuration and files, without starting Next: `scripts/yolo-example.ts` builds and serves it.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const root = join(import.meta.dir, "..");
const m3Next = join(root, "../..");

beforeAll(() => {
  // `@aphrody/m3-next` resolves to its build output: make it when a fresh checkout has none.
  if (!existsSync(join(m3Next, "dist/index.js"))) {
    const build = Bun.spawnSync(
      [
        "bun",
        join(m3Next, "../../scripts/build.ts"),
        "build",
        "--only",
        "@aphrody/m3-next",
      ],
      { windowsHide: true, cwd: m3Next },
    );
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  }
});

describe("examples/app", () => {
  test("next.config.ts: the Next 16 stack, with the monorepo root for Turbopack", async () => {
    const config = (await import("../next.config")).default;
    expect(config.cacheComponents).toBe(true);
    expect(config.reactCompiler).toBe(true);
    expect(config.typedRoutes).toBe(true);
    expect(config.output).toBeUndefined();
    expect(config.transpilePackages).toContain("@aphrody/m3-baseui");
    expect(config.turbopack?.root).toBe(join(root, "../../../.."));
  });

  test("proxy.ts: a function and a literal page matcher; a first visit gets the theme cookie", async () => {
    const { proxy, config } = await import("../proxy");
    expect(typeof proxy).toBe("function");
    expect(config.matcher).toHaveLength(1);
    const response = proxy(new NextRequest("http://localhost/theme"));
    expect(response.cookies.get("m3-theme")?.value).toBe("system");
  });

  test("the health route answers", async () => {
    const { GET } = await import("../app/api/health/route");
    expect(await GET().json()).toMatchObject({ ok: true });
  });

  test("every route has its file", () => {
    for (const file of [
      "app/layout.tsx",
      "app/page.tsx",
      "app/components/page.tsx",
      "app/theme/page.tsx",
      "app/api/health/route.ts",
      "app/globals.css",
    ])
      expect(existsSync(join(root, file))).toBe(true);
  });
});
