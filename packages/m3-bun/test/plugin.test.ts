// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { m3Bun } from "../src/plugin.ts";
import { tsM3Css } from "../src/theme-css.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

async function bundle(
  files: Record<string, string>,
  entry: string,
  options: Parameters<typeof m3Bun>[0] = {},
): Promise<{ success: boolean; logs: string[]; text: string }> {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop -- Materialize each fixture file before running the single bundler invocation.
    await Bun.write(join(dir, name), content);
  }
  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    root: dir,
    target: "browser",
    plugins: [m3Bun({ configDir: dir, ...options })],
    throw: false,
  });
  const text = (await Promise.all(result.outputs.map((o) => o.text()))).join(
    "\n",
  );
  return { success: result.success, logs: result.logs.map(String), text };
}

describe("m3Bun: the one plugin", () => {
  test("an explicit TypeScript generator remains a caller override for custom themes", async () => {
    const { success, text, logs } = await bundle(
      {
        "main.css":
          '@import "m3:tokens.css";\n@import "m3:scheme.css";\nbody { color: var(--md-sys-color-primary); }\n',
      },
      "main.css",
      { theme: { seed: "#00897b", variant: "vibrant" }, css: tsM3Css },
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("--md-sys-color-primary");
    expect(text).toContain("--md-sys-shape-corner-medium");
  });

  test("m3:icons/<name> is the SVG markup from the catalogue; variants and errors", async () => {
    const iconsRoot = tmp();
    await Bun.write(
      join(iconsRoot, "home/materialsymbolsoutlined/home_24px.svg"),
      '<svg xmlns="a"/>',
    );
    await Bun.write(
      join(iconsRoot, "home/materialsymbolsrounded/home_fill1_24px.svg"),
      '<svg xmlns="b"/>',
    );
    const ok = await bundle(
      {
        "main.ts":
          'import a from "m3:icons/home"; import b from "m3:icons/rounded/home?fill=1"; console.log(a, b);\n',
      },
      "main.ts",
      { iconsRoot },
    );
    expect(ok.success).toBe(true);
    expect(ok.text).toContain('<svg xmlns="b"/>');
    const missing = await bundle(
      {
        "main.ts":
          'import a from "m3:icons/no_such_symbol_xyz"; console.log(a);\n',
      },
      "main.ts",
      { iconsRoot },
    );
    expect(missing.success).toBe(false);
    expect(missing.logs.join("\n")).toContain("no_such_symbol_xyz");
  });

  test("m3:fonts.css falls back to @aphrody/m3-fonts when no Aphrody OS checkout holds the fonts", async () => {
    const { success, text, logs } = await bundle(
      { "main.css": '@import "m3:fonts.css";\n' },
      "main.css",
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("@font-face");
    expect(text).toContain("Google Sans Flex");
  });

  test("an app can pass its own css generator for the sheets the TypeScript one does not know", async () => {
    const { success, text } = await bundle(
      { "main.css": '@import "m3:spaceui.css";\n' },
      "main.css",
      {
        css: (config: any) => `/* ${config.sheet} */ :root { --custom: 1; }`,
      },
    );
    expect(success).toBe(true);
    expect(text).toContain("--custom");
    const fallback = await bundle(
      { "main.css": '@import "m3:spaceui.css";\n' },
      "main.css",
      {
        theme: { seed: "#123456" },
      },
    );
    expect(fallback.success).toBe(false);
    expect(fallback.logs.join("\n")).toContain("native");
  });

  test("default baseline uses the committed native sheet without a TypeScript override", async () => {
    const { success, text, logs } = await bundle(
      { "main.ts": 'import "m3:tokens.css";\n' },
      "main.ts",
      {
        theme: { seed: "#6750A4", variant: "tonalSpot", contrast: 0 },
      },
    );
    // Tailwind compiles the sheet's `@theme inline`: Bun's CSS parser has nothing to warn about.
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("--md-sys-color-primary: #65558f");
    expect(text).toContain("--primary: var(--md-sys-color-primary)");
    expect(text).not.toContain("@theme");
  });
});

let nativeCorpus = process.env.APHRODY_DESIGN_CORPUS;
if (!nativeCorpus) {
  let dir = import.meta.dir;
  for (;;) {
    const corpus = join(dir, "var/mirrors/design-sync");
    if (existsSync(join(corpus, "tokens.json"))) {
      nativeCorpus = corpus;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

describe.skipIf(!nativeCorpus)("m3Bun native artifact default", () => {
  test("the real native pet export reaches Bun.build without an injected generator", async () => {
    const theme = await Bun.file(join(nativeCorpus!, "tokens.json")).json();
    const output = await bundle(
      { "main.ts": 'import "m3:tokens.css";\n' },
      "main.ts",
      {
        configDir: nativeCorpus,
        theme: {
          seed: theme.seed,
          variant: theme.variant,
          contrast: theme.contrast_level,
        },
        tailwind: false,
        sass: false,
      },
    );
    expect(output.success).toBe(true);
    expect(
      output.logs.filter(
        (log) => log !== "BuildMessage: invalid @ rule encountered: '@theme'",
      ),
    ).toEqual([]);
    if (output.logs.length)
      console.warn(
        `[m3Bun native CSS qualification gap] ${output.logs.join("; ")}`,
      );
    expect(output.text).toContain(
      `--md-sys-color-primary: ${theme.light.primary}`,
    );
    expect(output.text).toContain(
      `--md-sys-color-primary: ${theme.dark.primary}`,
    );
    expect(output.text).toContain("--primary: var(--md-sys-color-primary)");
  });

  test("an explicit CSS generator still takes precedence over a native artifact", async () => {
    const output = await bundle(
      { "main.ts": 'import "m3:tokens.css";\n' },
      "main.ts",
      {
        nativeTheme: join(nativeCorpus!, "tokens.json"),
        theme: { seed: "#123456" },
        css: () => ":root { --caller-color: #123456; }",
        tailwind: false,
        sass: false,
      },
    );
    expect(output.success).toBe(true);
    expect(output.text).toContain("--caller-color: #123456");
    expect(output.text).not.toContain("--md-sys-color-primary");
  });
});

describe("m3:optional/<specifier>", () => {
  test("a resolvable module is its namespace with resolved: true", async () => {
    const { success, text, logs } = await bundle(
      {
        "main.ts":
          'import fonts, { resolved } from "m3:optional/@aphrody/m3-fonts"; console.log(resolved, Object.keys(fonts ?? {}).length);\n',
      },
      "main.ts",
      // Specifiers resolve from the app directory: the test's temporary directory has no node_modules, this package does.
      { configDir: import.meta.dir },
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("resolved");
    expect(text).toContain("FONT_STACKS");
  });
  test("a module that is not installed builds to null with resolved: false", async () => {
    const { success, text, logs } = await bundle(
      {
        "main.ts":
          'import brand, { resolved } from "m3:optional/@definitely/not-installed"; console.log(brand, resolved);\n',
      },
      "main.ts",
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("= null;");
    expect(text).toContain("var resolved = false;");
  });
});
