// SPDX-License-Identifier: Apache-2.0
// The public surface: every Base UI primitive is wrapped, every class the wrappers emit has a rule, no rule is dead,
// the stylesheets only read M3 tokens, and the package maps resolve.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import * as index from "../src/index.ts";
import { BUTTON_SIZES, BUTTON_VARIANTS } from "../src/button.tsx";
import { INPUT_VARIANTS } from "../src/input.tsx";

const pkgDir = join(import.meta.dir, "..");
const read = (...p: string[]): string =>
  readFileSync(join(pkgDir, ...p), "utf8");
const manifest = JSON.parse(read("package.json")) as {
  exports: Record<string, string>;
  sideEffects: string[];
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
};

const baseDir = dirname(
  fileURLToPath(import.meta.resolve("@base-ui/react/package.json")),
);
const baseExports = Object.keys(
  (
    JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8")) as {
      exports: object;
    }
  ).exports,
);

/** Base UI entries that are not components: providers, helpers, hooks and types. */
const NON_VISUAL = new Set([
  "csp-provider",
  "direction-provider",
  "merge-props",
  "use-render",
  "unstable-use-media-query",
  "types",
]);
const components = baseExports
  .filter((k) => /^\.\/[a-z][a-z-]*$/.test(k) && k !== "./package.json")
  .map((k) => k.slice(2))
  .filter((name) => !NON_VISUAL.has(name));

const pascal = (name: string): string =>
  name
    .split("-")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssFiles = readdirSync(join(pkgDir, "css")).filter((f) =>
  f.endsWith(".css"),
);
const allCss = stripComments(cssFiles.map((f) => read("css", f)).join("\n"));
const srcFiles = readdirSync(join(pkgDir, "src")).filter((f) =>
  /\.tsx?$/.test(f),
);
const allSrc = srcFiles.map((f) => read("src", f)).join("\n");
const publicApi = index as Record<string, unknown>;

describe("coverage of Base UI", () => {
  test("Base UI ships the primitives this package expects", () => {
    expect(components.length).toBeGreaterThanOrEqual(38);
    expect(components).toContain("dialog");
    expect(components).toContain("otp-field");
  });

  for (const name of components) {
    test(`${name} is wrapped part for part`, async () => {
      const base = (await import(`@base-ui/react/${name}`)) as Record<
        string,
        unknown
      >;
      const [baseName, value] = Object.entries(base)[0]!;
      const isNamespace =
        typeof value === "object" &&
        value !== null &&
        !("$$typeof" in (value as object));
      const wrapper = (await import(`../src/${name}.tsx`)) as Record<
        string,
        unknown
      >;
      const publicName = `M3${pascal(name)}`;
      if (isNamespace) {
        const parts = Object.keys(value as object);
        expect(Object.keys(wrapper)).toEqual(expect.arrayContaining(parts));
        if (typeof publicApi[publicName] === "function") {
          // Closed form (`M3Switch`): its parts are exported flat (`M3SwitchRoot`, `M3SwitchThumb`).
          for (const part of parts)
            expect(typeof publicApi[`${publicName}${part}`]).toBe("function");
        } else {
          expect(typeof publicApi[publicName]).toBe("object");
          expect(Object.keys(publicApi[publicName] as object)).toEqual(
            expect.arrayContaining(parts),
          );
        }
      } else {
        // Single-element primitives and closed forms (`M3Switch`, `M3Checkbox`, `M3Radio`) are named after Base UI's export.
        expect(typeof (wrapper[`M3${baseName}`] ?? wrapper[publicName])).toBe(
          "function",
        );
        expect(
          typeof (publicApi[`M3${baseName}`] ?? publicApi[publicName]),
        ).toBe("function");
      }
    });
  }

  test("the non-visual Base UI pieces are re-exported", () => {
    expect(typeof index.mergeProps).toBe("function");
    expect(typeof index.useRender).toBe("function");
    expect(index.CSPProvider).toBeDefined();
    expect(index.DirectionProvider).toBeDefined();
  });

  test("every component module resolves through the package exports", () => {
    expect(manifest.exports["./*"]).toBe("./src/*.tsx");
    for (const name of components) expect(srcFiles).toContain(`${name}.tsx`);
  });
});

describe("stylesheets", () => {
  test("the aggregate imports core first and every sheet once", () => {
    const aggregate = read("m3-baseui.css");
    const imports = [
      ...aggregate.matchAll(/@import "\.\/css\/([\w-]+)\.css";/g),
    ].map((m) => m[1]!);
    expect(imports[0]).toBe("core");
    expect(new Set(imports).size).toBe(imports.length);
    expect(new Set(imports)).toEqual(
      new Set(cssFiles.map((f) => f.slice(0, -4))),
    );
  });

  test("each sheet is entirely inside @layer components, so utilities and app CSS win", () => {
    for (const file of cssFiles) {
      const css = stripComments(read("css", file)).trim();
      expect(css.startsWith("@layer components {")).toBe(true);
      let depth = 0;
      let closedAt = -1;
      for (let i = 0; i < css.length; i += 1) {
        if (css[i] === "{") depth += 1;
        if (css[i] === "}") depth -= 1;
        if (depth === 0 && css[i] === "}") closedAt = i;
        if (closedAt >= 0 && i > closedAt && !/\s/.test(css[i]!))
          throw new Error(`${file}: rules outside @layer components`);
      }
      expect(depth).toBe(0);
    }
  });

  test("no hard-coded colours: only tokens and color-mix of tokens", () => {
    expect(allCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(allCss).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/);
  });

  test("every --md-* token a sheet reads exists in the token sheets or is a colour role", () => {
    const tokens =
      readFileSync(
        fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css")),
        "utf8",
      ) +
      readFileSync(
        fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/expressive.css")),
        "utf8",
      );
    const defined = new Set(
      [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!),
    );
    for (const role of ROLES)
      defined.add(
        `--md-sys-color-${role.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
      );
    const used = new Set(
      [...allCss.matchAll(/var\((--md-[\w-]+)/g)].map((m) => m[1]!),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  test("every --m3-bui-font-* shorthand that a sheet reads is defined in core.css", () => {
    const core = stripComments(read("css", "core.css"));
    const defined = new Set(
      [...core.matchAll(/(--m3-bui-font-[\w-]+)\s*:/g)].map((m) => m[1]!),
    );
    const used = new Set(
      [...allCss.matchAll(/var\((--m3-bui-font-[\w-]+)/g)].map((m) => m[1]!),
    );
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  test("a class the wrappers emit has a rule, and a rule has a wrapper", () => {
    const emitted = new Set<string>();
    for (const m of allSrc.matchAll(/"(m3-bui-[\w -]*)"/g))
      for (const token of m[1]!.split(" ")) emitted.add(token);
    for (const v of BUTTON_VARIANTS) emitted.add(`m3-bui-button--${v}`);
    // The default size (`sm`) and the default input variant (`outlined`) are the base class.
    for (const size of BUTTON_SIZES.filter((name) => name !== "sm"))
      emitted.add(`m3-bui-button--${size}`);
    for (const variant of INPUT_VARIANTS.filter((name) => name !== "outlined"))
      emitted.add(`m3-bui-input--${variant}`);

    const ruled = new Set(
      [...allCss.matchAll(/\.(m3-bui-[\w-]+)/g)].map((m) => m[1]!),
    );
    // Classes documented for the app to add, not emitted by a wrapper.
    const documented = new Set(["m3-bui-tabs--secondary"]);

    expect([...emitted].filter((c) => !ruled.has(c))).toEqual([]);
    expect(
      [...ruled].filter((c) => !emitted.has(c) && !documented.has(c)),
    ).toEqual([]);
  });
});

describe("package", () => {
  test("no MUI, emotion or CSS-in-JS residue", () => {
    expect(allSrc + allCss).not.toMatch(
      /@mui|\bMui[A-Z]|@emotion|styled-components|makeStyles/,
    );
  });

  test("every wrapper module is a client boundary; the helper and the barrel are not", () => {
    for (const f of srcFiles) {
      const isBoundary = /^"use client";$/m.test(read("src", f));
      expect([f, isBoundary]).toEqual([
        f,
        f !== "index.ts" && f !== "part.tsx",
      ]);
    }
  });

  test("tree-shakeable: ESM, side effects only in CSS, no catch-all namespace of Base UI", () => {
    expect(manifest.sideEffects).toEqual(["*.css"]);
    expect(allSrc).not.toMatch(/export \* as \w+ from "@base-ui\/react"/);
    expect(Object.keys(manifest.dependencies)).toEqual(["@base-ui/react"]);
    expect(manifest.peerDependencies["react"]).toBe(">=19.0.0");
  });
});
