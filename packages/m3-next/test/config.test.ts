// SPDX-License-Identifier: Apache-2.0
// withM3 for Next 16: React Compiler, Cache Components, typed routes, Turbopack and the Tauri static export.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  M3_OPTIMIZE_PACKAGE_IMPORTS,
  M3_TRANSPILE_PACKAGES,
  colorSchemeScript,
  isTauriBuild,
  m3TypefaceCss,
  withM3,
} from "../src/index";

describe("withM3 options", () => {
  test("transpiles and optimises the Base UI layer", () => {
    const config = withM3({});
    expect(config.transpilePackages).toContain("@aphrody/m3-baseui");
    expect(config.experimental?.optimizePackageImports).toEqual(
      expect.arrayContaining(["@aphrody/m3-baseui", "@base-ui/react"]),
    );
    expect(M3_TRANSPILE_PACKAGES).toContain("@aphrody/m3-baseui");
    expect(M3_OPTIMIZE_PACKAGE_IMPORTS).toContain("@base-ui/react");
  });

  test("React Compiler, Cache Components and typed routes are Next 16 top-level keys", () => {
    const config = withM3({}, { reactCompiler: true, cacheComponents: true, typedRoutes: true });
    expect(config.reactCompiler).toBe(true);
    expect(config.cacheComponents).toBe(true);
    expect(config.typedRoutes).toBe(true);
    expect(withM3({}).reactCompiler).toBeUndefined();
    expect(withM3({}).cacheComponents).toBeUndefined();
  });

  test("an option never overrides a key the config sets", () => {
    const config = withM3(
      { reactCompiler: false, typedRoutes: false, cacheComponents: false },
      { reactCompiler: true, typedRoutes: true, cacheComponents: true },
    );
    expect(config.reactCompiler).toBe(false);
    expect(config.typedRoutes).toBe(false);
    expect(config.cacheComponents).toBe(false);
  });
});

describe("Tauri static export", () => {
  test("`tauri: true` makes an export a webview can load", () => {
    const config = withM3({}, { tauri: true, cacheComponents: true });
    expect(config.output).toBe("export");
    expect(config.trailingSlash).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    expect(config.cacheComponents).toBe(false);
    expect(config.env).toEqual({ NEXT_PUBLIC_M3_STATIC: "1" });
  });

  test("user values win", () => {
    const config = withM3(
      {
        output: "standalone",
        trailingSlash: false,
        images: { unoptimized: true, formats: ["image/avif"] },
        env: { A: "1" },
      },
      { tauri: true },
    );
    expect(config.output).toBe("standalone");
    expect(config.trailingSlash).toBe(false);
    expect(config.images).toEqual({
      unoptimized: true,
      formats: ["image/avif"],
    });
    expect(config.env).toEqual({ NEXT_PUBLIC_M3_STATIC: "1", A: "1" });
  });

  test("`tauri: false` and no option leave the config a server config", () => {
    for (const config of [withM3({}), withM3({}, { tauri: false })]) {
      expect(config.output).toBeUndefined();
      expect(config.env).toBeUndefined();
    }
  });

  test("`auto` follows the Tauri CLI environment", () => {
    expect(isTauriBuild({})).toBe(false);
    expect(isTauriBuild({ TAURI_ENV_PLATFORM: "linux" })).toBe(true);
    const before = process.env["TAURI_ENV_PLATFORM"];
    try {
      delete process.env["TAURI_ENV_PLATFORM"];
      delete process.env["TAURI_ENV_ARCH"];
      expect(withM3({}, { tauri: "auto" }).output).toBeUndefined();
      process.env["TAURI_ENV_PLATFORM"] = "linux";
      expect(withM3({}, { tauri: "auto" }).output).toBe("export");
    } finally {
      if (before === undefined) delete process.env["TAURI_ENV_PLATFORM"];
      else process.env["TAURI_ENV_PLATFORM"] = before;
    }
  });

  test("the dev asset prefix is set only for a dev host, and never in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { host: env["TAURI_DEV_HOST"], node: env["NODE_ENV"] };
    try {
      delete env["TAURI_DEV_HOST"];
      env["NODE_ENV"] = "development";
      expect(withM3({}, { tauri: true }).assetPrefix).toBeUndefined();
      expect(withM3({}, { tauri: { devHost: "192.168.1.5", devPort: 3100 } }).assetPrefix).toBe(
        "http://192.168.1.5:3100",
      );
      env["TAURI_DEV_HOST"] = "10.0.0.2";
      expect(withM3({}, { tauri: true }).assetPrefix).toBe("http://10.0.0.2:3000");
      env["NODE_ENV"] = "production";
      expect(withM3({}, { tauri: true }).assetPrefix).toBeUndefined();
    } finally {
      for (const [key, value] of [
        ["TAURI_DEV_HOST", saved.host],
        ["NODE_ENV", saved.node],
      ] as const) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    }
  });
});

/** Run the script against a minimal document and report the classes and color-scheme it leaves. */
function run(cookie: string, osDark: boolean, initial: string[] = [], name?: string) {
  const classes = new Set(initial);
  const root = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, on?: boolean) => {
        if (on ?? !classes.has(c)) classes.add(c);
        else classes.delete(c);
      },
    },
    style: { colorScheme: "" },
  };
  const script = colorSchemeScript(name);
  new Function("document", "window", script)(
    { documentElement: root, cookie },
    { matchMedia: () => ({ matches: osDark }) },
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- a copy: ES2022 has no toSorted
  return { classes: [...classes].sort(), colorScheme: root.style.colorScheme };
}

describe("the pre-paint script", () => {
  test("no cookie means system: the OS preference decides", () => {
    expect(run("", true)).toEqual({ classes: ["dark"], colorScheme: "dark" });
    expect(run("", false, ["dark"])).toEqual({
      classes: [],
      colorScheme: "light",
    });
    expect(run("other=1", true)).toEqual({
      classes: ["dark"],
      colorScheme: "dark",
    });
  });

  test("a saved light or dark preference wins over the OS", () => {
    expect(run("m3-theme=light", true)).toEqual({
      classes: ["light"],
      colorScheme: "light",
    });
    expect(run("a=b; m3-theme=dark", false)).toEqual({
      classes: ["dark"],
      colorScheme: "dark",
    });
    expect(run("m3-theme=system; x=y", true)).toEqual({
      classes: ["dark"],
      colorScheme: "dark",
    });
  });

  test("system clears a stale .light", () => {
    expect(run("m3-theme=system", false, ["light"])).toEqual({
      classes: [],
      colorScheme: "light",
    });
  });

  test("an invalid value is ignored, a custom cookie name is honoured", () => {
    expect(run("m3-theme=purple", true)).toEqual({
      classes: ["dark"],
      colorScheme: "dark",
    });
    expect(run("app-theme=light", true, [], "app-theme")).toEqual({
      classes: ["light"],
      colorScheme: "light",
    });
    expect(() => colorSchemeScript('we"ird;name')).toThrow("HTTP cookie token");
  });
});

describe("typefaces", () => {
  test("map the M3 reference typefaces onto the fonts an app loads", () => {
    expect(m3TypefaceCss({})).toBe("");
    expect(
      m3TypefaceCss({
        brand: "var(--font-roboto), sans-serif",
        code: "var(--font-mono)",
      }),
    ).toBe(
      ":root {\n  --md-ref-typeface-brand: var(--font-roboto), sans-serif;\n  --md-ref-typeface-code: var(--font-mono);\n}",
    );
  });

  test("a value cannot escape the declaration", () => {
    expect(m3TypefaceCss({ plain: "Inter; } body { display: none" })).not.toMatch(/[;}]\s*body/);
    expect(m3TypefaceCss({ plain: "</style><script>" })).not.toContain("<");
  });
});

describe("m3.css", () => {
  const css = readFileSync(join(import.meta.dir, "..", "m3.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  test("imports tokens, expressive tokens, the colour sheets and the Tailwind preset, in that order", () => {
    const imports = [...css.matchAll(/@import "([^"]+)";/g)].map(m => m[1]);
    expect(imports).toEqual([
      "@aphrody/m3-tokens/m3-tokens.css",
      "@aphrody/m3-tokens/expressive.css",
      "@aphrody/m3-theme/tokens.css",
      "@aphrody/m3-theme/tailwind.css",
      "@aphrody/m3-tailwind/preset.css",
    ]);
  });

  test("leaves the dark variant to the preset", () => {
    expect(css).not.toContain("@custom-variant");
  });
});
