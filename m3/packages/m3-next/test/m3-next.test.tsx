// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import {
  M3_COLOR_SCHEME_SCRIPT,
  M3_SERVER_EXTERNAL_PACKAGES,
  M3_TRANSPILE_PACKAGES,
  colorSchemeFor,
  generateM3Metadata,
  generateM3Viewport,
  m3SchemeStylesheet,
  m3ThemeColors,
  parseThemeMode,
  rootDeclarations,
  themeCookie,
  withM3,
} from "../src/index";
import {
  M3Document,
  isBunRuntime,
  m3Css,
  m3CssResult,
  m3FfiError,
  m3SchemeCss,
} from "../src/server";

const pkgDir = join(import.meta.dir, "..");
const require = createRequire(join(pkgDir, "package.json"));
const nativeLib = ["bun_rs.dll", "libbun_rs.so", "libbun_rs.dylib"].some((name) =>
  existsSync(join(pkgDir, "../../target/release", name)),
);

describe("withM3", () => {
  test("adds the M3 packages, keeps user values and strict mode", () => {
    const config = withM3({
      transpilePackages: ["my-lib"],
      reactStrictMode: false,
      poweredByHeader: false,
    });
    expect(config.transpilePackages).toContain("my-lib");
    for (const name of M3_TRANSPILE_PACKAGES) expect(config.transpilePackages).toContain(name);
    expect(config.reactStrictMode).toBe(false);
    expect(config.poweredByHeader).toBe(false);
    expect(config.serverExternalPackages).toEqual([...M3_SERVER_EXTERNAL_PACKAGES]);
    expect(config.experimental?.optimizePackageImports).toContain("@aphrody/m3-primitives");
  });

  test("defaults strict mode on, deduplicates and never lists a package twice", () => {
    const config = withM3({
      transpilePackages: ["@aphrody/m3-theme"],
      serverExternalPackages: ["@aphrody/m3-ai", "sharp"],
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.transpilePackages!.filter((name) => name === "@aphrody/m3-theme")).toHaveLength(
      1,
    );
    // A transpiled package can never be external at the same time (Next rejects the overlap).
    expect(config.serverExternalPackages).toEqual(["sharp", "@aphrody/bun"]);
  });

  test("merges Turbopack options and the optional root", () => {
    const config = withM3(
      { turbopack: { resolveExtensions: [".tsx", ".ts", ".js"] } },
      { turbopackRoot: "/repo" },
    );
    expect(config.turbopack).toEqual({ resolveExtensions: [".tsx", ".ts", ".js"], root: "/repo" });
    expect(withM3({}).turbopack).toBeUndefined();
    expect(withM3({}, { optimizePackageImports: false }).experimental).toBeUndefined();
  });
});

describe("theme mode", () => {
  test("parses cookie values", () => {
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("bogus")).toBe("system");
    expect(parseThemeMode(undefined, "dark")).toBe("dark");
    expect(colorSchemeFor("system")).toBe("light dark");
    expect(themeCookie("dark")).toBe("m3-theme=dark; path=/; max-age=31536000; samesite=lax");
  });
});

describe("metadata and viewport", () => {
  test("theme-color is the scheme surface in both modes", () => {
    const colors = m3ThemeColors({ seed: "#0b57d0" });
    expect(colors.light).toBe(schemeFromSeed("#0b57d0")["--md-sys-color-surface"]!);
    expect(colors.dark).toBe(schemeFromSeed("#0b57d0", { dark: true })["--md-sys-color-surface"]!);
    const viewport = generateM3Viewport({ seed: "#0b57d0" });
    expect(viewport.colorScheme).toBe("light dark");
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: colors.light },
      { media: "(prefers-color-scheme: dark)", color: colors.dark },
    ]);
    expect(generateM3Viewport({ mode: "dark" }).themeColor).toBe(m3ThemeColors().dark);
  });

  test("metadata has a title template and merges overrides", () => {
    const metadata = generateM3Metadata({
      name: "M3",
      description: "d",
      url: "https://example.test",
      metadata: { robots: "noindex" },
    });
    expect(metadata.title).toEqual({ default: "M3", template: "%s · M3" });
    expect(String(metadata.metadataBase)).toBe("https://example.test/");
    expect(metadata.robots).toBe("noindex");
  });
});

describe("m3Css", () => {
  test("static sheets match the files of @aphrody/m3-theme", async () => {
    const result = await m3CssResult({ sheet: "tailwind" }, { noFfi: true });
    expect(result.source).toBe("static");
    expect(result.css).toBe(
      readFileSync(require.resolve("@aphrody/m3-theme/tailwind.css"), "utf8"),
    );
    expect(await m3Css({ sheet: "tokens" }, { noFfi: true })).toContain("--md-sys-color-primary:");
  });

  test("the JS scheme fallback equals material-color-utilities", async () => {
    const result = await m3CssResult(
      { sheet: "scheme", seed: "#b3261e", dark: true },
      { noFfi: true },
    );
    expect(result.source).toBe("js");
    expect(rootDeclarations(result.css)).toEqual(schemeFromSeed("#b3261e", { dark: true }));
  });

  test.skipIf(!isBunRuntime() || !nativeLib)(
    "under Bun the Rust renderer agrees with the JS scheme",
    async () => {
      const result = await m3CssResult({ sheet: "scheme", seed: "#b3261e" });
      expect(m3FfiError()).toBeUndefined();
      expect(result.source).toBe("ffi");
      const rust = rootDeclarations(result.css);
      for (const [role, value] of Object.entries(schemeFromSeed("#b3261e")))
        expect(rust[role]).toBe(value);
      const tokens = await m3CssResult({ sheet: "tokens" });
      expect(tokens.source).toBe("ffi");
      expect(tokens.css).toContain("--md-sys-color-primary:");
    },
  );

  test("the inline scheme sheet wires both modes to the classes and the media query", async () => {
    const { css } = await m3SchemeCss({ seed: "#6750a4" }, { noFfi: true });
    expect(css).toContain(":root {");
    expect(css).toContain("@media (prefers-color-scheme: dark) {\n  :root:not(.light) {");
    expect(css).toContain(":root.dark {");
    expect(css).toContain(":root.light {");
    expect(css.match(/--md-sys-color-primary:/g)).toHaveLength(4);
    expect(m3SchemeStylesheet({ "--a": "#000" }, { "--a": "#fff" })).toContain(
      "color-scheme: dark;\n    --a: #fff;",
    );
  });
});

describe("M3Document", () => {
  test("a forced mode sets the class and color-scheme, without the pre-paint script", () => {
    const html = renderToString(
      <M3Document mode="dark" className="font-plain" schemeCss=":root{--x:1}">
        hi
      </M3Document>,
    );
    expect(html).toContain('class="font-plain dark"');
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain('data-m3-theme="dark"');
    expect(html).toContain('<style id="m3-scheme">:root{--x:1}</style>');
    expect(html).not.toContain("m3-color-scheme");
    expect(html).toContain("<body>hi</body>");
  });

  test("system mode defers to the OS and resolves the class before paint", () => {
    const html = renderToString(<M3Document mode="system" lang="fr" />);
    expect(html).toContain('lang="fr"');
    expect(html).toContain("color-scheme:light dark");
    expect(html).not.toContain("class=");
    expect(html).toContain('<script id="m3-color-scheme">');
    expect(html).toContain(M3_COLOR_SCHEME_SCRIPT);
  });
});
