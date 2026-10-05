// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadTokens, lookupTokens, validateTokens } from "./catalog.ts";

const scratch = mkdtempSync(join(tmpdir(), "m3-token-catalog-"));
let fixtures = 0;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(exports: Record<string, unknown>, files: Record<string, string>): string {
  const root = join(scratch, String(fixtures++));
  const pkg = join(root, "packages/m3-tokens");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ exports }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(pkg, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

describe("the repository token catalogue", () => {
  test("Expressive typography, motion and directional shapes can be looked up and validated", () => {
    const names = [
      "--md-sys-typescale-display-large-emphasized-font",
      "--md-sys-motion-spring-expressive-fast-spatial-damping",
      "--md-sys-shape-corner-large-start",
    ];
    for (const name of names) {
      const tokens = lookupTokens(name);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.source).toBe("packages/m3-tokens/src/expressive.css");
    }
    expect(lookupTokens(names[1]!)[0]?.value).toBe("0.6");
    const input = names.map((name) => `var(${name})`).join(" ");
    expect(validateTokens(input)).toEqual({ checked: names, unknown: [] });
    expect(
      validateTokens(`${input} var(--md-sys-motion-spring-expressive-fast-spatial-dampng)`).unknown,
    ).toEqual(["--md-sys-motion-spring-expressive-fast-spatial-dampng"]);
  });

  test("base tokens, breakpoints and dynamic colour roles remain available without duplicates", () => {
    expect(lookupTokens("corner-full")[0]?.value).toBe("9999px");
    expect(lookupTokens("--md-breakpoint-expanded")[0]?.value).toBe("840px");
    expect(lookupTokens("--md-sys-color-on-primary-container")[0]?.source).toBe(
      "packages/m3-tokens/src/dynamic-color.ts",
    );
    const tokens = loadTokens();
    expect(new Set(tokens.map((token) => token.name)).size).toBe(tokens.length);
  });
});

describe("exported token sources", () => {
  test("reads exported CSS rather than unrelated files and retains the first declaration's source", () => {
    const root = fixture(
      {
        "./base.css": { default: "./src/base.css" },
        "./alias.css": "./src/base.css",
        "./extended.css": ["./src/extended.css"],
        "./helpers": "./src/helpers.ts",
      },
      {
        "src/base.css": `/* --md-commented-out: nope; */
        :root { --md-sys-shape-corner-large: 16px; --md-sys-color-primary: #6750a4; }
        .dark { --md-sys-shape-corner-large: 20px; }`,
        "src/extended.css":
          ":root { --md-sys-shape-corner-large: 32px; --md-sys-shape-corner-large-start: 16px 0 0 16px; }",
        "src/unexported.css": ":root { --md-unexported: hidden; }",
        "src/helpers.ts": "// --md-not-css: hidden;",
        "src/dynamic-color.ts": `export const ROLES = ["primary", 'surfaceBright', "primary", /* "hiddenRole" */];`,
      },
    );
    const tokens = loadTokens(root);
    expect(tokens).toHaveLength(4);
    expect(lookupTokens("--md-sys-shape-corner-large", 1, root)).toEqual([
      {
        name: "--md-sys-shape-corner-large",
        value: "16px",
        source: "packages/m3-tokens/src/base.css",
      },
    ]);
    expect(lookupTokens("--md-sys-color-primary", 50, root)).toEqual([
      {
        name: "--md-sys-color-primary",
        value: "#6750a4",
        source: "packages/m3-tokens/src/base.css",
      },
    ]);
    expect(lookupTokens("surface-bright", 50, root)).toEqual([
      {
        name: "--md-sys-color-surface-bright",
        value: "(dynamic colour role)",
        source: "packages/m3-tokens/src/dynamic-color.ts",
      },
    ]);
    expect(
      validateTokens(
        "var(--md-sys-shape-corner-large-start) var(--md-sys-color-surface-bright)",
        root,
      ).unknown,
    ).toEqual([]);
    expect(
      validateTokens(
        "--md-unexported --md-commented-out --md-not-css --md-sys-color-hidden-role",
        root,
      ).unknown,
    ).toEqual([
      "--md-unexported",
      "--md-commented-out",
      "--md-not-css",
      "--md-sys-color-hidden-role",
    ]);
  });

  test("missing exported sheets do not hide present sheets or dynamic roles", () => {
    const root = fixture(
      {
        "./missing.css": "./src/missing.css",
        "./present.css": "./src/present.css",
        "./outside.css": "../outside.css",
      },
      {
        "src/present.css": ":root { --md-present: 1px; }",
        "src/dynamic-color.ts": 'export const ROLES = ["onPrimaryContainer"];',
      },
    );
    expect(loadTokens(root).map((token) => token.name)).toEqual([
      "--md-present",
      "--md-sys-color-on-primary-container",
    ]);
    expect(
      validateTokens("--md-present --md-sys-color-on-primary-container --md-missing", root),
    ).toEqual({
      checked: ["--md-present", "--md-sys-color-on-primary-container", "--md-missing"],
      unknown: ["--md-missing"],
    });
  });

  test("an absent token checkout gives an empty catalogue and reports unknown references", () => {
    const root = join(scratch, "absent");
    expect(loadTokens(root)).toEqual([]);
    expect(lookupTokens("primary", 50, root)).toEqual([]);
    expect(validateTokens("var(--md-sys-color-primary)", root)).toEqual({
      checked: ["--md-sys-color-primary"],
      unknown: ["--md-sys-color-primary"],
    });
  });
});
