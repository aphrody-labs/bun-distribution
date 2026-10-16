// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeM3Css, nativeThemeExport } from "../src/theme-css.ts";
import { colorRoles, ogImage } from "../src/tools-og.ts";
import { cleanup, fixtureCopy, tmp } from "./helpers.ts";

afterAll(cleanup);

const canvas = await import("@aphrody/canvas").catch(() => undefined);
const native = await nativeM3Css();
const exported = await nativeThemeExport(import.meta.dir, { seed: "#8c6c88" });

test("colorRoles reads the --md-sys-color declarations, first one wins", () => {
  expect(
    colorRoles(
      ":root { --md-sys-color-on-surface: #1D1B20; --md-sys-color-primary:#65558f }\n.dark { --md-sys-color-primary: #cfbdfe; }",
    ),
  ).toEqual({ onSurface: "#1d1b20", primary: "#65558f" });
});

const hex = (data: Uint8ClampedArray, offset: number): string =>
  `#${[...data.subarray(offset, offset + 3)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

describe.skipIf(!canvas?.isNativeCanvasAvailable())("ogImage", () => {
  test("draws a 1200 x 630 PNG in the theme roles of the app", async () => {
    const dir = fixtureCopy();
    const out = join(tmp("m3-bun-og-"), "og.png");
    const report = await ogImage({ dir, engine: "mcu", out });
    expect(report).toMatchObject({ file: out, width: 1200, height: 630 });
    expect(report.colors).toEqual({
      surface: "#fdf7ff",
      onSurface: "#1d1b20",
      onSurfaceVariant: "#49454e",
      primary: "#65558f",
      primaryContainer: "#e9ddff",
    });
    const bytes = await Bun.file(out).bytes();
    expect(bytes.length).toBe(report.bytes);
    const image = await canvas!.loadImage(out);
    expect([image.width, image.height]).toEqual([1200, 630]);
    const surface = canvas!.createCanvas(1200, 630);
    const ctx = surface.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, 1200, 630).data;
    expect(hex(pixels, 0)).toBe(report.colors.surface);
    expect(hex(pixels, (629 * 1200 + 1199) * 4)).toBe(
      report.colors.primaryContainer,
    );
  });

  test("dark scheme, custom size and WebP from the extension", async () => {
    const out = join(tmp("m3-bun-og-"), "og.webp");
    const report = await ogImage({
      dir: fixtureCopy(),
      engine: "mcu",
      dark: true,
      width: 600,
      height: 315,
      out,
    });
    expect(report.colors.surface).toBe("#141218");
    expect(
      new TextDecoder().decode((await Bun.file(out).bytes()).subarray(8, 12)),
    ).toBe("WEBP");
  });

  test.skipIf(!exported)(
    "the native engine draws in the roles of the Rust ThemeExport of the app's theme",
    async () => {
      const dir = fixtureCopy();
      const config = join(dir, "m3.config.ts");
      writeFileSync(
        config,
        readFileSync(config, "utf8").replace("#6750a4", "#8c6c88"),
      );
      const report = await ogImage({ dir, out: join(tmp(), "og.png") });
      const { light } = exported!.theme;
      expect(report.colors).toEqual({
        surface: light.surface!,
        onSurface: light.onSurface!,
        onSurfaceVariant: light.onSurfaceVariant!,
        primary: light.primary!,
        primaryContainer: light.primaryContainer!,
      });
    },
  );

  test.skipIf(native !== undefined)(
    "the native engine without @aphrody/bun names the missing library",
    async () => {
      await expect(
        ogImage({ dir: fixtureCopy(), out: join(tmp(), "og.png") }),
      ).rejects.toThrow(/needs the @aphrody\/bun native library/);
    },
  );
});
