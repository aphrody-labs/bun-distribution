// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  M3_EXTERNAL,
  commonDir,
  expandEntries,
  externals,
  m3BunBuild,
  m3Package,
  prependUseClient,
} from "../bun-build.ts";

const DIRECTIVE = "'use client';\n";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m3-bun-build-"));
  await mkdir(join(dir, "src"), { recursive: true });
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("m3BunBuild native preset", () => {
  test("prepends 'use client' using native Bun I/O", async () => {
    const dist = join(dir, "dist");
    await mkdir(join(dist, "sub"), { recursive: true });
    await Bun.write(join(dist, "index.js"), "export const a = 1;\n");
    await Bun.write(join(dist, "sub", "btn.js"), "export const b = 2;\n");

    const modified = await prependUseClient(dist);
    expect(modified).toBe(2);

    const content1 = await Bun.file(join(dist, "index.js")).text();
    const content2 = await Bun.file(join(dist, "sub", "btn.js")).text();
    expect(content1).toBe(`${DIRECTIVE}export const a = 1;\n`);
    expect(content2).toBe(`${DIRECTIVE}export const b = 2;\n`);

    // Second run should be idempotent
    const modifiedSecond = await prependUseClient(dist);
    expect(modifiedSecond).toBe(0);
  });

  test("bundles TypeScript code into dist using Bun.build", async () => {
    await Bun.write(
      join(dir, "src", "index.ts"),
      `export const greet = (name: string): string => 'Hello ' + name;`,
    );

    const result = await m3BunBuild({
      entry: "src/index.ts",
      cwd: dir,
      target: "browser",
      useClient: true,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);

    const outFile = join(dir, "dist", "index.js");
    expect(await Bun.file(outFile).exists()).toBe(true);

    const text = await Bun.file(outFile).text();
    expect(text).toContain(DIRECTIVE);
    expect(text).toContain("greet");
  });

  test("preserves M3_EXTERNAL dependencies", () => {
    expect(M3_EXTERNAL).toContain("react");
    expect(M3_EXTERNAL).toContain("lit");
    expect(M3_EXTERNAL).toContain("@aphrody/*");
  });

  test("an explicit list marks only those files", async () => {
    const dist = join(dir, "dist");
    await mkdir(join(dist, "sub"), { recursive: true });
    await Bun.write(join(dist, "index.js"), "export {};\n");
    await Bun.write(join(dist, "react.js"), "export {};\n");
    await Bun.write(join(dist, "sub", "link.js"), "export {};\n");
    await Bun.write(join(dist, "index.js.map"), "{}");
    expect(await prependUseClient(dist, ["react.js", "sub/link.js"])).toBe(2);
    expect(await Bun.file(join(dist, "index.js")).text()).toBe("export {};\n");
    expect(await Bun.file(join(dist, "react.js")).text()).toStartWith(
      DIRECTIVE,
    );
    expect(await Bun.file(join(dist, "sub", "link.js")).text()).toStartWith(
      DIRECTIVE,
    );
    expect(await Bun.file(join(dist, "index.js.map")).text()).toBe("{}");
  });

  test("entry globs expand against the package and plain paths pass through", async () => {
    await Bun.write(join(dir, "wrappers", "a.ts"), "export {};\n");
    await Bun.write(join(dir, "wrappers", "b.ts"), "export {};\n");
    expect(expandEntries(["index.ts", "wrappers/*.ts"], dir)).toEqual([
      join(dir, "index.ts"),
      join(dir, "wrappers", "a.ts"),
      join(dir, "wrappers", "b.ts"),
    ]);
    expect(() => expandEntries("nothing/*.ts", dir)).toThrow(/matches nothing/);
  });

  test("the output layout is based on the deepest common directory of the entries", () => {
    expect(commonDir(["/p/src/index.ts", "/p/src/shims/link.ts"])).toBe(
      "/p/src",
    );
    expect(commonDir(["/p/index.ts", "/p/wrappers/a.ts"])).toBe("/p");
    expect(commonDir(["/p/a/x.ts", "/q/b/y.ts"])).toBe("/");
  });

  test("m3Package is a typed identity", () => {
    const config = {
      entry: ["src/a.ts"],
      target: "node",
      useClient: false,
    } as const;
    expect(m3Package({ ...config })).toEqual(config);
    expect(m3Package()).toEqual({});
  });

  test("a build of several entries keeps the src-relative layout, splits shared code and marks the listed entries", async () => {
    await Bun.write(
      join(dir, "src", "shared.ts"),
      "export const shared = () => 'shared';\n",
    );
    await Bun.write(
      join(dir, "src", "a.ts"),
      "import { shared } from './shared'; export const a = shared() + 'a';\n",
    );
    await Bun.write(
      join(dir, "src", "react.tsx"),
      "import { shared } from './shared'; export const r = shared() + 'r';\n",
    );
    const result = await m3BunBuild({
      entry: ["src/a.ts", "src/react.tsx"],
      cwd: dir,
      useClient: ["react.js"],
    });
    expect(result.success).toBe(true);
    expect(await Bun.file(join(dir, "dist", "a.js")).text()).not.toStartWith(
      DIRECTIVE,
    );
    expect(await Bun.file(join(dir, "dist", "react.js")).text()).toStartWith(
      DIRECTIVE,
    );
  });

  test("a build error is returned, not thrown", async () => {
    await Bun.write(join(dir, "src", "bad.ts"), "import './nope';\n");
    const result = await m3BunBuild({ entry: "src/bad.ts", cwd: dir });
    expect(result.success).toBe(false);
    expect(result.logs.join("\n")).toContain("nope");
  });
});

describe("externals", () => {
  test("shared list, then the package's dependencies and peers with their subpaths, then extras", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { swiper: "1" },
        peerDependencies: { "@scope/x": "1" },
        devDependencies: { bundled: "1" },
      }),
    );
    const list = externals(dir, ["bun:*"]);
    expect(list).toEqual(
      expect.arrayContaining([
        ...M3_EXTERNAL,
        "node:*",
        "swiper",
        "swiper/*",
        "@scope/x",
        "@scope/x/*",
        "bun:*",
      ]),
    );
    expect(list).not.toContain("bundled");
    expect(new Set(list).size).toBe(list.length);
  });

  test("a dependency stays an import and a dev-only package is bundled in", async () => {
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { kept: "1" } }),
    );
    await Bun.write(
      join(dir, "node_modules", "kept", "package.json"),
      '{"name":"kept","main":"index.js"}',
    );
    await Bun.write(
      join(dir, "node_modules", "kept", "index.js"),
      "export const kept = 'KEPT-BODY';\n",
    );
    await Bun.write(
      join(dir, "node_modules", "inlined", "package.json"),
      '{"name":"inlined","main":"index.js"}',
    );
    await Bun.write(
      join(dir, "node_modules", "inlined", "index.js"),
      "export const inlined = 'INLINED-BODY';\n",
    );
    await Bun.write(
      join(dir, "src", "index.ts"),
      "import { kept } from 'kept'; import { inlined } from 'inlined'; export const both = kept + inlined;\n",
    );
    const result = await m3BunBuild({
      entry: "src/index.ts",
      cwd: dir,
      useClient: false,
    });
    expect(result.success).toBe(true);
    const out = await Bun.file(join(dir, "dist", "index.js")).text();
    expect(out).toContain('from "kept"');
    expect(out).not.toContain("KEPT-BODY");
    expect(out).toContain("INLINED-BODY");
  });
});
