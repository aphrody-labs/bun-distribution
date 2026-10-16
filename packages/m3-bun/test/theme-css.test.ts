// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import {
  exportedScheme,
  mcuM3Css,
  m3CssFor,
  nativeM3Css,
  nativeThemeExport,
  schemeVariant,
  tsM3Css,
} from "../src/theme-css.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const native = await nativeM3Css();
const found = await nativeThemeExport(import.meta.dir, { seed: "#8c6c88" });

describe("mcuM3Css", () => {
  test("tokens: static token CSS plus light and dark colour roles of the seed", () => {
    const css = mcuM3Css({ sheet: "tokens", seed: "#6750a4" });
    expect(css).toContain("--md-sys-shape-corner-medium: 12px");
    expect(css).toContain("--md-sys-color-primary: #65558f");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
  });
  test("scheme: one mode, so dark differs from light", () => {
    const light = mcuM3Css({ sheet: "scheme", seed: "#6750a4" });
    const dark = mcuM3Css({ sheet: "scheme", seed: "#6750a4", dark: true });
    expect(light).toContain("--md-sys-color-primary: #65558f");
    expect(dark).toContain("--md-sys-color-primary: #cfbdfe");
    expect(light).not.toBe(dark);
  });
  test("seed, variant and contrast change the roles", () => {
    const base = mcuM3Css({ sheet: "scheme", seed: "#6750a4" });
    expect(mcuM3Css({ sheet: "scheme", seed: "#00897b" })).not.toBe(base);
    expect(
      mcuM3Css({ sheet: "scheme", seed: "#6750a4", variant: "vibrant" }),
    ).not.toBe(base);
    expect(
      mcuM3Css({ sheet: "scheme", seed: "#6750a4", contrast: 1 }),
    ).not.toBe(base);
  });
  test("the Rust-only sheets say what to use instead", () => {
    expect(() => mcuM3Css({ sheet: "tailwind" })).toThrow(
      /m3-tailwind\/preset\.css/,
    );
    expect(() => mcuM3Css({ sheet: "spaceui" })).toThrow(
      /needs the Rust m3Css/,
    );
  });
  test("schemeVariant accepts camelCase and kebab-case and rejects the rest", () => {
    expect(schemeVariant(undefined)).toBe("tonalSpot");
    expect(schemeVariant("tonal-spot")).toBe("tonalSpot");
    expect(schemeVariant("tonalSpot")).toBe("tonalSpot");
    expect(schemeVariant("monochrome")).toBe("monochrome");
    expect(() => schemeVariant("rainbow")).toThrow(/unknown scheme variant/);
  });
});

describe("engines", () => {
  test("tsM3Css is the Rust m3Css when it loads, else the MCU generator", () => {
    const config = { sheet: "scheme", seed: "#00897b", dark: true } as const;
    expect(tsM3Css(config)).toBe((native ?? mcuM3Css)(config));
  });
  test("m3CssFor: mcu on request, unknown engines are errors", async () => {
    expect(await m3CssFor("mcu")).toBe(mcuM3Css);
    await expect(m3CssFor("wasm" as never)).rejects.toThrow(
      /unknown css engine wasm \(native, mcu\)/,
    );
  });
  test("m3CssFor native serves the committed default theme sheet", async () => {
    const css = (await m3CssFor("native"))({ sheet: "tokens" });
    expect(css).toContain("--md-sys-color-primary: #65558f");
  });
  test.skipIf(native !== undefined)(
    "m3CssFor native names the missing library for a custom theme",
    async () => {
      const generate = await m3CssFor("native");
      expect(() => generate({ sheet: "scheme", seed: "#00897b" })).toThrow(
        /needs the @aphrody\/bun native library/,
      );
    },
  );
  test.skipIf(native === undefined)(
    "m3CssFor native is the Rust m3Css for any theme",
    async () => {
      const generate = await m3CssFor("native");
      expect(generate({ sheet: "scheme", seed: "#00897b" })).toBe(
        native!({ sheet: "scheme", seed: "#00897b" }),
      );
    },
  );
});

describe("nativeThemeExport", () => {
  test.skipIf(!found)(
    "reuses the validated Rust ThemeExport above the app when it was exported for the theme",
    async () => {
      expect(found!.path.replaceAll("\\", "/")).toEndWith(
        "var/mirrors/design-sync/tokens.json",
      );
      expect(found!.theme).toMatchObject({
        schema_version: 1,
        seed: "#8c6c88",
        variant: "tonal-spot",
        contrast_level: 0,
      });
      expect(Object.keys(found!.theme.light)).toHaveLength(49);
      expect(
        await nativeThemeExport(import.meta.dir, {
          seed: "#8c6c88",
          contrast: 0.5,
        }),
      ).toBeUndefined();
      expect(
        await nativeThemeExport(import.meta.dir, { seed: "#6750a4" }),
      ).toBeUndefined();
    },
  );
  test.skipIf(!found)(
    "m3CssFor native serves the ThemeExport for its own theme, without the native library",
    async () => {
      const generate = await m3CssFor("native", import.meta.dir);
      const scheme = generate({ sheet: "scheme", seed: "#8c6c88", dark: true });
      expect(scheme).toBe(exportedScheme(found!.theme, true));
      expect(scheme).toContain(
        `--md-sys-color-primary-container: ${found!.theme.dark.primaryContainer};`,
      );
      expect(generate({ sheet: "tokens", seed: "#8c6c88" })).toContain(
        `--md-sys-color-primary: ${found!.theme.light.primary}`,
      );
      expect(generate({ sheet: "tokens" })).toContain(
        "--md-sys-color-primary: #65558f",
      );
    },
  );
  test("APHRODY_DESIGN_CORPUS without an export gives nothing", async () => {
    const saved = Bun.env.APHRODY_DESIGN_CORPUS;
    Bun.env.APHRODY_DESIGN_CORPUS = tmp("m3-bun-corpus-");
    try {
      expect(
        await nativeThemeExport(import.meta.dir, { seed: "#8c6c88" }),
      ).toBeUndefined();
    } finally {
      if (saved === undefined) delete Bun.env.APHRODY_DESIGN_CORPUS;
      else Bun.env.APHRODY_DESIGN_CORPUS = saved;
    }
  });
});
