// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { m3Bun } from "../src/plugin.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

async function bundle(files: Record<string, string>, entry: string, options: Parameters<typeof m3Bun>[0] = {}): Promise<{ success: boolean; logs: string[]; text: string }> {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) await Bun.write(join(dir, name), content);
  const result = await Bun.build({ entrypoints: [join(dir, entry)], root: dir, target: "browser", plugins: [m3Bun({ configDir: dir, ...options })], throw: false });
  const text = (await Promise.all(result.outputs.map((o) => o.text()))).join("\n");
  return { success: result.success, logs: result.logs.map(String), text };
}

describe("m3Bun: the one plugin", () => {
  test("m3:theme.css, m3:tokens.css and m3:scheme.css come from the seed without the Rust library", async () => {
    const { success, text, logs } = await bundle(
      { "main.css": '@import "m3:tokens.css";\n@import "m3:scheme.css";\nbody { color: var(--md-sys-color-primary); }\n' },
      "main.css",
      { theme: { seed: "#00897b", variant: "vibrant" } },
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("--md-sys-color-primary");
    expect(text).toContain("--md-sys-shape-corner-medium");
  });

  test("m3:icons/<name> is the SVG markup from the forked catalogue; variants and errors", async () => {
    const ok = await bundle({ "main.ts": 'import a from "m3:icons/home"; import b from "m3:icons/rounded/home?fill=1"; console.log(a, b);\n' }, "main.ts");
    expect(ok.success).toBe(true);
    expect(ok.text).toContain("<svg xmlns=");
    const missing = await bundle({ "main.ts": 'import a from "m3:icons/no_such_symbol_xyz"; console.log(a);\n' }, "main.ts");
    expect(missing.success).toBe(false);
    expect(missing.logs.join("\n")).toContain("no_such_symbol_xyz");
  });

  test("m3:fonts.css falls back to @aphrody/m3-fonts when no Aphrody OS checkout holds the fonts", async () => {
    const { success, text, logs } = await bundle({ "main.css": '@import "m3:fonts.css";\n' }, "main.css");
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("@font-face");
    expect(text).toContain("Google Sans Flex");
  });

  test("an app can pass its own css generator for the sheets the TypeScript one does not know", async () => {
    const { success, text } = await bundle({ "main.css": '@import "m3:spaceui.css";\n' }, "main.css", {
      css: (config) => `/* ${config.sheet} */ :root { --custom: 1; }`,
    });
    expect(success).toBe(true);
    expect(text).toContain("--custom");
    const fallback = await bundle({ "main.css": '@import "m3:spaceui.css";\n' }, "main.css");
    expect(fallback.success).toBe(false);
    expect(fallback.logs.join("\n")).toContain("needs the Rust m3Css");
  });
});

describe("m3:optional/<specifier>", () => {
  test("a resolvable module is its namespace with resolved: true", async () => {
    const { success, text, logs } = await bundle(
      { "main.ts": 'import fonts, { resolved } from "m3:optional/@aphrody/m3-fonts"; console.log(resolved, Object.keys(fonts ?? {}).length);\n' },
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
      { "main.ts": 'import brand, { resolved } from "m3:optional/@definitely/not-installed"; console.log(brand, resolved);\n' },
      "main.ts",
    );
    expect({ success, logs }).toEqual({ success: true, logs: [] });
    expect(text).toContain("= null;");
    expect(text).toContain("var resolved = false;");
  });
});
