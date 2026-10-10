// SPDX-License-Identifier: Apache-2.0
// The m3 package modules m3Bun serves (src/plugins-m3.ts), through real `Bun.build` runs. The packages resolve from
// the app directory: the first of @aphrody/m3-bun, `M3_BUN_TEST_DEPS` and the workspace's app-ui that has them all.
import { afterAll, describe, expect, test } from "bun:test";
import { delimiter, dirname, join } from "node:path";
import { m3Bun } from "../src/plugin.ts";
import { resolveFrom } from "../src/plugins.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const PACKAGE_DIR = dirname(import.meta.dir);
const DEP_DIRS = [
  PACKAGE_DIR,
  ...(Bun.env.M3_BUN_TEST_DEPS?.split(delimiter).filter(Boolean) ?? []),
  join(PACKAGE_DIR, "../app-ui"),
];
const m3Deps = DEP_DIRS.find(dir =>
  ["@aphrody/m3-theme/tokens.css", "@aphrody/assets/package.json"].every(s => resolveFrom(s, [dir])),
);

async function bundle(
  files: Record<string, string>,
  entry: string,
  options: Parameters<typeof m3Bun>[0] = {},
): Promise<{ success: boolean; logs: string; text: string }> {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop -- Materialize each fixture file before the single bundler invocation.
    await Bun.write(join(dir, name), content);
  }
  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    root: dir,
    outdir: join(dir, "dist"),
    target: "browser",
    plugins: [m3Bun({ configDir: m3Deps ?? dir, ...options })],
    throw: false,
  });
  const text = (await Promise.all(result.outputs.map(o => o.text()))).join("\n");
  return { success: result.success, logs: result.logs.map(String).join("\n"), text };
}

describe.skipIf(!m3Deps)("m3:theme/, m3:assets/", () => {
  test("m3:theme/tokens.css is the @aphrody/m3-theme sheet", async () => {
    const { success, logs, text } = await bundle({ "main.css": '@import "m3:theme/tokens.css";\n' }, "main.css");
    expect(logs).toBe("");
    expect(text).toContain("--md-sys-color-primary: #65558f");
    expect(success).toBe(true);
  });

  test("m3:theme/spaceui.css imported from JS reaches Bun compiled: no `@theme` block left", async () => {
    const { success, logs, text } = await bundle({ "main.ts": 'import "m3:theme/spaceui.css";\n' }, "main.ts");
    expect(logs).toBe("");
    expect(text).toContain("--md-sys-color-primary");
    expect(text).not.toContain("@theme");
    expect(success).toBe(true);
  });

  test("m3:assets/<path> is the @aphrody/assets file; ?url inlines it as a data URL", async () => {
    const file = await bundle(
      { "main.ts": 'import a from "m3:assets/icons/Album.png";\nconsole.log(a);\n' },
      "main.ts",
    );
    expect(file.logs).toBe("");
    expect(file.text).toMatch(/Album-[a-z0-9]+\.png/);
    expect(file.success).toBe(true);
    const inline = await bundle(
      { "main.ts": 'import a from "m3:assets/icons/Album.png?url";\nconsole.log(a);\n' },
      "main.ts",
    );
    expect(inline.logs).toBe("");
    expect(inline.text).toContain("data:image/png;base64,");
    expect(inline.success).toBe(true);
  });

  test("an unknown file or a query other than m3:assets/?url fails with the package to install", async () => {
    const missing = await bundle({ "main.css": '@import "m3:theme/nope.css";\n' }, "main.css");
    expect(missing.success).toBe(false);
    expect(missing.logs).toContain("m3-bun: m3:theme/nope.css needs @aphrody/m3-theme/nope.css");
    const query = await bundle({ "main.ts": 'import t from "m3:theme/tokens.css?url";\nconsole.log(t);\n' }, "main.ts");
    expect(query.success).toBe(false);
    expect(query.logs).toContain("only m3:assets/ takes a query, and only ?url");
  });
});

describe("m3:icons/", () => {
  test("a local catalogue (iconsRoot) serves the variants; a missing icon names the file", async () => {
    const root = tmp();
    await Bun.write(join(root, "home/materialsymbolsoutlined/home_24px.svg"), '<svg id="outlined"/>\n');
    await Bun.write(join(root, "home/materialsymbolsrounded/home_wght300fill1_24px.svg"), '<svg id="rounded"/>\n');
    const ok = await bundle(
      {
        "main.ts":
          'import a from "m3:icons/home"; import b from "m3:icons/rounded/home?fill=1&wght=300"; console.log(a, b);\n',
      },
      "main.ts",
      { iconsRoot: root },
    );
    expect(ok.logs).toBe("");
    expect(ok.text).toContain('<svg id="outlined"/>');
    expect(ok.text).toContain('<svg id="rounded"/>');
    expect(ok.success).toBe(true);
    const missing = await bundle({ "main.ts": 'import a from "m3:icons/nope"; console.log(a);\n' }, "main.ts", {
      iconsRoot: root,
    });
    expect(missing.success).toBe(false);
    expect(missing.logs).toContain("no icon outlined/nope_24px.svg");
  });

  test("without a catalogue the CDN (M3_ICONS_ORIGIN) is fetched once into the disk cache", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        hits++;
        return new URL(req.url).pathname === "/s/i/short-term/release/materialsymbolsoutlined/home/default/24px.svg"
          ? new Response('<svg id="cdn"/>')
          : new Response("", { status: 404 });
      },
    });
    const saved = { origin: Bun.env.M3_ICONS_ORIGIN, cache: Bun.env.M3_ICONS_CACHE };
    Bun.env.M3_ICONS_ORIGIN = server.url.origin;
    Bun.env.M3_ICONS_CACHE = tmp();
    try {
      const files = { "main.ts": 'import a from "m3:icons/home"; console.log(a);\n' };
      // Skip the forked catalogue when it is checked out: this test is about the CDN.
      const options = { iconsRoot: undefined };
      const first = await bundle(files, "main.ts", options);
      if (first.text.includes("<svg xmlns=")) return;
      expect(first.logs).toBe("");
      expect(first.text).toContain('<svg id="cdn"/>');
      const second = await bundle(files, "main.ts", options);
      expect(second.text).toContain('<svg id="cdn"/>');
      expect(hits).toBe(1);
      const missing = await bundle({ "main.ts": 'import a from "m3:icons/nope"; console.log(a);\n' }, "main.ts");
      expect(missing.success).toBe(false);
      expect(missing.logs).toContain("no icon outlined/nope_24px.svg at");
    } finally {
      for (const [key, value] of [
        ["M3_ICONS_ORIGIN", saved.origin],
        ["M3_ICONS_CACHE", saved.cache],
      ] as const) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });
});

const catalogue = (await import("@aphrody/material-design-icons").catch(() => null)) as {
  hasSymbol(name: string): boolean;
  readSymbolSvg(name: string): string;
} | null;
test.skipIf(!catalogue?.hasSymbol("home"))("m3:icons/ reads the @aphrody/material-design-icons catalogue", async () => {
  const { success, logs, text } = await bundle(
    { "main.ts": 'import a from "m3:icons/home"; console.log(a);\n' },
    "main.ts",
  );
  expect(logs).toBe("");
  expect(text).toContain(JSON.stringify(catalogue!.readSymbolSvg("home").trim()).slice(1, 40));
  expect(success).toBe(true);
});

test("m3:icon/ is @aphrody/m3-icons' native renderer, or an error that points to m3:icons/", async () => {
  const { success, logs, text } = await bundle(
    { "main.ts": 'import a from "m3:icon/outlined/home?fill=1"; console.log(a);\n' },
    "main.ts",
  );
  if (success) {
    expect(text).toContain("<svg");
    return;
  }
  expect(logs).toMatch(/m3-bun: (native Material Symbols need @aphrody\/m3-icons|@aphrody\/m3-icons renders through)/);
  expect(logs).toContain("m3:icons/[style/]name serves the SVG catalogue without it");
});
