import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveCssHost } from "../scripts/css-host";

// Host theme parity requires a real explicit checkout; no site is fabricated.
const host = resolveCssHost("--site-root", "SHENRON_SITE_ROOT", ["src", "app", "globals.css"]);

const pkgCss = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
const siteCss = await Bun.file(host.stylesheet).text();
const combined = `${siteCss}\n${pkgCss}`;

// Parsed from source text: importing site-theme.ts would couple the package
// type-check to the site's module graph.
const siteTheme = await Bun.file(join(host.directory, "src", "lib", "site-theme.ts")).text();
const block = /export const THEME_COLOR_VARS = \{([\s\S]*?)\} as const;/.exec(siteTheme)?.[1] ?? "";
const themeVars = [...block.matchAll(/(\w+):\s*"(--dbz-[\w-]+)"/g)].map(m => m[2] as string);

/** Returns the body of every top-level `@layer components { … }` block. */
function componentLayers(css: string): string[] {
  const bodies: string[] = [];
  const re = /@layer components\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    bodies.push(css.slice(start, i - 1));
  }
  return bodies;
}

describe("styles.css", () => {
  test("THEME_COLOR_VARS was parsed", () => {
    expect(themeVars.length).toBeGreaterThanOrEqual(12);
  });

  test("every theme variable is consumed as var(--dbz-<x>, in the combined stylesheets", () => {
    expect(themeVars.filter(v => !combined.includes(`var(${v},`))).toEqual([]);
  });

  test("globals.css imports the package stylesheet right after tailwindcss", () => {
    const imports = siteCss.split(/\r?\n/).filter(l => l.startsWith("@import"));
    expect(imports.slice(0, 2)).toEqual(['@import "tailwindcss";', '@import "@shenron/ui/styles.css";']);
  });

  test("shared classes sit in @layer components", () => {
    const layered = componentLayers(pkgCss).join("\n");
    for (const cls of [".cible-44", ".card", ".btn", ".btn-primary", ".input", ".badge"]) {
      const escaped = cls.replaceAll(".", String.raw`\.`);
      const re = new RegExp(String.raw`${escaped}(?![\w-])[^{;]*\{`);
      expect({ cls, layered: re.test(layered) }).toEqual({
        cls,
        layered: true,
      });
    }
    // Nothing outside the layers declares these classes.
    let outside = pkgCss;
    for (const body of componentLayers(pkgCss)) outside = outside.replace(body, "");
    expect(/\.(card|btn|input|badge|cible-44)(?![\w-])[^{;]*\{/.test(outside.replace(/\/\*[\s\S]*?\*\//g, ""))).toBe(
      false,
    );
  });
});
